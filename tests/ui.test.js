import test from 'node:test';
import assert from 'node:assert/strict';
import { containFit } from '../js/ui.js';

test('containFit keeps the source proportions inside the stage', () => {
  assert.deepEqual(containFit(1000, 500, 1280, 720), { width: 889, height: 500 });
  assert.deepEqual(containFit(400, 800, 1280, 720), { width: 400, height: 225 });
  assert.deepEqual(containFit(400, 800, 720, 1280), { width: 400, height: 711 });
});

import { createGestures, formatValue, loadSettings, saveSettings, formatStatus } from '../js/ui.js';
import { defaultParams, PARAM_DEFS } from '../js/effects/diplopia.js';

const fakeEl = () => {
  const h = {};
  return {
    addEventListener: (type, fn) => { h[type] = fn; },
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 450 }),
    setPointerCapture() {},
    fire: (type, x, y) => h[type]?.({ clientX: x, clientY: y, pointerId: 1, preventDefault() {} }),
  };
};

test('a small movement is a tap, reported in picture coordinates', () => {
  const el = fakeEl(), taps = [], drags = [];
  createGestures(el, { onTap: (u, v) => taps.push([u, v]), onDrag: (d) => drags.push(d) });
  el.fire('pointerdown', 500, 275); el.fire('pointermove', 503, 276); el.fire('pointerup', 503, 276);
  assert.equal(taps.length, 1);
  assert.ok(Math.abs(taps[0][0] - 0.50375) < 1e-6 && Math.abs(taps[0][1] - 226 / 450) < 1e-6);
  assert.equal(drags.length, 0);
});

test('a longer movement is a drag whose pieces add up to the distance moved', () => {
  const el = fakeEl(), taps = [], drags = [];
  createGestures(el, { onTap: () => taps.push(1), onDrag: (d) => drags.push(d) });
  el.fire('pointerdown', 300, 200); el.fire('pointermove', 330, 200); el.fire('pointermove', 350, 205); el.fire('pointerup', 350, 205);
  assert.equal(taps.length, 0);
  assert.ok(Math.abs(drags.reduce((a, b) => a + b, 0) - 50 / 800) < 1e-9);
});

test('formatValue', () => {
  const def = (key) => PARAM_DEFS.find((d) => d.key === key);
  assert.equal(formatValue(def('delayMin'), 2), '2.0 s');
  assert.equal(formatValue(def('restSeparation'), 0.035), '3.5%');
  assert.equal(formatValue(def('driftSpeed'), 1), '1.0×');
  assert.equal(formatValue(def('dominance'), 0.55), '0.55');
});

test('settings survive a round trip and bad storage gives defaults', () => {
  const mem = { v: null, getItem() { return this.v; }, setItem(k, v) { this.k = k; this.v = v; } };
  saveSettings(mem, { ...defaultParams(), blur: 0.01 });
  assert.equal(mem.k, 'diplopia.settings.v1');
  assert.equal(loadSettings(mem).blur, 0.01);
  assert.deepEqual(loadSettings({ getItem: () => '{not json' }), defaultParams());
  assert.deepEqual(loadSettings({ getItem: () => '{"blur": 99, "delayMin": 9, "delayMax": 1}' }), { ...defaultParams(), blur: 0.02, delayMin: 1, delayMax: 1 });
  assert.deepEqual(loadSettings({ getItem() { throw new Error('blocked'); } }), defaultParams());
  assert.doesNotThrow(() => saveSettings({ setItem() { throw new Error('full'); } }, defaultParams()));
});

test('formatStatus', () => {
  assert.equal(formatStatus({ phase: 'drifting', mode: 'whole', depth: null }), 'drifting');
  assert.equal(formatStatus({ phase: 'focused', mode: 'depth', depth: { state: 'loading', percent: 43 } }), 'focused · loading depth model 43%');
  assert.equal(formatStatus({ phase: 'drifting', mode: 'depth', depth: { state: 'ready', rate: 11.6, device: 'webgpu' } }), 'drifting · depth 12/s (webgpu)');
  assert.equal(formatStatus({ phase: 'focused', mode: 'depth', depth: { state: 'error' } }), 'focused · depth unavailable');
});

test('a pointer that cannot be captured still gives a tap', () => {
  const el = fakeEl(), taps = [];
  el.setPointerCapture = () => { throw new Error('No active pointer with the given id'); };
  createGestures(el, { onTap: (u, v) => taps.push([u, v]), onDrag() {} });
  assert.doesNotThrow(() => el.fire('pointerdown', 500, 275));
  el.fire('pointerup', 500, 275);
  assert.equal(taps.length, 1);
});
