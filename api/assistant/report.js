'use strict';
/**
 * Report summary drafts. The facts come from the database, never from the browser. A language model may turn them into prose,
 * but every number in its text is checked against the facts and a deterministic template is used instead when anything does not match,
 * so a draft can never contain a figure the data does not support.
 */
const { PROJECTION } = require('./filters');
const { normalize, diffInspections } = require('./sites');

const MAX_SCAN = 3000;
const SEV = ['Critical', 'Major', 'Minor', 'Info'];
const DEFAULT_SIZES = [[3.2, 180], [2.5, 150]];

const round1 = (n) => Math.round(n * 10) / 10;
const clockOf = (angle) => Math.round(angle / 30) % 12 || 12;

/** Facts about one inspection (and how it compares with the one before), from raw detection documents. */
function buildFacts(allDocs, inspectionId) {
  const docs = allDocs.filter((d) => (d.inspection_id || null) === inspectionId);
  const located = docs.filter((d) => typeof d.z === 'number' && d.z > 0.05);
  const bySeverity = Object.fromEntries(SEV.map((s) => [s, docs.filter((d) => d.severity === s).length]));
  const classes = {};
  docs.forEach((d) => { const c = String(d.class_label || 'unknown').toLowerCase().slice(0, 30); classes[c] = (classes[c] || 0) + 1; });

  const zs = located.map((d) => d.z);
  const critical = located.filter((d) => d.severity === 'Critical');
  const bins = new Map();
  located.forEach((d) => {
    const lo = Math.floor(d.z / 25) * 25;
    const b = bins.get(lo) || { range: `${lo}-${lo + 25} m`, count: 0, critical: 0 };
    b.count += 1; if (d.severity === 'Critical') b.critical += 1;
    bins.set(lo, b);
  });
  const measured = docs.filter((d) => {
    const w = Number(d.crack_width_mm); const l = Number(d.crack_length_mm);
    return w > 0 && l > 0 && !DEFAULT_SIZES.some(([dw, dl]) => dw === w && dl === l);
  });
  const largest = [...located].sort((a, b) => (b.crack_area_mm2 || 0) - (a.crack_area_mm2 || 0)).slice(0, 3)
    .filter((d) => d.crack_area_mm2 > 0)
    .map((d) => ({ class: String(d.class_label || '').slice(0, 30), severity: d.severity || null, chainage_m: round1(d.z), clock: clockOf(normalize(d).angle_deg), area_mm2: Math.round(d.crack_area_mm2) }));

  const diff = diffInspections(allDocs.map(normalize));
  const previous = diff && diff.latestId === inspectionId
    ? { inspection_id: String(diff.previousId).slice(0, 64), new: diff.fresh.length, grown_20_percent_or_more: diff.grown.length, steady: diff.steady.length, not_seen_again: diff.notSeen.length }
    : null;

  return {
    inspection_id: inspectionId,
    total: docs.length,
    by_severity: bySeverity,
    by_class: Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    chainage_range_m: zs.length ? [round1(Math.min(...zs)), round1(Math.max(...zs))] : null,
    critical_chainage_range_m: critical.length ? [round1(Math.min(...critical.map((d) => d.z))), round1(Math.max(...critical.map((d) => d.z)))] : null,
    hotspots: [...bins.values()].sort((a, b) => b.critical - a.critical || b.count - a.count).slice(0, 3),
    largest_defects: largest,
    flagged_urgent: docs.filter((d) => d.flagged_urgent === true).length,
    without_position: docs.length - located.length,
    with_measured_size: measured.length,
    compared_with_previous: previous,
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Plain deterministic summary of the facts. Also the fallback when no AI is available or its text fails the number check. */
function templateDraft(f) {
  if (!f.total) return `Inspection ${f.inspection_id || 'records'} has no recorded defects.\n\nAll findings in this report are AI predictions and must be reviewed by an engineer.`;
  const sev = SEV.filter((s) => f.by_severity[s]).map((s) => `${f.by_severity[s]} ${s.toLowerCase()}`).join(', ');
  const p1 = [`Inspection ${f.inspection_id} recorded ${plural(f.total, 'defect')}: ${sev}.`];
  if (f.chainage_range_m) p1.push(`Located defects lie between ${f.chainage_range_m[0]} m and ${f.chainage_range_m[1]} m from the intake.`);
  if (f.critical_chainage_range_m) p1.push(`Critical defects lie between ${f.critical_chainage_range_m[0]} m and ${f.critical_chainage_range_m[1]} m.`);
  if (f.hotspots.length) p1.push(`The busiest stretch is ${f.hotspots[0].range}, with ${plural(f.hotspots[0].count, 'defect')}${f.hotspots[0].critical ? ` of which ${f.hotspots[0].critical} critical` : ''}.`);
  if (f.largest_defects.length) { const d = f.largest_defects[0]; p1.push(`The largest recorded area is a ${d.class} of ${d.area_mm2} mm2 at ${d.chainage_m} m, ${d.clock} o'clock.`); }

  const parts = [p1.join(' ')];
  if (f.compared_with_previous) {
    const c = f.compared_with_previous;
    parts.push(`Compared with the previous inspection (${c.inspection_id}): ${c.new} new, ${c.grown_20_percent_or_more} grown by 20% or more, ${c.steady} steady and ${c.not_seen_again} not seen again. Not seen again does not prove a repair, because the latest footage may not cover that stretch.`);
  }
  const quality = [];
  if (f.without_position) quality.push(`${plural(f.without_position, 'detection')} ${f.without_position === 1 ? 'has' : 'have'} no recorded position and ${f.without_position === 1 ? 'is' : 'are'} left out of the chainage figures`);
  quality.push(`sizes were measured for ${f.with_measured_size} of ${f.total}`);
  if (f.flagged_urgent) quality.push(`${f.flagged_urgent} ${f.flagged_urgent === 1 ? 'has' : 'have'} been flagged for urgent attention by an engineer`);
  parts.push(`Data notes: ${quality.join('; ')}. Chainage for video inspections is estimated from the video time.`);
  parts.push('All findings in this report are AI predictions and must be reviewed by an engineer before any repair decision.');
  return parts.join('\n\n');
}

/** Every number the facts contain, as strings, plus the forms a writer would naturally use. */
function allowedNumbers(facts) {
  const set = new Set();
  const walk = (v) => {
    if (typeof v === 'number') { set.add(String(v)); set.add(String(round1(v))); set.add(String(Math.round(v))); }
    else if (typeof v === 'string') (v.match(/\d+(?:\.\d+)?/g) || []).forEach((n) => set.add(String(parseFloat(n))));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(facts);
  ['20', '25'].forEach((n) => set.add(n)); // fixed rules the text may mention: 20% growth threshold, 25 m bins
  return set;
}

/** True when every number in the draft appears in the facts. */
function numbersMatch(text, facts) {
  const allowed = allowedNumbers(facts);
  return (text.match(/\d+(?:\.\d+)?/g) || []).every((n) => allowed.has(String(parseFloat(n))));
}

const SYSTEM = [
  'You write the summary section of a hydropower tunnel inspection report for engineers.',
  'Use only the facts in the JSON the user sends. Never invent numbers, locations, causes or dates.',
  'Do not recommend repairs, schedules or priorities. State that every finding is an AI prediction awaiting engineer review.',
  'Mention that "not seen again" does not prove a repair, if a comparison is present.',
  'Write 3 short plain-text paragraphs, at most 200 words in total, with no markdown, bullet points or headings.',
].join(' ');

function clean(text) {
  return String(text || '').replace(/[*_#`>]/g, '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2500);
}

/**
 * Returns { draft, source: 'ai' | 'template', note? }. `generate` is optional; without it, or when it fails, the template is returned.
 */
async function draftNarrative(facts, generate) {
  const fallback = templateDraft(facts);
  if (!generate || !facts.total) return { draft: fallback, source: 'template' };
  try {
    const resp = await generate({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(facts) }] }],
      generationConfig: { maxOutputTokens: 700 },
    });
    const parts = resp?.candidates?.[0]?.content?.parts || [];
    const text = clean(parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join(''));
    if (!text) return { draft: fallback, source: 'template', note: 'The AI returned no text, so the standard summary is shown.' };
    if (!numbersMatch(text, facts)) return { draft: fallback, source: 'template', note: 'The AI wrote a figure that is not in the findings, so the standard summary is shown instead.' };
    return { draft: text, source: 'ai' };
  } catch (err) {
    return { draft: fallback, source: 'template', note: 'The AI service was not available, so the standard summary is shown.' };
  }
}

async function loadAll(db) {
  return db.collection('detections').find({}, { projection: PROJECTION }).limit(MAX_SCAN).toArray();
}

module.exports = { buildFacts, templateDraft, numbersMatch, draftNarrative, loadAll };
