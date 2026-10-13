import test from 'node:test';
import assert from 'node:assert/strict';
import { containFit } from '../js/ui.js';

test('containFit keeps the source proportions inside the stage', () => {
  assert.deepEqual(containFit(1000, 500, 1280, 720), { width: 889, height: 500 });
  assert.deepEqual(containFit(400, 800, 1280, 720), { width: 400, height: 225 });
  assert.deepEqual(containFit(400, 800, 720, 1280), { width: 400, height: 711 });
});
