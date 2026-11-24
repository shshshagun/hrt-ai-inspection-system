'use strict';
/**
 * The read-only tools the model may call. Every tool queries MongoDB through the validated filter builder and
 * returns only whitelisted fields. Results are data for the model to report, never instructions.
 */
const { FILTER_PROPERTIES, FilterError, buildFilter, runFilter, toRecord, PROJECTION, TUNNEL_M } = require('./filters');
const { normalize, groupSites, siteGrowth, diffInspections } = require('./sites');
const { countsAsCrack, reviewState } = require('../detectionRules');

const MAX_SCAN = 3000; // upper bound on documents read for aggregate tools

const DECLARATIONS = [
  {
    name: 'search_detections',
    description: 'Find individual defects. Use for questions like "critical cracks past 120 m" or "which defects are at 3 o\'clock". Returns at most 25 records.',
    parameters: { type: 'object', properties: FILTER_PROPERTIES },
  },
  {
    name: 'summarize_detections',
    description: 'Count defects grouped by severity, class, inspection or 50 m chainage band. Accepts the same filters as search_detections.',
    parameters: {
      type: 'object',
      properties: { group_by: { type: 'string', enum: ['severity', 'class', 'inspection', 'chainage_band'], description: 'What to group by.' }, ...FILTER_PROPERTIES },
      required: ['group_by'],
    },
  },
  {
    name: 'list_inspections',
    description: 'List the inspection sessions with how many defects each found, newest first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'compare_inspections',
    description: 'Compare the two most recent inspections. Returns how many defects are new, grown by 20% or more, steady, or not seen again, with examples. "Not seen" does not prove a repair.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_site_history',
    description: 'History of one physical defect across inspections (matched by class, chainage within 3 m and angle within 35 degrees): when it was seen, its size each time and how much it grew.',
    parameters: { type: 'object', properties: { id: { type: 'string', description: 'A defect id returned by another tool.' } }, required: ['id'] },
  },
];

function idQuery(id) {
  if (typeof id !== 'string' || !/^[\w.\-]{1,64}$/.test(id)) throw new FilterError('id is not valid');
  const clauses = [{ id }, { detection_id: id }];
  try {
    const { ObjectId } = require('mongodb');
    if (/^[a-f0-9]{24}$/i.test(id)) clauses.unshift({ _id: new ObjectId(id) });
  } catch { /* mongodb driver not available in tests */ }
  return { $or: clauses };
}

async function scan(db, query) {
  return db.collection('detections').find(query, { projection: PROJECTION }).limit(MAX_SCAN).toArray();
}

function bucket(docs, groupBy) {
  const counts = new Map();
  for (const d of docs) {
    let key;
    if (groupBy === 'severity') key = d.severity || 'unknown';
    else if (groupBy === 'class') key = String(d.class_label || 'unknown').toLowerCase();
    else if (groupBy === 'inspection') key = d.inspection_id || 'unknown';
    else { const lo = Math.min(Math.floor((d.z || 0) / 50) * 50, TUNNEL_M - 50); key = `${lo}-${lo + 50} m`; }
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([group, count]) => ({ group, count })).sort((a, b) => b.count - a.count);
}

const siteLine = (site, extra = {}) => ({
  defect_class: site.cls, chainage_m: Math.round(site.z * 10) / 10,
  ids: site.sightings.map((s) => s.id).slice(-2), ...extra,
});

