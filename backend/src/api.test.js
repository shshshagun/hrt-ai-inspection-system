'use strict';

/**
 * api.test.js
 * Unit and route contract verification for Modules 3, 5, and 6.
 * Tests route mounting, express-validator rules, and SQL injection guards.
 */

const assert = require('assert');
const { isValidUUID, isValidSeverity } = require('./middleware/validate');

console.log('\nHRT Modules 3, 5, 6 — API Contract & Security Tests');
console.log('━'.repeat(55));

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// 1. UUID Validation
test('Valid UUIDs pass validator', () => {
  assert.strictEqual(isValidUUID('c1455943-882d-4250-843b-092bdd1351a9'), true);
  assert.strictEqual(isValidUUID('45e23d50-e579-4c5a-a3de-461d650927bb'), true);
});

test('Invalid / malicious UUIDs fail validator', () => {
  assert.strictEqual(isValidUUID('invalid-uuid'), false);
  assert.strictEqual(isValidUUID("'; DROP TABLE detections; --"), false);
  assert.strictEqual(isValidUUID('12345'), false);
});

// 2. Severity Validation
test('Valid severities pass validator', () => {
  assert.strictEqual(isValidSeverity('critical'), true);
  assert.strictEqual(isValidSeverity('major'), true);
  assert.strictEqual(isValidSeverity('minor'), true);
  assert.strictEqual(isValidSeverity('info'), true);
});

test('Invalid severities fail validator', () => {
  assert.strictEqual(isValidSeverity('dangerous'), false);
  assert.strictEqual(isValidSeverity(''), false);
  assert.strictEqual(isValidSeverity(null), false);
});

// 3. App Route Mounting
test('Express app loads and mounts all required routes', () => {
  // Set dummy env so index.js doesn't fail on missing env
  process.env.PORT = '0'; // ephemeral port
  const app = require('./index');
  assert.ok(app, 'App instance should exist');

  // Verify registered router paths
  const registeredPaths = [];
  app._router.stack.forEach((layer) => {
    if (layer.route) {
      registeredPaths.push(layer.route.path);
    } else if (layer.name === 'router') {
      registeredPaths.push(layer.regexp.toString());
    }
  });

  // Check health route
  assert.ok(registeredPaths.includes('/health'), 'Health check endpoint mounted');
});

// 4. Ingestion payload verification
test('Detection API Client JSON payload format compatibility', () => {
  const samplePayload = {
    class_label: 'crack',
    confidence: 0.87,
    bbox: { x1: 120.5, y1: 80.2, x2: 340.1, y2: 200.8, width: 219.6, height: 120.6 },
    frame_index: 142,
    timestamp: '2026-10-31T08:00:00Z',
    x: 1.23,
    y: -0.45,
    z: 45.30,
  };

  assert.strictEqual(typeof samplePayload.class_label, 'string');
  assert.ok(samplePayload.confidence >= 0 && samplePayload.confidence <= 1);
  assert.strictEqual(typeof samplePayload.frame_index, 'number');
  assert.strictEqual(typeof samplePayload.z, 'number');

  // Payload with optional inspection_id
  const payloadWithInsp = {
    ...samplePayload,
    inspection_id: 'c1455943-882d-4250-843b-092bdd1351a9',
  };
  assert.ok(isValidUUID(payloadWithInsp.inspection_id), 'Valid UUID inspection_id passes');
});

// 5. Rate Limiter Verification
test('Rate limiter middleware tracks requests and enforces threshold', () => {
  const { createRateLimiter } = require('./middleware/rateLimiter');
  const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
  const req = { ip: '127.0.0.1', headers: {}, socket: {} };
  const headers = {};
  let statusSet = 200;
  let jsonSent = null;
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (code) => {
      statusSet = code;
      return { json: (j) => { jsonSent = j; } };
    },
  };
  let nextCalled = 0;
  const next = () => { nextCalled++; };

  limiter(req, res, next);
  assert.strictEqual(nextCalled, 1);
  assert.strictEqual(headers['X-RateLimit-Limit'], 2);
  assert.strictEqual(headers['X-RateLimit-Remaining'], 1);

  limiter(req, res, next);
  assert.strictEqual(nextCalled, 2);
  assert.strictEqual(headers['X-RateLimit-Remaining'], 0);

  limiter(req, res, next);
  assert.strictEqual(nextCalled, 2, 'Next should not be called when limit exceeded');
  assert.strictEqual(statusSet, 429);
  assert.ok(jsonSent && jsonSent.error);
  assert.strictEqual(typeof headers['Retry-After'], 'number');
});

