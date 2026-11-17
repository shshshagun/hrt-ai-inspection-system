'use strict';
/**
 * Repeat-inspection helpers for the gateway: a CommonJS port of frontend/src/utils/defectHistory.js, so the assistant can
 * answer "what grew since the last inspection?" with the same rules the dashboard uses. tests/assistantSites.test.js
 * checks the two stay in step on the demo data.
 */
const DEFECT_RADIUS_M = 2.95;

function angleOf(d) {
  if (typeof d.angle_deg === 'number') return d.angle_deg;
  const x = d.x ?? 0;
  const y = d.y ?? DEFECT_RADIUS_M;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

const timeOf = (d) => new Date(d.detectedAt || 0).getTime();
const areaOf = (d) => Number(d.crack_area_mm2 ?? d.area_mm2 ?? 0);
const lengthOf = (d) => Number(d.crack_length_mm ?? d.length_mm ?? 0);
const angleGap = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** Raw Mongo detection -> the shape the helpers expect. */
function normalize(d) {
  return {
    id: String(d._id ?? d.id),
    cls: String(d.class_label || '').toLowerCase(),
    severity: d.severity,
    inspectionId: d.inspection_id,
    chainage_m: Number(d.z ?? 0),
    angle_deg: angleOf(d),
    detectedAt: d.timestamp || d.created_at,
    crack_area_mm2: d.crack_area_mm2,
    crack_length_mm: d.crack_length_mm,
  };
}

// A chainage of 0 is how a missing position is stored, so those detections cannot be matched and are left out.
function groupSites(detections) {
  const sites = [];
  for (const d of [...detections].filter((x) => x.chainage_m > 0.05).sort((a, b) => timeOf(a) - timeOf(b))) {
    const z = d.chainage_m;
    const a = d.angle_deg;
    const site = sites.find((s) => s.cls === d.cls && Math.abs(s.z - z) <= 3 && angleGap(s.angle, a) <= 35
      && !s.sightings.some((o) => o.inspectionId === d.inspectionId && o.id !== d.id));
    if (site) site.sightings.push(d);
    else sites.push({ cls: d.cls, z, angle: a, sightings: [d] });
  }
  return sites;
}

function siteGrowth(site) {
  if (site.sightings.length < 2) return null;
  const first = site.sightings[0];
  const last = site.sightings[site.sightings.length - 1];
  const a0 = areaOf(first) || lengthOf(first);
  const a1 = areaOf(last) || lengthOf(last);
  if (!a0) return null;
  return { ratio: a1 / a0, percent: Math.round((a1 / a0 - 1) * 100) };
}

function diffInspections(detections) {
  const newest = new Map();
  detections.forEach((d) => { newest.set(d.inspectionId, Math.max(newest.get(d.inspectionId) || 0, timeOf(d))); });
  const order = [...newest.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (order.length < 2) return null;
  const [latestId, previousId] = order;
  const result = { latestId, previousId, fresh: [], grown: [], steady: [], notSeen: [] };
  for (const site of groupSites(detections)) {
    const inLatest = site.sightings.filter((d) => d.inspectionId === latestId);
    const inPrevious = site.sightings.filter((d) => d.inspectionId === previousId);
    if (inLatest.length && !inPrevious.length) { result.fresh.push({ site }); continue; }
    if (!inLatest.length && inPrevious.length) { result.notSeen.push({ site }); continue; }
    if (inLatest.length && inPrevious.length) {
      const a0 = areaOf(inPrevious[0]) || lengthOf(inPrevious[0]);
      const a1 = areaOf(inLatest[0]) || lengthOf(inLatest[0]);
      const percent = a0 ? Math.round((a1 / a0 - 1) * 100) : 0;
      (percent >= 20 ? result.grown : result.steady).push({ site, percent });
    }
  }
  result.grown.sort((a, b) => b.percent - a.percent);
  return result;
}

module.exports = { angleOf, normalize, groupSites, siteGrowth, diffInspections };
