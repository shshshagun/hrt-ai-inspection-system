'use strict';
/**
 * The gateway has its own CommonJS copy of the repeat-inspection rules (api/assistant/sites.js). This test runs both
 * versions on the demo data and checks they agree, so the assistant answers like the dashboard.
 * Run:  node tests/assistantSites.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const server = require('../api/assistant/sites');

const src = (...p) => pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', ...p)).href;
const frontendNorm = (d) => ({ ...d, id: d._id, category: d.class_label, inspectionId: d.inspection_id, chainage_m: d.z, detectedAt: d.timestamp });

test('server and dashboard group the same sites and agree on what changed', async () => {
  const history = await import(src('utils', 'defectHistory.js'));
  const { DEMO_DETECTIONS } = await import(src('demo', 'sampleData.js'));

  const fe = history.groupSites(DEMO_DETECTIONS.map(frontendNorm));
  const be = server.groupSites(DEMO_DETECTIONS.map(server.normalize));
  assert.equal(be.length, fe.length);
  const ids = (sites) => sites.map((s) => s.sightings.map((d) => String(d.id)).join(',')).sort();
  assert.deepEqual(ids(be), ids(fe));

  const feDiff = history.diffInspections(DEMO_DETECTIONS.map(frontendNorm));
  const beDiff = server.diffInspections(DEMO_DETECTIONS.map(server.normalize));
  assert.equal(beDiff.latestId, feDiff.latestId);
  for (const key of ['fresh', 'grown', 'steady', 'notSeen']) assert.equal(beDiff[key].length, feDiff[key].length, key);
  assert.deepEqual(beDiff.grown.map((g) => g.percent), feDiff.grown.map((g) => g.percent));
});
