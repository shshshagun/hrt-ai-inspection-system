'use strict';
/**
 * The report summary exists twice: on the server (api/assistant/report.js) and in the browser for the demo
 * (frontend/src/utils/reportDraft.js). They must write the same text. Run:  node tests/reportDraft.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const server = require('../api/assistant/report');

const src = (...p) => pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', ...p)).href;
const norm = (d) => ({ ...d, id: d._id, category: d.class_label, inspectionId: d.inspection_id, chainage_m: d.z, detectedAt: d.timestamp });
const asMongo = (d) => ({ ...d, timestamp: new Date(d.timestamp) }); // the database returns real dates

test('server and browser summaries agree on every demo inspection', async () => {
  const client = await import(src('utils', 'reportDraft.js'));
  const { DEMO_DETECTIONS, DEMO_INSPECTIONS } = await import(src('demo', 'sampleData.js'));
  const mongo = DEMO_DETECTIONS.map(asMongo);
  const app = DEMO_DETECTIONS.map(norm);
  for (const insp of DEMO_INSPECTIONS) {
    const a = server.buildFacts(mongo, insp.id);
    const b = client.buildReportFacts(app, insp.id);
    assert.deepEqual(a, b, `facts differ for ${insp.id}`);
    assert.equal(server.templateDraft(a), client.templateDraft(b), `text differs for ${insp.id}`);
  }
});

test('an AI draft is used only when every number in it comes from the facts', async () => {
  const { DEMO_DETECTIONS } = await import(src('demo', 'sampleData.js'));
  const facts = server.buildFacts(DEMO_DETECTIONS.map(asMongo), 'INSP-DEMO-2026-11');
  const reply = (text) => async () => ({ candidates: [{ content: { parts: [{ text }] } }] });

  const good = await server.draftNarrative(facts, reply(`Inspection INSP-DEMO-2026-11 found ${facts.total} defects, ${facts.by_severity.Critical} of them critical. AI predictions need engineer review.`));
  assert.equal(good.source, 'ai');

  const bad = await server.draftNarrative(facts, reply(`The inspection found ${facts.total + 40} defects.`));
  assert.equal(bad.source, 'template', 'an invented figure falls back to the standard summary');
  assert.match(bad.note, /not in the findings/);
  assert.equal(bad.draft, server.templateDraft(facts));

  const down = await server.draftNarrative(facts, async () => { throw new Error('boom'); });
  assert.equal(down.source, 'template');
  assert.equal((await server.draftNarrative(facts, null)).source, 'template');
  assert.ok(server.numbersMatch('20% growth and 25 m bins.', facts), 'the two fixed rules may be mentioned');
});

test('markdown is stripped from an AI draft', async () => {
  const facts = { inspection_id: 'X', total: 2, by_severity: { Critical: 1, Major: 1, Minor: 0, Info: 0 }, by_class: [], chainage_range_m: null, critical_chainage_range_m: null, hotspots: [], largest_defects: [], flagged_urgent: 0, without_position: 0, with_measured_size: 2, compared_with_previous: null };
  const out = await server.draftNarrative(facts, async () => ({ candidates: [{ content: { parts: [{ text: '**Summary**\n\nTwo defects (1 critical, 1 major) were found.' }] } }] }));
  assert.equal(out.source, 'ai');
  assert.ok(!/[*#`]/.test(out.draft));
});
