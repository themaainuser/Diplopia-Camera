import test from 'node:test';
import assert from 'node:assert/strict';
import { blinkCurve, createBlink, BLINK_DURATION } from '../js/effects/blink.js';

test('the blink closes, holds and opens', () => {
  assert.equal(BLINK_DURATION, 0.3);
  assert.deepEqual([blinkCurve(-1), blinkCurve(0), blinkCurve(0.08), blinkCurve(0.13), blinkCurve(0.3), blinkCurve(5)], [0, 0, 1, 1, 0, 0]);
  assert.ok(Math.abs(blinkCurve(0.04) - 0.5) < 1e-9);
  assert.ok(Math.abs(blinkCurve(0.22) - 0.5) < 1e-9);
});

test('a blink runs once; a second trigger during it does not restart it', () => {
  const b = createBlink();
  assert.deepEqual([b.update(1 / 60), b.active], [0, false]);
  b.trigger();
  assert.equal(b.active, true);
  let peak = 0;
  for (let i = 0; i < 6; i++) peak = Math.max(peak, b.update(1 / 60));   // 0.1 s in
  assert.equal(peak, 1);
  b.trigger();
  let t = 0.1;
  while (b.active) { b.update(1 / 60); t += 1 / 60; }
  assert.ok(t >= 0.3 - 1e-9 && t <= 0.3 + 2 / 60, `ended at ${t}`);
  assert.equal(b.update(1 / 60), 0);
});

test('a long gap ends the blink instead of freezing it shut', () => {
  const b = createBlink();
  b.trigger();
  for (let i = 0; i < 3; i++) b.update(3600);
  assert.deepEqual([b.active, b.update(1 / 60)], [false, 0]);
});
