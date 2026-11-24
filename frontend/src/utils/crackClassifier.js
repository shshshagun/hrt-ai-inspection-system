/**
 * Second-stage "is this really a crack?" classifier, run in the browser on each detected crop (224 x 224).
 * The model file (public/models/hrt_crack_cls.onnx) is optional: when it is not there the app works as before. When it is
 * there but cannot be loaded, detections are stored as candidates instead of counting as cracks (see crackVerdict.js).
 */
import * as ort from 'onnxruntime-web/wasm';

const URL = '/models/hrt_crack_cls.onnx';
export const SIZE = 224;
let loading = null;

/** { state: 'ok', session } | { state: 'absent' } | { state: 'failed' } */
export function getCrackClassifier() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const probe = await fetch(URL, { method: 'HEAD' });
      const type = probe.headers.get('content-type') || '';
      if (!probe.ok || type.includes('text/html')) return { state: 'absent' }; // not shipped (a single-page app answers unknown paths with its HTML page)
      ort.env.wasm.numThreads = 1;
      const session = await ort.InferenceSession.create(URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { state: 'ok', session };
    } catch {
      return { state: 'failed' };
    }
  })();
  return loading;
}

/** RGBA pixels (224 x 224) to a 1 x 3 x 224 x 224 float tensor with values 0..1. The network normalises inside. */
export function toTensorData(rgba) {
  const n = SIZE * SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i += 1) {
    out[i] = rgba[i * 4] / 255;
    out[n + i] = rgba[i * 4 + 1] / 255;
    out[2 * n + i] = rgba[i * 4 + 2] / 255;
  }
  return out;
}

/** Probability (0..1) that the crop shows a crack, plus the classifier's state. Never throws. */
export async function classifyCrop(canvas) {
  const c = await getCrackClassifier();
  if (c.state !== 'ok') return { state: c.state, score: null };
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const data = toTensorData(ctx.getImageData(0, 0, SIZE, SIZE).data);
    const out = await c.session.run({ [c.session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]) });
    const score = Number(out[c.session.outputNames[0]].data[0]);
    return Number.isFinite(score) ? { state: 'ok', score } : { state: 'failed', score: null };
  } catch {
    return { state: 'failed', score: null };
  }
}
