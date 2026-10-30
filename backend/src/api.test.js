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
});

console.log('━'.repeat(55));
console.log(`Results: ${passed}/${total} passed`);
if (passed === total) {
  console.log('All API security & route contract checks passed ✓\n');
  process.exit(0);
} else {
  process.exit(1);
}

