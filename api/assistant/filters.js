'use strict';
/**
 * One validated filter builder shared by the chat tools and the natural-language search.
 * Input comes from a language model, so nothing is trusted: only enums, bounded numbers and short
 * plain strings are accepted, and no model-supplied text is ever used as a regular expression or an operator.
 */

const TUNNEL_M = 250;
const SEVERITIES = ['Critical', 'Major', 'Minor', 'Info'];
const SORTS = ['chainage', 'severity', 'confidence', 'newest', 'largest'];
const SEVERITY_RANK = { Critical: 4, Major: 3, Minor: 2, Info: 1 };
const CLASS_RE = /^[A-Za-z][A-Za-z _-]{0,39}$/;
const ID_RE = /^[\w.\- ]{1,64}$/;

class FilterError extends Error {
  constructor(message) { super(message); this.name = 'FilterError'; this.publicMessage = message; }
}

function bounded(value, min, max, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new FilterError(`${name} must be a number from ${min} to ${max}`);
  return n;
}

function date(value, name) {
  if (value === undefined || value === null || value === '') return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) throw new FilterError(`${name} must be a date such as 2026-11-01`);
  return d;
}

/** JSON-schema fragment for the filter arguments, reused by both function declarations. */
const FILTER_PROPERTIES = {
  defect_class: { type: 'string', description: 'Defect type, for example crack or spalling.' },
  severity: { type: 'string', enum: SEVERITIES, description: 'Severity level.' },
  min_chainage_m: { type: 'number', description: 'Only defects at or beyond this distance in metres from the intake (0 to 250).' },
  max_chainage_m: { type: 'number', description: 'Only defects at or before this distance in metres from the intake (0 to 250).' },
  clock_hour: { type: 'integer', description: 'Clock position around the lining, 1 to 12 (12 is the crown at the top, 6 the invert at the bottom).' },
  inspection_id: { type: 'string', description: 'Only this inspection session.' },
  min_confidence: { type: 'number', description: 'Minimum model confidence from 0 to 1.' },
  flagged_urgent: { type: 'boolean', description: 'true to list only defects an engineer flagged for urgent repair.' },
  since: { type: 'string', description: 'Only defects detected on or after this date (YYYY-MM-DD).' },
  until: { type: 'string', description: 'Only defects detected on or before this date (YYYY-MM-DD).' },
  sort: { type: 'string', enum: SORTS, description: 'Order of the results.' },
  limit: { type: 'integer', description: 'How many results to return, 1 to 25.' },
};

