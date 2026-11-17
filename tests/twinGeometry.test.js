'use strict';
/** Geometry and data rules of the digital twin. Run:  node tests/twinGeometry.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'pages', 'twin', 'geometry.js')).href);
const demo = () => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'demo', 'sampleData.js')).href);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('defects sit at 2.95 m on the default bore, with the documented clock convention', async () => {
  const { surfacePoint, defectPosition, DEFECT_R } = await load();
  near(DEFECT_R, 2.95);
  const crown = defectPosition({ angle_deg: 0, chainage_m: 40 });
  near(crown.x, 0); near(crown.y, 2.95); near(crown.z, 40);
  const right = defectPosition({ angle_deg: 90, chainage_m: 40 }); // 3 o'clock: +X in stored coordinates
  near(right.x, 2.95); near(right.y, 0, 1e-9);
  const invert = defectPosition({ angle_deg: 180, chainage_m: 40 });
  near(invert.y, -2.95);
  const wall = surfacePoint(90, 10, { inset: 0 });
  near(wall.x, 3.0);
});

test('stored x/y of every demo defect round-trips to the same angle and radius', async () => {
  const { toTwinDefect, defectPosition } = await load();
  const { DEMO_DETECTIONS } = await demo();
  for (const raw of DEMO_DETECTIONS) {
    const d = toTwinDefect(raw);
    const p = defectPosition(d);
    assert.ok(Math.abs(p.x - raw.x) < 0.02 && Math.abs(p.y - raw.y) < 0.02, `${raw._id}: ${p.x},${p.y} vs ${raw.x},${raw.y}`);
    near(p.z, raw.z);
  }
});

test('profile CSV: radius or diameter, interpolation, and rejection of bad rows', async () => {
  const { parseProfileCsv, makeRadiusAt } = await load();
  const ok = parseProfileCsv('chainage_m,radius_m\n0,3\n100,3.5\n250,3\n');
  assert.deepEqual(ok.errors, []);
  const r = makeRadiusAt(ok.rows);
  near(r(0), 3); near(r(50), 3.25); near(r(100), 3.5); near(r(999), 3); near(r(-5), 3);
  const dia = parseProfileCsv('chainage_m;diameter_m\n0;6\n250;7');
  near(makeRadiusAt(dia.rows)(250), 3.5);
  const bad = parseProfileCsv('0,3\n10,abc\n20,99\n9999,3');
  assert.ok(bad.errors.length >= 3);
  assert.equal(bad.rows.length, 0, 'fewer than two valid rows means no profile at all');
  assert.equal(makeRadiusAt([])(10), 3, 'no profile falls back to the parametric radius');
  assert.equal(parseProfileCsv('x\n'.repeat(6000)).rows.length, 0);
});

test('horseshoe section has a flat invert and the same crown', async () => {
  const { surfacePoint } = await load();
  near(surfacePoint(0, 0, { shape: 'horseshoe' }).y, 3);
  near(surfacePoint(180, 0, { shape: 'horseshoe' }).y, -2.4);
  near(surfacePoint(180, 0, { shape: 'circular' }).y, -3);
});

test('records without a position or measurement are flagged instead of drawn as measured', async () => {
  const { toTwinDefect, clusterCoincident } = await load();
  // the shape the live gateway stores when the pipeline gave no position (x=0, y=2.95, z=0, default sizes)
  const live = Array.from({ length: 12 }, (_, i) => toTwinDefect({ _id: `live${i}`, class_label: 'crack', confidence: 0.9, x: 0, y: 2.95, z: 0, crack_width_mm: 2.5, crack_length_mm: 150, image_url: 'data:image/jpeg;base64,AAAA', inspection_id: 'CAM-1' }, i));
  assert.ok(live.every((d) => !d.located), 'chainage 0 means "not recorded"');
  assert.ok(live.every((d) => !d.sizeMeasured), 'system default sizes are not measurements');
  const located = toTwinDefect({ _id: 'a', class_label: 'crack', z: 42, x: 2.95, y: 0, crack_width_mm: 1.7, crack_length_mm: 320 });
  assert.ok(located.located && located.sizeMeasured);
  near(located.angle_deg, 90);
  // defects stacked on the same spot are grouped so they can still be picked one by one
  const stack = Array.from({ length: 5 }, (_, i) => toTwinDefect({ _id: `s${i}`, z: 10, x: 0, y: 2.95 }));
  assert.equal(clusterCoincident(stack).length, 1);
  assert.equal(clusterCoincident(stack)[0].members.length, 5);
});

test('seeded randomness is deterministic and the caption is plain text', async () => {
  const { mulberry32, hashString, describeDefect, toTwinDefect } = await load();
  const a = mulberry32(hashString('abc')); const b = mulberry32(hashString('abc'));
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  const text = describeDefect(toTwinDefect({ _id: 'x', class_label: 'crack', severity: 'Critical', z: 12.34, x: 0, y: 2.95, crack_width_mm: 1.2, crack_length_mm: 400 }));
  assert.match(text, /Critical crack at 12\.3 m, 12 o'clock, about 400 mm long and 1\.2 mm wide/);
});
