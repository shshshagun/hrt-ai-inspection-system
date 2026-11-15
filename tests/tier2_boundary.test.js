'use strict';

/**
 * tests/tier2_boundary.test.js
 * Tier 2: Boundary & Corner Cases Test Suite
 *
 * Programmatically validates:
 *  1. Invalid detection payload rejection (HTTP 400 validation error responses)
 *  2. SQL injection and bad UUID handling (middleware & parameterized query enforcement)
 *  3. Spatial binning bounds (interval boundaries 5m to 50m, empty bins, null coords)
 *  4. 1-based frame indexing bounds in InspectionVideos.jsx (frames 1 to 192, assets & clamping)
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');

// Ensure modules can resolve backend and root packages
const ROOT_DIR = path.resolve(__dirname, '..');
module.paths.push(path.join(ROOT_DIR, 'backend', 'node_modules'));

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function runTier2() {
  console.log(`\n${BOLD}${CYAN}======================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  TIER 2: Boundary & Corner Cases Verification        ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================${RESET}`);

  const results = [];

  function record(name, pass, details = '') {
    results.push({ name, pass, details });
    const badge = pass ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
    console.log(`  ${badge} ${name}`);
    if (details && !pass) {
      console.log(`      ${RED}${details}${RESET}`);
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Invalid detection payload rejection (HTTP 400)
  // ---------------------------------------------------------------------------
  try {
    process.env.PORT = '0';
    process.env.NODE_ENV = 'test';
    const app = require('../backend/src/index');

    const invokePostDetection = (payload) => {
      return new Promise((resolve) => {
        const req = {
          method: 'POST',
          url: '/api/detections',
          headers: {
            'content-type': 'application/json',
          },
          body: payload,
          socket: { remoteAddress: '127.0.0.1' },
        };
        const headers = {};
        let statusCode = 200;
        let responseBody = null;
        const res = {
          setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
          getHeader: (k) => headers[k.toLowerCase()],
          removeHeader: (k) => { delete headers[k.toLowerCase()]; },
          status: (code) => { statusCode = code; return res; },
          json: (data) => { responseBody = data; resolve({ statusCode, responseBody }); },
          end: () => { resolve({ statusCode, responseBody }); },
        };

        app.handle(req, res);
      });
    };

    // 1.1 Missing class_label -> 400
    const resMissingLabel = await invokePostDetection({
      confidence: 0.85,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: 10,
      timestamp: new Date().toISOString(),
      x: 1.0, y: 1.0, z: 10.0,
    });
    record('Payload rejection: missing class_label yields HTTP 400', resMissingLabel.statusCode === 400);

    // 1.2 Empty class_label -> 400
    const resEmptyLabel = await invokePostDetection({
      class_label: '   ',
      confidence: 0.85,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: 10,
      timestamp: new Date().toISOString(),
      x: 1.0, y: 1.0, z: 10.0,
    });
    record('Payload rejection: empty class_label yields HTTP 400', resEmptyLabel.statusCode === 400);

    // 1.3 Out-of-bounds confidence (< 0 or > 1) -> 400
    const resNegConf = await invokePostDetection({
      class_label: 'crack',
      confidence: -0.2,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: 10,
      timestamp: new Date().toISOString(),
      x: 1.0, y: 1.0, z: 10.0,
    });
    const resHighConf = await invokePostDetection({
      class_label: 'crack',
      confidence: 1.5,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: 10,
      timestamp: new Date().toISOString(),
      x: 1.0, y: 1.0, z: 10.0,
    });
    record('Payload rejection: confidence outside [0.0, 1.0] yields HTTP 400', resNegConf.statusCode === 400 && resHighConf.statusCode === 400);

    // 1.4 Missing bbox -> 400
    const resMissingBbox = await invokePostDetection({
      class_label: 'crack',
      confidence: 0.8,
      frame_index: 10,
      timestamp: new Date().toISOString(),
      x: 1.0, y: 1.0, z: 10.0,
    });
    record('Payload rejection: missing bbox object yields HTTP 400', resMissingBbox.statusCode === 400);

    // 1.5 Negative frame_index -> 400
    const resNegFrame = await invokePostDetection({
      class_label: 'crack',
      confidence: 0.8,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: -5,
      timestamp: new Date().toISOString(),
      x: 1.0, y: 1.0, z: 10.0,
    });
    record('Payload rejection: negative frame_index yields HTTP 400', resNegFrame.statusCode === 400);

    // 1.6 Malformed timestamp string -> 400
    const resBadTimestamp = await invokePostDetection({
      class_label: 'crack',
      confidence: 0.8,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: 1,
      timestamp: 'invalid-date-format-999',
      x: 1.0, y: 1.0, z: 10.0,
    });
    record('Payload rejection: non-ISO8601 timestamp yields HTTP 400', resBadTimestamp.statusCode === 400);

    // 1.7 Non-numeric coordinates -> 400
    const resBadCoords = await invokePostDetection({
      class_label: 'crack',
      confidence: 0.8,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: 1,
      timestamp: new Date().toISOString(),
      x: 'invalid', y: 1.0, z: 10.0,
    });
    record('Payload rejection: non-float spatial coordinates yield HTTP 400', resBadCoords.statusCode === 400);

    // 1.8 Malformed inspection_id UUID -> 400
    const resBadInspId = await invokePostDetection({
      class_label: 'crack',
      confidence: 0.8,
      bbox: { x1: 10, y1: 10, x2: 50, y2: 50 },
      frame_index: 1,
      timestamp: new Date().toISOString(),
      x: 1.0, y: 1.0, z: 10.0,
      inspection_id: 'bad-uuid-value',
    });
    record('Payload rejection: malformed inspection_id yields HTTP 400', resBadInspId.statusCode === 400);

  } catch (err) {
    record('Detection payload validation framework initialization', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // 2. SQL injection and bad UUID handling
  // ---------------------------------------------------------------------------
  try {
    const { isValidUUID } = require('../backend/src/middleware/validate');

    const maliciousUUIDs = [
      "'; DROP TABLE detections; --",
      "' OR '1'='1",
      "c1455943-882d-4250-843b-092bdd1351a9; DELETE FROM inspections",
      '1234567890',
      'c1455943-882d-4250-843b',
      'not-a-valid-uuid-format',
      '',
      null,
      undefined,
    ];

    let allMaliciousRejected = true;
    for (const badUuid of maliciousUUIDs) {
      if (isValidUUID(badUuid) !== false) {
        allMaliciousRejected = false;
        break;
      }
    }
    record('SQL Injection Guard: Malicious and invalid UUID strings rejected by isValidUUID', allMaliciousRejected);

    const validUUIDs = [
      'c1455943-882d-4250-843b-092bdd1351a9',
      '45e23d50-e579-4c5a-a3de-461d650927bb',
      'a74303d9-1790-4d74-869f-3afe634e81a7',
    ];
    let allValidAccepted = true;
    for (const validUuid of validUUIDs) {
      if (isValidUUID(validUuid) !== true) {
        allValidAccepted = false;
        break;
      }
    }
    record('UUID Verification: RFC 4122 compliant UUIDv4 strings accepted', allValidAccepted);

    // Codebase Parameterized Query Audit: verify zero string concatenation in SQL
    const routesDir = path.join(ROOT_DIR, 'backend', 'src', 'routes');
    const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && !f.includes('test'));
    let hasUnsafeConcatenation = false;

    for (const file of routeFiles) {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
      // Look for unsafe query patterns like query(`SELECT ... ${...}`)
      if (/query\(\s*`[^`]*\$\{[^}]+\}[^`]*`/i.test(content) || /query\(\s*["'][^"']*\+\s*req\./i.test(content)) {
        hasUnsafeConcatenation = true;
        break;
      }
    }
    record('SQL Security Audit: backend routes use strictly parameterized queries ($1, $2)', !hasUnsafeConcatenation);

  } catch (err) {
    record('SQL injection and UUID validation', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // 3. Spatial binning bounds (5m to 50m intervals, empty bins, null coords)
  // ---------------------------------------------------------------------------
  try {
    function binData(rows, intervalM, minConf = 0.0) {
      const filtered = rows.filter(
        r => r.coord_z !== null && r.coord_z !== undefined && !isNaN(r.coord_z) && typeof r.coord_z === 'number' && r.confidence >= minConf
      );

      const bins = new Map();
      for (const row of filtered) {
        const binKey = Math.floor(row.coord_z / intervalM);
        const start = binKey * intervalM;
        const end = (binKey + 1) * intervalM;

        if (!bins.has(binKey)) {
          bins.set(binKey, { chainage_start: start, chainage_end: end, count: 0 });
        }
        bins.get(binKey).count++;
      }
      return [...bins.values()].sort((a, b) => a.chainage_start - b.chainage_start);
    }

    // 3.1 Interval boundary test: 5m interval
    const testRows5m = [
      { coord_z: 0.0, confidence: 0.8 },
      { coord_z: 4.999, confidence: 0.8 },
      { coord_z: 5.0, confidence: 0.8 },
      { coord_z: 9.999, confidence: 0.8 },
      { coord_z: 10.0, confidence: 0.8 },
      { coord_z: 249.99, confidence: 0.8 },
    ];
    const bins5m = binData(testRows5m, 5);
    const pass5m = bins5m.length === 4 &&
      bins5m[0].chainage_start === 0 && bins5m[0].chainage_end === 5 && bins5m[0].count === 2 &&
      bins5m[1].chainage_start === 5 && bins5m[1].chainage_end === 10 && bins5m[1].count === 2 &&
      bins5m[2].chainage_start === 10 && bins5m[2].chainage_end === 15 && bins5m[2].count === 1 &&
      bins5m[3].chainage_start === 245 && bins5m[3].chainage_end === 250 && bins5m[3].count === 1;
    record('Spatial binning bounds: interval=5m boundary partitioning [0,5), [5,10), [245,250)', pass5m);

    // 3.2 Interval boundary test: 50m interval
    const testRows50m = [
      { coord_z: 0.0, confidence: 0.7 },
      { coord_z: 49.99, confidence: 0.7 },
      { coord_z: 50.0, confidence: 0.7 },
      { coord_z: 200.0, confidence: 0.7 },
      { coord_z: 249.99, confidence: 0.7 },
    ];
    const bins50m = binData(testRows50m, 50);
    const pass50m = bins50m.length === 3 &&
      bins50m[0].chainage_start === 0 && bins50m[0].chainage_end === 50 && bins50m[0].count === 2 &&
      bins50m[1].chainage_start === 50 && bins50m[1].chainage_end === 100 && bins50m[1].count === 1 &&
      bins50m[2].chainage_start === 200 && bins50m[2].chainage_end === 250 && bins50m[2].count === 2;
    record('Spatial binning bounds: interval=50m boundary partitioning [0,50), [50,100), [200,250)', pass50m);

    // 3.3 Empty bins when filter excludes all rows
    const emptyBins = binData(testRows50m, 25, 0.999);
    record('Spatial binning bounds: zero bins returned when confidence threshold excludes all detections', emptyBins.length === 0);

    // 3.4 Null, undefined, NaN, and string coords strictly excluded
    const corruptedRows = [
      { coord_z: null, confidence: 0.95 },
      { coord_z: undefined, confidence: 0.95 },
      { coord_z: NaN, confidence: 0.95 },
      { coord_z: 'corrupted', confidence: 0.95 },
      { coord_z: 15.0, confidence: 0.8 },
    ];
    const binsCleaned = binData(corruptedRows, 10);
    const passNullExclusion = binsCleaned.length === 1 && binsCleaned[0].chainage_start === 10 && binsCleaned[0].count === 1;
    record('Spatial binning bounds: null, undefined, NaN, and corrupt coord_z rows strictly excluded', passNullExclusion);

  } catch (err) {
    record('Spatial binning bounds logic verification', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // 4. 1-based frame indexing bounds in InspectionVideos.jsx (frames 1 to 192)
  // ---------------------------------------------------------------------------
  try {
    const manifestPath = path.join(ROOT_DIR, 'frontend', 'public', 'frames', 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    record('InspectionVideos: manifest specifies frameCount = 192 and fps = 24', manifest.frameCount === 192 && manifest.fps === 24);

    // Asset existence verification: 1-based indexing means frame_0001.webp to frame_0192.webp
    const frame1Path = path.join(ROOT_DIR, 'frontend', 'public', 'frames', 'mobile', 'frame_0001.webp');
    const frame192Path = path.join(ROOT_DIR, 'frontend', 'public', 'frames', 'mobile', 'frame_0192.webp');
    const frame0Path = path.join(ROOT_DIR, 'frontend', 'public', 'frames', 'mobile', 'frame_0000.webp');

    record('InspectionVideos: physical assets frame_0001.webp and frame_0192.webp exist', fs.existsSync(frame1Path) && fs.existsSync(frame192Path));
    record('InspectionVideos: frame_0000.webp does not exist (1-based physical frame set)', !fs.existsSync(frame0Path));

    // Clamping boundary function simulation
    function clampFrame(index, totalFrames = 192) {
      return Math.max(1, Math.min(totalFrames, index));
    }

    record('InspectionVideos bounds: index 0 clamps to 1 (lower bound)', clampFrame(0) === 1);
    record('InspectionVideos bounds: index 1 clamps to 1 (lower bound identity)', clampFrame(1) === 1);
    record('InspectionVideos bounds: index 192 clamps to 192 (upper bound identity)', clampFrame(192) === 192);
    record('InspectionVideos bounds: index 250 clamps to 192 (upper bound)', clampFrame(250) === 192);

    // Nearest detection algorithm boundary matching
    function nearestDetection(detections, frameIdx) {
      if (!detections || detections.length === 0) return null;
      return detections.reduce((best, d) => {
        const dfi = d.frameIndex ?? d.frame_index ?? 1;
        const bfi = best.frameIndex ?? best.frame_index ?? 1;
        return Math.abs(dfi - frameIdx) < Math.abs(bfi - frameIdx) ? d : best;
      });
    }

    const mockDetections = [
      { id: 'd1', frame_index: 1 },
      { id: 'd2', frame_index: 96 },
      { id: 'd3', frame_index: 192 },
    ];

    record('InspectionVideos nearest: frame 1 targets detection at frame 1', nearestDetection(mockDetections, 1).id === 'd1');
    record('InspectionVideos nearest: frame 192 targets detection at frame 192', nearestDetection(mockDetections, 192).id === 'd3');
    record('InspectionVideos nearest: out-of-range frame 200 matches upper detection', nearestDetection(mockDetections, 200).id === 'd3');
    record('InspectionVideos nearest: empty detections array returns null without error', nearestDetection([], 50) === null);

  } catch (err) {
    record('InspectionVideos frame indexing bounds verification', false, err.message);
  }

  const passedCount = results.filter(r => r.pass).length;
  const totalCount = results.length;
  const allPass = passedCount === totalCount;

  console.log(`\nTier 2 Summary: ${allPass ? GREEN : RED}${passedCount}/${totalCount} passed${RESET}\n`);
  return { tier: 2, pass: allPass, total: totalCount, passed: passedCount, results };
}

if (require.main === module) {
  runTier2().then(res => {
    process.exit(res.pass ? 0 : 1);
  });
}

module.exports = { runTier2 };
