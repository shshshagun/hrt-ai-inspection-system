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
  minConfidence: 0.5,   // the detector fires from 0.42; a verdict of "crack" needs a little more
  minElongation: 2.5,   // cracks are long and thin: sqrt(major axis / minor axis) of the mask
  minMaskPixels: 30,    // a smaller mask is noise
  minBoxAspect: 2.2,    // when there is no mask: long side over short side of the box
  minFrames: 3,         // seen in at least this many frames of a video or live feed
  classifierNot: 0.3,   // the second-stage classifier: below this it says "not a crack"
  classifierCrack: 0.7, // at or above this it says "crack"; in between it is not sure
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

/**
 * Automatic verdict for one detection.
 * @param {{cls:string, confidence:number, observations?:number, shape?:{areaPx:number, elongation:number}, boxAspect?:number, classifier?:{state:'ok'|'absent'|'failed', score:number|null}}} d
 * @param {{mode?: 'video'|'webcam'|'photo'}} opts frames only matter when there is more than one
 * @returns {{verdict:'crack'|'candidate', reasons:string[]}}
 */
export function autoVerdict(d, { mode = 'video' } = {}) {
  const reasons = [];
  if (d.cls !== 'crack') reasons.push('texture_heuristic'); // "spalling" comes from a texture check, not a trained model
  if (!(d.confidence >= RULES.minConfidence)) reasons.push('low_confidence');
  if (d.shape && d.shape.areaPx > 0) {
    if (d.shape.areaPx < RULES.minMaskPixels) reasons.push('too_small');
    if (d.shape.elongation < RULES.minElongation) reasons.push('blob_shape');
  } else if (typeof d.boxAspect === 'number' && d.boxAspect < RULES.minBoxAspect) {
    reasons.push('compact_box');
  }
  if (mode !== 'photo' && (d.observations ?? 1) < RULES.minFrames) reasons.push('few_frames');
  // second-stage classifier: absent means it is not part of this build; failed means it should have run but could not
  if (d.classifier?.state === 'failed') reasons.push('classifier_unavailable');
  else if (d.classifier?.state === 'ok') {
    if (d.classifier.score < RULES.classifierNot) reasons.push('classifier_not_crack');
    else if (d.classifier.score < RULES.classifierCrack) reasons.push('classifier_unsure');
  }
  return { verdict: reasons.length ? 'candidate' : 'crack', reasons };
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
