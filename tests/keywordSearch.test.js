'use strict';
/** Run:  node tests/keywordSearch.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const src = (...p) => pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', ...p)).href;
const norm = (d) => ({ ...d, id: d._id, category: d.class_label, inspectionId: d.inspection_id, chainage_m: d.z, detectedAt: d.timestamp });

test('keyword search understands class, severity, distance and clock position', async () => {
  const { parseKeywordQuery, applyKeywordFilters } = await import(src('utils', 'keywordSearch.js'));
  const { DEMO_DETECTIONS } = await import(src('demo', 'sampleData.js'));
  const dets = DEMO_DETECTIONS.map(norm);

  const a = parseKeywordQuery('critical cracks past 100 m');
  assert.deepEqual(a.filters, { severity: 'critical', cls: 'crack', min: 100 });
  const hits = applyKeywordFilters(dets, a.filters);
  assert.ok(hits.length > 0);
  assert.ok(hits.every((d) => d.severity === 'Critical' && d.z >= 100 && /crack/i.test(d.class_label)));

  assert.deepEqual(parseKeywordQuery('spalling between 50 and 120 m').filters, { cls: 'spall', min: 50, max: 120 });
  assert.deepEqual(parseKeywordQuery('anything near 200 m').filters, { min: 185, max: 215 });
  assert.equal(parseKeywordQuery('defects at 3 o\'clock').filters.hour, 3);
  assert.deepEqual(parseKeywordQuery('hello').filters, {});
});
