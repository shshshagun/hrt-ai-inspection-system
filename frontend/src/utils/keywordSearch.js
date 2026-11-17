/**
 * Plain keyword search, used in the demo and whenever the AI search is not switched on. It understands the same ideas as
 * the AI search (class, severity, distance from the intake, clock position) but only through fixed words and patterns.
 */
import { angleOf, chainageOf } from './defectHistory.js';

const CLASSES = [['crack', 'crack'], ['spall', 'spalling'], ['leak', 'leakage'], ['corro', 'corrosion'], ['eros', 'erosion'], ['joint', 'joint']];
const SEVERITIES = ['critical', 'major', 'minor', 'info'];
const RANK = { Critical: 4, Major: 3, Minor: 2, Info: 1 };

export function parseKeywordQuery(text) {
  const q = ` ${String(text).toLowerCase()} `;
  const filters = {};
  const chips = [];

  const sev = SEVERITIES.find((s) => q.includes(s));
  if (sev) { filters.severity = sev; chips.push(`severity: ${sev}`); }
  const cls = CLASSES.find(([stem]) => q.includes(stem));
  if (cls) { filters.cls = cls[0]; chips.push(`class: ${cls[1]}`); }

  const num = '(\\d+(?:\\.\\d+)?)';
  const between = q.match(new RegExp(`between ${num}\\s*(?:m|metres|meters)?\\s*(?:and|to|-)\\s*${num}`));
  const past = q.match(new RegExp(`(?:past|over|above|beyond|after|further than|more than|from)\\s+${num}\\s*(?:m\\b|metres|meters)?`));
  const before = q.match(new RegExp(`(?:before|under|below|within|less than|up to|until)\\s+${num}\\s*(?:m\\b|metres|meters)?`));
  const near = q.match(new RegExp(`(?:near|around|at)\\s+${num}\\s*(?:m\\b|metres|meters)`));
  if (between) { filters.min = Math.min(+between[1], +between[2]); filters.max = Math.max(+between[1], +between[2]); }
  else if (near) { filters.min = Math.max(0, +near[1] - 15); filters.max = +near[1] + 15; }
  else { if (past) filters.min = +past[1]; if (before) filters.max = +before[1]; }
  if (filters.min !== undefined) chips.push(`from ${filters.min} m`);
  if (filters.max !== undefined) chips.push(`to ${filters.max} m`);

  const hour = q.match(/(\d{1,2})\s*(?:o'?\s?clock|oclock)/);
  if (hour && +hour[1] >= 1 && +hour[1] <= 12) { filters.hour = +hour[1]; chips.push(`${hour[1]} o'clock`); }
  return { filters, chips };
}

const hourOf = (d) => Math.round(angleOf(d) / 30) % 12 || 12;

export function applyKeywordFilters(detections, filters, limit = 25) {
  return detections
    .filter((d) => {
      const c = chainageOf(d);
      const label = String(d.class_label || d.category || '').toLowerCase();
      return (!filters.severity || String(d.severity || '').toLowerCase() === filters.severity)
        && (!filters.cls || label.includes(filters.cls))
        && (filters.min === undefined || c >= filters.min)
        && (filters.max === undefined || c <= filters.max)
        && (!filters.hour || hourOf(d) === filters.hour);
    })
    .sort((a, b) => (RANK[b.severity] || 0) - (RANK[a.severity] || 0) || chainageOf(a) - chainageOf(b))
    .slice(0, limit);
}
