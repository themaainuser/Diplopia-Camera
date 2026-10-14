import test from 'node:test';
import assert from 'node:assert/strict';
import { make, run, toDrifting, onsetTime, rng, STEP } from './helpers.js';

const still = { driftAmount: 0 };
const near = (a, b, tol = 0.001) => Math.abs(a - b) < tol;
const REFOCUS = 0.35 + 2 * STEP;

test('push moves the images apart and together', () => {
  const m = make(still); toDrifting(m);
  m.push(0.02); assert.ok(near(run(m, 1).separation.x, 0.055));
  m.push(-0.03); assert.ok(near(run(m, 1).separation.x, 0.025));
});

test('pushing under the fusion threshold fuses; blur stays', () => {
  const m = make(still); toDrifting(m);
  m.push(-1);
  const s = run(m, 1);
  assert.equal(s.phase, 'fused');
  assert.ok(s.separation.x < 0.0005 && Math.abs(s.separation.y) < 0.0005);
  assert.ok(near(s.blur, 0.006, 1e-9));
});

test('fused holds until the break-away threshold (1.5 x 0.006 = 0.009)', () => {
  const m = make(still); toDrifting(m);
  m.push(-1); run(m, 1);
  m.push(0.007); assert.equal(run(m, 0.5).phase, 'fused');
  m.push(0.003);
  const s = run(m, 0.5);
  assert.equal(s.phase, 'drifting');
  assert.ok(near(s.separation.x, 0.010));
});

test('a fusion threshold of zero switches fusion off', () => {
  const m = make({ ...still, fusionThreshold: 0 }); toDrifting(m);
  m.push(-1);
  const s = run(m, 1);
  assert.equal(s.phase, 'drifting');
  assert.ok(s.separation.x < 0.001);
});

test('push is ignored while focused', () => {
  const m = make(still);
  m.push(0.05);
  assert.ok(near(toDrifting(m).separation.x, 0.035));
});

test('refocus blinks, overshoots below zero, and returns to focused', () => {
  const m = make(still); toDrifting(m);
  m.refocus();
  let minX = 1, maxBlink = 0;
  const s = run(m, REFOCUS, (f) => { minX = Math.min(minX, f.separation.x); maxBlink = Math.max(maxBlink, f.blink); });
  assert.ok(minX < 0 && minX > -0.01);
  assert.ok(maxBlink >= 0.99);
  assert.deepEqual(s, { separation: { x: 0, y: 0 }, blur: 0, balance: 0.5, blink: 0, relax: 0, phase: 'focused' });
});

test('after refocus a new delay runs and the push is forgotten', () => {
  const m = make(still); toDrifting(m);
  m.push(0.03); run(m, 1);
  m.refocus(); run(m, REFOCUS);
  const t = onsetTime(m);
  assert.ok(t >= 2 - STEP && t <= 6 + STEP);
  assert.ok(near(run(m, 1.5 + 2).separation.x, 0.035));
});

test('refocus is ignored while focused and while already refocusing', () => {
  const a = make(still, 5), b = make(still, 5);
  a.refocus();
  assert.equal(onsetTime(a), onsetTime(b));
  const m = make(still); toDrifting(m);
  m.refocus(); run(m, 0.2); m.refocus();
  assert.equal(run(m, 0.15 + 2 * STEP).phase, 'focused');
});

test('ten minutes of random steering stays in range', () => {
  const r = rng(99), m = make({}, 3);
  run(m, 600, (s) => {
    if (r() < 0.01) m.push((r() - 0.5) * 0.2);
    if (r() < 0.001) m.refocus();
    for (const v of [s.separation.x, s.separation.y, s.blur, s.balance, s.blink, s.relax]) assert.ok(Number.isFinite(v));
    if (s.phase !== 'refocusing') assert.ok(s.separation.x >= 0 && s.separation.x <= 0.2);
    for (const v of [s.balance, s.blink, s.relax]) assert.ok(v >= 0 && v <= 1);
  });
});

import { blinkCurve } from '../js/effects/blink.js';

test('reset returns to a single view and starts a new delay', () => {
  const m = make(still); toDrifting(m);
  m.push(0.03); m.reset();
  assert.deepEqual(m.state, { separation: { x: 0, y: 0 }, blur: 0, balance: 0.5, blink: 0, relax: 0, phase: 'focused' });
  const t = onsetTime(m);
  assert.ok(t >= 2 - STEP && t <= 6 + STEP);
  assert.ok(near(run(m, 1.5 + 2).separation.x, 0.035));   // the push was forgotten
});

test('the refocus blink is the shared blink curve', () => {
  const m = make(still); toDrifting(m); m.refocus();
  let t = 0;
  run(m, 0.3, (s) => { t += STEP; if (s.phase === 'refocusing') assert.ok(Math.abs(s.blink - blinkCurve(t)) < 1e-9); });
});

test('a push that is not a finite number is ignored', () => {
  const m = make(still); toDrifting(m);
  for (const bad of [NaN, Infinity, -Infinity, undefined]) m.push(bad);
  assert.ok(near(run(m, 1).separation.x, 0.035));
});
