/**
 * Which detections count as cracks.
 *
 * The detector has one class and is not very accurate on tunnel footage, so a detection is not stored as "a crack" just because the
 * model fired. Every detection gets an automatic verdict when it is made (crack or candidate, with reasons), and an engineer can
 * confirm or reject it. A detection counts as a crack when an engineer confirmed it, or when it is still unreviewed and the automatic
 * verdict is "crack". Rejected detections never count. Old records without a verdict stay candidates until someone reviews them.
 *
 * The same rule is used by the server (api/detectionRules.js); tests/detectionRules.test.js keeps the two in step.
 */

export const REJECT_REASONS = ['shadow', 'stain', 'ring_joint', 'debris', 'texture', 'other'];

// Tunable limits, kept in one place so they can be tuned against labelled footage.
export const RULES = {
  minMaskPixels: 30,    // a smaller mask is noise (hard limit)
  minElongation: 2.5,   // cracks are long and thin: sqrt(major axis / minor axis) of the mask. Also the cut-off for dropping
                        // large, compact detections (ring joints) before they are stored
  minBoxAspect: 2.2,    // when there is no mask: long side over short side of the box
  minFrames: 3,         // the most sightings ever asked for; fewer when frames are sampled far apart (see framesExpected)
  classifierNot: 0.3,   // the second-stage classifier: below this it says "not a crack"
  classifierCrack: 0.7, // at or above this it says "crack"; in between it is not sure
  passScore: 0.6,       // a detection whose combined score reaches this counts as a crack
};

/** Elongation and fill of a binary mask (1 = crack pixel) of size w x h, from its second moments. */
export function shapeMetrics(grid, w, h) {
  let n = 0; let sx = 0; let sy = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (grid[y * w + x]) { n += 1; sx += x; sy += y; }
  if (n === 0) return { areaPx: 0, elongation: 0, fill: 0 };
  const mx = sx / n; const my = sy / n;
  let cxx = 0; let cyy = 0; let cxy = 0; let x0 = w; let x1 = 0; let y0 = h; let y1 = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!grid[y * w + x]) continue;
      cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  cxx /= n; cyy /= n; cxy /= n;
  const tr = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + disc; const l2 = Math.max(1e-6, tr / 2 - disc);
  return { areaPx: n, elongation: Math.sqrt(l1 / l2), fill: n / ((x1 - x0 + 1) * (y1 - y0 + 1)) };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * How many sightings a real crack should get, given how far apart the frames were taken. A crack stays in view for roughly a
 * second, so frames 0.33 s apart should see it about three times and frames 2 s apart only once.
 */
export function framesExpected(frameIntervalSec) {
  if (!(frameIntervalSec > 0)) return RULES.minFrames;
  return Math.max(1, Math.min(RULES.minFrames, Math.round(1.0 / frameIntervalSec)));
}

/**
 * Automatic verdict for one detection.
 *
 * Instead of letting every check veto, the checks are combined into one score from 0 to 1. The second-stage classifier, which
 * looks at the crop itself, carries the most weight; detector confidence, mask shape and the number of sightings add to it. Only
 * two things are hard limits: the texture-based "spalling" estimate is never a crack, and a mask smaller than minMaskPixels is noise.
 * `reasons` lists the parts that pulled the score down, so a reviewer can see why something was held back.
 *
 * @param {{cls:string, confidence:number, observations?:number, shape?:{areaPx:number, elongation:number}, boxAspect?:number, classifier?:{state:'ok'|'absent'|'failed', score:number|null}}} d
 * @param {{mode?: 'video'|'webcam'|'photo', frameIntervalSec?: number}} opts
 * @returns {{verdict:'crack'|'candidate', reasons:string[], score:number}}
 */