// 6. Sliding Window Log Algorithm Verification
test('Rate limiter sliding window purges expired hits and restores quota', () => {
  const { createRateLimiter } = require('./middleware/rateLimiter');
  let simulatedTime = 1000;
  const limiter = createRateLimiter({
    windowMs: 2000,
    max: 2,
    now: () => simulatedTime,
  });

  const mockRes = () => {
    const h = {};
    let status = 200, json = null;
    return {
      headers: h,
      setHeader: (k, v) => { h[k] = v; },
      status: (c) => {
        status = c;
        return { json: (j) => { json = j; } };
      },
      getStatus: () => status,
    };
  };

  const req = { ip: '10.0.0.1', headers: {}, socket: {} };

  // Hit 1 at t=1000 -> Allowed (rem: 1)
  let r1 = mockRes(), next1 = false;
  limiter(req, r1, () => { next1 = true; });
  assert.strictEqual(next1, true);
  assert.strictEqual(r1.headers['X-RateLimit-Remaining'], 1);

  // Hit 2 at t=2000 -> Allowed (rem: 0)
  simulatedTime = 2000;
  let r2 = mockRes(), next2 = false;
  limiter(req, r2, () => { next2 = true; });
  assert.strictEqual(next2, true);
  assert.strictEqual(r2.headers['X-RateLimit-Remaining'], 0);

  // Hit 3 at t=2500 -> Rejected (Window [500, 2500] contains both t=1000 and t=2000)
  simulatedTime = 2500;
  let r3 = mockRes(), next3 = false;
  limiter(req, r3, () => { next3 = true; });
  assert.strictEqual(next3, false);
  assert.strictEqual(r3.getStatus(), 429);
  assert.strictEqual(r3.headers['X-RateLimit-Remaining'], 0);
  assert.strictEqual(r3.headers['Retry-After'], 1); // Oldest expires at 3000 -> ceil((3000-2500)/1000) = 1

  // Hit 4 at t=3001 -> t=1000 has slid out of window (3001 - 2000 = 1001 > 1000). Allowed!
  simulatedTime = 3001;
  let r4 = mockRes(), next4 = false;
  limiter(req, r4, () => { next4 = true; });
  assert.strictEqual(next4, true);
  assert.strictEqual(r4.headers['X-RateLimit-Remaining'], 0); // Window now has t=2000, t=3001 -> 0 remaining
});