function titleCase(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function buildFilter(args = {}) {
  const query = {};
  const description = [];

  if (args.defect_class !== undefined && args.defect_class !== null && args.defect_class !== '') {
    if (typeof args.defect_class !== 'string' || !CLASS_RE.test(args.defect_class.trim())) throw new FilterError('defect_class must be a short word such as crack or spalling');
    let c = args.defect_class.trim().toLowerCase().replace(/ /g, '_');
    if (c.length > 4 && c.endsWith('s') && !c.endsWith('ss')) c = c.slice(0, -1);
    query.class_label = { $in: [c, titleCase(c)] };
    description.push(`class: ${c}`);
  }
  if (args.severity !== undefined && args.severity !== null && args.severity !== '') {
    const sev = SEVERITIES.find((s) => s.toLowerCase() === String(args.severity).toLowerCase());
    if (!sev) throw new FilterError(`severity must be one of ${SEVERITIES.join(', ')}`);
    query.severity = sev;
    description.push(`severity: ${sev}`);
  }
  const lo = bounded(args.min_chainage_m, 0, TUNNEL_M, 'min_chainage_m');
  const hi = bounded(args.max_chainage_m, 0, TUNNEL_M, 'max_chainage_m');
  if (lo !== undefined || hi !== undefined) {
    if (lo !== undefined && hi !== undefined && lo > hi) throw new FilterError('min_chainage_m cannot be larger than max_chainage_m');
    query.z = {};
    if (lo !== undefined) { query.z.$gte = lo; description.push(`from ${lo} m`); }
    if (hi !== undefined) { query.z.$lte = hi; description.push(`to ${hi} m`); }
  }
  const hour = bounded(args.clock_hour, 1, 12, 'clock_hour');
  if (hour !== undefined) {
    const h = Math.round(hour);
    query.clock_pos = new RegExp(`^${h} o`); // h is a number we validated, never model text
    description.push(`${h} o'clock`);
  }
  if (args.inspection_id !== undefined && args.inspection_id !== null && args.inspection_id !== '') {
    if (typeof args.inspection_id !== 'string' || !ID_RE.test(args.inspection_id)) throw new FilterError('inspection_id contains characters that are not allowed');
    query.inspection_id = args.inspection_id;
    description.push(`inspection: ${args.inspection_id}`);
  }
  const conf = bounded(args.min_confidence, 0, 1, 'min_confidence');
  if (conf !== undefined) { query.confidence = { $gte: conf }; description.push(`confidence ≥ ${Math.round(conf * 100)}%`); }
  if (args.flagged_urgent === true) { query.flagged_urgent = true; description.push('flagged urgent'); }
  const since = date(args.since, 'since');
  const until = date(args.until, 'until');
  if (since || until) {
    query.timestamp = {};
    if (since) { query.timestamp.$gte = since; description.push(`since ${since.toISOString().slice(0, 10)}`); }
    if (until) { const end = new Date(until); end.setUTCHours(23, 59, 59, 999); query.timestamp.$lte = end; description.push(`until ${until.toISOString().slice(0, 10)}`); }
  }

  const sort = args.sort === undefined || args.sort === null || args.sort === '' ? 'severity' : args.sort;
  if (!SORTS.includes(sort)) throw new FilterError(`sort must be one of ${SORTS.join(', ')}`);
  const limit = Math.round(bounded(args.limit, 1, 25, 'limit') ?? 10);
  return { query, sort, limit, description };
}

const PROJECTION = {
  class_label: 1, subtype: 1, severity: 1, confidence: 1, z: 1, x: 1, y: 1, clock_pos: 1, inspection_id: 1,
  timestamp: 1, crack_area_mm2: 1, crack_width_mm: 1, crack_length_mm: 1, flagged_urgent: 1,
};

const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

/** The only fields that ever leave the server toward the model: no images, boxes, notes or people. */
function toRecord(d) {
  return {
    id: String(d._id),
    defect_class: cap(d.class_label, 40),
    description: cap(d.subtype, 80),
    severity: SEVERITIES.includes(d.severity) ? d.severity : null,
    confidence: typeof d.confidence === 'number' ? Math.round(d.confidence * 100) / 100 : null,
    chainage_m: typeof d.z === 'number' ? Math.round(d.z * 10) / 10 : null,
    clock_position: cap(d.clock_pos, 40),
    inspection_id: cap(d.inspection_id, 64),
    detected_at: d.timestamp instanceof Date ? d.timestamp.toISOString() : null,
    area_mm2: typeof d.crack_area_mm2 === 'number' ? Math.round(d.crack_area_mm2) : null,
    width_mm: typeof d.crack_width_mm === 'number' ? Math.round(d.crack_width_mm * 10) / 10 : null,
    length_mm: typeof d.crack_length_mm === 'number' ? Math.round(d.crack_length_mm) : null,
    flagged_urgent: d.flagged_urgent === true,
  };
}

/** Runs a built filter against the detections collection and returns shaped records. */
async function runFilter(db, filter, { fetchLimit } = {}) {
  const needsJsSort = filter.sort === 'severity' || filter.sort === 'largest';
  const mongoSort = { chainage: { z: 1 }, confidence: { confidence: -1 }, newest: { timestamp: -1 } }[filter.sort] || { timestamp: -1 };
  const take = fetchLimit || (needsJsSort ? 300 : filter.limit);
  const docs = await db.collection('detections').find(filter.query, { projection: PROJECTION }).sort(mongoSort).limit(take).toArray();
  let rows = docs.map(toRecord);
  if (filter.sort === 'severity') rows.sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0) || (b.confidence || 0) - (a.confidence || 0));
  if (filter.sort === 'largest') rows.sort((a, b) => (b.area_mm2 || 0) - (a.area_mm2 || 0));
  if (!fetchLimit) rows = rows.slice(0, filter.limit);
  return rows;
}

module.exports = { FilterError, FILTER_PROPERTIES, SEVERITIES, buildFilter, toRecord, runFilter, PROJECTION, TUNNEL_M };
