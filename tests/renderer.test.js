import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomFor, displayToSource } from '../js/renderer.js';

const near = (a, b) => Math.abs(a - b) < 0.0005;
const P = { restSeparation: 0.035, driftAmount: 0.4, blur: 0.006, depthStrength: 0.04, depthBlur: 0.006 };
const MAXED = { restSeparation: 0.12, driftAmount: 1, blur: 0.02, depthStrength: 0.12, depthBlur: 0.02 };

test('zoomFor hides the largest expected shift', () => {
  assert.ok(near(zoomFor(P, 'whole'), 1 / (1 - 2 * 0.0305)));   // 0.5 * 0.035 * 1.4 + 0.006
  assert.ok(near(zoomFor(P, 'depth'), 1 / (1 - 2 * 0.0565)));   // + 0.5 * 0.04 + 0.006
  assert.equal(zoomFor(MAXED, 'depth'), 1.5);                   // capped
});

test('displayToSource undoes zoom and mirror', () => {
  const p = (u, v, o) => { const r = displayToSource(u, v, o); return [+r.u.toFixed(4), +r.v.toFixed(4)]; };
  assert.deepEqual(p(0.5, 0.5, { zoom: 1.25, mirror: false }), [0.5, 0.5]);
  assert.deepEqual(p(1, 0, { zoom: 1.25, mirror: false }), [0.9, 0.1]);
  assert.deepEqual(p(1, 0, { zoom: 1.25, mirror: true }), [0.1, 0.1]);
});

import { blurScale } from '../js/renderer.js';

test('zoomFor grows to hide a separation pushed past the resting range', () => {
  assert.ok(near(zoomFor(P, 'whole', 0.01), zoomFor(P, 'whole')));
  assert.ok(near(zoomFor(P, 'whole', 0.12), 1 / (1 - 2 * (0.06 + 0.006))));
  assert.ok(near(zoomFor(P, 'whole', -0.12), zoomFor(P, 'whole', 0.12)));
});

test('blurScale keeps the blur taps no more than a texel apart', () => {
  assert.deepEqual([4, 8, 8.1, 16, 16.1, 32, 40].map(blurScale), [2, 2, 4, 4, 8, 8, 16]);
  for (let sigma = 0.5; sigma <= 64; sigma += 0.5) assert.ok(sigma / blurScale(sigma) <= 4, `sigma ${sigma}`);
});
