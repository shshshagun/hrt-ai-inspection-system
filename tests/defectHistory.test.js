'use strict';
/**
 * Unit tests for the repeat-inspection helpers and the demo sample data.
 * Run:  node tests/defectHistory.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = (...p) => pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', ...p)).href;
const loadHistory = () => import(src('utils', 'defectHistory.js'));
const loadDemo = () => import(src('demo', 'sampleData.js'));

// the app normalises raw records; the helpers only need these fields
const norm = (d) => ({ ...d, id: d._id, category: d.class_label, inspectionId: d.inspection_id, chainage_m: d.z, detectedAt: d.timestamp });

test('demo data: three inspections of the same tunnel with valid positions', async () => {
  const { DEMO_DETECTIONS, DEMO_INSPECTIONS } = await loadDemo();
  assert.equal(DEMO_INSPECTIONS.length, 3);
  assert.ok(DEMO_DETECTIONS.length >= 30);
  for (const d of DEMO_DETECTIONS) {
    assert.ok(d.z >= 0 && d.z <= 250, `chainage in range: ${d.z}`);
    assert.ok(Math.abs(Math.hypot(d.x, d.y) - 2.95) < 0.02, 'defects lie at radius 2.95 m');
    assert.ok(['Critical', 'Major', 'Minor'].includes(d.severity));
  }
  const counts = DEMO_INSPECTIONS.map((i) => i.totalDetections);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a), 'newest inspection first, later inspections see at least as many defects');
  const ids = new Set(DEMO_DETECTIONS.map((d) => d._id));
  assert.equal(ids.size, DEMO_DETECTIONS.length, 'ids are unique');
});

test('groupSites joins the same defect across inspections and measures growth', async () => {
  const { groupSites, siteGrowth, siteOf } = await loadHistory();
  const { DEMO_DETECTIONS } = await loadDemo();
  const dets = DEMO_DETECTIONS.map(norm);
  const sites = groupSites(dets);
  assert.equal(sites.length, 15, 'fifteen physical defects');
  assert.ok(sites.every((s) => s.sightings.length <= 3));
  assert.ok(sites.every((s) => new Set(s.sightings.map((d) => d.inspectionId)).size === s.sightings.length), 'one sighting per inspection');
  const triple = sites.find((s) => s.sightings.length === 3);
  const g = siteGrowth(triple);
  assert.ok(g.percent > 0, 'defects in the sample grow');
  assert.deepEqual(siteOf(dets, triple.sightings[1].id).sightings.map((d) => d.id), triple.sightings.map((d) => d.id), 'finds the site from any of its sightings');
  assert.equal(siteGrowth({ sightings: [triple.sightings[0]] }), null, 'no growth for a single sighting');
});

test('a defect further away or in another class is a different site', async () => {
  const { groupSites } = await loadHistory();
  const base = { id: 'a', class_label: 'crack', category: 'crack', inspectionId: 'I1', chainage_m: 50, angle_deg: 90, detectedAt: '2026-01-01T00:00:00Z', crack_area_mm2: 100 };
  const sites = groupSites([
    base,
    { ...base, id: 'b', inspectionId: 'I2', chainage_m: 52, angle_deg: 100, detectedAt: '2026-06-01T00:00:00Z' },
    { ...base, id: 'c', inspectionId: 'I2', chainage_m: 60 },
    { ...base, id: 'd', inspectionId: 'I2', class_label: 'spalling', category: 'spalling' },
    { ...base, id: 'e', inspectionId: 'I2', angle_deg: 250 },
  ]);
  assert.equal(sites.length, 4);
  assert.equal(sites[0].sightings.length, 2);
});

test('buildBrief writes plain sentences from the data', async () => {
  const { buildBrief, angleOf } = await loadHistory();
  const { DEMO_DETECTIONS } = await loadDemo();
  assert.match(buildBrief([])[0], /No inspection data/);
  const lines = buildBrief(DEMO_DETECTIONS.map(norm));
  assert.match(lines[0], /latest inspection \(INSP-DEMO-2026-11\) found 15 defects/);
  assert.ok(lines.some((l) => /grown by 20% or more/.test(l)));
  assert.equal(Math.round(angleOf({ x: 0, y: 2.95 })), 0, 'crown is 0 degrees');
  assert.equal(Math.round(angleOf({ x: 2.95, y: 0 })), 90, 'right wall is 90 degrees');
  assert.equal(Math.round(angleOf({ x: 0, y: -2.95 })), 180, 'invert is 180 degrees');
});

test('diffInspections sorts every site into fresh, grown, steady or not seen', async () => {
  const { diffInspections } = await loadHistory();
  const { DEMO_DETECTIONS } = await loadDemo();
  const dets = DEMO_DETECTIONS.map(norm);
  const diff = diffInspections(dets);
  assert.equal(diff.latestId, 'INSP-DEMO-2026-11');
  const inLatest = dets.filter((d) => d.inspectionId === diff.latestId).length;
  assert.equal(diff.fresh.length + diff.grown.length + diff.steady.length, inLatest, 'every defect in the latest inspection is accounted for once');
  assert.ok(diff.grown.every((g) => g.percent >= 20));
  assert.ok(diff.notSeen.every((n) => !n.site.sightings.some((d) => d.inspectionId === diff.latestId)));
  assert.equal(diffInspections(dets.filter((d) => d.inspectionId === diff.latestId)), null, 'one inspection has nothing to compare');
});
