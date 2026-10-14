import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAM_DEFS, MAX_SEPARATION, BREAKAWAY_RATIO } from '../js/effects/diplopia.js';
import { EFFECTS, ALL_DEFS, defaultParams, sanitizeParams } from '../js/effects/index.js';

const DIPLOPIA = {
  delayMin: 2, delayMax: 6, onsetDuration: 1.5, restSeparation: 0.035, driftAmount: 0.4, driftSpeed: 1,
  verticalMisalign: 0.002, blur: 0.006, dominance: 0.55, fusionThreshold: 0.006, depthStrength: 0.04, depthBlur: 0.006,
};
const AFTERIMAGE = { afterStrength: 0.45, afterBuild: 4, afterFade: 6, afterSelectivity: 0.5, afterSteady: 0.3 };

test('defaults match the specs, with both effects switched on', () => {
  assert.deepEqual(defaultParams(), { ...DIPLOPIA, ...AFTERIMAGE, diplopiaOn: 1, afterimageOn: 1 });
  assert.equal(MAX_SEPARATION, 0.2);
  assert.equal(BREAKAWAY_RATIO, 1.5);
});

test('the effects list names each effect, its switch and its sliders', () => {
  assert.deepEqual(EFFECTS.map((e) => [e.id, e.label, e.switchKey]), [
    ['diplopia', 'Double vision', 'diplopiaOn'], ['afterimage', 'Afterimages', 'afterimageOn'],
  ]);
  assert.equal(EFFECTS[0].defs, PARAM_DEFS);
  assert.deepEqual(EFFECTS[1].defs.map((d) => d.key), Object.keys(AFTERIMAGE));
  for (const d of ALL_DEFS) assert.ok(d.label && d.step > 0 && d.min <= d.value && d.value <= d.max, d.key);
  assert.deepEqual(PARAM_DEFS.filter((d) => d.depthOnly).map((d) => d.key), ['depthStrength', 'depthBlur']);
});

test('sanitizeParams: anything that is not an object gives defaults', () => {
  for (const raw of [null, undefined, 'x', 42, []]) assert.deepEqual(sanitizeParams(raw), defaultParams());
});

test('sanitizeParams: clamps, rejects non-numbers, drops unknown keys', () => {
  const p = sanitizeParams({ blur: 9, restSeparation: -1, dominance: NaN, driftSpeed: '2', afterFade: 99, hacked: 1 });
  assert.deepEqual([p.blur, p.restSeparation, p.dominance, p.driftSpeed, p.afterFade], [0.02, 0, 0.55, 1, 30]);
  assert.equal('hacked' in p, false);
});

test('sanitizeParams: delay minimum never exceeds maximum', () => {
  const p = sanitizeParams({ delayMin: 10, delayMax: 3 });
  assert.deepEqual([p.delayMin, p.delayMax], [3, 3]);
});

test('sanitizeParams: a switch is 0 or 1, anything else is its default', () => {
  assert.equal(sanitizeParams({ diplopiaOn: 0 }).diplopiaOn, 0);
  for (const junk of [0.5, 7, -1, true, 'off', null]) assert.equal(sanitizeParams({ afterimageOn: junk }).afterimageOn, 1);
});

test('settings saved before afterimages existed gain the new keys', () => {
  const p = sanitizeParams({ ...DIPLOPIA, blur: 0.01 });
  assert.deepEqual(p, { ...defaultParams(), blur: 0.01 });
});
