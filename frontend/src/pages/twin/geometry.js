/**
 * Three-free geometry and data rules for the digital twin, kept separate so they can be tested in plain Node.
 *
 * Conventions (same as the published reports and the rest of the app):
 *   origin (0, 0, 0) at the intake, +Z along the tunnel (chainage in metres),
 *   a defect at clock angle A (0 deg = 12 o'clock crown, 90 deg = 3 o'clock right wall) sits at
 *   x = r * sin(A), y = r * cos(A), z = chainage, with r = DEFECT_R = 2.95 m on the default 3.0 m circular bore.
 * The 3D view mirrors the X axis for display so that 3 o'clock appears on the observer's right when looking
 * downstream, matching the radar. Stored coordinates are never changed.
 */
import { TUNNEL_CONFIG } from './tunnel.config.js';

export const DEFECT_INSET_M = 0.05;
export const DEFECT_R = TUNNEL_CONFIG.radius_m - DEFECT_INSET_M; // 2.95
export const MIRROR_X_FOR_VIEWER = true;

const RAD = Math.PI / 180;

// ───────────── survey profile (view-only, session-only) ─────────────

/**
 * Parses a CSV of "chainage_m,radius_m" (or "chainage_m,diameter_m") rows. Header, comma / semicolon / tab separators
 * and blank lines are tolerated. Anything outside sensible bounds is rejected rather than clamped.
 */
export function parseProfileCsv(text, { length = TUNNEL_CONFIG.length_m, maxRows = 5000 } = {}) {
  const errors = [];
  const rows = [];
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > maxRows + 1) return { rows: [], errors: [`Too many rows (limit ${maxRows}).`] };
  let useDiameter = false;
  lines.forEach((line, i) => {
    const cells = line.split(/[;,\t]/).map((c) => c.trim());
    if (i === 0 && cells.some((c) => /[a-z]/i.test(c))) { useDiameter = /diam/i.test(cells[1] || ''); return; }
    const chainage = Number(cells[0]);
    const value = Number(cells[1]);
    if (!Number.isFinite(chainage) || !Number.isFinite(value)) { errors.push(`Row ${i + 1}: not numbers.`); return; }
    const radius = useDiameter ? value / 2 : value;
    if (chainage < 0 || chainage > length * 1.05) { errors.push(`Row ${i + 1}: chainage ${chainage} is outside 0 to ${length} m.`); return; }
    if (radius < 1 || radius > 12) { errors.push(`Row ${i + 1}: radius ${radius} m is outside 1 to 12 m.`); return; }
    rows.push({ z: chainage, r: radius });
  });
  rows.sort((a, b) => a.z - b.z);
  const unique = rows.filter((row, i) => i === 0 || row.z !== rows[i - 1].z);
  if (unique.length < 2) errors.push('At least two valid rows are needed.');
  return { rows: unique.length >= 2 ? unique : [], errors: errors.slice(0, 5) };
}

/** Radius at any chainage by linear interpolation of the profile, or the parametric radius when there is none. */
export function makeRadiusAt(rows, fallback = TUNNEL_CONFIG.radius_m) {
  if (!rows || rows.length < 2) return () => fallback;
  return (z) => {
    if (z <= rows[0].z) return rows[0].r;
    const last = rows[rows.length - 1];
    if (z >= last.z) return last.r;
    let lo = 0;
    let hi = rows.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid].z <= z) lo = mid; else hi = mid; }
    const t = (z - rows[lo].z) / (rows[hi].z - rows[lo].z);
    return rows[lo].r + (rows[hi].r - rows[lo].r) * t;
  };
}

// ───────────── cross-section surface ─────────────

/** The 3D point on the lining at clock angle `angleDeg` and chainage `z`. `shape` is 'circular' (default) or 'horseshoe'. */
export function surfacePoint(angleDeg, z, { radiusAt = () => TUNNEL_CONFIG.radius_m, shape = 'circular', inset = 0 } = {}) {
  const R = radiusAt(z);
  const r = R - inset;
  const a = angleDeg * RAD;
  let y = r * Math.cos(a);
  if (shape === 'horseshoe') y = Math.max(y, -0.8 * R + inset); // flat invert
  return { x: r * Math.sin(a), y, z };
}

