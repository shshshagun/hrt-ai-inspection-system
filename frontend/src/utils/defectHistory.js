/**
 * Repeat-inspection helpers: the same physical defect is seen again in later inspections, so detections from
 * different sessions are grouped into "sites" by class, chainage (within 3 m) and angle around the lining (within 35 degrees).
 */
export const TUNNEL_LENGTH_M = 250;
export const DEFECT_RADIUS_M = 2.95;

export function angleOf(d) {
  if (typeof d.angle_deg === 'number') return d.angle_deg;
  const x = d.coordinates?.x ?? d.x ?? 0;
  const y = d.coordinates?.y ?? d.y ?? DEFECT_RADIUS_M;
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
}

export function chainageOf(d) {
  return Number(d.chainage_m ?? d.chainage ?? d.z ?? d.coordinates?.z ?? 0);
}

export function areaOf(d) {
  return Number(d.crack_area_mm2 ?? d.area_mm2 ?? 0);
}

export function lengthOf(d) {
  return Number(d.crack_length_mm ?? d.length_mm ?? 0);
}

export function timeOf(d) {
  return new Date(d.detectedAt || d.timestamp || d.created_at || 0).getTime();
}

function angleGap(a, b) {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

/** Groups detections into sites; each site lists its sightings oldest first. */
export function groupSites(detections) {
  const sites = [];
  for (const d of [...detections].sort((a, b) => timeOf(a) - timeOf(b))) {
    const cls = (d.class_label || d.category || '').toLowerCase();
    const z = chainageOf(d);
    const a = angleOf(d);
    const site = sites.find((s) => s.cls === cls && Math.abs(s.z - z) <= 3 && angleGap(s.angle, a) <= 35
      && !s.sightings.some((o) => o.inspectionId === d.inspectionId && o.id !== d.id));
    if (site) site.sightings.push(d);
    else sites.push({ cls, z, angle: a, sightings: [d] });
  }
  return sites;
}

/** Growth of one site between its first and latest sighting (null when seen once). */
export function siteGrowth(site) {
  if (site.sightings.length < 2) return null;
  const first = site.sightings[0];
  const last = site.sightings[site.sightings.length - 1];
  const a0 = areaOf(first) || lengthOf(first);
  const a1 = areaOf(last) || lengthOf(last);
  if (!a0) return null;
  return { from: first, to: last, ratio: a1 / a0, percent: Math.round((a1 / a0 - 1) * 100) };
}

/** The site that contains a given detection id. */
export function siteOf(detections, id) {
  return groupSites(detections).find((s) => s.sightings.some((d) => d.id === id)) || null;
}

/** Plain-language summary of the current data, used by the dashboard brief. */
export function buildBrief(detections) {
  if (!detections.length) return ['No inspection data yet. Upload a video in New Inspection, or open the demo, to see the summary here.'];
  const sites = groupSites(detections);
  const latestId = [...detections].sort((a, b) => timeOf(b) - timeOf(a))[0].inspectionId;
  const latest = detections.filter((d) => d.inspectionId === latestId);
  const lines = [];
  const critical = latest.filter((d) => d.severity === 'Critical');
  lines.push(`The latest inspection (${latestId}) found ${latest.length} defect${latest.length === 1 ? '' : 's'}, ${critical.length} of them critical.`);
  if (critical.length) {
    const zs = critical.map(chainageOf);
    lines.push(`Critical defects lie between ${Math.min(...zs).toFixed(0)} m and ${Math.max(...zs).toFixed(0)} m from the intake.`);
  }
  const hours = {};
  latest.forEach((d) => { const h = Math.round(angleOf(d) / 30) % 12 || 12; hours[h] = (hours[h] || 0) + 1; });
  const top = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 1) lines.push(`Most defects sit near ${top[0]} o'clock (${top[1]} of ${latest.length}).`);
  const grown = sites.map((s) => ({ s, g: siteGrowth(s) })).filter((x) => x.g && x.g.percent >= 20).sort((a, b) => b.g.percent - a.g.percent);
  if (grown.length) {
    const w = grown[0];
    lines.push(`${grown.length} defect${grown.length === 1 ? ' has' : 's have'} grown by 20% or more since the first inspection; the largest increase is +${w.g.percent}% at ${w.s.z.toFixed(0)} m.`);
  }
  const pending = latest.filter((d) => (d.reviewStatus || d.verified_status) === 'pending').length;
  if (pending) lines.push(`${pending} finding${pending === 1 ? ' is' : 's are'} waiting for an engineer to review.`);
  return lines;
}
