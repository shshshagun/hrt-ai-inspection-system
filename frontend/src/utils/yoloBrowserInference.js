/**
 * yoloBrowserInference.js
 * ───────────────────────────────────────────────────────────────────────────
 * Real in-browser Computer Vision engine powered by ONNX Runtime Web
 * running the project's trained YOLOv8n-seg neural network weights
 * (/models/hrt_yolov8_crack.onnx) paired with a connected-component
 * Laplacian concrete spalling detector.
 */

import * as ort from 'onnxruntime-web/wasm';
import { RULES, keepMainComponents, shapeMetrics } from './crackVerdict';
import { classifyCrop } from './crackClassifier';
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

      // The cells give a rough rectangle; shrink it to where the dark or rough pixels actually are (middle 90% of them)
      const rx1 = minC * cw; const rx2 = Math.min(sw - 1, maxC * cw);
      const ry1 = minR * ch; const ry2 = Math.min(sh - 1, maxR * ch);
      const xs = []; const ys = [];
      for (let y = Math.max(1, ry1); y < ry2; y++) {
        for (let x = Math.max(1, rx1); x < rx2; x++) {
          const idx = y * sw + x;
          const lap = luma[idx - 1] + luma[idx + 1] + luma[idx - sw] + luma[idx + sw] - 4 * luma[idx];
          if (luma[idx] < 65 || Math.abs(lap) > 28) { xs.push(x); ys.push(y); }
        }
      }
      let fx1 = rx1; let fx2 = rx2; let fy1 = ry1; let fy2 = ry2;
      if (xs.length >= 40) {
        xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
        const at = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * q)))];
        fx1 = Math.max(rx1, at(xs, 0.05) - 1); fx2 = Math.min(rx2, at(xs, 0.95) + 2);
        fy1 = Math.max(ry1, at(ys, 0.05) - 1); fy2 = Math.min(ry2, at(ys, 0.95) + 2);
      }
      const x1 = (fx1 / sw) * W;
      const y1 = (fy1 / sh) * H;
      const x2 = (fx2 / sw) * W;
      const y2 = (fy2 / sh) * H;
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
/** A square 224 x 224 canvas around a detection (with some context), with nothing drawn on it. */
export function cropCanvas(srcCanvas, box, W, H) {
  try {
    const cx = (box.x1 + box.x2) / 2; const cy = (box.y1 + box.y2) / 2;
    const side = Math.min(Math.min(W, H), Math.max(64, Math.max(box.x2 - box.x1, box.y2 - box.y1) * 1.5));
    const x0 = Math.max(0, Math.min(W - side, cx - side / 2));
    const y0 = Math.max(0, Math.min(H - side, cy - side / 2));
    const c = document.createElement('canvas');
    c.width = 224; c.height = 224;
    c.getContext('2d', { willReadFrequently: true }).drawImage(srcCanvas, x0, y0, side, side, 0, 0, 224, 224);
    return c;
  } catch {
    return null;
  }
}

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

  // Drop stray specks: keep the connected pieces that are a real part of the crack, so one far-off dot cannot stretch the box
  activePixels = keepMainComponents(maskGrid, pw, ph);
  if (activePixels === 0) {
    return { maskUrl: null, maskCanvas: null, activePixels: 0 };
  }

  const shape = shapeMetrics(maskGrid, pw, ph); // long and thin (a crack) or compact (a blob)?

  // Tight bounds of what is left: the box is drawn around the crack itself, not around the model's loose box
  let bx1 = pw; let by1 = ph; let bx2 = 0; let by2 = 0;
  for (let ly = 0; ly < ph; ly++) {
    for (let lx = 0; lx < pw; lx++) {
      if (maskGrid[ly * pw + lx] === 0) continue;
      if (lx < bx1) bx1 = lx;
      if (lx + 1 > bx2) bx2 = lx + 1;
      if (ly < by1) by1 = ly;
      if (ly + 1 > by2) by2 = ly + 1;
    }
  }
  const tw = bx2 - bx1;
  const th = by2 - by1;

  // The mask picture covers exactly the tight region, so it lines up with the box drawn from `bounds`
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = tw;
  maskCanvas.height = th;
  const maskCtx = maskCanvas.getContext('2d');
  const imgData = maskCtx.createImageData(tw, th);
  const rgba = imgData.data;

  // Styling Palette:
  // Neon Cyan (Standard/Major): fill rgba(0, 240, 255, 0.40), stroke rgba(0, 240, 255, 0.95)
  // Warning Red (Critical):     fill rgba(239, 68, 68, 0.45), stroke rgba(239, 68, 68, 0.95)
  const r = isCritical ? 239 : 0;
  const g = isCritical ? 68 : 240;
  const b = isCritical ? 68 : 255;
  const fillAlpha = isCritical ? 115 : 102; // ~0.45 or ~0.40
  const strokeAlpha = 242;                 // 0.95

  for (let ly = by1; ly < by2; ly++) {
    const row = ly * pw;
    for (let lx = bx1; lx < bx2; lx++) {
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

      const offset = ((ly - by1) * tw + (lx - bx1)) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = isContour ? strokeAlpha : fillAlpha;
    }
  }

  maskCtx.putImageData(imgData, 0, 0);
  const maskUrl = maskCanvas.toDataURL('image/png');

  // bounds: the tight region in prototype cells, relative to (px1, py1)
  return { maskCanvas, maskUrl, activePixels, shape, bounds: { x1: bx1, y1: by1, x2: bx2, y2: by2 } };
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
      let shape = null;
      let tx1 = x1; let ty1 = y1; let tx2 = x2; let ty2 = y2;

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
        shape = maskResult.shape || null;

        if (activePixels > 0 && maskResult.bounds) {
          area_mm2 = calculateCrackAreaMm2(activePixels, scale);
          // Tight box: exactly the cells the mask covers, in frame pixels
          const bd = maskResult.bounds;
          const toX = (gx) => (((px1 + gx) * 4 - dw) / scale) + tile.x0;
          const toY = (gy) => (((py1 + gy) * 4 - dh) / scale) + tile.y0;
          tx1 = Math.max(0, toX(bd.x1));
          ty1 = Math.max(0, toY(bd.y1));
          tx2 = Math.min(W, toX(bd.x2));
          ty2 = Math.min(H, toY(bd.y2));
          destBox = { destX: toX(bd.x1), destY: toY(bd.y1), destW: ((bd.x2 - bd.x1) * 4) / scale, destH: ((bd.y2 - bd.y1) * 4) / scale };
        }
      }

      // The detector's own box is loose; when there is a mask the box follows the mask instead
      if (tx2 - tx1 < 3 || ty2 - ty1 < 3) continue;
      const boxFrac = ((tx2 - tx1) * (ty2 - ty1)) / (W * H);
      // One crack does not fill a third of the picture. A ring joint, a wall seam or the whole wall is not a crack either:
      // large and not long-and-thin is dropped here, before it can be drawn or stored.
      if (boxFrac > 0.45) continue;
      if (boxFrac > 0.2 && shape && shape.elongation < RULES.minElongation) continue;

      rawBoxes.push({
        x1: tx1,
        y1: ty1,
        x2: tx2,
        y2: ty2,
        confidence: conf,
        class: 'crack',
        maskCanvas,
        maskUrl,
        activePixels,
        area_mm2,
        destBox,
        shape,
      });
    }
  }

  const mergedCracks = consolidateBoxes(rawBoxes, W, H, 0.35);
  const spallClusters = detectSpallingClusters(srcCanvas, mergedCracks, W, H);
  const combined = [...mergedCracks, ...spallClusters].slice(0, 6);

  if (combined.length === 0) {
    return { detections: [], snapshotUrl: null };
  }

  // Clean crops for the review screen and the crack classifier: taken before anything is painted on the frame
  for (const cand of combined) {
    const crop = cropCanvas(srcCanvas, cand, W, H);
    cand.cropUrl = crop ? crop.toDataURL('image/jpeg', 0.8) : null;
    cand.classifier = crop ? await classifyCrop(crop) : { state: 'absent', score: null };
  }

  // Paint mask overlays for winning detections directly onto srcCanvas before snapshot capture
  for (const cand of combined) {
    const pieces = cand.parts && cand.parts.length ? cand.parts : [{ maskCanvas: cand.maskCanvas, destBox: cand.destBox }];
    for (const piece of pieces) {
      if (piece.maskCanvas && piece.destBox && piece.destBox.destW > 0 && piece.destBox.destH > 0) {
        srcCtx.drawImage(piece.maskCanvas, piece.destBox.destX, piece.destBox.destY, piece.destBox.destW, piece.destBox.destH);
      }
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
      // The crack outline(s) as pictures placed in percent of the frame, for the live overlay (not stored)
      mask_parts: (box.parts && box.parts.length ? box.parts : (box.maskUrl && box.destBox ? [{ maskUrl: box.maskUrl, destBox: box.destBox }] : []))
          .map((p) => ({
          url: p.maskUrl,
          left_pct: Number(((p.destBox.destX / W) * 100).toFixed(2)),
          top_pct: Number(((p.destBox.destY / H) * 100).toFixed(2)),
          width_pct: Number(((p.destBox.destW / W) * 100).toFixed(2)),
          height_pct: Number(((p.destBox.destH / H) * 100).toFixed(2)),
        })),
      image_url: snapshotUrl,
      crop_url: box.cropUrl || null,
      classifier: box.classifier || { state: 'absent', score: null },
      shape: box.shape || null,
      box_aspect: Number((Math.max(bwNorm * W, bhNorm * H) / Math.max(1, Math.min(bwNorm * W, bhNorm * H))).toFixed(2)),
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
