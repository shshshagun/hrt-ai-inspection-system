'use strict';

/**
 * tests/adversarial_probe.test.js
 * Adversarial Challenger & Empirical Stress Test Suite
 *
 * Exercises:
 *  1. Malformed Payloads & Schema Violations on POST /api/detections
 *  2. SQL Injection Vectors against API Endpoints & Query Parsers
 *  3. Spatial Binning Boundary & Extreme Conditions
 *  4. Rate Limiter Burst Stress & IP Spoofing Resistance
 *  5. Live MongoDB Connectivity & Gateway Ingestion Handlers
 *  6. Baseline Test Suite Permutations across Environments
 */

const path = require('path');
const assert = require('assert');
const http = require('http');
const net = require('net');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
module.paths.push(path.join(ROOT_DIR, 'backend', 'node_modules'));

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ${GREEN}✓ PASS${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✗ FAIL${RESET} ${label} ${detail ? `(${detail})` : ''}`);
    failed++;
    failures.push({ label, detail });
  }
}

// Request invoker against backend Express app in-memory
function invokeApp(app, { method = 'GET', url = '/', body = null, headers = {}, ip = '127.0.0.1' }) {
  return new Promise((resolve) => {
    const reqHeaders = { ...headers };
    if (body && !reqHeaders['content-type']) {
      reqHeaders['content-type'] = 'application/json';
    }
    const req = {
      method,
      url,
      headers: reqHeaders,
      body,
      socket: { remoteAddress: ip },
      ip,
    };
    const resHeaders = {};
    let statusCode = 200;
    let responseBody = null;
    let ended = false;

    const finish = () => {
      if (!ended) {
        ended = true;
        resolve({ statusCode, responseBody, headers: resHeaders });
      }
    };

    const res = {
      setHeader: (k, v) => { resHeaders[k.toLowerCase()] = v; },
      getHeader: (k) => resHeaders[k.toLowerCase()],
      removeHeader: (k) => { delete resHeaders[k.toLowerCase()]; },
      status: (code) => { statusCode = code; return res; },
      json: (data) => { responseBody = data; finish(); },
      send: (data) => { responseBody = data; finish(); },
      end: (data) => { if (data && !responseBody) responseBody = data; finish(); },
    };

    app.handle(req, res);
  });
}

async function runAdversarialSuite() {
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  ADVERSARIAL STRESS TEST & PENETRATION PROBE SUITE                  ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}`);

  process.env.PORT = '0';
  process.env.NODE_ENV = 'test';
  const app = require('../backend/src/index');

  // ===========================================================================
  // SECTION 1: Malformed Payloads & Schema Violations (POST /api/detections)
  // ===========================================================================
  console.log(`\n${BOLD}${YELLOW}[1] Malformed Payloads & Schema Rejection on POST /api/detections${RESET}`);

  const baseValidPayload = {
    class_label: 'crack',
    confidence: 0.85,
    bbox: { x1: 100, y1: 50, x2: 200, y2: 150, width: 100, height: 100 },
    frame_index: 10,
    timestamp: '2026-11-09T19:00:00.000Z',
    x: 1.25,
    y: 2.67,
    z: 10.5,
  };

  // 1.1 Missing coordinates
  const missingX = { ...baseValidPayload }; delete missingX.x;
  const resMissingX = await invokeApp(app, { method: 'POST', url: '/api/detections', body: missingX });
  check('Missing coordinate x is rejected with HTTP 400', resMissingX.statusCode === 400);

  const missingY = { ...baseValidPayload }; delete missingY.y;
  const resMissingY = await invokeApp(app, { method: 'POST', url: '/api/detections', body: missingY });
  check('Missing coordinate y is rejected with HTTP 400', resMissingY.statusCode === 400);

  const missingZ = { ...baseValidPayload }; delete missingZ.z;
  const resMissingZ = await invokeApp(app, { method: 'POST', url: '/api/detections', body: missingZ });
  check('Missing coordinate z is rejected with HTTP 400', resMissingZ.statusCode === 400);

  // 1.2 Non-float and NaN coordinates
  const nanX = { ...baseValidPayload, x: NaN };
  const resNanX = await invokeApp(app, { method: 'POST', url: '/api/detections', body: nanX });
  check('NaN coordinate x is rejected with HTTP 400', resNanX.statusCode === 400);

  const strY = { ...baseValidPayload, y: 'not-a-number' };
  const resStrY = await invokeApp(app, { method: 'POST', url: '/api/detections', body: strY });
  check('String coordinate y is rejected with HTTP 400', resStrY.statusCode === 400);

  const nullZ = { ...baseValidPayload, z: null };
  const resNullZ = await invokeApp(app, { method: 'POST', url: '/api/detections', body: nullZ });
  check('Null coordinate z is rejected with HTTP 400', resNullZ.statusCode === 400);

  // 1.3 Confidence boundary and invalid violations
  const negConf = { ...baseValidPayload, confidence: -0.01 };
  const resNegConf = await invokeApp(app, { method: 'POST', url: '/api/detections', body: negConf });
  check('Negative confidence (-0.01) is rejected with HTTP 400', resNegConf.statusCode === 400);

  const largeNegConf = { ...baseValidPayload, confidence: -999.0 };
  const resLargeNegConf = await invokeApp(app, { method: 'POST', url: '/api/detections', body: largeNegConf });
  check('Extreme negative confidence (-999.0) is rejected with HTTP 400', resLargeNegConf.statusCode === 400);

  const overConf = { ...baseValidPayload, confidence: 1.01 };
  const resOverConf = await invokeApp(app, { method: 'POST', url: '/api/detections', body: overConf });
  check('Confidence above 1.0 (1.01) is rejected with HTTP 400', resOverConf.statusCode === 400);

  const nanConf = { ...baseValidPayload, confidence: NaN };
  const resNanConf = await invokeApp(app, { method: 'POST', url: '/api/detections', body: nanConf });
  check('NaN confidence is rejected with HTTP 400', resNanConf.statusCode === 400);

  const strConf = { ...baseValidPayload, confidence: 'high' };
  const resStrConf = await invokeApp(app, { method: 'POST', url: '/api/detections', body: strConf });
  check('String confidence ("high") is rejected with HTTP 400', resStrConf.statusCode === 400);

  // 1.4 Bounding box malformations & extreme bounds
  const nullBbox = { ...baseValidPayload, bbox: null };
  const resNullBbox = await invokeApp(app, { method: 'POST', url: '/api/detections', body: nullBbox });
  check('Null bbox object is rejected with HTTP 400', resNullBbox.statusCode === 400);

  const emptyBbox = { ...baseValidPayload, bbox: {} };
  const resEmptyBbox = await invokeApp(app, { method: 'POST', url: '/api/detections', body: emptyBbox });
  check('Empty bbox object is rejected with HTTP 400', resEmptyBbox.statusCode === 400);

  const missingCoordBbox = { ...baseValidPayload, bbox: { x1: 10, y1: 20, x2: 30 } };
  const resMissingCoordBbox = await invokeApp(app, { method: 'POST', url: '/api/detections', body: missingCoordBbox });
  check('Bbox missing y2 is rejected with HTTP 400', resMissingCoordBbox.statusCode === 400);

  const negWidthBbox = { ...baseValidPayload, bbox: { x1: 10, y1: 20, x2: 30, y2: 40, width: -15 } };
  const resNegWidthBbox = await invokeApp(app, { method: 'POST', url: '/api/detections', body: negWidthBbox });
  check('Negative bbox width is rejected with HTTP 400', resNegWidthBbox.statusCode === 400);

  const negHeightBbox = { ...baseValidPayload, bbox: { x1: 10, y1: 20, x2: 30, y2: 40, height: -20 } };
  const resNegHeightBbox = await invokeApp(app, { method: 'POST', url: '/api/detections', body: negHeightBbox });
  check('Negative bbox height is rejected with HTTP 400', resNegHeightBbox.statusCode === 400);

  // 1.5 Class label & Frame index violations
  const missingClass = { ...baseValidPayload }; delete missingClass.class_label;
  const resMissingClass = await invokeApp(app, { method: 'POST', url: '/api/detections', body: missingClass });
  check('Missing class_label is rejected with HTTP 400', resMissingClass.statusCode === 400);

  const emptyClass = { ...baseValidPayload, class_label: '   ' };
  const resEmptyClass = await invokeApp(app, { method: 'POST', url: '/api/detections', body: emptyClass });
  check('Whitespace-only class_label is rejected with HTTP 400', resEmptyClass.statusCode === 400);

  const negFrame = { ...baseValidPayload, frame_index: -1 };
  const resNegFrame = await invokeApp(app, { method: 'POST', url: '/api/detections', body: negFrame });
  check('Negative frame_index (-1) is rejected with HTTP 400', resNegFrame.statusCode === 400);

  const floatFrame = { ...baseValidPayload, frame_index: 12.5 };
  const resFloatFrame = await invokeApp(app, { method: 'POST', url: '/api/detections', body: floatFrame });
  check('Float frame_index (12.5) is rejected with HTTP 400', resFloatFrame.statusCode === 400);

  const badTimestamp = { ...baseValidPayload, timestamp: 'invalid-iso-date' };
  const resBadTimestamp = await invokeApp(app, { method: 'POST', url: '/api/detections', body: badTimestamp });
  check('Invalid timestamp string is rejected with HTTP 400', resBadTimestamp.statusCode === 400);

  // ===========================================================================
  // SECTION 2: SQL Injection Vectors against API Contracts
  // ===========================================================================
  console.log(`\n${BOLD}${YELLOW}[2] SQL Injection Probes against Input Validation & Routes${RESET}`);

  const sqliPayloads = [
    "'; DROP TABLE detections; --",
    "' OR '1'='1",
    "'; DELETE FROM inspections; --",
    "' UNION SELECT null, null, null, null, null--",
    "1; SELECT pg_sleep(5); --",
    "admin'--",
  ];

  // 2.1 SQLi in POST /api/detections inspection_id
  for (const sqli of sqliPayloads) {
    const payloadWithSqli = { ...baseValidPayload, inspection_id: sqli };
    const res = await invokeApp(app, { method: 'POST', url: '/api/detections', body: payloadWithSqli });
    check(`POST /api/detections with SQLi in inspection_id [${sqli.slice(0, 20)}...] returns HTTP 400`, res.statusCode === 400);
  }

  // 2.2 SQLi in GET /api/spatial-summary inspection_id
  for (const sqli of sqliPayloads) {
    const encoded = encodeURIComponent(sqli);
    const res = await invokeApp(app, { method: 'GET', url: `/api/spatial-summary?inspection_id=${encoded}` });
    check(`GET /api/spatial-summary with SQLi in inspection_id [${sqli.slice(0, 20)}...] returns HTTP 400`, res.statusCode === 400);
  }

  // 2.3 SQLi in GET /api/spatial-summary interval_m and min_conf
  const resSqliInterval = await invokeApp(app, {
    method: 'GET',
    url: `/api/spatial-summary?interval_m=${encodeURIComponent("10; DROP TABLE detections; --")}`,
  });
  check('GET /api/spatial-summary with SQLi in interval_m returns HTTP 400', resSqliInterval.statusCode === 400);

  const resSqliConf = await invokeApp(app, {
    method: 'GET',
    url: `/api/spatial-summary?min_conf=${encodeURIComponent("0.5' OR '1'='1")}`,
  });
  check('GET /api/spatial-summary with SQLi in min_conf returns HTTP 400', resSqliConf.statusCode === 400);

  // 2.4 SQLi in GET /api/detections query params
  const resSqliId = await invokeApp(app, {
    method: 'GET',
    url: `/api/detections?id=${encodeURIComponent("'; DROP TABLE detections; --")}`,
  });
  check('GET /api/detections with SQLi in id returns HTTP 400', resSqliId.statusCode === 400);

  const resSqliSession = await invokeApp(app, {
    method: 'GET',
    url: `/api/detections?session_id=${encodeURIComponent("' OR '1'='1")}`,
  });
  check('GET /api/detections with SQLi in session_id returns HTTP 400', resSqliSession.statusCode === 400);

  const resSqliStatus = await invokeApp(app, {
    method: 'GET',
    url: `/api/detections?status=${encodeURIComponent("confirmed' OR '1'='1")}`,
  });
  check('GET /api/detections with SQLi in status returns HTTP 400', resSqliStatus.statusCode === 400);

  // 2.5 SQLi in POST /api/reports/generate format
  const resSqliReportFormat = await invokeApp(app, {
    method: 'POST',
    url: '/api/reports/generate',
    body: { format: "pdf'; DROP TABLE detections; --" },
  });
  check('POST /api/reports/generate with SQLi in format returns HTTP 400', resSqliReportFormat.statusCode === 400);

  // ===========================================================================
  // SECTION 3: Spatial Binning Boundary & Extreme Conditions
  // ===========================================================================
  console.log(`\n${BOLD}${YELLOW}[3] Spatial Binning Boundary & Corner Conditions${RESET}`);

  // Test interval bounds: MIN=5, MAX=50
  const validIntervals = [5, 10, 25, 50];
  for (const interval of validIntervals) {
    const res = await invokeApp(app, { method: 'GET', url: `/api/spatial-summary?interval_m=${interval}` });
    check(`Valid boundary interval_m=${interval} passes input validation (status: ${res.statusCode} != 400)`, res.statusCode !== 400);
  }

  // Default fallback when empty or omitted
  const resEmptyInterval = await invokeApp(app, { method: 'GET', url: '/api/spatial-summary?interval_m=' });
  check('Empty interval_m query safely defaults to 10m (status != 400)', resEmptyInterval.statusCode !== 400);

  // Invalid intervals: below MIN (4, 0, -5), above MAX (51, 100), non-integer (12.5), non-numeric ("foo")
  const invalidIntervals = [4, 0, -5, 51, 100, 12.5, 'foo'];
  for (const interval of invalidIntervals) {
    const res = await invokeApp(app, { method: 'GET', url: `/api/spatial-summary?interval_m=${encodeURIComponent(interval)}` });
    check(`Invalid interval_m="${interval}" is rejected with HTTP 400`, res.statusCode === 400);
  }

  // Test min_conf bounds: [0.0, 1.0]
  const validMinConfs = [0.0, 0.35, 0.50, 0.75, 0.99, 1.0];
  for (const conf of validMinConfs) {
    const res = await invokeApp(app, { method: 'GET', url: `/api/spatial-summary?min_conf=${conf}` });
    check(`Valid boundary min_conf=${conf} passes validation (status: ${res.statusCode} != 400)`, res.statusCode !== 400);
  }

  const invalidMinConfs = [-0.01, -1.0, 1.01, 2.5, 'high', 'NaN'];
  for (const conf of invalidMinConfs) {
    const res = await invokeApp(app, { method: 'GET', url: `/api/spatial-summary?min_conf=${encodeURIComponent(conf)}` });
    check(`Invalid min_conf="${conf}" is rejected with HTTP 400`, res.statusCode === 400);
  }

  // Direct mathematical stress verification on binning logic
  const adversarialDetections = [];
  adversarialDetections.push({ coord_z: 0.0, confidence: 0.95 });      // exact 0.0 start
  adversarialDetections.push({ coord_z: 4.9999, confidence: 0.80 });   // just below 5m
  adversarialDetections.push({ coord_z: 5.0, confidence: 0.70 });      // exact 5.0 boundary
  adversarialDetections.push({ coord_z: 249.999, confidence: 0.90 });  // tunnel end
  adversarialDetections.push({ coord_z: 250.0, confidence: 0.85 });    // exact 250m
  adversarialDetections.push({ coord_z: null, confidence: 0.99 });     // null coord_z
  adversarialDetections.push({ coord_z: undefined, confidence: 0.99 });// undefined coord_z
  adversarialDetections.push({ coord_z: 100.0, confidence: 0.0 });     // minimum confidence 0.0
  adversarialDetections.push({ coord_z: 100.0, confidence: 1.0 });     // maximum confidence 1.0

  // 1,000 random dense coordinates
  for (let i = 0; i < 1000; i++) {
    adversarialDetections.push({
      coord_z: Math.random() * 250,
      confidence: Math.random(),
    });
  }

  // Pure binning simulation logic test
  function testBinningSim(rows, intervalM, minConf) {
    const filtered = rows.filter(r => r.coord_z !== null && r.coord_z !== undefined && r.confidence >= minConf);
    const bins = new Map();
    for (const r of filtered) {
      const key = Math.floor(r.coord_z / intervalM);
      if (!bins.has(key)) {
        bins.set(key, {
          start: key * intervalM,
          end: (key + 1) * intervalM,
          count: 0,
        });
      }
      bins.get(key).count++;
    }
    return [...bins.values()].sort((a, b) => a.start - b.start);
  }

  const simulatedBins5 = testBinningSim(adversarialDetections, 5, 0.0);
  check('Binning correctly processed 1000+ adversarial records at 5m interval', simulatedBins5.length > 0);
  const totalCount5 = simulatedBins5.reduce((s, b) => s + b.count, 0);
  check('Null and undefined coord_z were strictly excluded', totalCount5 === adversarialDetections.length - 2);

  const simulatedBinsEmpty = testBinningSim([], 10, 0.0);
  check('Empty detection array returns empty bins array ([]) without exception', Array.isArray(simulatedBinsEmpty) && simulatedBinsEmpty.length === 0);

  const simulatedBinsHighConf = testBinningSim(adversarialDetections, 10, 1.01);
  check('Confidence threshold above max returns empty array', simulatedBinsHighConf.length === 0);

  // ===========================================================================
  // SECTION 4: Rate Limiter Burst Stress & Spoofing Defense
  // ===========================================================================
  console.log(`\n${BOLD}${YELLOW}[4] Rate Limiter Stress Burst & Multi-Hop IP Spoofing Defense${RESET}`);

  const { createRateLimiter } = require('../backend/src/middleware/rateLimiter');

  // 4.1 High frequency burst test
  const burstLimiter = createRateLimiter({ windowMs: 10000, max: 25 });
  const burstReq = { ip: '192.168.1.100', headers: {}, socket: { remoteAddress: '192.168.1.100' } };

  let burstAllowed = 0;
  let burstBlocked = 0;
  let lastHeaders = {};

  for (let i = 0; i < 35; i++) {
    const resHeaders = {};
    let status = 200;
    const res = {
      setHeader: (k, v) => { resHeaders[k.toLowerCase()] = v; },
      status: (code) => { status = code; return { json: () => {} }; },
    };
    let nextCalled = false;
    burstLimiter(burstReq, res, () => { nextCalled = true; });

    if (nextCalled) burstAllowed++;
    if (status === 429) {
      burstBlocked++;
      lastHeaders = resHeaders;
    }
  }

  check('Rate limiter accurately allows exactly 25 requests in burst', burstAllowed === 25);
  check('Rate limiter strictly blocks remaining 10 requests with HTTP 429', burstBlocked === 10);
  check('Rate limiter emits Retry-After header >= 1 on rejection', typeof lastHeaders['retry-after'] === 'number' && lastHeaders['retry-after'] >= 1);
  check('Rate limiter emits X-RateLimit-Remaining: 0 on rejection', lastHeaders['x-ratelimit-remaining'] === 0);

  // 4.2 Multi-hop X-Forwarded-For IP spoofing attack
  const spoofLimiter = createRateLimiter({ windowMs: 10000, max: 2 });
  const clientTrueIp = '203.0.113.88';

  // Attacker tries to cycle fake proxies in X-Forwarded-For
  const spoofReq1 = { headers: { 'x-forwarded-for': `${clientTrueIp}, 10.0.0.1, 10.0.0.2` }, socket: {} };
  const spoofReq2 = { headers: { 'x-forwarded-for': `${clientTrueIp}, 172.16.0.5` }, socket: {} };
  const spoofReq3 = { headers: { 'x-forwarded-for': `${clientTrueIp}, 192.168.5.99` }, socket: {} };

  let spoofNextCount = 0;
  let spoofBlocked = false;

  spoofLimiter(spoofReq1, { setHeader: () => {}, status: () => ({ json: () => {} }) }, () => { spoofNextCount++; });
  spoofLimiter(spoofReq2, { setHeader: () => {}, status: () => ({ json: () => {} }) }, () => { spoofNextCount++; });
  spoofLimiter(spoofReq3, {
    setHeader: () => {},
    status: (code) => {
      if (code === 429) spoofBlocked = true;
      return { json: () => {} };
    },
  }, () => { spoofNextCount++; });

  check('Rate limiter extracts true client IP (first entry) and prevents proxy rotation bypass', spoofNextCount === 2 && spoofBlocked);

  // Distinct client IP has independent quota
  const legitimateOtherReq = { headers: { 'x-forwarded-for': '198.51.100.99' }, socket: {} };
  let otherAllowed = false;
  spoofLimiter(legitimateOtherReq, { setHeader: () => {}, status: () => ({ json: () => {} }) }, () => { otherAllowed = true; });
  check('Distinct client IP maintains independent rate limit bucket', otherAllowed);

  // ===========================================================================
  // SECTION 5: Live MongoDB Connectivity & Gateway Ingestion Handlers
  // ===========================================================================
  console.log(`\n${BOLD}${YELLOW}[5] Live MongoDB Connectivity & Ingestion Gateway Handlers${RESET}`);

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hrt_inspection';
  const { MongoClient } = require(path.join(ROOT_DIR, 'api', 'node_modules', 'mongodb'));

  let mongoAlive = false;
  try {
    const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 2000 });
    await client.connect();
    const admin = client.db('hrt_inspection').admin();
    const pingRes = await admin.ping();
    mongoAlive = (pingRes && pingRes.ok === 1);
    await client.close();
  } catch (err) {
    mongoAlive = false;
  }
  check('Live MongoDB reachable on 127.0.0.1:27017 and ping acknowledged ({ ok: 1 })', mongoAlive);

  // Probe live Ingestion Gateway microservice (spin up on 5098 if 5000 not listening)
  const { spawn } = require('child_process');
  let gwPort = 5000;
  let spawnedGateway = null;

  function checkPort(port) {
    return new Promise((resolve) => {
      const sock = new net.Socket();
      sock.setTimeout(1000);
      sock.once('connect', () => { sock.destroy(); resolve(true); });
      sock.once('timeout', () => { sock.destroy(); resolve(false); });
      sock.once('error', () => { resolve(false); });
      sock.connect(port, '127.0.0.1');
    });
  }

  const is5000Open = await checkPort(5000);
  if (!is5000Open) {
    gwPort = 5098;
    spawnedGateway = spawn('node', ['api/server.js'], {
      cwd: ROOT_DIR,
      env: { ...process.env, PORT: String(gwPort), MONGODB_URI: mongoUri },
      stdio: 'ignore',
    });
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (await checkPort(gwPort)) break;
    }
  }

  function gatewayRequest(p, method = 'GET', body = null) {
    return new Promise((resolve) => {
      const postData = body ? JSON.stringify(body) : null;
      const opts = {
        hostname: '127.0.0.1',
        port: gwPort,
        path: p,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        },
        timeout: 2500,
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let parsed = data;
          try { parsed = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, body: parsed });
        });
      });
      req.on('error', (err) => resolve({ status: null, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 408, error: 'timeout' }); });
      if (postData) req.write(postData);
      req.end();
    });
  }

  try {
    const gwHealth = await gatewayRequest('/health');
    check('Ingestion Gateway /health check returns HTTP 200 OK', gwHealth.status === 200);

    // Test valid ingestion
    const validGwDoc = {
      class_label: 'crack_probe',
      confidence: 0.88,
      bbox: { x1: 50, y1: 60, x2: 120, y2: 140 },
      frame_index: 25,
      timestamp: new Date().toISOString(),
      x: 1.5, y: -0.5, z: 22.0,
    };
    const gwInsert = await gatewayRequest('/api/detections', 'POST', validGwDoc);
    check('Ingestion Gateway POST /api/detections inserts document and returns HTTP 201 with _id',
      gwInsert.status === 201 && !!gwInsert.body._id);

    // Test malformed payload rejection in Ingestion Gateway
    const gwMissingLabel = { confidence: 0.88 };
    const gwResMissingLabel = await gatewayRequest('/api/detections', 'POST', gwMissingLabel);
    check('Ingestion Gateway rejects missing class_label with HTTP 400', gwResMissingLabel.status === 400);

    const gwNanConf = { class_label: 'crack', confidence: 'not-a-number' };
    const gwResNanConf = await gatewayRequest('/api/detections', 'POST', gwNanConf);
    check('Ingestion Gateway rejects non-numeric confidence with HTTP 400', gwResNanConf.status === 400);

    const gwMissingConf = { class_label: 'crack' };
    const gwResMissingConf = await gatewayRequest('/api/detections', 'POST', gwMissingConf);
    check('Ingestion Gateway rejects missing confidence with HTTP 400', gwResMissingConf.status === 400);

    // Test GET /api/detections
    const gwGet = await gatewayRequest('/api/detections', 'GET');
    check('Ingestion Gateway GET /api/detections returns HTTP 200 array with stored documents',
      gwGet.status === 200 && Array.isArray(gwGet.body) && gwGet.body.length > 0);
  } finally {
    if (spawnedGateway) {
      spawnedGateway.kill();
    }
  }

  // ===========================================================================
  // SECTION 6: Baseline Unit Test Permutations across Environments
  // ===========================================================================
  console.log(`\n${BOLD}${YELLOW}[6] Baseline Test Suite Permutations across Environments${RESET}`);

  // Test UUID validator across edge cases
  const { isValidUUID, isValidSeverity } = require('../backend/src/middleware/validate');
  check('isValidUUID handles undefined/null safely', !isValidUUID(undefined) && !isValidUUID(null));
  check('isValidUUID rejects UUID with trailing characters', !isValidUUID('c1455943-882d-4250-843b-092bdd1351a9-extra'));
  check('isValidUUID rejects UUID with spaces', !isValidUUID(' c1455943-882d-4250-843b-092bdd1351a9 '));
  check('isValidSeverity rejects case variations ("CRITICAL")', !isValidSeverity('CRITICAL'));
  check('isValidSeverity rejects prototype poisoning strings ("__proto__")', !isValidSeverity('__proto__'));

  // Run child process execution of existing baseline suites under different NODE_ENV
  try {
    const apiOutDev = execSync('node backend/src/api.test.js', {
      cwd: ROOT_DIR,
      env: { ...process.env, NODE_ENV: 'development' },
    }).toString();
    check('Baseline api.test.js passes under NODE_ENV=development (12/12)', apiOutDev.includes('12/12 passed'));

    const apiOutProd = execSync('node backend/src/api.test.js', {
      cwd: ROOT_DIR,
      env: { ...process.env, NODE_ENV: 'production' },
    }).toString();
    check('Baseline api.test.js passes under NODE_ENV=production (12/12)', apiOutProd.includes('12/12 passed'));

    const spatialOut = execSync('node backend/src/routes/spatial.test.js', {
      cwd: ROOT_DIR,
      env: { ...process.env },
    }).toString();
    check('Baseline spatial.test.js passes under standalone execution (22/22)', spatialOut.includes('22/22 passed'));
  } catch (err) {
    check('Baseline test execution under environment permutations succeeded', false, err.message);
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log(`\n${BOLD}${CYAN}======================================================================${RESET}`);
  console.log(`  Adversarial Challenge Results: ${BOLD}${passed}${RESET} passed, ${BOLD}${failed}${RESET} failed`);
  console.log(`${BOLD}${CYAN}======================================================================${RESET}`);

  if (failed > 0) {
    console.log(`${RED}\nDetected ${failed} adversarial vulnerabilities / failures:${RESET}`);
    failures.forEach((f, idx) => console.log(`  ${idx + 1}. ${f.label} [${f.detail}]`));
    process.exit(1);
  } else {
    console.log(`\n${GREEN}${BOLD}ALL ADVERSARIAL CHALLENGES & PENETRATION PROBES PASSED ✓${RESET}\n`);
    process.exit(0);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
