/**
 * yoloBrowserInference.js
 * ───────────────────────────────────────────────────────────────────────────
 * Real in-browser Computer Vision engine powered by ONNX Runtime Web
 * running the project's trained YOLOv8n-seg neural network weights
 * (/models/hrt_yolov8_crack.onnx) paired with a connected-component
 * Laplacian concrete spalling detector.
 */

import * as ort from 'onnxruntime-web/wasm';
import { boxIoU, consolidateBoxes } from './defectTracker';

let sessionPromise = null;

/** Configure single-threaded WASM so Vercel hosts without COOP/COEP work reliably. */
export async function getYoloSession(onStatus) {
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    onStatus?.('Loading YOLOv8n-seg neural model (12.6 MB)…');
    ort.env.wasm.numThreads = 1;

    const session = await ort.InferenceSession.create('/models/hrt_yolov8_crack.onnx', {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    onStatus?.('YOLOv8n-seg neural engine ready');
    return session;
  })().catch((err) => {
    sessionPromise = null;
    throw err;
  });

  return sessionPromise;
}

const CLOCK_LABELS = [
  "12 o'clock (Crown)",
  "1 o'clock (Upper Right)",
  "2 o'clock (Right Haunch)",
  "3 o'clock (Right Wall)",
  "4 o'clock (Lower Right)",
  "5 o'clock (Invert Haunch)",
  "6 o'clock (Invert / Floor)",
  "7 o'clock (Invert Haunch)",
  "8 o'clock (Lower Left)",
  "9 o'clock (Left Wall)",
  "10 o'clock (Left Haunch)",
  "11 o'clock (Upper Left)",
];

function computeSpatialProps(cxNorm, cyNorm, bwNorm, bhNorm, chainageZ) {
  // Angle around tunnel cross-section: 0 deg = 12 o'clock (top)
  const dx = cxNorm - 0.5;
  const dy = -(cyNorm - 0.5);
  const rad = Math.atan2(dx, dy);
  const deg = ((rad * 180) / Math.PI + 360) % 360;
  const hourIdx = Math.round(deg / 30) % 12;

  const R = 2.95;
  const x = Number((R * Math.sin(rad)).toFixed(3));
  const y = Number((R * Math.cos(rad)).toFixed(3));

  // Calibrate approximate mm at ROV optical stand-off (~640x480 reference)
  const pxW = bwNorm * 640;
  const pxH = bhNorm * 480;
  const longPx = Math.max(pxW, pxH);
  const shortPx = Math.min(pxW, pxH);

  const height_mm = Math.max(25, Math.round(longPx * 1.65));
  const width_mm = Number(Math.max(0.8, Math.min(28.0, shortPx * 0.085)).toFixed(1));

  return {
    clock_pos: CLOCK_LABELS[hourIdx],
    angle_deg: Number(deg.toFixed(1)),
    x,
    y,
    chainage_z: Number(chainageZ.toFixed(2)),
    width_mm,
    height_mm,
  };
}

/** Letterbox a region of source canvas into reusable 640x640 NCHW Float32 tensor */
function prepareTileTensor(srcCanvas, x0, y0, cropW, cropH, workCanvas, workCtx) {
  const scale = Math.min(640 / cropW, 640 / cropH);
  const nw = Math.round(cropW * scale);
  const nh = Math.round(cropH * scale);
  const dw = Math.floor((640 - nw) / 2);
  const dh = Math.floor((640 - nh) / 2);

  workCtx.fillStyle = 'rgb(114, 114, 114)';
  workCtx.fillRect(0, 0, 640, 640);
  workCtx.drawImage(srcCanvas, x0, y0, cropW, cropH, dw, dh, nw, nh);

  const imgData = workCtx.getImageData(0, 0, 640, 640).data;
  const floatData = new Float32Array(3 * 640 * 640);
  const area = 640 * 640;

  for (let p = 0; p < area; p++) {
    const idx = p * 4;
    floatData[p] = imgData[idx] / 255.0;
    floatData[area + p] = imgData[idx + 1] / 255.0;
    floatData[2 * area + p] = imgData[idx + 2] / 255.0;
  }

  return {
    tensor: new ort.Tensor('float32', floatData, [1, 3, 640, 640]),
    scale,
    dw,
    dh,
  };
}