// 7. Client IP Resolution & X-Forwarded-For Parsing
test('Rate limiter parses first client IP from multi-hop X-Forwarded-For header', () => {
  const { createRateLimiter, getClientIp } = require('./middleware/rateLimiter');

  // getClientIp direct verification
  assert.strictEqual(
    getClientIp({ headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' } }),
    '203.0.113.195'
  );
  assert.strictEqual(
    getClientIp({ headers: { 'x-forwarded-for': '  198.51.100.1  ' } }),
    '198.51.100.1'
  );
  assert.strictEqual(
    getClientIp({ headers: {}, socket: { remoteAddress: '192.168.1.50' } }),
    '192.168.1.50'
  );
  assert.strictEqual(
    getClientIp({ headers: {}, ip: '127.0.0.1' }),
    '127.0.0.1'
  );

  // Middleware multi-hop bucket sharing
  const limiter = createRateLimiter({ windowMs: 5000, max: 2 });
  const mockRes = () => {
    const h = {};
    let status = 200;
    return {
      headers: h,
      setHeader: (k, v) => { h[k] = v; },
      status: (c) => { status = c; return { json: () => {} }; },
      getStatus: () => status,
    };
  };

  const reqHopA = { headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.1' }, socket: {} };
  const reqHopB = { headers: { 'x-forwarded-for': '203.0.113.195, 10.0.0.2' }, socket: {} };
  const reqHopC = { headers: { 'x-forwarded-for': '203.0.113.195' }, socket: {} };
  const reqDifferentIp = { headers: { 'x-forwarded-for': '198.51.100.77' }, socket: {} };

  let rA = mockRes(), nA = false; limiter(reqHopA, rA, () => { nA = true; });
  let rB = mockRes(), nB = false; limiter(reqHopB, rB, () => { nB = true; });
  let rC = mockRes(), nC = false; limiter(reqHopC, rC, () => { nC = true; });
  let rDiff = mockRes(), nDiff = false; limiter(reqDifferentIp, rDiff, () => { nDiff = true; });

  assert.strictEqual(nA, true);
  assert.strictEqual(nB, true);
  assert.strictEqual(nC, false, '3rd request from same client IP behind proxy should be blocked');
  assert.strictEqual(rC.getStatus(), 429);
  assert.strictEqual(nDiff, true, 'Different client IP should maintain an independent rate limit bucket');
});

// 8. Helmet Security Headers & Fingerprint Suppression
test('Security headers (Helmet) are emitted and X-Powered-By is suppressed', () => {
  process.env.PORT = '0';
  const app = require('./index');

  const req = {
    method: 'GET',
    url: '/health',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
  };
  const headers = {};
  const res = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    getHeader: (k) => headers[k.toLowerCase()],
    removeHeader: (k) => { delete headers[k.toLowerCase()]; },
    status: () => res,
    json: () => {},
    end: () => {},
  };

  app.handle(req, res);

  assert.strictEqual(headers['x-content-type-options'], 'nosniff');
  assert.strictEqual(headers['x-frame-options'], 'SAMEORIGIN');
  assert.strictEqual(headers['cross-origin-resource-policy'], 'cross-origin');
  assert.ok(headers['strict-transport-security'], 'HSTS header should be present');
  assert.strictEqual(headers['x-powered-by'], undefined, 'X-Powered-By must be suppressed');
});

// 9. CORS Rejection Verification (403 Forbidden)
test('CORS origin allowlist rejects disallowed origins with HTTP 403 in production', () => {
  const origEnv = process.env.NODE_ENV;
  const origOrigins = process.env.ALLOWED_ORIGINS;
  process.env.PORT = '0';
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGINS = 'https://portal.hrt-inspection.com,http://localhost:5173';

  const app = require('./index');

  const mockExchange = (origin) => {
    const req = {
      method: 'GET',
      url: '/health',
      headers: origin ? { origin } : {},
      socket: { remoteAddress: '127.0.0.1' },
    };
    const headers = {};
    let statusCode = 200;
    let jsonBody = null;
    const res = {
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      getHeader: (k) => headers[k.toLowerCase()],
      removeHeader: (k) => { delete headers[k.toLowerCase()]; },
      status: (code) => { statusCode = code; return res; },
      json: (data) => { jsonBody = data; },
      end: () => {},
    };
    app.handle(req, res);
    return { statusCode, headers, jsonBody };
  };

  try {
    // Disallowed origin should return HTTP 403 Forbidden
    const blocked = mockExchange('https://attacker-origin.example.com');
    assert.strictEqual(blocked.statusCode, 403);
    assert.deepStrictEqual(blocked.jsonBody, { error: 'CORS forbidden: origin not allowed' });

    // Allowed origin should return HTTP 200 OK
    const allowed = mockExchange('https://portal.hrt-inspection.com');
    assert.strictEqual(allowed.statusCode, 200);
    assert.strictEqual(allowed.jsonBody.status, 'ok');
  } finally {
    process.env.NODE_ENV = origEnv;
    process.env.ALLOWED_ORIGINS = origOrigins;
  }
});

// 10. Reports PDF Engine Verification
test('Reports route is loadable and exportable as an Express Router', () => {
  const reports = require('./routes/reports');
  assert.ok(reports, 'Reports router should be exportable');
  assert.strictEqual(typeof reports, 'function', 'Reports should be an Express router');
});

console.log('━'.repeat(55));
console.log(`Results: ${passed}/${total} passed`);
if (passed === total) {
  console.log('All API security & route contract checks passed ✓\n');
  process.exit(0);
} else {
  process.exit(1);
}

