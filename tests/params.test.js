import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAM_DEFS, defaultParams, sanitizeParams, MAX_SEPARATION, BREAKAWAY_RATIO } from '../js/effects/diplopia.js';

test('defaults match the spec', () => {
  assert.deepEqual(defaultParams(), {
    delayMin: 2, delayMax: 6, onsetDuration: 1.5, restSeparation: 0.035, driftAmount: 0.4, driftSpeed: 1,
    verticalMisalign: 0.002, blur: 0.006, dominance: 0.55, fusionThreshold: 0.006, depthStrength: 0.04, depthBlur: 0.006,
  });
  assert.equal(MAX_SEPARATION, 0.2);
  assert.equal(BREAKAWAY_RATIO, 1.5);
});

test('every definition has a label, a step and a range containing its default', () => {
  for (const d of PARAM_DEFS) assert.ok(d.label && d.step > 0 && d.min <= d.value && d.value <= d.max, d.key);
  assert.deepEqual(PARAM_DEFS.filter((d) => d.depthOnly).map((d) => d.key), ['depthStrength', 'depthBlur']);
});

test('sanitizeParams: anything that is not an object gives defaults', () => {
  for (const raw of [null, undefined, 'x', 42, []]) assert.deepEqual(sanitizeParams(raw), defaultParams());
});

test('sanitizeParams: clamps, rejects non-numbers, drops unknown keys', () => {
  const p = sanitizeParams({ blur: 9, restSeparation: -1, dominance: NaN, driftSpeed: '2', hacked: 1 });
  assert.equal(p.blur, 0.02);
  assert.equal(p.restSeparation, 0);
  assert.equal(p.dominance, 0.55);
  assert.equal(p.driftSpeed, 1);
  assert.equal('hacked' in p, false);
});

test('sanitizeParams: delay minimum never exceeds maximum', () => {
  const p = sanitizeParams({ delayMin: 10, delayMax: 3 });
  assert.deepEqual([p.delayMin, p.delayMax], [3, 3]);
});
