'use strict';
/**
 * Unit tests for the in-browser defect tracker (frontend/src/utils/defectTracker.js).
 * Run:  node tests/defectTracker.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'utils', 'defectTracker.js')).href);

const hit = (o = {}) => ({
  class: 'crack', confidence: 0.7, video_time: 1, chainage_z: 10, angle_deg: 90,
  bbox: { left_pct: 40, top_pct: 40, width_pct: 10, height_pct: 10 }, ...o,
});

test('boxIoU, pctBoxIoU and angleDiffDeg', async () => {
  const { boxIoU, pctBoxIoU, angleDiffDeg } = await load();
  assert.equal(boxIoU({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 20, y1: 20, x2: 30, y2: 30 }), 0);
  assert.ok(Math.abs(boxIoU({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 0, y1: 0, x2: 10, y2: 10 }) - 1) < 1e-9);
  assert.ok(Math.abs(boxIoU({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x1: 5, y1: 0, x2: 15, y2: 10 }) - 1 / 3) < 1e-9);
  assert.equal(pctBoxIoU(null, { left_pct: 0, top_pct: 0, width_pct: 1, height_pct: 1 }), 0);
  assert.equal(angleDiffDeg(350, 10), 20, 'wraps around 0/360');
  assert.equal(angleDiffDeg(0, 180), 180);
  assert.equal(angleDiffDeg(90, 90), 0);
});

test('consolidateBoxes removes duplicates and merges seam-split boxes of the same class only', async () => {
  const { consolidateBoxes } = await load();
  const dup = consolidateBoxes([
    { x1: 100, y1: 100, x2: 200, y2: 200, confidence: 0.9, class: 'crack' },
    { x1: 105, y1: 105, x2: 205, y2: 205, confidence: 0.6, class: 'crack' }], 1000, 1000);
  assert.equal(dup.length, 1);
  assert.equal(dup[0].confidence, 0.9);
  const seam = consolidateBoxes([
    { x1: 100, y1: 100, x2: 200, y2: 200, confidence: 0.8, class: 'crack' },
    { x1: 210, y1: 100, x2: 300, y2: 200, confidence: 0.7, class: 'crack' }], 1000, 1000);
  assert.equal(seam.length, 1);
  assert.equal(seam[0].x1, 100); assert.equal(seam[0].x2, 300);
  const differentClass = consolidateBoxes([
    { x1: 100, y1: 100, x2: 200, y2: 200, confidence: 0.8, class: 'crack' },
    { x1: 100, y1: 100, x2: 200, y2: 200, confidence: 0.7, class: 'spalling' }], 1000, 1000);
  assert.equal(differentClass.length, 2);
  const far = consolidateBoxes([
    { x1: 0, y1: 0, x2: 100, y2: 100, confidence: 0.8, class: 'crack' },
    { x1: 800, y1: 800, x2: 900, y2: 900, confidence: 0.7, class: 'crack' }], 1000, 1000);
  assert.equal(far.length, 2);
});

test('tracker: repeated sightings of one crack are stored once, with the sharpest capture', async () => {
  const { createDefectTracker } = await load();
  const t = createDefectTracker();
  t.ingestFrame([hit({ video_time: 1, confidence: 0.6 })]);
  t.ingestFrame([hit({ video_time: 2, confidence: 0.9, chainage_z: 11 })]);
  t.ingestFrame([hit({ video_time: 3, confidence: 0.7, chainage_z: 12 })]);
  const manifest = t.getManifest();
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].confidence, 0.9, 'highest-confidence snapshot is kept');
  assert.equal(manifest[0].observations, 3);
  assert.match(manifest[0].localId, /^CRK-001$/);
});

test('tracker: different place, different class or long gap start new tracks', async () => {
  const { createDefectTracker } = await load();
  const t = createDefectTracker();
  t.ingestFrame([hit()]);
  t.ingestFrame([hit({ video_time: 2, class: 'spalling' })]);
  t.ingestFrame([hit({ video_time: 3, angle_deg: 270, chainage_z: 80, bbox: { left_pct: 5, top_pct: 5, width_pct: 8, height_pct: 8 } })]);
  t.ingestFrame([hit({ video_time: 30 })]);
  const ids = t.getManifest().map((d) => d.localId).sort();
  assert.equal(ids.length, 4);
  assert.deepEqual(ids, ['CRK-001', 'CRK-003', 'CRK-004', 'SPA-002']);
});

test('tracker: persisting — exited tracks, flushPendingNow and flushAll return each defect once', async () => {
  const { createDefectTracker } = await load();
  const t = createDefectTracker();
  t.ingestFrame([hit({ video_time: 1 })]);
  assert.equal(t.popExitedTracks(2).length, 0, 'still in view');
  const out = t.popExitedTracks(10);
  assert.equal(out.length, 1); assert.equal(out[0].persisted, true);
  assert.equal(t.popExitedTracks(20).length, 0, 'not returned twice');
  t.ingestFrame([hit({ video_time: 21, angle_deg: 200, chainage_z: 50, bbox: { left_pct: 70, top_pct: 70, width_pct: 8, height_pct: 8 } })]);
  assert.equal(t.flushPendingNow().length, 1);
  assert.equal(t.flushPendingNow().length, 0);
  t.ingestFrame([hit({ video_time: 40, angle_deg: 10, chainage_z: 90, bbox: { left_pct: 10, top_pct: 10, width_pct: 8, height_pct: 8 } })]);
  assert.equal(t.flushAll().length, 1);
  assert.equal(t.flushAll().length, 0);
});

test('tracker: custom gating thresholds are honoured and the manifest lists the newest track first', async () => {
  const { createDefectTracker } = await load();
  const strict = createDefectTracker({ maxGapSeconds: 0.5 });
  strict.ingestFrame([hit({ video_time: 1 })]);
  strict.ingestFrame([hit({ video_time: 2 })]);
  assert.equal(strict.getManifest().length, 2, 'gap of 1 s exceeds the 0.5 s limit');
  const t = createDefectTracker();
  t.ingestFrame([hit({ video_time: 1, class: 'crack' })]);
  t.ingestFrame([hit({ video_time: 1.5, class: 'spalling' })]);
  assert.equal(t.getManifest()[0].class, 'spalling');
});

test('OOP: tracks are polymorphic subclasses with private state', async () => {
  const { DefectTrack, CrackTrack, SpallingTrack, DefectTracker, createDefectTracker } = await load();
  const crack = DefectTrack.create(1, hit({ class: 'crack' }), 90);
  const spall = DefectTrack.create(2, hit({ class: 'spalling' }), 90);
  assert.ok(crack instanceof CrackTrack && crack instanceof DefectTrack);
  assert.ok(spall instanceof SpallingTrack && spall instanceof DefectTrack);
  assert.equal(crack.typeCode, 'CRK');
  assert.equal(spall.typeCode, 'SPA');
  assert.equal(spall.trackId, 'SPA-002');
  assert.equal(Object.keys(crack).length, 0, 'state is private, not enumerable');
  assert.throws(() => { crack.trackId = 'x'; }, TypeError, 'identifier is read-only');
  assert.equal(crack.markPersisted().persisted, true);
  assert.equal(crack.markPersisted(), null, 'a defect is handed over for storage only once');
  assert.ok(createDefectTracker() instanceof DefectTracker);
});
