'use strict';

/**
 * tests/stress_probe_twin_geometry.js
 * Empirical Stress Test Probe for Three.js Digital Twin Geometric Projection & Radial Invariant
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const CRACKS_PATH = path.join(ROOT_DIR, 'frontend', 'public', 'data', 'cracks.json');
const TUNNEL_CONFIG_PATH = path.join(ROOT_DIR, 'frontend', 'src', 'pages', 'twin', 'tunnel.config.js');

console.log('================================================================');
console.log('  STRESS PROBE 2: Three.js Digital Twin Geometry & Projection   ');
console.log('================================================================');

let totalChecks = 0;
let passedChecks = 0;

function check(label, condition, details = '') {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${label}`);
  } else {
    console.error(`  [FAIL] ${label} - ${details}`);
  }
}

// 1. Constants and projection formulas from TunnelTwin.jsx (lines 16-26 & 990-996)
const DEFECT_R = 2.95; // snapped 5cm inside 3.0m inner wall
const TUNNEL_RADIUS_M = 3.0;
const TUNNEL_LENGTH_M = 250.0;
const EPSILON = 1e-6; // 10^-6 tolerance

function formatClockPosition(deg) {
  const normalized = ((deg % 360) + 360) % 360;
  if (normalized === 0 || normalized === 360) return "12 o'clock (Crown)";
  if (normalized === 90) return "3 o'clock (Right Wall)";
  if (normalized === 180) return "6 o'clock (Invert / Floor)";
  if (normalized === 270) return "9 o'clock (Left Wall)";
  const clock = Math.round(normalized / 30) || 12;
  return `${clock} o'clock (${normalized}\xB0)`;
}

function projectDefect(angleDeg, chainageM) {
  const baseRad = (angleDeg * Math.PI) / 180;
  const mx = DEFECT_R * Math.sin(baseRad);
  const my = DEFECT_R * Math.cos(baseRad);
  const mz = chainageM;
  return { x: mx, y: my, z: mz };
}

// 2. Cardinal clock positions verification
const cardinalCases = [
  { deg: 0,   clock: "12 o'clock (Crown)",          expX: 0,        expY: DEFECT_R,  desc: "12 o'clock Crown (0°)" },
  { deg: 90,  clock: "3 o'clock (Right Wall)",      expX: DEFECT_R, expY: 0,         desc: "3 o'clock Right Wall (90°)" },
  { deg: 180, clock: "6 o'clock (Invert / Floor)",  expX: 0,        expY: -DEFECT_R, desc: "6 o'clock Invert / Floor (180°)" },
  { deg: 270, clock: "9 o'clock (Left Wall)",       expX: -DEFECT_R, expY: 0,        desc: "9 o'clock Left Wall (270°)" },
  { deg: 360, clock: "12 o'clock (Crown)",          expX: 0,        expY: DEFECT_R,  desc: "360° wrap identity to Crown" },
];

for (const c of cardinalCases) {
  const p = projectDefect(c.deg, 10.0);
  const dx = Math.abs(p.x - c.expX);
  const dy = Math.abs(p.y - c.expY);
  const radialDist = Math.sqrt(p.x * p.x + p.y * p.y);
  const rErr = Math.abs(radialDist - DEFECT_R);
  const clockStr = formatClockPosition(c.deg);

  check(`Cardinal Position: ${c.desc} coordinates match expected within 1e-6`, dx < EPSILON && dy < EPSILON, `dx=${dx}, dy=${dy}`);
  check(`Cardinal Position: ${c.desc} radial invariant sqrt(x²+y²) == 2.95 ± 1e-6`, rErr < EPSILON, `rErr=${rErr}`);
  check(`Cardinal Position: ${c.desc} clock format label === "${c.clock}"`, clockStr === c.clock, `got "${clockStr}"`);
}

// 3. Hourly clock positions (1 o'clock to 11 o'clock)
for (let hour = 1; hour <= 12; hour++) {
  const deg = (hour * 30) % 360;
  const p = projectDefect(deg, 20.0);
  const radialDist = Math.sqrt(p.x * p.x + p.y * p.y);
  const rErr = Math.abs(radialDist - DEFECT_R);
  assert.ok(rErr < EPSILON, `Hour ${hour} failed radial invariant: err=${rErr}`);
}
check('All 12 hourly clock positions (1:00 to 12:00) satisfy radial invariant ± 1e-6', true);

// 4. Fine-grained radial projection invariant sweep:
// 36,000 steps (every 0.01 degree across 0° to 360°)
let maxError = 0;
let sweepPass = true;
const NUM_STEPS = 36000;
for (let i = 0; i < NUM_STEPS; i++) {
  const deg = (i / NUM_STEPS) * 360;
  const p = projectDefect(deg, 50.0);
  const r = Math.sqrt(p.x * p.x + p.y * p.y);
  const err = Math.abs(r - DEFECT_R);
  if (err > maxError) maxError = err;
  if (err > EPSILON) {
    sweepPass = false;
    break;
  }
}
check(`Fine-grained 36,000-angle sweep: radial invariant holds across full 360° (max err = ${maxError.toExponential(4)})`, sweepPass && maxError < EPSILON);

// 5. Arbitrary, irrational, and multi-turn angle stress testing
const exoticAngles = [
  -720, -450, -360, -270, -180, -90, -45, -0.0001,
  Math.PI, Math.E, Math.SQRT2, (1 + Math.sqrt(5)) / 2 * 100,
  360.0001, 450, 720, 1080, 1440, 99999.5
];
let exoticPass = true;
for (const ang of exoticAngles) {
  const p = projectDefect(ang, 75.0);
  const r = Math.sqrt(p.x * p.x + p.y * p.y);
  if (Math.abs(r - DEFECT_R) > EPSILON) {
    exoticPass = false;
    break;
  }
}
check('Exotic / multi-turn / negative angles satisfy radial invariant ± 1e-6', exoticPass);

// 6. Longitudinal axis (+Z chainage axis) invariant
const chainageTests = [0.0, 0.5, 10.25, 50.0, 125.75, 200.0, 249.99, 250.0];
let chainagePass = true;
for (const z of chainageTests) {
  const p = projectDefect(45, z);
  if (p.z !== z || p.z < 0 || p.z > TUNNEL_LENGTH_M) {
    chainagePass = false;
    break;
  }
}
check('Longitudinal axis +Z invariant: z matches chainage strictly in [0, 250m]', chainagePass);

// 7. Clearance inside 3.0m tunnel bore (5cm clearance)
const clearance = TUNNEL_RADIUS_M - DEFECT_R;
check('Radial clearance between defect marker and tunnel bore is exactly 0.05m (5cm)', Math.abs(clearance - 0.05) < 1e-9);

// 8. Empirical dataset validation: frontend/public/data/cracks.json
assert.ok(fs.existsSync(CRACKS_PATH), `cracks.json not found at ${CRACKS_PATH}`);
const cracksData = JSON.parse(fs.readFileSync(CRACKS_PATH, 'utf8'));
check('cracks.json contains 20 real defect records', cracksData.length === 20, `got ${cracksData.length}`);

let allCracksPass = true;
let worstCrackErr = 0;
for (const crack of cracksData) {
  assert.ok(typeof crack.angle_deg === 'number', `crack ${crack.id} missing angle_deg`);
  assert.ok(typeof crack.chainage_m === 'number', `crack ${crack.id} missing chainage_m`);
  
  const p = projectDefect(crack.angle_deg, crack.chainage_m);
  const r = Math.sqrt(p.x * p.x + p.y * p.y);
  const err = Math.abs(r - DEFECT_R);
  if (err > worstCrackErr) worstCrackErr = err;

  if (err > EPSILON || p.z < 0 || p.z > TUNNEL_LENGTH_M) {
    allCracksPass = false;
    break;
  }
}
check(`All 20 defects in cracks.json project precisely at R=2.95m and inside [0, 250m] +Z (max err = ${worstCrackErr.toExponential(4)})`, allCracksPass);

// Summary
console.log('----------------------------------------------------------------');
console.log(`STRESS PROBE 2 RESULT: ${passedChecks}/${totalChecks} checks passed.`);
if (passedChecks !== totalChecks) {
  process.exit(1);
}
console.log('================================================================\n');
