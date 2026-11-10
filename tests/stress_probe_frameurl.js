'use strict';

/**
 * tests/stress_probe_frameurl.js
 * Empirical Stress Test Probe for InspectionVideos.jsx Frame Handling & Boundary Clamping
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT_DIR, 'frontend', 'public', 'frames', 'manifest.json');
const FRAMES_DIR = path.join(ROOT_DIR, 'frontend', 'public', 'frames', 'mobile');

console.log('================================================================');
console.log('  STRESS PROBE 1: InspectionVideos Frame Handling & Boundaries  ');
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

// 1. Verify manifest existence and structure
assert.ok(fs.existsSync(MANIFEST_PATH), `Manifest not found at ${MANIFEST_PATH}`);
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
check('Manifest exists and parses as valid JSON', true);
check('Manifest specifies frameCount === 192', manifest.frameCount === 192, `got ${manifest.frameCount}`);
check('Manifest specifies fps === 24', manifest.fps === 24, `got ${manifest.fps}`);
check('Manifest specifies pad === 4', manifest.pad === 4, `got ${manifest.pad}`);
check('Manifest specifies ext === "webp"', manifest.ext === 'webp', `got ${manifest.ext}`);

// 2. Exact reproduction of frameUrl logic from InspectionVideos.jsx
const FRAME_BASE = '/frames/mobile/';
function zeroPad(n, width) {
  return String(n).padStart(width, '0');
}
function frameUrl(man, frameIdx) {
  if (!man) return '';
  const pad   = man.pad  ?? 4;
  const ext   = man.ext  ?? 'webp';
  const total = man.frameCount || 192;
  const n     = Math.max(1, Math.min(total, frameIdx + 1));
  return `${FRAME_BASE}frame_${zeroPad(n, pad)}.${ext}`;
}

// 3. Test exact required out-of-range and edge indices: [-1, 0, 1, 192, 193, 9999]
const testCases = [
  { index: -9999, expected: '/frames/mobile/frame_0001.webp', desc: 'extreme negative index -9999 clamps to frame_0001.webp' },
  { index: -1,    expected: '/frames/mobile/frame_0001.webp', desc: 'negative index -1 clamps to frame_0001.webp' },
  { index: 0,     expected: '/frames/mobile/frame_0001.webp', desc: '0-based index 0 maps to frame_0001.webp' },
  { index: 1,     expected: '/frames/mobile/frame_0002.webp', desc: '0-based index 1 maps to frame_0002.webp' },
  { index: 191,   expected: '/frames/mobile/frame_0192.webp', desc: 'last valid index 191 maps to frame_0192.webp' },
  { index: 192,   expected: '/frames/mobile/frame_0192.webp', desc: 'boundary index 192 clamps to frame_0192.webp' },
  { index: 193,   expected: '/frames/mobile/frame_0192.webp', desc: 'overflow index 193 clamps to frame_0192.webp' },
  { index: 9999,  expected: '/frames/mobile/frame_0192.webp', desc: 'extreme overflow index 9999 clamps to frame_0192.webp' },
];

for (const tc of testCases) {
  const actual = frameUrl(manifest, tc.index);
  check(`frameUrl: ${tc.desc}`, actual === tc.expected, `Expected ${tc.expected}, got ${actual}`);
}

// 4. Invariant: ZERO requests target non-existent frame_0000.webp across ANY real index
let zeroTargeted = false;
for (let i = -10000; i <= 10000; i++) {
  const url = frameUrl(manifest, i);
  if (url.includes('frame_0000.webp')) {
    zeroTargeted = true;
    break;
  }
}
check('Invariant: Zero requests target non-existent frame_0000.webp across [-10000, 10000]', !zeroTargeted);

// 5. Physical disk asset verification:
// frame_0000.webp MUST NOT exist
const frame0Path = path.join(FRAMES_DIR, 'frame_0000.webp');
check('Physical asset frame_0000.webp does NOT exist on disk', !fs.existsSync(frame0Path));

// frame_0193.webp MUST NOT exist
const frame193Path = path.join(FRAMES_DIR, 'frame_0193.webp');
check('Physical asset frame_0193.webp does NOT exist on disk', !fs.existsSync(frame193Path));

// All 192 assets (frame_0001.webp to frame_0192.webp) MUST exist on disk with nonzero byte size
let missingAssetCount = 0;
let emptyAssetCount = 0;
for (let i = 1; i <= 192; i++) {
  const assetName = `frame_${zeroPad(i, 4)}.webp`;
  const assetPath = path.join(FRAMES_DIR, assetName);
  if (!fs.existsSync(assetPath)) {
    missingAssetCount++;
  } else {
    const stat = fs.statSync(assetPath);
    if (stat.size === 0) emptyAssetCount++;
  }
}
check('All 192 physical assets (frame_0001.webp to frame_0192.webp) exist on disk', missingAssetCount === 0, `missing ${missingAssetCount} files`);
check('All 192 physical assets have non-zero file sizes (>0 bytes)', emptyAssetCount === 0, `found ${emptyAssetCount} empty files`);

// 6. Handle edge cases: null/undefined manifest
check('frameUrl with null manifest returns empty string gracefully', frameUrl(null, 5) === '');
check('frameUrl with undefined manifest returns empty string gracefully', frameUrl(undefined, 5) === '');

// Summary
console.log('----------------------------------------------------------------');
console.log(`STRESS PROBE 1 RESULT: ${passedChecks}/${totalChecks} checks passed.`);
if (passedChecks !== totalChecks) {
  process.exit(1);
}
console.log('================================================================\n');