/** Executes a tool. `sink` collects the defect ids that appear in results so the UI can link them. */
async function executeTool(name, args, { db, sink }) {
  if (!db) throw Object.assign(new Error('db'), { publicMessage: 'The database is not available right now.' });
  const a = args && typeof args === 'object' ? args : {};

  if (name === 'search_detections') {
    const filter = buildFilter(a);
    const records = await runFilter(db, filter);
    records.forEach((r) => sink.add(r.id));
    return { applied_filters: filter.description, count: records.length, records };
  }

  if (name === 'summarize_detections') {
    if (!['severity', 'class', 'inspection', 'chainage_band'].includes(a.group_by)) throw new FilterError('group_by must be severity, class, inspection or chainage_band');
    const filter = buildFilter(a);
    const docs = await scan(db, filter.query);
    return { applied_filters: filter.description, total: docs.length, groups: bucket(docs, a.group_by), note: 'Counts cover detections that count as cracks unless include_unreviewed was set.' };
  }

  if (name === 'list_inspections') {
    const docs = await scan(db, {});
    const map = new Map();
    for (const d of docs) {
      const id = d.inspection_id || 'unknown';
      const row = map.get(id) || { inspection_id: String(id).slice(0, 64), cracks: 0, critical: 0, awaiting_review: 0, rejected: 0, last_detected: 0 };
      if (reviewState(d) === 'rejected') row.rejected += 1;
      else if (countsAsCrack(d)) { row.cracks += 1; if (d.severity === 'Critical') row.critical += 1; }
      else row.awaiting_review += 1;
      row.last_detected = Math.max(row.last_detected, d.timestamp instanceof Date ? d.timestamp.getTime() : 0);
      map.set(id, row);
    }
    const rows = [...map.values()].sort((x, y) => y.last_detected - x.last_detected)
      .map((r) => ({ ...r, last_detected: r.last_detected ? new Date(r.last_detected).toISOString() : null }));
    return { count: rows.length, inspections: rows.slice(0, 20) };
  }

  if (name === 'compare_inspections') {
    const docs = (await scan(db, {})).filter(countsAsCrack);
    const diff = diffInspections(docs.map(normalize));
    if (!diff) return { note: 'Fewer than two inspections exist, so there is nothing to compare.' };
    const take = (items, fn) => items.slice(0, 6).map(fn);
    const out = {
      previous_inspection: String(diff.previousId).slice(0, 64),
      latest_inspection: String(diff.latestId).slice(0, 64),
      counts: { new: diff.fresh.length, grown_20_percent_or_more: diff.grown.length, steady: diff.steady.length, not_seen_again: diff.notSeen.length },
      new: take(diff.fresh, (x) => siteLine(x.site)),
      grown: take(diff.grown, (x) => siteLine(x.site, { growth_percent: x.percent })),
      not_seen_again: take(diff.notSeen, (x) => siteLine(x.site)),
      caveat: 'Not seen again does not prove a defect was repaired; the latest footage may not cover that stretch.',
    };
    [...out.new, ...out.grown, ...out.not_seen_again].forEach((x) => x.ids.forEach((i) => sink.add(i)));
    return out;
  }

  if (name === 'get_site_history') {
    const target = await db.collection('detections').findOne(idQuery(a.id), { projection: PROJECTION });
    if (!target) return { error: 'No defect with that id.' };
    const near = await db.collection('detections').find(
      { class_label: target.class_label, z: { $gte: (target.z || 0) - 3, $lte: (target.z || 0) + 3 } },
      { projection: PROJECTION },
    ).limit(200).toArray();
    const targetId = String(target._id);
    const all = near.some((d) => String(d._id) === targetId) ? near : [...near, target];
    const site = groupSites(all.map(normalize)).find((s) => s.sightings.some((d) => d.id === targetId));
    if (!site) return { error: 'Could not place that defect.' };
    const growth = siteGrowth(site);
    site.sightings.forEach((s) => sink.add(s.id));
    return {
      defect_class: site.cls,
      chainage_m: Math.round(site.z * 10) / 10,
      sightings: site.sightings.map((s) => ({
        id: s.id, inspection_id: String(s.inspectionId || '').slice(0, 64),
        detected_at: s.detectedAt instanceof Date ? s.detectedAt.toISOString() : null,
        area_mm2: Math.round(Number(s.crack_area_mm2 || 0)) || null, severity: s.severity || null,
      })),
      growth_percent_first_to_last: growth ? growth.percent : null,
    };
  }

  throw new FilterError(`Unknown tool ${String(name).slice(0, 40)}`);
}

module.exports = { DECLARATIONS, executeTool, toRecord };
