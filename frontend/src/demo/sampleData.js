/**
 * Sample inspection data for the read-only demo (no server needed).
 * Three inspections of the same 250 m tunnel (March, August, November 2026): the same cracks are seen
 * again each time and most of them grow, so the repeat-inspection views have something to show.
 * The numbers are invented for demonstration; the images are frames of the landing-page descent video.
 */

const R = 2.95; // defect radius in metres (tunnel convention used across the project)

const CLOCK_LABELS = [
  "12 o'clock (Crown)", "1 o'clock (Upper Right)", "2 o'clock (Right Haunch)", "3 o'clock (Right Wall)",
  "4 o'clock (Lower Right)", "5 o'clock (Invert Haunch)", "6 o'clock (Invert / Floor)", "7 o'clock (Invert Haunch)",
  "8 o'clock (Lower Left)", "9 o'clock (Left Wall)", "10 o'clock (Left Haunch)", "11 o'clock (Upper Left)",
];

// One row per physical defect: chainage z (m), angle around the lining (deg, 0 = crown), class, length (mm) in
// November, yearly growth factor, first inspection that saw it (0 = March, 1 = August, 2 = November), frame.
const SITES = [
  { z: 12.4, a: 2, cls: 'crack', len: 210, growth: 1.5, first: 0, frame: 152 },
  { z: 24.6, a: 88, cls: 'crack', len: 96, growth: 1.1, first: 0, frame: 160 },
  { z: 38.1, a: 154, cls: 'spalling', len: 340, growth: 1.35, first: 0, frame: 170 },
  { z: 51.9, a: 301, cls: 'crack', len: 180, growth: 1.7, first: 0, frame: 176 },
  { z: 66.3, a: 33, cls: 'crack', len: 128, growth: 1.05, first: 0, frame: 158 },
  { z: 79.0, a: 262, cls: 'crack', len: 260, growth: 1.6, first: 0, frame: 184 },
  { z: 93.7, a: 121, cls: 'crack', len: 74, growth: 1.0, first: 1, frame: 166 },
  { z: 108.2, a: 330, cls: 'crack', len: 305, growth: 1.9, first: 0, frame: 188 },
  { z: 121.5, a: 296, cls: 'spalling', len: 410, growth: 1.45, first: 0, frame: 174 },
  { z: 134.8, a: 301, cls: 'crack', len: 158, growth: 1.3, first: 1, frame: 180 },
  { z: 149.3, a: 62, cls: 'crack', len: 88, growth: 1.0, first: 1, frame: 156 },
  { z: 167.0, a: 209, cls: 'crack', len: 224, growth: 1.55, first: 0, frame: 186 },
  { z: 188.4, a: 12, cls: 'crack', len: 112, growth: 1.1, first: 1, frame: 164 },
  { z: 203.9, a: 247, cls: 'crack', len: 143, growth: 1.25, first: 2, frame: 172 },
  { z: 229.5, a: 174, cls: 'crack', len: 67, growth: 1.0, first: 2, frame: 178 },
];

const SESSIONS = [
  { id: 'INSP-DEMO-2026-03', date: '2026-03-12', label: 'Spring inspection – baseline', video: 'hrt_run_march.mp4', scale: 0.55 },
  { id: 'INSP-DEMO-2026-08', date: '2026-08-20', label: 'Summer follow-up', video: 'hrt_run_august.mp4', scale: 0.78 },
  { id: 'INSP-DEMO-2026-11', date: '2026-11-14', label: 'Autumn inspection – latest', video: 'hrt_run_november.mp4', scale: 1.0 },
];

function rand(seed) { // small deterministic generator, so the demo looks the same every time
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function build() {
  const detections = [];
  SESSIONS.forEach((sess, si) => {
    SITES.forEach((site, i) => {
      if (site.first > si) return;
      const r = rand(i * 97 + si * 13 + 5);
      // length grows with each later inspection by the site's growth factor
      const back = 2 - si;
      const length = Math.round(site.len / Math.pow(site.growth, back * 0.7));
      const width = Number((0.8 + (length / 410) * 4.6 + r() * 0.4).toFixed(1));
      const area = Math.round(length * width * (site.cls === 'spalling' ? 2.6 : 0.62));
      const confidence = Number(Math.min(0.96, 0.56 + (length / 520) + r() * 0.12).toFixed(2));
      const severity = length >= 320 || confidence >= 0.93 ? 'Critical' : length >= 150 || confidence >= 0.8 ? 'Major' : 'Minor';
      const rad = (site.a * Math.PI) / 180;
      const hour = Math.round(site.a / 30) % 12;
      const ts = new Date(`${sess.date}T0${6 + (i % 3)}:${10 + i}:00Z`).toISOString();
      detections.push({
        _id: `demo-${si}-${i}`,
        class_label: site.cls,
        subtype: site.cls === 'spalling' ? 'Concrete Spalling / Exposed Rebar Cavity' : 'Longitudinal Lining Crack',
        confidence,
        severity,
        crack_width_mm: width,
        crack_length_mm: length,
        crack_area_mm2: area,
        clock_pos: CLOCK_LABELS[hour],
        angle_deg: site.a,
        inspection_id: sess.id,
        video_name: sess.video,
        video_time: Number((site.z / 12).toFixed(1)),
        frame_index: Math.round(site.z * 4),
        image_url: `/frames/mobile/frame_${String(Math.max(130, site.frame - (2 - si) * 2)).padStart(4, '0')}.webp`,
        bbox: { left_pct: 18 + ((i * 7) % 50), top_pct: 20 + ((i * 11) % 40), width_pct: 14 + (length / 410) * 22, height_pct: 9 + (width / 6) * 12 },
        timestamp: ts,
        created_at: ts,
        x: Number((R * Math.sin(rad)).toFixed(2)),
        y: Number((R * Math.cos(rad)).toFixed(2)),
        z: site.z,
        verified_status: severity === 'Critical' && si === 2 ? 'pending' : 'confirmed',
        // the sample cracks were reviewed, except the newest critical ones, which the system judged to be cracks but nobody has confirmed yet
        review_status: severity === 'Critical' && si === 2 ? 'pending' : 'confirmed',
        auto_verdict: 'crack',
        demo: true,
      });
    });
  });
  return detections;
}

export const DEMO_DETECTIONS = build();

export const DEMO_INSPECTIONS = SESSIONS.map((sess) => {
  const rows = DEMO_DETECTIONS.filter((d) => d.inspection_id === sess.id);
  const zs = rows.map((d) => d.z);
  return {
    id: sess.id,
    inspection_id: sess.id,
    label: sess.label,
    facility_name: sess.label,
    videoName: sess.video,
    date: sess.date,
    start_time: `${sess.date}T06:00:00.000Z`,
    end_time: `${sess.date}T09:30:00.000Z`,
    rov: 'Recorded footage (demo)',
    operator_name: 'Demo data',
    totalDetections: rows.length,
    detection_count: rows.length,
    criticalCount: rows.filter((d) => d.severity === 'Critical').length,
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    total_chainage_m: 250,
    coverageKm: 0.25,
    coverage_km: 0.25,
    status: 'completed',
  };
}).reverse(); // newest first, like the server
