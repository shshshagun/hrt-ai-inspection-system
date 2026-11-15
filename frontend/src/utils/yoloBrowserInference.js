/**
 * yoloBrowserInference.js
 * ───────────────────────────────────────────────────────────────────────────
 * Real in-browser Computer Vision engine powered by ONNX Runtime Web
 * running the project's trained YOLOv8n-seg neural network weights
 * (/models/hrt_yolov8_crack.onnx) paired with a connected-component
 * Laplacian concrete spalling detector.
 */

import * as ort from 'onnxruntime-web/wasm';
import { boxIoU, consolidateBoxes } from './defectTracker.js';

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
    nw,
    nh,
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

      if (meanL > 68 && meanL < 165 && lapVar > 240 && darkFrac > 0.08 && darkFrac < 0.40) {
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
      const conf = Number(Math.min(0.92, 0.60 + (avgVar - 240) / 450).toFixed(2));

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
 * Decodes the prototype mask for a single bounding box detection.
 * Computes dot product between 32 coefficients and prototype tensor subgrid,
 * applies logit > 0.0 thresholding, identifies 4-connected contour pixels,
 * and renders an offscreen canvas with semi-transparent fill and neon contour.
 *
 * @param {Float32Array} protoData - Flat [32, 160, 160] prototype tensor
 * @param {Float32Array} maskCoeffs - 32 mask coefficients
 * @param {Object} bounds - { px1, py1, px2, py2, pw, ph }
 * @param {boolean} isCritical - Whether detection is critical severity
 * @returns {{ maskUrl: string|null, maskCanvas: HTMLCanvasElement|null, activePixels: number }}
 */
export function decodeInstanceMask(protoData, maskCoeffs, { px1, py1, px2, py2, pw, ph }, isCritical = false) {
  if (!protoData || !maskCoeffs || pw <= 0 || ph <= 0) {
    return { maskUrl: null, maskCanvas: null, activePixels: 0 };
  }

  const maskGrid = new Uint8Array(pw * ph);
  let activePixels = 0;

  for (let py = py1; py < py2; py++) {
    const rowOffset = py * 160;
    const gridRow = (py - py1) * pw;

    for (let px = px1; px < px2; px++) {
      let logit = 0.0;
      const spatialIdx = rowOffset + px;

      for (let k = 0; k < 32; k++) {
        logit += maskCoeffs[k] * protoData[k * 25600 + spatialIdx];
      }

      // Sigmoid threshold: sigmoid(logit) > 0.5 <=> logit > 0.0
      if (logit > 0.0) {
        maskGrid[gridRow + (px - px1)] = 1;
        activePixels++;
      }
    }
  }

  if (activePixels === 0) {
    return { maskUrl: null, maskCanvas: null, activePixels: 0 };
  }

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = pw;
  maskCanvas.height = ph;
  const maskCtx = maskCanvas.getContext('2d');
  const imgData = maskCtx.createImageData(pw, ph);
  const rgba = imgData.data;

  // Styling Palette:
  // Neon Cyan (Standard/Major): fill rgba(0, 240, 255, 0.40), stroke rgba(0, 240, 255, 0.95)
  // Warning Red (Critical):     fill rgba(239, 68, 68, 0.45), stroke rgba(239, 68, 68, 0.95)
  const r = isCritical ? 239 : 0;
  const g = isCritical ? 68 : 240;
  const b = isCritical ? 68 : 255;
  const fillAlpha = isCritical ? 115 : 102; // ~0.45 or ~0.40
  const strokeAlpha = 242;                 // 0.95

  for (let ly = 0; ly < ph; ly++) {
    const row = ly * pw;
    for (let lx = 0; lx < pw; lx++) {
      const pIdx = row + lx;
      if (maskGrid[pIdx] === 0) continue;

      // 4-connected boundary check
      const isContour =
        lx === 0 ||
        lx === pw - 1 ||
        ly === 0 ||
        ly === ph - 1 ||
        maskGrid[pIdx - 1] === 0 ||
        maskGrid[pIdx + 1] === 0 ||
        maskGrid[pIdx - pw] === 0 ||
        maskGrid[pIdx + pw] === 0;

      const offset = pIdx * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = isContour ? strokeAlpha : fillAlpha;
    }
  }

  maskCtx.putImageData(imgData, 0, 0);
  const maskUrl = maskCanvas.toDataURL('image/png');

  return { maskCanvas, maskUrl, activePixels };
}

/**
 * Computes physical crack surface area (mm²) from prototype pixel count
 * calibrated to ROV camera optics (f=8mm, D=1000mm, pitch=0.00345mm/px).
 */
export function calculateCrackAreaMm2(activePixels, scale = 1.0) {
  if (!activePixels || activePixels <= 0) return 0.0;
  const s = Math.max(0.001, scale);
  const area = (activePixels * 2.9756) / (s * s);
  return Number(area.toFixed(1));
}

/**
 * Run YOLOv8n-seg ONNX (tiled for deep scan, or fast single-frame for live webcam) on a video element or canvas.
 */
export async function detectVideoFrame(
  videoEl,
  { frameIndex = 0, videoTime = 0, chainageZ = 0, confThreshold = 0.42, tiled = true } = {}
) {
  const mediaSource = videoEl;
  const W = mediaSource.videoWidth || mediaSource.naturalWidth || mediaSource.width || 640;
  const H = mediaSource.videoHeight || mediaSource.naturalHeight || mediaSource.height || 360;
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
    const out0 = results[session.outputNames[0]] || results['output0']; // shape [1, 37, 8400]
    const out1 = results[session.outputNames[1]] || results['output1']; // shape [1, 32, 160, 160]
    const data = out0.data;
    const protoData = out1 ? out1.data : null;
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

      let maskCanvas = null;
      let maskUrl = null;
      let activePixels = 0;
      let area_mm2 = 0;
      let destBox = null;

      if (protoData) {
        const maskCoeffs = new Float32Array(32);
        for (let k = 0; k < 32; k++) {
          maskCoeffs[k] = data[(5 + k) * anchors + a];
        }

        const mx1 = Math.max(0, Math.min(640, cx - bw / 2));
        const my1 = Math.max(0, Math.min(640, cy - bh / 2));
        const mx2 = Math.max(0, Math.min(640, cx + bw / 2));
        const my2 = Math.max(0, Math.min(640, cy + bh / 2));

        const px1 = Math.max(0, Math.min(159, Math.floor(mx1 / 4)));
        const py1 = Math.max(0, Math.min(159, Math.floor(my1 / 4)));
        const px2 = Math.max(px1 + 1, Math.min(160, Math.ceil(mx2 / 4)));
        const py2 = Math.max(py1 + 1, Math.min(160, Math.ceil(my2 / 4)));
        const pw = px2 - px1;
        const ph = py2 - py1;

        const isCritical = conf >= 0.60;
        const maskResult = decodeInstanceMask(
          protoData,
          maskCoeffs,
          { px1, py1, px2, py2, pw, ph },
          isCritical
        );

        maskCanvas = maskResult.maskCanvas;
        maskUrl = maskResult.maskUrl;
        activePixels = maskResult.activePixels;

        if (activePixels > 0) {
          area_mm2 = calculateCrackAreaMm2(activePixels, scale);
          const destX = Math.max(0, ((px1 * 4 - dw) / scale) + tile.x0);
          const destY = Math.max(0, ((py1 * 4 - dh) / scale) + tile.y0);
          const destW = (pw * 4) / scale;
          const destH = (ph * 4) / scale;
          destBox = { destX, destY, destW, destH };
        }
      }

      rawBoxes.push({
        x1,
        y1,
        x2,
        y2,
        confidence: conf,
        class: 'crack',
        maskCanvas,
        maskUrl,
        activePixels,
        area_mm2,
        destBox,
      });
    }
  }

  const mergedCracks = consolidateBoxes(rawBoxes, W, H, 0.35);
  const spallClusters = detectSpallingClusters(srcCanvas, mergedCracks, W, H);
  const combined = [...mergedCracks, ...spallClusters].slice(0, 6);

  if (combined.length === 0) {
    return { detections: [], snapshotUrl: null };
  }

  // Paint mask overlays for winning detections directly onto srcCanvas before snapshot capture
  for (const cand of combined) {
    if (cand.maskCanvas && cand.destBox && cand.destBox.destW > 0 && cand.destBox.destH > 0) {
      srcCtx.drawImage(
        cand.maskCanvas,
        cand.destBox.destX,
        cand.destBox.destY,
        cand.destBox.destW,
        cand.destBox.destH
      );
    }
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

    const area_mm2 =
      box.class === 'spalling'
        ? Number((spatial.width_mm * spatial.height_mm * 0.65).toFixed(1))
        : (box.area_mm2 && box.area_mm2 > 0)
          ? box.area_mm2
          : Number((spatial.width_mm * spatial.height_mm * 0.40).toFixed(1));

    // Readable ID: inspectionNo_CRK-001 format (assigned by caller via frameIndex prefix)
    const defectSeq = String(idx + 1).padStart(3, '0');
    const defectType = box.class === 'spalling' ? 'SPA' : 'CRK';
    return {
      localId: `${defectType}-${defectSeq}`,
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
      area_mm2,
      maskUrl: box.maskUrl || null,
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
