'use strict';
/**
 * The detection box follows the crack's mask, not the detector's loose box. These tests cover the two pieces that make that
 * work without a browser: clearing stray specks from a mask, and keeping every piece's outline when boxes are merged.
 * Run:  node tests/maskBox.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = (rel) => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'utils', rel)).href);

function bounds(grid, w, h) {
  let x1 = w; let y1 = h; let x2 = 0; let y2 = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (grid[y * w + x]) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + 1); y2 = Math.max(y2, y + 1); }
  return { x1, y1, x2, y2 };
}

test('a stray speck far from the crack is cleared, so it cannot stretch the box', async () => {
  const { keepMainComponents } = await load('crackVerdict.js');
  const w = 60; const h = 40;
  const grid = new Uint8Array(w * h);
  for (let x = 10; x < 40; x += 1) { grid[20 * w + x] = 1; grid[21 * w + x] = 1; } // the crack: 60 px
  grid[2 * w + 55] = 1; // a single speck in the far corner
  const left = keepMainComponents(grid, w, h);
  assert.equal(left, 60);
  assert.deepEqual(bounds(grid, w, h), { x1: 10, y1: 20, x2: 40, y2: 22 });
});

test('a second real piece of the crack (a fifth of the main one or more) is kept', async () => {
  const { keepMainComponents } = await load('crackVerdict.js');
  const w = 80; const h = 20;
  const grid = new Uint8Array(w * h);
  for (let x = 5; x < 45; x += 1) grid[5 * w + x] = 1; // 40 px
  for (let x = 55; x < 70; x += 1) grid[12 * w + x] = 1; // 15 px, more than a fifth of 40
  assert.equal(keepMainComponents(grid, w, h), 55);
  assert.deepEqual(bounds(grid, w, h), { x1: 5, y1: 5, x2: 70, y2: 13 });
});

test('an empty mask stays empty', async () => {
  const { keepMainComponents } = await load('crackVerdict.js');
  assert.equal(keepMainComponents(new Uint8Array(100), 10, 10), 0);
});

test('merging two boxes keeps both outlines', async () => {
  const { consolidateBoxes } = await load('defectTracker.js');
  const a = { x1: 100, y1: 100, x2: 160, y2: 130, confidence: 0.8, class: 'crack', maskUrl: 'a', maskCanvas: null, destBox: { destX: 100, destY: 100, destW: 60, destH: 30 } };
  const b = { x1: 150, y1: 120, x2: 220, y2: 160, confidence: 0.6, class: 'crack', maskUrl: 'b', maskCanvas: null, destBox: { destX: 150, destY: 120, destW: 70, destH: 40 } };
  const out = consolidateBoxes([a, b], 1280, 720, 0.9);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].parts.map((p) => p.maskUrl).sort(), ['a', 'b']);
  assert.equal(out[0].x1, 100);
  assert.equal(out[0].x2, 220);
});
