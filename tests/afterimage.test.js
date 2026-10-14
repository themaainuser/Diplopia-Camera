import test from 'node:test';
import assert from 'node:assert/strict';
import { afterimageRates } from '../js/effects/afterimage.js';

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