export function autoVerdict(d, { mode = 'video', frameIntervalSec } = {}) {
  const reasons = [];
  if (d.cls !== 'crack') return { verdict: 'candidate', reasons: ['texture_heuristic'], score: 0 }; // from a texture check, not a model
  if (d.shape && d.shape.areaPx > 0 && d.shape.areaPx < RULES.minMaskPixels) return { verdict: 'candidate', reasons: ['too_small'], score: 0 };

  // Each part is 0 (looks nothing like a crack) to 1 (clearly a crack)
  const sConf = clamp01(((d.confidence ?? 0) - 0.35) / (0.75 - 0.35));
  if (sConf < 0.5) reasons.push('low_confidence');

  let sShape = 0.5; // unknown shape: neutral
  if (d.shape && d.shape.areaPx > 0) {
    sShape = clamp01((d.shape.elongation - 1.5) / (4 - 1.5));
    if (d.shape.elongation < RULES.minElongation) reasons.push('blob_shape');
  } else if (typeof d.boxAspect === 'number') {
    sShape = clamp01((d.boxAspect - 1.2) / (3.5 - 1.2));
    if (d.boxAspect < RULES.minBoxAspect) reasons.push('compact_box');
  }

  let sFrames = 1;
  if (mode !== 'photo') {
    const need = framesExpected(frameIntervalSec);
    sFrames = clamp01((d.observations ?? 1) / need);
    if (sFrames < 1) reasons.push('few_frames');
  }

  let score;
  const cls = d.classifier;
  if (cls?.state === 'ok' && typeof cls.score === 'number') {
    if (cls.score < RULES.classifierNot) reasons.push('classifier_not_crack');
    else if (cls.score < RULES.classifierCrack) reasons.push('classifier_unsure');
    score = 0.5 * cls.score + 0.2 * sConf + 0.2 * sShape + 0.1 * sFrames;
  } else {
    // no classifier in this build: the other parts share its weight. If it should have run but failed, nothing is trusted blindly.
    score = 0.4 * sConf + 0.4 * sShape + 0.2 * sFrames;
    if (cls?.state === 'failed') {
      reasons.push('classifier_unavailable');
      score = Math.min(score, RULES.passScore - 0.01);
    }
  }
  score = Number(score.toFixed(3));
  if (score >= RULES.passScore) return { verdict: 'crack', reasons: [], score };
  return { verdict: 'candidate', reasons: reasons.length ? reasons : ['low_score'], score };
}

export function reviewState(d) {
  const s = d.review_status || d.reviewStatus;
  return s === 'confirmed' || s === 'rejected' ? s : 'pending';
}

/** The one rule behind every count, chart, report and the 3D twin. */
export function countsAsCrack(d) {
  const state = reviewState(d);
  if (state === 'rejected') return false;
  if (state === 'confirmed') return true;
  return d.auto_verdict === 'crack';
}

/** Same views as the server's ?view= parameter (used by the read-only demo, which has no server). */
export function matchesView(d, view) {
  const state = reviewState(d);
  switch (view) {
    case 'counted': return countsAsCrack(d);
    case 'not_rejected': return state !== 'rejected';
    case 'pending': return state === 'pending' && !countsAsCrack(d);
    case 'rejected': return state === 'rejected';
    default: return true;
  }
}

/**
 * Keeps the connected pieces of a mask that matter: the biggest one, and any other piece that is at least a fifth of it.
 * Everything else (isolated specks the model scatters around a crack) is cleared. Edits the grid in place and returns the
 * number of pixels left.
 */
export function keepMainComponents(grid, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const sizes = [];
  const stack = [];
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 0 || label[i] !== -1) continue;
    const id = sizes.length;
    let n = 0;
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const p = stack.pop();
      n += 1;
      const x = p % w;
      const y = (p - x) / w;
      if (x > 0 && grid[p - 1] && label[p - 1] === -1) { label[p - 1] = id; stack.push(p - 1); }
      if (x < w - 1 && grid[p + 1] && label[p + 1] === -1) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && grid[p - w] && label[p - w] === -1) { label[p - w] = id; stack.push(p - w); }
      if (y < h - 1 && grid[p + w] && label[p + w] === -1) { label[p + w] = id; stack.push(p + w); }
    }
    sizes.push(n);
  }
  const biggest = sizes.length ? Math.max(...sizes) : 0;
  const keep = sizes.map((n) => n === biggest || n >= Math.max(4, biggest * 0.2));
  let left = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 0) continue;
    if (keep[label[i]]) left += 1;
    else grid[i] = 0;
  }
  return left;
}
