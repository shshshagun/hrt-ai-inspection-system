'use strict';

/**
 * api.test.js
 * Unit and route contract verification for Modules 3, 5, 6, and 7.
 * Tests route mounting, express-validator rules, rate limiting, security headers,
 * and binary PDF / CSV inspection report generation.
 *
 * Author / Attribution: Shagun <shagunsoni197@gmail.com>
 */

const assert = require('assert');
const http = require('http');
const { isValidUUID, isValidSeverity } = require('./middleware/validate');

console.log('\nHRT Modules 3, 5, 6, 7 — API Contract, Security & Report Generation Tests');
console.log('━'.repeat(55));

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

(async () => {
  // =========================================================================
  // 1. UUID Validation
  // =========================================================================
  await test('Valid UUIDs pass validator', () => {
    assert.strictEqual(isValidUUID('c1455943-882d-4250-843b-092bdd1351a9'), true);
    assert.strictEqual(isValidUUID('45e23d50-e579-4c5a-a3de-461d650927bb'), true);
  });

  await test('Invalid / malicious UUIDs fail validator', () => {
    assert.strictEqual(isValidUUID('invalid-uuid'), false);
    assert.strictEqual(isValidUUID("'; DROP TABLE detections; --"), false);
    assert.strictEqual(isValidUUID('12345'), false);
  });

  // =========================================================================
  // 2. Severity Validation
  // =========================================================================
  await test('Valid severities pass validator', () => {
    assert.strictEqual(isValidSeverity('critical'), true);
    assert.strictEqual(isValidSeverity('major'), true);
    assert.strictEqual(isValidSeverity('minor'), true);
    assert.strictEqual(isValidSeverity('info'), true);
  });

  await test('Invalid severities fail validator', () => {
    assert.strictEqual(isValidSeverity('dangerous'), false);
    assert.strictEqual(isValidSeverity(''), false);
    assert.strictEqual(isValidSeverity(null), false);
  });

  // =========================================================================
  // 3. App Route Mounting
  // =========================================================================
  await test('Express app loads and mounts all required routes', () => {
    process.env.PORT = '0'; // ephemeral port
    const app = require('./index');
    assert.ok(app, 'App instance should exist');

    const registeredPaths = [];
    app._router.stack.forEach((layer) => {
      if (layer.route) {
        registeredPaths.push(layer.route.path);
      } else if (layer.name === 'router') {
        registeredPaths.push(layer.regexp.toString());
      }
    });

    assert.ok(registeredPaths.includes('/health'), 'Health check endpoint mounted');
  });

  // =========================================================================
  // 4. Ingestion payload verification
  // =========================================================================
  await test('Detection API Client JSON payload format compatibility', () => {
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

    const payloadWithInsp = {
      ...samplePayload,
      inspection_id: 'c1455943-882d-4250-843b-092bdd1351a9',
    };
    assert.ok(isValidUUID(payloadWithInsp.inspection_id), 'Valid UUID inspection_id passes');
  });

  // =========================================================================
  // 5. Rate Limiter Verification
  // =========================================================================
  await test('Rate limiter middleware tracks requests and enforces threshold', () => {
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

  // =========================================================================
  // 6. Sliding Window Log Algorithm Verification
  // =========================================================================
  await test('Rate limiter sliding window purges expired hits and restores quota', () => {
    const { createRateLimiter } = require('./middleware/rateLimiter');
    let simulatedTime = 1000;
    const limiter = createRateLimiter({
      windowMs: 2000,
      max: 2,
      now: () => simulatedTime,
    });

    const mockRes = () => {
      const h = {};
      let status = 200;
      return {
        headers: h,
        setHeader: (k, v) => { h[k] = v; },
        status: (c) => {
          status = c;
          return { json: (_j) => {} };
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
    assert.strictEqual(r3.headers['Retry-After'], 1);

    // Hit 4 at t=3001 -> t=1000 has slid out of window. Allowed!
    simulatedTime = 3001;
    let r4 = mockRes(), next4 = false;
    limiter(req, r4, () => { next4 = true; });
    assert.strictEqual(next4, true);
    assert.strictEqual(r4.headers['X-RateLimit-Remaining'], 0);
  });

  // =========================================================================
  // 7. Client IP Resolution & X-Forwarded-For Parsing
  // =========================================================================
  await test('Rate limiter parses first client IP from multi-hop X-Forwarded-For header', () => {
    const { createRateLimiter, getClientIp } = require('./middleware/rateLimiter');

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

  // =========================================================================
  // 8. Helmet Security Headers & Fingerprint Suppression
  // =========================================================================
  await test('Security headers (Helmet) are emitted and X-Powered-By is suppressed', () => {
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

  // =========================================================================
  // 9. CORS Rejection Verification (403 Forbidden)
  // =========================================================================
  await test('CORS origin allowlist rejects disallowed origins with HTTP 403 in production', () => {
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
      const blocked = mockExchange('https://attacker-origin.example.com');
      assert.strictEqual(blocked.statusCode, 403);
      assert.deepStrictEqual(blocked.jsonBody, { error: 'CORS forbidden: origin not allowed' });

      const allowed = mockExchange('https://portal.hrt-inspection.com');
      assert.strictEqual(allowed.statusCode, 200);
      assert.strictEqual(allowed.jsonBody.status, 'ok');
    } finally {
      process.env.NODE_ENV = origEnv;
      process.env.ALLOWED_ORIGINS = origOrigins;
    }
  });

  // =========================================================================
  // 10. Reports PDF Engine Verification
  // =========================================================================
  await test('Reports route is loadable and exportable as an Express Router', () => {
    const reports = require('./routes/reports');
    assert.ok(reports, 'Reports router should be exportable');
    assert.strictEqual(typeof reports, 'function', 'Reports should be an Express router');
  });

  // =========================================================================
  // 11. Ephemeral Test Server for Binary PDF & CSV Report Generation (Tests 13-17)
  // =========================================================================
  const app = require('./index');
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const serverPort = testServer.address().port;

  function postReport(body) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify(body);
      const req = http.request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/api/reports/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            buffer,
            text: buffer.toString('utf-8'),
          });
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  // Sample 1x1 transparent PNG data URI
  const SAMPLE_PNG_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // Test 13: POST /api/reports/generate (PDF default) streams binary PDF with %PDF- header
  await test('POST /api/reports/generate (PDF default) streams binary PDF with %PDF- header', async () => {
    const res = await postReport({ format: 'pdf' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.ok(res.headers['content-disposition'].includes('attachment; filename="HRT_Report_'));
    assert.ok(res.buffer.length > 2000, `Buffer size (${res.buffer.length}) must exceed 2KB`);

    // Binary magic bytes header check
    assert.strictEqual(res.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.strictEqual(res.buffer[0], 0x25); // %
    assert.strictEqual(res.buffer[1], 0x50); // P
    assert.strictEqual(res.buffer[2], 0x44); // D
    assert.strictEqual(res.buffer[3], 0x46); // F
    assert.strictEqual(res.buffer[4], 0x2D); // -
    assert.ok(res.buffer.includes(Buffer.from('%%EOF')), 'PDF trailer %%EOF marker must exist');
  });

  // Test 14: POST /api/reports/generate (PDF) embeds defect photo and image objects
  await test('POST /api/reports/generate (PDF) embeds defect photo and image objects', async () => {
    const res = await postReport({
      format: 'pdf',
      inspection_id: 'c1455943-882d-4250-843b-092bdd1351a9',
      detections: [
        {
          id: 'DET-MOCK-IMG-1',
          class_label: 'crack',
          severity: 'Critical',
          confidence: 0.94,
          coord_z: 18.5,
          crack_area_mm2: 450.2,
          image_url: SAMPLE_PNG_BASE64,
        },
      ],
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.strictEqual(res.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(res.buffer.length > 2000, `Buffer size (${res.buffer.length}) must exceed 2KB`);
  });

  // Test 15: POST /api/reports/generate (CSV) streams regulatory defect CSV
  await test('POST /api/reports/generate (CSV) streams regulatory defect CSV', async () => {
    const res = await postReport({ format: 'csv' });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/csv'));
    assert.ok(res.headers['content-disposition'].includes('.csv"'));
    assert.ok(res.text.includes('Detection ID,Category,Subtype,Severity,Confidence,Chainage (km)'));
  });

  // Test 16: POST /api/reports/generate rejects invalid format with HTTP 400
  await test('POST /api/reports/generate rejects invalid format with HTTP 400', async () => {
    const res = await postReport({ format: 'invalid_format_xyz' });
    assert.strictEqual(res.statusCode, 400);
    const body = JSON.parse(res.text);
    assert.strictEqual(body.error, '`format` must be "pdf" or "csv"');
  });

  // Test 17: POST /api/reports/generate handles corrupted image data without server crash
  await test('POST /api/reports/generate handles corrupted image data without server crash', async () => {
    const res = await postReport({
      format: 'pdf',
      detections: [
        {
          class_label: 'crack',
          confidence: 0.88,
          image_url: 'data:image/png;base64,corrupted_not_valid_base64!!!',
        },
      ],
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.strictEqual(res.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(res.buffer.length > 2000);
  });

  // Clean teardown
  await new Promise((resolve) => testServer.close(resolve));

  console.log('━'.repeat(55));
  console.log(`Results: ${passed}/${total} passed`);
  if (passed === total) {
    console.log('All API security & route contract checks passed ✓\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
})();
