/**
 * Standard report summary built from the findings, used in the read-only demo and whenever the server cannot reach an AI.
 * It mirrors api/assistant/report.js (the server's version); tests/reportDraft.test.js checks the two give the same text.
 */
import { angleOf, areaOf, chainageOf, diffInspections } from './defectHistory.js';
import { countsAsCrack, reviewState } from './crackVerdict.js';

const SEV = ['Critical', 'Major', 'Minor', 'Info'];
const DEFAULT_SIZES = [[3.2, 180], [2.5, 150]];
const round1 = (n) => Math.round(n * 10) / 10;
const clockOf = (angle) => Math.round(angle / 30) % 12 || 12;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `detections` are the app's normalised records (inspectionId, chainage_m, class_label, severity...). */
export function buildReportFacts(detections, inspectionId) {
  const ofInspection = detections.filter((d) => (d.inspectionId || null) === inspectionId);
  const docs = ofInspection.filter(countsAsCrack); // only detections that count as cracks
  const located = docs.filter((d) => chainageOf(d) > 0.05);
  const bySeverity = Object.fromEntries(SEV.map((s) => [s, docs.filter((d) => d.severity === s).length]));
  const classes = {};
  docs.forEach((d) => { const c = String(d.class_label || d.category || 'unknown').toLowerCase().slice(0, 30); classes[c] = (classes[c] || 0) + 1; });
  const zs = located.map(chainageOf);
  const critical = located.filter((d) => d.severity === 'Critical');
  const bins = new Map();
  located.forEach((d) => {
    const lo = Math.floor(chainageOf(d) / 25) * 25;
    const b = bins.get(lo) || { range: `${lo}-${lo + 25} m`, count: 0, critical: 0 };
    b.count += 1; if (d.severity === 'Critical') b.critical += 1;
    bins.set(lo, b);
  });
  const measured = docs.filter((d) => {
    const w = Number(d.crack_width_mm); const l = Number(d.crack_length_mm);
    return w > 0 && l > 0 && !DEFAULT_SIZES.some(([dw, dl]) => dw === w && dl === l);
  });
  const largest = [...located].sort((a, b) => areaOf(b) - areaOf(a)).slice(0, 3).filter((d) => areaOf(d) > 0)
    .map((d) => ({ class: String(d.class_label || d.category || '').toLowerCase().slice(0, 30), severity: d.severity || null, chainage_m: round1(chainageOf(d)), clock: clockOf(angleOf(d)), area_mm2: Math.round(areaOf(d)) }));
  const diff = diffInspections(detections.filter(countsAsCrack));
  const previous = diff && diff.latestId === inspectionId
    ? { inspection_id: String(diff.previousId).slice(0, 64), new: diff.fresh.length, grown_20_percent_or_more: diff.grown.length, steady: diff.steady.length, not_seen_again: diff.notSeen.length }
    : null;
  return {
    inspection_id: inspectionId,
    total: docs.length,
    by_severity: bySeverity,
    by_class: Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    chainage_range_m: zs.length ? [round1(Math.min(...zs)), round1(Math.max(...zs))] : null,
    critical_chainage_range_m: critical.length ? [round1(Math.min(...critical.map(chainageOf))), round1(Math.max(...critical.map(chainageOf)))] : null,
    hotspots: [...bins.values()].sort((a, b) => b.critical - a.critical || b.count - a.count).slice(0, 3),
    largest_defects: largest,
    flagged_urgent: docs.filter((d) => d.flagged_urgent === true).length,
    without_position: docs.length - located.length,
    awaiting_review: ofInspection.filter((d) => reviewState(d) === 'pending' && !countsAsCrack(d)).length,
    rejected: ofInspection.filter((d) => reviewState(d) === 'rejected').length,
    with_measured_size: measured.length,
    compared_with_previous: previous,
  };
}

export function templateDraft(f) {
  if (!f.total) return `Inspection ${f.inspection_id || 'records'} has no detections that count as defects${f.awaiting_review ? `; ${f.awaiting_review} are awaiting engineer review` : ''}.\n\nAll findings in this report are AI predictions and must be reviewed by an engineer.`;
  const sev = SEV.filter((s) => f.by_severity[s]).map((s) => `${f.by_severity[s]} ${s.toLowerCase()}`).join(', ');
  const p1 = [`Inspection ${f.inspection_id} recorded ${plural(f.total, 'defect')}: ${sev}.`];
  if (f.chainage_range_m) p1.push(`Located defects lie between ${f.chainage_range_m[0]} m and ${f.chainage_range_m[1]} m from the intake.`);
  if (f.critical_chainage_range_m) p1.push(`Critical defects lie between ${f.critical_chainage_range_m[0]} m and ${f.critical_chainage_range_m[1]} m.`);
  if (f.hotspots.length) p1.push(`The busiest stretch is ${f.hotspots[0].range}, with ${plural(f.hotspots[0].count, 'defect')}${f.hotspots[0].critical ? ` of which ${f.hotspots[0].critical} critical` : ''}.`);
  if (f.largest_defects.length) { const d = f.largest_defects[0]; p1.push(`The largest recorded area is a ${d.class} of ${d.area_mm2} mm2 at ${d.chainage_m} m, ${d.clock} o'clock.`); }
  if (f.awaiting_review) p1.push(`${plural(f.awaiting_review, 'more detection')} ${f.awaiting_review === 1 ? 'is' : 'are'} awaiting engineer review and ${f.awaiting_review === 1 ? 'is' : 'are'} not counted.`);
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