/** Supplementary CV check for exposed rebar / severe concrete spalling cavities */
function detectSpallingClusters(srcCanvas, existingBoxes, W, H) {
  // Analyze at fast downscaled 280x160 resolution
  const sw = 280;
  const sh = 160;
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, sw, sh);
  const rgba = ctx.getImageData(0, 0, sw, sh).data;

  const luma = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const p = i * 4;
    luma[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  }

  // Laplacian variance per cell in 14x10 grid (skip outer HUD/ROV bumper borders)
  const COLS = 14;
  const ROWS = 10;
  const cw = Math.floor(sw / COLS);
  const ch = Math.floor(sh / ROWS);
  const hotCells = [];

  for (let r = 1; r < ROWS - 2; r++) {
    for (let col = 1; col < COLS - 1; col++) {
      let sumL = 0;
      let darkCount = 0;
      let lapSum = 0;
      let lapSq = 0;
      let n = 0;

      for (let y = r * ch + 1; y < (r + 1) * ch - 1; y++) {
        for (let x = col * cw + 1; x < (col + 1) * cw - 1; x++) {
          const idx = y * sw + x;
          const v = luma[idx];
          sumL += v;
          if (v < 65) darkCount++;
          const lap = luma[idx - 1] + luma[idx + 1] + luma[idx - sw] + luma[idx + sw] - 4 * v;
          lapSum += lap;
          lapSq += lap * lap;
          n++;
        }
      }

      if (n === 0) continue;
      const meanL = sumL / n;
      const darkFrac = darkCount / n;
      const meanLap = lapSum / n;
      const lapVar = lapSq / n - meanLap * meanLap;

      if (meanL > 62 && meanL < 172 && lapVar > 165 && darkFrac > 0.05 && darkFrac < 0.48) {
        hotCells.push({ r, col, lapVar });
      }
    }
  }

  // Group 8-connected adjacent hot cells; require >= 2 connected cells
  const visited = new Set();
  const clusters = [];

  for (const cell of hotCells) {
    const key = `${cell.r},${cell.col}`;
    if (visited.has(key)) continue;

    const queue = [cell];
    const group = [];
    visited.add(key);

    while (queue.length > 0) {
      const cur = queue.shift();
      group.push(cur);
      for (const other of hotCells) {
        const ok = `${other.r},${other.col}`;
        if (!visited.has(ok) && Math.abs(other.r - cur.r) <= 1 && Math.abs(other.col - cur.col) <= 1) {
          visited.add(ok);
          queue.push(other);
        }
      }
    }

    if (group.length >= 2) {
      const minC = Math.min(...group.map((g) => g.col));
      const maxC = Math.max(...group.map((g) => g.col)) + 1;
      const minR = Math.min(...group.map((g) => g.r));
      const maxR = Math.max(...group.map((g) => g.r)) + 1;

      const x1 = (minC / COLS) * W;
      const y1 = (minR / ROWS) * H;
      const x2 = (maxC / COLS) * W;
      const y2 = (maxR / ROWS) * H;
      const avgVar = group.reduce((s, g) => s + g.lapVar, 0) / group.length;
      const conf = Number(Math.min(0.92, 0.58 + (avgVar - 165) / 450).toFixed(2));

      const cand = { x1, y1, x2, y2, confidence: conf, class: 'spalling' };
      const overlapsYolo = existingBoxes.some((b) => boxIoU(cand, b) > 0.35);
      if (!overlapsYolo) clusters.push(cand);
    }
  }

  return clusters;
}

/**
 * Capture a lightweight 480px-wide JPEG data URL from the current frame canvas.
 */
export function captureSnapshot(srcCanvas) {
  const targetW = 480;
  const ratio = srcCanvas.height / Math.max(1, srcCanvas.width);
  const targetH = Math.round(targetW * ratio);
  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = targetW;
  snapCanvas.height = targetH;
  const ctx = snapCanvas.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0, targetW, targetH);
  return snapCanvas.toDataURL('image/jpeg', 0.68);
}

/**
 * Run YOLOv8n-seg ONNX (tiled for deep scan, or fast single-frame for live webcam) on a video element or canvas.
 */
