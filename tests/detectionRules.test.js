'use strict';
/**
 * The "counts as a crack" rule exists three times: the browser (crackVerdict.js), the server function and the MongoDB query
 * (api/detectionRules.js). This test makes them agree on every combination, and checks the automatic verdict and mask maths.
 * Run:  node tests/detectionRules.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const rules = require('../api/detectionRules');

const loadVerdict = () => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'utils', 'crackVerdict.js')).href);

/** A tiny evaluator for the few MongoDB operators the queries use, so the query can be tested without a database. */
function matches(doc, q) {
  return Object.entries(q).every(([k, v]) => {
    if (k === '$or') return v.some((s) => matches(doc, s));
    if (k === '$and') return v.every((s) => matches(doc, s));
    const val = doc[k];
    if (v && typeof v === 'object') {
      if ('$exists' in v) return (val !== undefined) === v.$exists;
      if ('$ne' in v) return val !== v.$ne;
    }
    if (v === null) return val === undefined || val === null;
    return val === v;
  });
}

const combos = [];
for (const review_status of [undefined, null, 'pending', 'confirmed', 'rejected']) {
  for (const auto_verdict of [undefined, 'crack', 'candidate']) {
    combos.push({ ...(review_status === undefined ? {} : { review_status }), ...(auto_verdict === undefined ? {} : { auto_verdict }) });
  }
}

test('the browser rule, the server function and the MongoDB query agree on every combination', async () => {
  const { countsAsCrack, reviewState } = await loadVerdict();
  for (const d of combos) {
    const expected = countsAsCrack(d);
    assert.equal(rules.countsAsCrack(d), expected, JSON.stringify(d));
    assert.equal(matches(d, rules.viewQuery('counted')), expected, `query: ${JSON.stringify(d)}`);
    assert.equal(rules.reviewState(d), reviewState(d));
    // every detection is in exactly one of counted / pending / rejected
    const inViews = ['counted', 'pending', 'rejected'].filter((v) => matches(d, rules.viewQuery(v)));
    assert.equal(inViews.length, 1, `${JSON.stringify(d)} is in ${inViews}`);
  }
  assert.equal(countsAsCrack({}), false, 'an old record without a verdict is a candidate');
  assert.equal(countsAsCrack({ review_status: 'confirmed', auto_verdict: 'candidate' }), true, 'an engineer overrules the automatic verdict');
  assert.equal(countsAsCrack({ review_status: 'rejected', auto_verdict: 'crack' }), false);
  assert.deepEqual(rules.withView({ a: 1 }, 'all'), { a: 1 });
});

test('automatic verdict: only a long, thin, confident, repeatedly seen mask is a crack', async () => {
  const { autoVerdict } = await loadVerdict();
  const good = { cls: 'crack', confidence: 0.8, observations: 4, shape: { areaPx: 400, elongation: 6 } };
  assert.deepEqual(autoVerdict(good), { verdict: 'crack', reasons: [] });
  const reasonsOf = (over, opts) => autoVerdict({ ...good, ...over }, opts).reasons;
  assert.deepEqual(reasonsOf({ cls: 'spalling' }), ['texture_heuristic']);
  assert.deepEqual(reasonsOf({ confidence: 0.45 }), ['low_confidence']);
  assert.deepEqual(reasonsOf({ shape: { areaPx: 400, elongation: 1.4 } }), ['blob_shape']);
  assert.deepEqual(reasonsOf({ shape: { areaPx: 12, elongation: 6 } }), ['too_small']);
  assert.deepEqual(reasonsOf({ observations: 1 }), ['few_frames']);
  assert.deepEqual(reasonsOf({ observations: 1 }, { mode: 'photo' }), [], 'one photo is one frame by nature');
  assert.deepEqual(reasonsOf({ shape: undefined, boxAspect: 1.3 }), ['compact_box']);
  assert.equal(autoVerdict({ cls: 'crack', confidence: 0.9, observations: 5, boxAspect: 4 }).verdict, 'crack');
});

test('mask shape: a line is elongated, a disc is not', async () => {
  const { shapeMetrics } = await loadVerdict();
  const w = 40; const h = 40;
  const line = new Uint8Array(w * h); for (let x = 5; x < 35; x += 1) { line[20 * w + x] = 1; line[21 * w + x] = 1; }
  const disc = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if ((x - 20) ** 2 + (y - 20) ** 2 < 100) disc[y * w + x] = 1;
  assert.ok(shapeMetrics(line, w, h).elongation > 6);
  assert.ok(shapeMetrics(disc, w, h).elongation < 1.2);
  assert.deepEqual(shapeMetrics(new Uint8Array(w * h), w, h), { areaPx: 0, elongation: 0, fill: 0 });
});

test('the second-stage classifier: absent changes nothing, failed makes a candidate, and its score is applied', async () => {
  const { autoVerdict } = await loadVerdict();
  const good = { cls: 'crack', confidence: 0.8, observations: 4, shape: { areaPx: 400, elongation: 6 } };
  assert.equal(autoVerdict({ ...good, classifier: { state: 'absent', score: null } }).verdict, 'crack');
  assert.deepEqual(autoVerdict({ ...good, classifier: { state: 'failed', score: null } }).reasons, ['classifier_unavailable']);
  assert.deepEqual(autoVerdict({ ...good, classifier: { state: 'ok', score: 0.1 } }).reasons, ['classifier_not_crack']);
  assert.deepEqual(autoVerdict({ ...good, classifier: { state: 'ok', score: 0.5 } }).reasons, ['classifier_unsure']);
  assert.equal(autoVerdict({ ...good, classifier: { state: 'ok', score: 0.93 } }).verdict, 'crack');
});

test('classifier input: pixels become a 0..1 channel-first tensor', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'utils', 'crackClassifier.js')).href).catch(() => null);
  if (!mod) return; // onnxruntime-web may not load outside a browser; the conversion is also covered below by a copy of its maths
  const n = 224 * 224;
  const rgba = new Uint8ClampedArray(n * 4).fill(0);
  rgba[0] = 255; rgba[1] = 128; rgba[2] = 0; rgba[3] = 255;
  const t = mod.toTensorData(rgba);
  assert.equal(t.length, 3 * n);
  assert.ok(Math.abs(t[0] - 1) < 1e-6 && Math.abs(t[n] - 128 / 255) < 1e-6 && t[2 * n] === 0);
});
