import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothDepth, depthSmoothing } from '../js/depth-math.js';

const maxStepAcross = (data, w, h) => {
  let m = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) m = Math.max(m, Math.abs(data[y * w + x + 1] - data[y * w + x]));
  return m;
};

test('a hard depth edge becomes a gentle ramp', () => {
  const w = 64, h = 8, data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 32; x < w; x++) data[y * w + x] = 255;
  const out = smoothDepth(data, w, h, 4);
  assert.equal(maxStepAcross(data, w, h), 255);
  assert.ok(maxStepAcross(out, w, h) <= 27);              // 255 / (4 * sqrt(2 pi)) = 25.4
  assert.deepEqual([out[0], out[w - 1]], [0, 255]);       // far from the edge nothing changes
  assert.ok(Math.abs(out[31] + out[32] - 255) <= 2);      // symmetric about the edge
});

test('fine ripples are removed and flat areas stay flat', () => {
  const w = 56, h = 4, data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) data[i] = 120 + Math.round(20 * Math.sin((2 * Math.PI * (i % w)) / 7));
  const out = smoothDepth(data, w, h, 4);
  for (let x = 12; x < w - 12; x++) assert.ok(Math.abs(out[x] - 120) <= 1, `x ${x}: ${out[x]}`);
  const flat = smoothDepth(new Uint8Array(w * h).fill(100), w, h, 4);
  assert.ok(flat.every((v) => v === 100));
});

test('edges running the other way are smoothed too, and a tiny sigma changes nothing', () => {
  const w = 8, h = 64, data = new Uint8Array(w * h);
  for (let y = 32; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = 255;
  const out = smoothDepth(data, w, h, 4);
  let m = 0;
  for (let y = 0; y < h - 1; y++) m = Math.max(m, Math.abs(out[(y + 1) * w] - out[y * w]));
  assert.ok(m <= 27);
  assert.equal(smoothDepth(data, w, h, 0), data);
  assert.equal(smoothDepth(data, w, h, 0.2), data);
});

test('depthSmoothing grows with the depth doubling strength, with a floor', () => {
  assert.equal(depthSmoothing(0), 0.01);
  assert.ok(Math.abs(depthSmoothing(0.04) - 0.016) < 1e-9);
  assert.ok(Math.abs(depthSmoothing(0.12) - 0.048) < 1e-9);
});