export async function detectVideoFrame(
  videoEl,
  { frameIndex = 0, videoTime = 0, chainageZ = 0, confThreshold = 0.25, tiled = true } = {}
) {
  const W = videoEl.videoWidth || videoEl.width || 640;
  const H = videoEl.videoHeight || videoEl.height || 360;
  if (!W || !H) return { detections: [], snapshotUrl: null };

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = W;
  srcCanvas.height = H;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.drawImage(videoEl, 0, 0, W, H);

  const workCanvas = document.createElement('canvas');
  workCanvas.width = 640;
  workCanvas.height = 640;
  const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

  const session = await getYoloSession();
  const inputName = session.inputNames[0];

  // Multi-scale overlapping tiles for deep video scans, single full frame for real-time webcam
  const tiles = tiled
    ? [
        { x0: 0, y0: 0, w: W, h: H },
        { x0: 0, y0: 0, w: Math.round(W * 0.6), h: Math.round(H * 0.65) },
        { x0: Math.round(W * 0.4), y0: 0, w: W - Math.round(W * 0.4), h: Math.round(H * 0.65) },
        { x0: 0, y0: Math.round(H * 0.32), w: Math.round(W * 0.6), h: H - Math.round(H * 0.32) },
        { x0: Math.round(W * 0.4), y0: Math.round(H * 0.32), w: W - Math.round(W * 0.4), h: H - Math.round(H * 0.32) },
      ]
    : [{ x0: 0, y0: 0, w: W, h: H }];

  const rawBoxes = [];

  for (const tile of tiles) {
    const { tensor, scale, dw, dh } = prepareTileTensor(
      srcCanvas,
      tile.x0,
      tile.y0,
      tile.w,
      tile.h,
      workCanvas,
      workCtx
    );

    const results = await session.run({ [inputName]: tensor });
    const out0 = results[session.outputNames[0]]; // shape [1, 37, 8400]
    const data = out0.data;
    const anchors = out0.dims[2] || 8400;

    for (let a = 0; a < anchors; a++) {
      const conf = data[4 * anchors + a];
      if (conf < confThreshold) continue;

      const cx = data[a];
      const cy = data[anchors + a];
      const bw = data[2 * anchors + a];
      const bh = data[3 * anchors + a];

      const x1 = Math.max(0, ((cx - bw / 2) - dw) / scale + tile.x0);
      const y1 = Math.max(0, ((cy - bh / 2) - dh) / scale + tile.y0);
      const x2 = Math.min(W, ((cx + bw / 2) - dw) / scale + tile.x0);
      const y2 = Math.min(H, ((cy + bh / 2) - dh) / scale + tile.y0);

      const boxW = x2 - x1;
      const boxH = y2 - y1;
      if (boxW < 8 || boxH < 8) continue;
      if (boxW > W * 0.85 && boxH > H * 0.85) continue;

      rawBoxes.push({ x1, y1, x2, y2, confidence: conf, class: 'crack' });
    }
  }

  const mergedCracks = consolidateBoxes(rawBoxes, W, H, 0.35);
  const spallClusters = detectSpallingClusters(srcCanvas, mergedCracks, W, H);
  const combined = [...mergedCracks, ...spallClusters].slice(0, 6);

  if (combined.length === 0) {
    return { detections: [], snapshotUrl: null };
  }

  const snapshotUrl = captureSnapshot(srcCanvas);

  const detections = combined.map((box, idx) => {
    const leftPct = Number(((box.x1 / W) * 100).toFixed(2));
    const topPct = Number(((box.y1 / H) * 100).toFixed(2));
    const widthPct = Number((((box.x2 - box.x1) / W) * 100).toFixed(2));
    const heightPct = Number((((box.y2 - box.y1) / H) * 100).toFixed(2));

    const cxNorm = (box.x1 + box.x2) / (2 * W);
    const cyNorm = (box.y1 + box.y2) / (2 * H);
    const bwNorm = (box.x2 - box.x1) / W;
    const bhNorm = (box.y2 - box.y1) / H;

    const spatial = computeSpatialProps(cxNorm, cyNorm, bwNorm, bhNorm, chainageZ);

    let severity = 'Minor';
    if (box.class === 'spalling') {
      severity = box.confidence >= 0.72 || widthPct * heightPct > 180 ? 'Major' : 'Minor';
    } else if (box.confidence >= 0.60 || spatial.width_mm >= 3.0 || spatial.height_mm >= 200) {
      severity = 'Critical';
    } else if (box.confidence >= 0.36 || spatial.height_mm >= 110) {
      severity = 'Major';
    }

    const subtype =
      box.class === 'spalling'
        ? 'Concrete Spalling / Exposed Rebar Cavity'
        : bwNorm < bhNorm * 0.65
          ? 'Longitudinal Structural Crack'
          : bhNorm < bwNorm * 0.65
            ? 'Circumferential Wall Crack'
            : 'Branching Fracture Network';

    return {
      localId: `DET-${frameIndex}-${idx}`,
      class: box.class,
      subtype,
      severity,
      confidence: Number(box.confidence.toFixed(3)),
      frame_index: frameIndex,
      video_time: Number(videoTime.toFixed(2)),
      clock_pos: spatial.clock_pos,
      angle_deg: spatial.angle_deg,
      x: spatial.x,
      y: spatial.y,
      chainage_z: spatial.chainage_z,
      width_mm: spatial.width_mm,
      height_mm: spatial.height_mm,
      image_url: snapshotUrl,
      bbox: {
        x1: Math.round((box.x1 / W) * 640),
        y1: Math.round((box.y1 / H) * 480),
        x2: Math.round((box.x2 / W) * 640),
        y2: Math.round((box.y2 / H) * 480),
        left_pct: leftPct,
        top_pct: topPct,
        width_pct: widthPct,
        height_pct: heightPct,
      },
    };
  });

  return { detections, snapshotUrl };
}