/** Where a defect is drawn on the lining. */
export function defectPosition(defect, opts = {}) {
  return surfacePoint(defect.angle_deg, defect.chainage_m, { inset: DEFECT_INSET_M, ...opts });
}

// ───────────── defects ─────────────

/** Angle in degrees clockwise from the crown, from stored x / y (same maths as the radar). */
export function angleFromXY(x, y) {
  if (!x && !y) return 0;
  return (((Math.atan2(x, y) * 180) / Math.PI) + 360) % 360;
}

// The gateway and the upload page fill these in when a detection arrives without a measurement.
const DEFAULT_SIZES = [[3.2, 180], [2.5, 150]];

/**
 * Normalises a raw detection for the twin. Nothing is invented: a record without a chainage is "unlocated" and is kept out
 * of the model, and sizes equal to the system defaults are flagged as not measured.
 */
export function toTwinDefect(raw, i = 0) {
  const id = raw._id ? String(raw._id) : String(raw.id || raw.detection_id || `DET-${i + 1}`);
  const chainage = Number(raw.z ?? raw.chainage_z ?? raw.chainage_m ?? raw.chainage ?? 0);
  const width = Number(raw.crack_width_mm ?? raw.width_mm ?? 0) || null;
  const length = Number(raw.crack_length_mm ?? raw.length_mm ?? raw.height_mm ?? 0) || null;
  const isDefault = width != null && length != null && DEFAULT_SIZES.some(([w, l]) => w === width && l === length);
  const angle = typeof raw.angle_deg === 'number' ? raw.angle_deg : angleFromXY(Number(raw.x) || 0, Number(raw.y) || 0);
  return {
    id,
    cls: String(raw.class_label || raw.category || 'defect').toLowerCase(),
    severity: raw.severity || (raw.confidence > 0.85 ? 'Critical' : raw.confidence > 0.7 ? 'Major' : 'Minor'),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    chainage_m: Number.isFinite(chainage) ? chainage : 0,
    angle_deg: ((angle % 360) + 360) % 360,
    width_mm: width,
    length_mm: length,
    area_mm2: Number(raw.crack_area_mm2 ?? raw.area_mm2 ?? 0) || null,
    sizeMeasured: !isDefault && width != null && length != null,
    located: Number.isFinite(chainage) && chainage > 0.05, // 0 is what a missing position is stored as
    inspectionId: raw.inspection_id || raw.inspectionId || null,
    detectedAt: raw.timestamp || raw.created_at || raw.detectedAt || null,
    imageUrl: typeof raw.image_url === 'string' && raw.image_url ? raw.image_url : null,
    videoName: raw.video_name || null,
  };
}

/** Groups defects that sit on top of each other (within 0.4 m and 12 degrees) so they can still be picked one by one. */
export function clusterCoincident(defects) {
  const clusters = [];
  for (const d of defects) {
    const c = clusters.find((k) => Math.abs(k.z - d.chainage_m) <= 0.4 && Math.min(Math.abs(k.a - d.angle_deg), 360 - Math.abs(k.a - d.angle_deg)) <= 12);
    if (c) c.members.push(d); else clusters.push({ z: d.chainage_m, a: d.angle_deg, members: [d] });
  }
  return clusters;
}

// ───────────── small deterministic helpers ─────────────

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One plain sentence for a defect, used as the replay caption. */
export function describeDefect(d) {
  const clock = Math.round(d.angle_deg / 30) % 12 || 12;
  const size = d.sizeMeasured ? `, about ${Math.round(d.length_mm)} mm long and ${d.width_mm} mm wide` : ', size not measured';
  return `${d.severity} ${d.cls} at ${d.chainage_m.toFixed(1)} m, ${clock} o'clock${size}.`;
}

export function formatClock(deg) {
  const n = ((deg % 360) + 360) % 360;
  if (n === 0) return "12 o'clock (crown)";
  if (n === 90) return "3 o'clock (right wall)";
  if (n === 180) return "6 o'clock (invert)";
  if (n === 270) return "9 o'clock (left wall)";
  return `${Math.round(n / 30) || 12} o'clock (${Math.round(n)}°)`;
}
