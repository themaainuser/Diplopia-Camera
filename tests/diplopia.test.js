import test from 'node:test';
import assert from 'node:assert/strict';
import { make, run, toDrifting, onsetTime, STEP } from './helpers.js';

test('focused: everything is at rest', () => {
  assert.deepEqual(make().update(STEP), { separation: { x: 0, y: 0 }, blur: 0, balance: 0.5, blink: 0, relax: 0, phase: 'focused' });
});

test('onset begins within the delay range and varies with the seed', () => {
  const times = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const t = onsetTime(make({}, seed));
    assert.ok(t >= 2 - STEP && t <= 6 + STEP, `seed ${seed}: ${t}`);
    times.add(t.toFixed(2));
  }
  assert.ok(times.size >= 10);
});

test('settles at the resting separation with full blur', () => {
  const s = toDrifting(make({ driftAmount: 0 }));
  assert.equal(s.phase, 'drifting');
  assert.equal(s.relax, 1);
  assert.ok(Math.abs(s.separation.x - 0.035) < 0.001);
  assert.ok(Math.abs(s.blur - 0.006) < 1e-9);
  assert.ok(s.separation.y > 0 && s.separation.y <= 0.0025);
});

test('blur leads separation during onset', () => {
  let seen = false;
  run(make({ driftAmount: 0 }), 9, (s) => {
    if (s.phase !== 'relaxing' || s.relax < 0.2 || s.relax > 0.8) return;
    seen = true;
    assert.ok(s.blur / 0.006 > s.separation.x / 0.035);
  });
  assert.ok(seen);
});

test('drift wanders within the drift amount; balance wobbles around dominance', () => {
  const m = make(); toDrifting(m);
  let lo = 1, hi = 0, bLo = 1, bHi = 0;
  run(m, 120, (s) => {
    lo = Math.min(lo, s.separation.x); hi = Math.max(hi, s.separation.x);
    bLo = Math.min(bLo, s.balance); bHi = Math.max(bHi, s.balance);
  });
  assert.ok(hi - lo > 0.008);
  assert.ok(lo >= 0.035 * 0.6 - 0.001 && hi <= 0.035 * 1.4 + 0.001);
  assert.ok(bLo >= 0.5 - 1e-9 && bHi <= 0.6 + 1e-9 && bHi - bLo > 0.01);
});

test('the same seed gives the same sequence', () => {
  const log = (m) => { const out = []; run(m, 30, (s) => out.push(s)); return out; };
  assert.deepEqual(log(make({}, 7)), log(make({}, 7)));
});

test('a huge or invalid time step is clamped (tab was hidden)', () => {
  const m = make();
  for (const dt of [3600, Infinity, NaN, -5]) {
    const s = m.update(dt);
    assert.equal(s.phase, 'focused');
    assert.equal(s.separation.x, 0);
  }
});
