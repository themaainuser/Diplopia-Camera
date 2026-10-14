import test from 'node:test';
import assert from 'node:assert/strict';
import { afterimageRates, createMemoryClock } from '../js/effects/afterimage.js';

const times = { afterBuild: 4, afterFade: 6 };

test('rates: nothing for no time, exact for one frame', () => {
  assert.deepEqual(afterimageRates(0, times), { build: 0, fade: 0 });
  const r = afterimageRates(1 / 60, times);
  assert.ok(Math.abs(r.build - (1 - Math.exp(-1 / 240))) < 1e-12);
  assert.ok(Math.abs(r.fade - (1 - Math.exp(-1 / 360))) < 1e-12);
});

test('rates: a long gap counts as 0.1 seconds, an invalid step as none', () => {
  assert.deepEqual(afterimageRates(3600, times), afterimageRates(0.1, times));
  assert.deepEqual(afterimageRates(Infinity, times), afterimageRates(0.1, times));
  for (const bad of [NaN, -5]) assert.deepEqual(afterimageRates(bad, times), { build: 0, fade: 0 });
});

const framesToFirstStep = (hz, params) => {
  const clock = createMemoryClock();
  for (let i = 1; i <= 1000; i++) if (clock.advance(1 / hz, params).fade > 0) return i;
  return Infinity;
};

test('the memory moves once per tick, by the whole time gathered', () => {
  // Build 4 s, Fade 6 s: a tick is 4 / 60 s, so 8 frames at 120 Hz.
  const clock = createMemoryClock();
  const steps = Array.from({ length: 8 }, () => clock.advance(1 / 120, times));
  assert.ok(steps.slice(0, 7).every((s) => s.build === 0 && s.fade === 0));
  assert.ok(Math.abs(steps[7].build - (1 - Math.exp(-(8 / 120) / 4))) < 1e-12);
  assert.ok(Math.abs(steps[7].fade - (1 - Math.exp(-(8 / 120) / 6))) < 1e-12);
});

test('the tick is a sixtieth of the shorter time, between 1/60 and 1/10 second', () => {
  assert.equal(framesToFirstStep(120, times), 8);
  assert.equal(framesToFirstStep(120, { afterBuild: 15, afterFade: 30 }), 12);
  assert.equal(framesToFirstStep(120, { afterBuild: 1, afterFade: 1 }), 2);
  assert.equal(framesToFirstStep(30, { afterBuild: 1, afterFade: 1 }), 1);
});

test('the memory fades the same over a second at any frame rate', () => {
  for (const hz of [30, 60, 90, 120, 144]) {
    const clock = createMemoryClock();
    let keep = 1;
    for (let i = 0; i < hz; i++) keep *= 1 - clock.advance(1 / hz, times).fade;
    // After one second, at most one tick (never more than 0.1 s) is still waiting to be applied.
    assert.ok(keep <= Math.exp(-(1 - 0.1) / 6) + 1e-9 && keep >= Math.exp(-1 / 6) - 1e-9, `${hz} Hz: ${keep}`);
  }
});

test('a hidden-tab gap moves the memory by at most 0.1 seconds', () => {
  const clock = createMemoryClock();
  assert.deepEqual(clock.advance(3600, times), afterimageRates(0.1, times));
  assert.deepEqual(clock.advance(NaN, times), { build: 0, fade: 0 });
});
