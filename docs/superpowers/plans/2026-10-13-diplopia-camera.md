# Diplopia Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plain-JS web app that shows a live camera view which, after a short random delay, slides into natural-looking double vision, in a whole-frame mode and a depth-aware mode, with steering, refocus, tuning sliders, and photo/video saving.

**Architecture:** A pure behaviour model turns elapsed time and user input into a per-frame state (separation, blur, balance, blink, relax). One WebGL renderer draws the source from that state; depth-aware mode adds a per-pixel depth term fed by a depth model running in a Web Worker. Camera, capture and UI are separate modules wired together by `js/main.js`.

**Tech Stack:** JavaScript ES modules, WebGL 1, `getUserMedia`, `MediaRecorder`, Node 24 built-in test runner, Transformers.js 4.3.0 from jsDelivr (depth-aware mode only).

**Spec:** `docs/superpowers/specs/2026-10-13-diplopia-camera-design.md`

## Global Constraints

- Plain JavaScript, ES modules, static files, no framework, no build step, no npm dependencies.
- Only `js/depth-worker.js` loads code from the network: `https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0`, model `onnx-community/depth-anything-v2-small`.
- Before writing any Transformers.js call, check current docs with Context7 (library id `/huggingface/transformers.js`). This is the user's standing rule.
- All distances are fractions of frame width. All times are seconds.
- Camera frames never leave the device.
- No module except `js/main.js` and `js/depth-worker.js` may touch `window`, `document` or `navigator` at import time, so Node tests can import them.
- Tests: `npm test` (runs `node --test`), files in `tests/*.test.js`.
- Dev server: `npm start`, then `http://localhost:8080`. Browser checks use `?source=test` because the checking browser may have no camera.
- Mode names in UI copy: "Whole-frame" and "Depth-aware".
- The folder is not a git repository. Skip every Commit step unless one has been created.

## Review Focus

1. **Tab hidden, then shown again** (a frame gap of seconds to hours): the effect continues from where it was, with no jump and no invalid numbers. Pinned in Task 2.
2. **Saved settings that are corrupt, out of range, or unreadable**: the app starts with safe values. Pinned in Tasks 1 and 6.
3. **Phone rotated, or switched to a camera with a different resolution**: the picture keeps its proportions. Pinned in Tasks 4 and 5.
4. **Share sheet dismissed without sharing**: nothing is downloaded and no error is shown. Pinned in Task 8.
5. **Depth result arriving after leaving depth-aware mode**: it is dropped, and the next entry into the mode works. Pinned in Task 7.

## File Map

| File | Created in | Responsibility |
|---|---|---|
| `package.json`, `tools/serve.js`, `.claude/launch.json` | Task 1 | Test and start commands, zero-dependency static server |
| `js/effects/diplopia.js` | Tasks 1 to 3 | Parameters and behaviour model |
| `js/camera.js` | Task 4 | Sources: camera, test pattern, image |
| `js/renderer.js` | Task 5 | WebGL renderer, both modes |
| `index.html`, `styles.css`, `js/main.js` | Task 5, extended in 6 to 8 | Page shell and frame loop |
| `js/ui.js` | Task 5 (messages, layout), Task 6 (controls) | Messages, gestures, panel, settings |
| `js/depth.js`, `js/depth-worker.js` | Task 7 | Depth pipeline |
| `js/capture.js` | Task 8 | Photo and video saving |
| `README.md` | Task 9 | How to run |

---

### Task 1: Project scaffold and tunable parameters

**Files:**
- Create: `package.json`, `tools/serve.js`, `.claude/launch.json`, `js/effects/diplopia.js`
- Test: `tests/params.test.js`

**Interfaces:**
- Produces: `PARAM_DEFS: Array<{ key, label, min, max, step, value, format, depthOnly? }>`, `defaultParams(): Record<string, number>`, `sanitizeParams(raw: unknown): Record<string, number>`, `MAX_SEPARATION = 0.2`, `BREAKAWAY_RATIO = 1.5`.

`PARAM_DEFS`, in this order (`format` is one of `seconds`, `percent`, `times`, `ratio`):

| key | label | min | max | step | value | format |
|---|---|---|---|---|---|---|
| `delayMin` | Onset delay, min | 0.5 | 20 | 0.1 | 2 | seconds |
| `delayMax` | Onset delay, max | 0.5 | 20 | 0.1 | 6 | seconds |
| `onsetDuration` | Onset duration | 0.3 | 5 | 0.1 | 1.5 | seconds |
| `restSeparation` | Resting separation | 0 | 0.12 | 0.001 | 0.035 | percent |
| `driftAmount` | Drift amount | 0 | 1 | 0.01 | 0.4 | percent |
| `driftSpeed` | Drift speed | 0.2 | 3 | 0.1 | 1 | times |
| `verticalMisalign` | Vertical misalignment | 0 | 0.01 | 0.0005 | 0.002 | percent |
| `blur` | Blur | 0 | 0.02 | 0.0005 | 0.006 | percent |
| `dominance` | Eye dominance | 0.3 | 0.7 | 0.01 | 0.55 | ratio |
| `fusionThreshold` | Fusion threshold | 0 | 0.02 | 0.0005 | 0.006 | percent |
| `depthStrength` | Depth doubling | 0 | 0.12 | 0.001 | 0.04 | percent (`depthOnly`) |
| `depthBlur` | Depth blur | 0 | 0.02 | 0.0005 | 0.006 | percent (`depthOnly`) |

- [ ] **Step 1: Create `package.json`** with `"type": "module"`, `"private": true`, scripts `"test": "node --test"` and `"start": "node tools/serve.js"`, and no dependencies.

- [ ] **Step 2: Write the failing tests** in `tests/params.test.js`

```js
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
```

- [ ] **Step 3: Run** `npm test`. Expected: FAIL, cannot find module `js/effects/diplopia.js`.

- [ ] **Step 4: Implement** the five exports in `js/effects/diplopia.js`. `sanitizeParams` accepts a value only when `typeof v === 'number'` and it is finite.

- [ ] **Step 5: Run** `npm test`. Expected: 5 tests pass.

- [ ] **Step 6: Create `tools/serve.js`**: a Node `http` static server for the project root, no dependencies.
  - Listens on `127.0.0.1`, port `process.env.PORT || 8080`.
  - Strips the query string, URL-decodes the path, serves `index.html` for `/`.
  - Responds 403 when the resolved path is outside the project root, 404 when the file is missing.
  - Content types: `.html` text/html, `.js` text/javascript, `.css` text/css, `.json` application/json, `.png`, `.jpg`/`.jpeg`, `.webp`, `.svg`; anything else application/octet-stream.
  - Sends `Cache-Control: no-store`.

- [ ] **Step 7: Create `.claude/launch.json`**

```json
{ "version": "0.0.1", "configurations": [{ "name": "cam-app", "runtimeExecutable": "node", "runtimeArgs": ["tools/serve.js"], "port": 8080 }] }
```

- [ ] **Step 8: Verify the server.** Start it, then run `curl -sI http://127.0.0.1:8080/js/effects/diplopia.js`. Expected: `200` with `content-type: text/javascript`. Run `curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8080/..%2f..%2fx"`. Expected: `403`.

- [ ] **Step 9: Commit** (see Global Constraints).

---

### Task 2: Behaviour model: onset and drift

**Files:**
- Modify: `js/effects/diplopia.js`
- Test: `tests/helpers.js`, `tests/diplopia.test.js`

**Interfaces:**
- Consumes: `MAX_SEPARATION` from Task 1.
- Produces: `createDiplopia({ params, random = Math.random })` returning `{ update(dt: number): FrameState, push(delta: number): void, refocus(): void, get state(): FrameState }`.
  - `FrameState = { separation: { x, y }, blur, balance, blink, relax, phase }`, `phase` one of `'focused' | 'relaxing' | 'drifting' | 'fused' | 'refocusing'`.
  - `update` returns a new plain object on every call.
  - The model keeps the `params` object by reference and reads it every update, so the UI can change values live.
  - In this task `push` and `refocus` exist but do nothing.

- [ ] **Step 1: Write the test helpers and the failing tests**

`tests/helpers.js` (shared with Task 3; the name keeps it out of test discovery). The model tests use their own fixed parameters, so retuning the app's defaults later does not break them.

```js
import { createDiplopia } from '../js/effects/diplopia.js';

export const rng = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
export const STEP = 1 / 60;
export const BASE = {
  delayMin: 2, delayMax: 6, onsetDuration: 1.5, restSeparation: 0.035, driftAmount: 0.4, driftSpeed: 1,
  verticalMisalign: 0.002, blur: 0.006, dominance: 0.55, fusionThreshold: 0.006, depthStrength: 0.04, depthBlur: 0.006,
};
export const make = (over = {}, seed = 1) => createDiplopia({ params: { ...BASE, ...over }, random: rng(seed) });
export const run = (m, seconds, each) => { let s; for (let t = 0; t < seconds; t += STEP) { s = m.update(STEP); each?.(s, t); } return s; };
export const toDrifting = (m) => run(m, 6 + 1.5 + 2); // max delay + onset + settle
export const onsetTime = (m) => { let t = 0; while (m.update(STEP).phase === 'focused') t += STEP; return t; };
```

`tests/diplopia.test.js`:

```js
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
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, `createDiplopia` is not exported.

- [ ] **Step 3: Implement `createDiplopia`** for the phases `focused`, `relaxing`, `drifting`.

Constants: `MAX_STEP = 0.1`, `FOLLOW_RATE = 10`, `TREMOR = 0.0003`, `BALANCE_WOBBLE = 0.05`, `BLUR_LEAD = 0.7`.

Random draws, in this order: three phases `p1, p2, p3 = random() * 2π` at creation, then the first delay. Every delay is `delayMin + random() * (delayMax - delayMin)`, read from `params` at the moment it is drawn.

```
noise(t)  = (sin(0.31 t + p1) + 0.6 sin(0.73 t + p2) + 0.3 sin(1.57 t + p3)) / 1.9
dt        = dt > 0 ? min(dt, MAX_STEP) : 0

focused:  count the delay down; at zero switch to relaxing with tRelax = 0, userOffset = 0, shown = 0.
          state: separation 0, blur 0, balance 0.5, blink 0, relax 0.

relaxing, drifting (and fused, Task 3):
  tRelax   += dt
  relax     = smoothstep(min(1, tRelax / onsetDuration))
  blurLevel = smoothstep(min(1, tRelax / (onsetDuration * BLUR_LEAD)))
  noiseT   += dt * driftSpeed
  base      = restSeparation * (1 + driftAmount * noise(noiseT)) * relax
  free      = base + userOffset
  if relaxing and tRelax >= onsetDuration: phase = drifting
  k         = 1 - exp(-dt * FOLLOW_RATE)
  shownX   += (free - shownX) * k
  shownY   += (verticalMisalign * relax * (0.6 + 0.4 * noise(noiseT * 0.7 + 100)) - shownY) * k
  tremor    = TREMOR * relax
  separation.x = clamp(shownX + tremor * noise(noiseT * 9 + 300), 0, MAX_SEPARATION)
  separation.y = shownY + tremor * noise(noiseT * 9 + 400)
  blur      = params.blur * blurLevel
  balance   = clamp(dominance + BALANCE_WOBBLE * noise(noiseT * 0.5 + 200), 0, 1)
  blink     = 0
```

`smoothstep(u) = u * u * (3 - 2 * u)`.

- [ ] **Step 4: Run** `npm test`. Expected: all tests pass.

- [ ] **Step 5: Commit.**

---

### Task 3: Behaviour model: steering, fusion and refocus

**Files:**
- Modify: `js/effects/diplopia.js`
- Test: `tests/diplopia-steer.test.js`

**Interfaces:**
- Consumes: `createDiplopia` from Task 2, and `tests/helpers.js` (`make`, `run`, `toDrifting`, `onsetTime`, `rng`, `STEP`).
- Produces: working `push(delta)` and `refocus()`, and the phases `fused` and `refocusing`.

- [ ] **Step 1: Write the failing tests** in `tests/diplopia-steer.test.js`

```js
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
```

- [ ] **Step 2: Run** `npm test`. Expected: the new file fails (push and refocus do nothing yet); Task 1 and 2 tests still pass.

- [ ] **Step 3: Implement `push`, fusion and `refocus`.**

`push(delta)`: ignored in `focused` and `refocusing`; otherwise `userOffset += delta`.

Additions to the Task 2 update, inside the relaxing/drifting/fused branch:

```
after computing base:
  userOffset = clamp(userOffset, -base, MAX_SEPARATION - base)     // no hidden wind-up past the limits
  free       = base + userOffset
after the relaxing -> drifting check:
  if drifting and fusionThreshold > 0 and free < fusionThreshold:                     phase = fused
  else if fused and (fusionThreshold == 0 or free > fusionThreshold * BREAKAWAY_RATIO): phase = drifting
while fused: the targets for shownX and shownY are 0, and tremor is 0.
```

`refocus()`: ignored in `focused` and `refocusing`. Otherwise record `s0 = current separation`, `blur0`, `relax0`, set `phase = refocusing`, `tRef = 0`.

```
refocusing, with REFOCUS_DURATION = 0.35 and u = tRef / REFOCUS_DURATION:
  tRef        += dt
  easeOutBack(u) = 1 + 2.70158 (u - 1)^3 + 1.70158 (u - 1)^2
  separation   = s0 * (1 - easeOutBack(u))                 // dips to about -0.1 * s0, ends at 0
  blur         = blur0 * (1 - u);  relax = relax0 * (1 - u)
  blink        = tRef < 0.08 ? tRef / 0.08 : tRef < 0.14 ? 1 : max(0, 1 - (tRef - 0.14) / 0.16)
  balance      = dominance
  when tRef >= REFOCUS_DURATION: phase = focused, draw a new delay, return the at-rest state.
```

- [ ] **Step 4: Run** `npm test`. Expected: all tests pass.

- [ ] **Step 5: Commit.**

---

### Task 4: Sources: camera, test pattern, image

**Files:**
- Create: `js/camera.js`
- Test: `tests/camera.test.js`

**Interfaces:**
- Produces:
  - `parseSource(search: string): { kind: 'camera' } | { kind: 'test' } | { kind: 'image', path: string }`
  - `describeCameraError(err: { name?, message? } | null, { secure: boolean }): { title, detail, action: 'retry' | 'test' | null }`
  - `sourceSize(element): { width, height } | null`
  - `createTestPattern(width = 1280, height = 720): HTMLCanvasElement`
  - `openSource(desc, { facing: 'environment' | 'user' }): Promise<Source>`, `Source = { element, kind, mirrored: boolean, facing, stop(): void }`
  - `countCameras(): Promise<number>`

Message copy for `describeCameraError`:

| Condition | title | detail | action |
|---|---|---|---|
| `secure` is false | The camera needs a secure address | Open this page on localhost or over HTTPS. | `null` |
| `NotAllowedError`, `SecurityError` | Camera access was blocked | Allow the camera for this site in your browser's address bar, then try again. | `retry` |
| `NotFoundError`, `OverconstrainedError` | No camera found | You can still try the effect with the test picture. | `test` |
| `NotReadableError`, `AbortError` | The camera is busy | Close other apps that are using the camera, then try again. | `retry` |
| anything else | The camera could not start | `err.message`, or "Unknown error." | `retry` |

- [ ] **Step 1: Write the failing tests** in `tests/camera.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, describeCameraError, sourceSize } from '../js/camera.js';

test('parseSource', () => {
  assert.deepEqual(parseSource(''), { kind: 'camera' });
  assert.deepEqual(parseSource('?source='), { kind: 'camera' });
  assert.deepEqual(parseSource('?source=test'), { kind: 'test' });
  assert.deepEqual(parseSource('?debug=depth&source=photos/desk.jpg'), { kind: 'image', path: 'photos/desk.jpg' });
  for (const bad of ['https://x.test/a.jpg', '//x.test/a.jpg', 'data:image/png;base64,AA', '/etc/x'])
    assert.deepEqual(parseSource('?source=' + encodeURIComponent(bad)), { kind: 'camera' });
});

test('describeCameraError', () => {
  const d = (name, secure = true) => describeCameraError(name ? { name, message: 'boom' } : null, { secure });
  assert.deepEqual([d('NotAllowedError', false).title, d('NotAllowedError', false).action], ['The camera needs a secure address', null]);
  assert.equal(d('NotAllowedError').action, 'retry');
  assert.equal(d('NotFoundError').action, 'test');
  assert.equal(d('NotReadableError').title, 'The camera is busy');
  assert.deepEqual(d('Weird'), { title: 'The camera could not start', detail: 'boom', action: 'retry' });
  assert.equal(d(null).detail, 'Unknown error.');
});

test('sourceSize reads video, image and canvas, and is null until ready', () => {
  assert.deepEqual(sourceSize({ videoWidth: 720, videoHeight: 1280 }), { width: 720, height: 1280 });
  assert.deepEqual(sourceSize({ naturalWidth: 800, naturalHeight: 600 }), { width: 800, height: 600 });
  assert.deepEqual(sourceSize({ width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.equal(sourceSize({ videoWidth: 0, videoHeight: 0 }), null);
  assert.equal(sourceSize(null), null);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, cannot find `js/camera.js`.

- [ ] **Step 3: Implement the three pure functions.** `parseSource` treats a value as an image path only when it has no `:` and does not start with `/` or `\`. `sourceSize` checks `videoWidth` first, then `naturalWidth`, then `width`.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Implement the browser functions.**
  - `createTestPattern`: a canvas drawn once with a soft gradient background, a thin grid, six circles of different sizes, the word `FOCUS` in large type at the centre and three lines of small text. High-contrast edges matter: they are what makes doubling and blur visible.
  - `openSource`, kind `camera`: `getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } })`, shown through a `<video>` with `playsInline`, `muted`, `autoplay`, resolved after `play()`. `mirrored` is `settings.facingMode === 'user'` when the track reports a facing mode, otherwise `true` (a desktop webcam). `stop()` stops every track. If `navigator.mediaDevices` is missing, reject with an error named `SecurityError`.
  - `openSource`, kind `test`: the pattern canvas, `mirrored: false`.
  - `openSource`, kind `image`: an `<img>` resolved on load, rejected with `Error('Could not load image: ' + path)`.
  - `countCameras`: number of `videoinput` devices from `enumerateDevices()`, or 0 when unavailable.

- [ ] **Step 6: Commit.**

---

### Task 5: Renderer, page shell and frame loop

**Files:**
- Create: `js/renderer.js`, `js/ui.js`, `js/main.js`, `index.html`, `styles.css`
- Test: `tests/renderer.test.js`, `tests/ui.test.js`

**Interfaces:**
- Consumes: `createDiplopia`, `sanitizeParams`, `defaultParams` (Tasks 1 to 3); `parseSource`, `openSource`, `sourceSize`, `describeCameraError` (Task 4).
- Produces:
  - `zoomFor(params, mode: 'whole' | 'depth'): number`
  - `displayToSource(u, v, { zoom, mirror }): { u, v }`, all in 0..1 with `v = 0` at the top
  - `createRenderer(canvas)` returning `{ resize(width, height), render(element, frame: FrameState, { params, mode, mirror, depth, showDepth }) }`; throws `Error('WebGL unavailable')` when no context can be made.
  - `depth` is `null` or `{ data: Uint8Array, width, height, version: number, fixation: number }`, one byte per pixel, row 0 at the top, 255 = nearest. `fixation` is 0..1.
  - `ui.js`: `showMessage(root, { title, detail, action }, onAction)`, `hideMessage(root)`, `containFit(stageW, stageH, srcW, srcH): { width, height }`
  - `window.__app = { model, params, renderer, state }`, where `state = { mode: 'whole' | 'depth', source, facing, depthOverride: null }`. A debugging handle used by the checks below.
  - Element ids: `#stage`, `#view` (canvas), `#bar`, `#mode-whole`, `#mode-depth`, `#photo`, `#record`, `#record-time`, `#camera-switch`, `#settings-toggle`, `#panel`, `#sliders`, `#reset`, `#status`, `#message`, `#message-title`, `#message-detail`, `#message-action`.

- [ ] **Step 1: Write the failing tests**

`tests/renderer.test.js`:

```js
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
```

`tests/ui.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { containFit } from '../js/ui.js';

test('containFit keeps the source proportions inside the stage', () => {
  assert.deepEqual(containFit(1000, 500, 1280, 720), { width: 889, height: 500 });
  assert.deepEqual(containFit(400, 800, 1280, 720), { width: 400, height: 225 });
  assert.deepEqual(containFit(400, 800, 720, 1280), { width: 400, height: 711 });
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the pure functions.**
  - `zoomFor`: `half = 0.5 * restSeparation * (1 + driftAmount) + blur`, plus `0.5 * depthStrength + depthBlur` in depth mode; result `min(1.5, 1 / (1 - 2 * half))`.
  - `displayToSource`: `u' = (u - 0.5) / zoom + 0.5`, same for `v`; then `u' = 1 - u'` when mirrored.
  - `containFit`: the largest size with the source's aspect ratio that fits the stage, rounded to whole pixels.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Implement `createRenderer`.**
  - Context: `canvas.getContext('webgl', { alpha: false, antialias: false })`.
  - All GL setup lives in one internal `init()` that runs at creation and again on `webglcontextrestored`. Call `preventDefault()` on `webglcontextlost`, and make `render` do nothing while the context is lost.
  - Source texture: uploaded every `render` with `texImage2D`, `UNPACK_FLIP_Y_WEBGL` on, `LINEAR`, `CLAMP_TO_EDGE`.
  - Depth texture: `LUMINANCE` / `UNSIGNED_BYTE`, `UNPACK_ALIGNMENT` 1, same flip, `LINEAR`, `CLAMP_TO_EDGE`; re-uploaded only when `depth.version` changes.
  - Mirror by negating clip-space x in the vertex shader, so all shader maths stays in source space.
  - Fragment shader, per pixel:

```
uv     = (v_uv - 0.5) / zoom + 0.5
d      = useDepth ? texture(depthTex, uv).r - fixation : 0
half   = 0.5 * vec2(sep.x + depthStrength * relax * d, sep.y * aspect)      // aspect = width / height
radius = blur + depthBlur * relax * abs(d)
L      = disc(uv - half, radius);  R = disc(uv + half, radius)
color  = mix(R, L, balance) * (1 - blink)
```

  - `disc(p, r)`: the average of 13 taps: the centre, six at `0.5 r` and six at `r` on hexagons, the outer ring turned 30 degrees. Tap offsets are `(dx, dy * aspect)` so the disc is round on screen.
  - `useDepth` is true only when `mode === 'depth'` and `depth` is not null. `zoom` comes from `zoomFor(params, useDepth ? 'depth' : 'whole')`.
  - When `showDepth` is true and a depth map is present, output the depth value as grey instead.

- [ ] **Step 6: Create `index.html` and `styles.css`.**
  - `#stage` fills the viewport (`100dvh`), black, and centres `#view`.
  - `#view` has `touch-action: none`. Its CSS size is set from JS with `containFit`; it has no `object-fit`, so its box is exactly the picture.
  - `#bar` is fixed to the bottom, translucent black with a backdrop blur, padded by `env(safe-area-inset-bottom)`. Order: the two mode buttons as one segmented control, `#photo` (a round shutter button), `#record` with `#record-time`, `#camera-switch`, `#settings-toggle`.
  - `#panel` is hidden by default: a right-hand side sheet on wide screens, a bottom sheet up to `60dvh` when the viewport is 600px wide or less; it scrolls. It contains `#status`, `#sliders`, `#reset`.
  - `#message` is a centred overlay, hidden by default.
  - Text `#f2f2f2`, record accent `#ff453a`, every control at least 44px in each direction, visible focus outlines.
  - Buttons use `aria-pressed` for toggles and have text labels or `aria-label`.

- [ ] **Step 7: Implement `js/main.js`** (whole-frame only for now).
  - Params: `sanitizeParams(null)` (settings loading arrives in Task 6).
  - Create the renderer; on failure show `{ title: 'This browser cannot draw the effect', detail: 'WebGL is not available.', action: null }` and stop.
  - Open the source from `parseSource(location.search)`. On failure show `describeCameraError(err, { secure: window.isSecureContext })`; `retry` opens it again, `test` navigates to `?source=test`.
  - Frame loop on `requestAnimationFrame`, with `dt` in seconds from the timestamps:
    1. `size = sourceSize(source.element)`; skip the frame while it is null.
    2. If `size` differs from the canvas's `width`/`height`, call `renderer.resize` and re-apply `containFit`. Also re-apply `containFit` on window `resize`.
    3. `frame = model.update(dt)`.
    4. `renderer.render(source.element, frame, { params, mode, mirror: source.mirrored, depth: state.depthOverride, showDepth })`, where `mode` is `'depth'` only when a depth object is present, and `showDepth` is true when the URL has `debug=depth`.
  - Set `window.__app`.

- [ ] **Step 8: Verify in a browser.** Start the server and open `http://localhost:8080/?source=test`.
  1. The test pattern is sharp, single, and fits the window with its proportions kept. The console shows no errors.
  2. Within 8 seconds the picture softens, then splits sideways into two ghost images a few percent of the width apart, and keeps wandering slowly. One image is slightly stronger.
  3. Run `__app.model.refocus()` in the console: a quick blink, then a single sharp picture.
  4. Run this, then wait for the next onset:

```js
Object.assign(__app.params, { restSeparation: 0, driftAmount: 0, delayMin: 0.5, delayMax: 0.5 });
const d = new Uint8Array(16 * 9);
for (let y = 0; y < 9; y++) d.fill(255 - y * 31, y * 16, y * 16 + 16);
__app.state.depthOverride = { data: d, width: 16, height: 9, version: 1, fixation: 0.5 };
__app.model.refocus();
```

  Expected: the middle band stays single and fairly sharp; the top and bottom bands are doubled and blurrier, more so toward the edges.
  5. Open `?source=test&debug=depth` and run the same snippet. Expected: a grey gradient, white at the top, black at the bottom.
  6. Run the following. Expected: the picture disappears for half a second, then returns and keeps animating.

```js
const ext = document.querySelector('#view').getContext('webgl').getExtension('WEBGL_lose_context');
ext.loseContext(); setTimeout(() => ext.restoreContext(), 500);
```

  7. Resize the window to a tall, narrow shape. Expected: the picture shrinks to fit and is never stretched.
  8. Open `http://localhost:8080/` with no camera available or permission denied. Expected: the matching message from Task 4's table, with its button.

- [ ] **Step 9: Commit.**

---

### Task 6: Controls: gestures, settings panel, mode switch

**Files:**
- Modify: `js/ui.js`, `js/main.js`, `styles.css`
- Test: `tests/ui.test.js` (extend)

**Interfaces:**
- Consumes: `PARAM_DEFS`, `sanitizeParams`, `defaultParams`; `openSource`, `countCameras` (Task 4); the element ids and `__app` from Task 5.
- Produces:
  - `createGestures(el, { onTap(u, v), onDrag(dxFraction), threshold = 8 }): void`
  - `formatValue(def, value): string`
  - `createPanel(container, { defs, params, onChange(key, value) }): { refresh(): void }`
  - `loadSettings(storage): Record<string, number>`, `saveSettings(storage, params): void`; storage key `diplopia.settings.v1`
  - `formatStatus({ phase, mode, depth }): string`, where `depth` is the status object from Task 7 or `null`
  - In `main.js`: `setMode(mode: 'whole' | 'depth')`, which Task 7 extends.

- [ ] **Step 1: Add the failing tests** to `tests/ui.test.js`

```js
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
```

- [ ] **Step 2: Run** `npm test`. Expected: the new tests fail on missing exports.

- [ ] **Step 3: Implement the five functions.**
  - `createGestures` uses `pointerdown`, `pointermove`, `pointerup`, `pointercancel` and pointer capture. Once total movement passes `threshold` pixels the gesture is a drag: every move reports the horizontal change since the previous pointer position, divided by the element's width (the first report covers everything since pointer-down).
  - `createPanel` builds one labelled `<input type="range">` per definition with a live value readout from `formatValue`. Rows for `depthOnly` definitions get the class `depth-only`. Moving `delayMin` above `delayMax` drags `delayMax` up with it, and the reverse. `refresh()` re-reads every value from `params`.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Wire into `js/main.js` and `styles.css`.**
  - Start from `loadSettings(localStorage)`. Every slider change writes into the shared `params` object and calls `saveSettings`.
  - `#reset` copies `defaultParams()` into `params`, saves, and calls `panel.refresh()`.
  - Gestures on `#view`: drag calls `model.push(dxFraction)` (right is apart, left is together, mirrored or not); tap calls `model.refocus()`.
  - `Space` calls `model.refocus()` and prevents scrolling, except when the event target is a button or an input.
  - `#settings-toggle` shows and hides `#panel` and keeps `aria-expanded` in step.
  - `setMode(mode)` sets `state.mode`, updates `aria-pressed` on both mode buttons, and toggles the class `depth-mode` on `<body>`. CSS hides `.depth-only` rows unless `body.depth-mode`.
  - `#status` shows `formatStatus(...)`, updated at most four times a second.
  - `#camera-switch`: hidden unless `countCameras()` is at least 2 and the source is a camera. It stops the current source and opens the other facing; if that fails, it reopens the previous one and shows the error message.

- [ ] **Step 6: Verify in a browser** at `?source=test`.
  1. Wait for the split, then drag right on the picture: the images move apart. Drag left: they come together, snap into one, and stay single until dragged apart again.
  2. Click the picture, then press Space after the next onset: each gives a blink and a single picture.
  3. Open settings. Move "Resting separation" and "Blur": the picture responds at once. The status line shows the phase.
  4. Reload: the slider values are kept. Press reset: they return to the defaults.
  5. Drag "Onset delay, min" above the max: the max follows.
  6. Click "Depth-aware": its button shows as pressed and the two depth sliders appear. Click "Whole-frame": they disappear.
  7. At a 375 x 812 viewport: the bar fits on one row, and the panel opens as a bottom sheet that scrolls.

- [ ] **Step 7: Commit.**

---

### Task 7: Depth pipeline and depth-aware mode

**Files:**
- Create: `js/depth.js`, `js/depth-worker.js`
- Modify: `js/main.js`
- Test: `tests/depth.test.js`

**Interfaces:**
- Consumes: `displayToSource`, `zoomFor` (Task 5); `setMode`, `formatStatus`, `showMessage` (Tasks 5 and 6).
- Produces:
  - `blendDepth(prev: Uint8Array | null, next: Uint8Array, alpha: number): Uint8Array`
  - `sampleDepth(data: Uint8Array, width, height, u, v): number`, 0..1, the mean of the 5 x 5 block around the point, clamped at the borders
  - `createDepth({ onStatus, createWorker, grab })` returning `{ start(), stop(), offer(element), setFixationPoint(u, v), get map(), get status() }`
    - `status = { state: 'idle' | 'loading' | 'ready' | 'error', percent, device, message, rate }`
    - `map` is `null` or the renderer's depth object `{ data, width, height, version, fixation }`
    - `createWorker` defaults to `() => new Worker(new URL('./depth-worker.js', import.meta.url), { type: 'module' })`
    - `grab(element)` defaults to drawing the element onto a reused 2D canvas 256 pixels wide (height from the source's aspect ratio) and returning `{ pixels: Uint8ClampedArray, width, height }`
  - Worker messages. To the worker: `{ type: 'load' }`, `{ type: 'frame', pixels, width, height }` (buffer transferred). From the worker: `{ type: 'progress', percent }`, `{ type: 'ready', device: 'webgpu' | 'wasm' }`, `{ type: 'error', message }`, `{ type: 'depth', data: Uint8Array, width, height }` (buffer transferred).

- [ ] **Step 1: Write the failing tests** in `tests/depth.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { blendDepth, sampleDepth, createDepth } from '../js/depth.js';

test('blendDepth mixes maps of the same size and replaces otherwise', () => {
  const next = Uint8Array.of(100, 200);
  assert.deepEqual([...blendDepth(Uint8Array.of(0, 100), next, 0.5)], [50, 150]);
  assert.equal(blendDepth(null, next, 0.5), next);
  assert.equal(blendDepth(Uint8Array.of(1, 2, 3), next, 0.5), next);
});

test('sampleDepth averages around the point and clamps at the borders', () => {
  const data = new Uint8Array(100).fill(0);            // 10 x 10
  for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) data[y * 10 + x] = 255;
  assert.equal(sampleDepth(data, 10, 10, 0.1, 0.5), 0);
  assert.equal(sampleDepth(data, 10, 10, 0.95, 0.05), 1);
  const edge = sampleDepth(data, 10, 10, 0.5, 0.5);
  assert.ok(edge > 0.2 && edge < 0.8);
});

const harness = () => {
  const sent = [];
  const worker = { postMessage: (m) => sent.push(m), terminate() {} };
  const depth = createDepth({
    onStatus() {}, createWorker: () => worker,
    grab: () => ({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 }),
  });
  const emit = (data) => worker.onmessage({ data });
  const result = (v) => emit({ type: 'depth', data: new Uint8Array(4).fill(v), width: 2, height: 2 });
  return { sent, depth, emit, result };
};

test('loads on start, sends one frame at a time, publishes results', () => {
  const { sent, depth, emit, result } = harness();
  depth.offer({}); assert.equal(sent.length, 0);                    // not started
  depth.start(); assert.deepEqual(sent[0], { type: 'load' });
  assert.equal(depth.status.state, 'loading');
  depth.offer({}); assert.equal(sent.length, 1);                    // not ready yet
  emit({ type: 'progress', percent: 40 }); assert.equal(depth.status.percent, 40);
  emit({ type: 'ready', device: 'wasm' });
  depth.offer({}); depth.offer({});
  assert.equal(sent.filter((m) => m.type === 'frame').length, 1);   // busy: no queue
  result(255);
  assert.deepEqual([depth.map.version, depth.map.fixation, depth.map.width], [1, 1, 2]);
  depth.offer({});
  assert.equal(sent.filter((m) => m.type === 'frame').length, 2);
});

test('a result that arrives after stop is dropped, and the mode can be re-entered', () => {
  const { sent, depth, emit, result } = harness();
  depth.start(); emit({ type: 'ready', device: 'wasm' });
  depth.offer({}); depth.stop(); result(255);
  assert.equal(depth.map, null);
  depth.start(); depth.offer({});
  assert.equal(sent.filter((m) => m.type === 'frame').length, 2);
  assert.equal(sent.filter((m) => m.type === 'load').length, 1);    // model is not reloaded
  result(0);
  assert.equal(depth.map.fixation, 0);
});

test('a worker failure becomes an error status', () => {
  const { depth, emit } = harness();
  depth.start(); emit({ type: 'error', message: 'offline' });
  assert.deepEqual([depth.status.state, depth.status.message], ['error', 'offline']);
  depth.offer({});
  assert.equal(depth.map, null);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, cannot find `js/depth.js`.

- [ ] **Step 3: Implement `js/depth.js`.**
  - `start()` marks the pipeline active; on first use it also creates the worker and posts `load`. `stop()` marks it inactive and clears `map` and the fixation value; the worker and the loaded model are kept.
  - `offer(element)` sends a frame only when active, ready and not waiting for a result.
  - On a `depth` message: clear the waiting flag; if inactive, drop the result. Otherwise `data = blendDepth(previous, incoming, 0.5)`, increase `version`, and update the fixation value toward `sampleDepth(data, …, fixU, fixV)` by 30% per map (the first map sets it directly).
  - `setFixationPoint(u, v)` stores the point (default `0.5, 0.5`) and, if a map exists, jumps the fixation value to the sample at that point.
  - `rate` is maps per second, smoothed.
  - The worker's own `onerror` (for example the CDN import failing) sets the `error` state with the message `Could not load the depth model. Check your connection.`
  - Call `onStatus(status)` on every status change.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Implement `js/depth-worker.js`.** First re-check the Transformers.js `depth-estimation` pipeline docs through Context7.
  - On `load`: `await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0')`, then `pipeline('depth-estimation', 'onnx-community/depth-anything-v2-small', { device, dtype, progress_callback })`.
  - Try `{ device: 'webgpu', dtype: 'fp16' }` when `navigator.gpu` exists; on any failure, or without WebGPU, use `{ device: 'wasm', dtype: 'q8' }`. Post `ready` with the device that worked, or `error` with the failure's message.
  - Forward progress only for files whose name ends in `.onnx`, as a whole-number percent.
  - On `frame`: `new RawImage(pixels, width, height, 4)`, run the pipeline, and post the returned `depth` image's `data`, `width`, `height`, transferring the buffer.
  - Use the pipeline's default input size. Tuning the model's input size is not part of this plan.

- [ ] **Step 6: Wire into `js/main.js`.**
  - Create the depth pipeline once, with `onStatus` refreshing the status line.
  - Extend `setMode`: `'depth'` calls `depth.start()`; `'whole'` calls `depth.stop()`.
  - Each frame in depth mode, call `depth.offer(source.element)`. The renderer gets `depth: d` and `mode: d ? 'depth' : 'whole'`, where `d = state.depthOverride ?? (state.mode === 'depth' ? depth.map : null)`.
  - When the status becomes `error`: call `setMode('whole')`, disable `#mode-depth`, set its `title` to `Depth-aware mode is unavailable: <message>`, and show the same sentence in the status line. Reloading the page is the way to retry.
  - While loading, `#mode-depth` has `aria-busy="true"` and the picture keeps rendering in whole-frame.
  - Tap: in depth mode, also call `depth.setFixationPoint` with `displayToSource(u, v, { zoom: zoomFor(params, 'depth'), mirror: source.mirrored })`.
  - Changing the camera or source size needs no special handling: a map of a different size replaces the old one.
  - Add `depth` to `window.__app`.

- [ ] **Step 7: Verify in a browser** at `?source=test`, with a network connection.
  1. Click "Depth-aware". The status line counts up a loading percentage, then shows `depth N/s (webgpu)` or `(wasm)` with N above zero. Whole-frame rendering continues while loading.
  2. `__app.depth.map` is an object whose `version` keeps increasing.
  3. Open `?source=test&debug=depth` and switch to "Depth-aware": a grey depth picture appears, the right way up, and updates.
  4. Switch to "Whole-frame" and back several times quickly: no console errors, and depth resumes without reloading the model.
  5. Reload and switch to "Depth-aware" again: the model comes from cache and is ready much faster.
  6. With the network disabled and the cache cleared (or after temporarily misspelling the CDN address), click "Depth-aware": the app returns to "Whole-frame", the button is disabled and its tooltip gives the reason.
  7. Record in the task notes: the device used and the measured depth rate.

- [ ] **Step 8: Commit.**

---

### Task 8: Saving: photo and video

**Files:**
- Create: `js/capture.js`
- Modify: `js/main.js`, `styles.css`
- Test: `tests/capture.test.js`

**Interfaces:**
- Consumes: the canvas `#view` and the buttons `#photo`, `#record`, `#record-time`, `#camera-switch` (Task 5).
- Produces:
  - `pickMimeType(isSupported: (type: string) => boolean): { mimeType, ext } | null`
  - `fileName(date: Date, ext: string): string`
  - `deliver(blob, name, env): Promise<'shared' | 'downloaded' | 'cancelled'>`, `env = { coarse: boolean, canShare(data): boolean, share(data): Promise<void>, download(blob, name): void }`
  - `browserEnv(): env`, the real implementation
  - `capturePhoto(canvas): Promise<Blob>` (JPEG, quality 0.92)
  - `canRecord(): boolean`
  - `createRecorder(canvas, { onStop(blob, ext), onTick(seconds), maxSeconds = 60 }): { start(), stop(), get recording() }`

- [ ] **Step 1: Write the failing tests** in `tests/capture.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMimeType, fileName, deliver } from '../js/capture.js';

test('pickMimeType prefers MP4, then WebM VP9, VP8, plain WebM', () => {
  assert.deepEqual(pickMimeType(() => true), { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' });
  assert.deepEqual(pickMimeType((t) => t === 'video/mp4'), { mimeType: 'video/mp4', ext: 'mp4' });
  assert.deepEqual(pickMimeType((t) => t.startsWith('video/webm')), { mimeType: 'video/webm;codecs=vp9', ext: 'webm' });
  assert.deepEqual(pickMimeType((t) => t === 'video/webm;codecs=vp8' || t === 'video/webm'), { mimeType: 'video/webm;codecs=vp8', ext: 'webm' });
  assert.equal(pickMimeType(() => false), null);
});

test('fileName uses local date and time', () => {
  assert.equal(fileName(new Date(2026, 9, 13, 9, 5, 7), 'jpg'), 'diplopia-20261013-090507.jpg');
});

const env = (over) => {
  const calls = [];
  return { calls, coarse: true, canShare: () => true, share: async () => { calls.push('share'); }, download: () => calls.push('download'), ...over };
};
const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' });
const blocked = Object.assign(new Error('no gesture'), { name: 'NotAllowedError' });
const blob = new Blob(['x'], { type: 'image/jpeg' });

test('deliver shares on touch devices that can share files', async () => {
  const e = env();
  assert.equal(await deliver(blob, 'a.jpg', e), 'shared');
  assert.deepEqual(e.calls, ['share']);
});

test('deliver downloads on desktop, or when sharing files is unsupported', async () => {
  for (const over of [{ coarse: false }, { canShare: () => false }]) {
    const e = env(over);
    assert.equal(await deliver(blob, 'a.jpg', e), 'downloaded');
    assert.deepEqual(e.calls, ['download']);
  }
});

test('a dismissed share sheet downloads nothing', async () => {
  const e = env({ share: async () => { throw abort; } });
  assert.equal(await deliver(blob, 'a.jpg', e), 'cancelled');
  assert.deepEqual(e.calls, []);
});

test('a share that fails for another reason falls back to download', async () => {
  const e = env({ share: async () => { throw blocked; } });
  assert.equal(await deliver(blob, 'a.jpg', e), 'downloaded');
  assert.deepEqual(e.calls, ['download']);
});
```

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, cannot find `js/capture.js`.

- [ ] **Step 3: Implement `pickMimeType`, `fileName`, `deliver`.** Candidate order: `video/mp4;codecs=avc1.42E01E`, `video/mp4`, `video/webm;codecs=vp9`, `video/webm;codecs=vp8`, `video/webm`. `deliver` shares `{ files: [new File([blob], name, { type: blob.type })] }`.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Implement the browser functions.**
  - `browserEnv()`: `coarse` from `matchMedia('(pointer: coarse)')`; `canShare`/`share` from `navigator` (absent means `canShare` is false); `download` uses a temporary `<a download>` with an object URL that is revoked afterwards.
  - `capturePhoto`: `canvas.toBlob(…, 'image/jpeg', 0.92)`, rejecting when the blob is null.
  - `canRecord`: `MediaRecorder` exists, `HTMLCanvasElement.prototype.captureStream` exists, and `pickMimeType(MediaRecorder.isTypeSupported)` is not null.
  - `createRecorder`: `canvas.captureStream(30)` and a `MediaRecorder` with the picked type. `onTick` fires four times a second with whole elapsed seconds. It stops itself at `maxSeconds`. On stop it stops the stream's tracks and calls `onStop` with one blob of the picked type and its extension.

- [ ] **Step 6: Wire into `js/main.js` and `styles.css`.**
  - `#photo` sets `state.pendingPhoto = true`. In the frame loop, immediately after `renderer.render`, if the flag is set: clear it, `capturePhoto`, then `deliver(blob, fileName(new Date(), 'jpg'), browserEnv())`.
  - `#record` toggles the recorder. While recording: `aria-pressed="true"`, the accent colour, `#record-time` shows `m:ss`, and `#camera-switch` is disabled. On stop, deliver the clip with `fileName(new Date(), ext)`.
  - Hide `#record` and `#record-time` when `canRecord()` is false.
  - Store `__app.lastSaved = { name, type, size, result }` after every delivery.

- [ ] **Step 7: Verify in a browser** at `?source=test`.
  1. Wait for the split, press the photo button. A file named `diplopia-<date>-<time>.jpg` downloads. Opened, it shows the same doubled picture at 1280 x 720. `__app.lastSaved.type` is `image/jpeg`.
  2. Press record, wait five seconds, drag the picture during it, press record again. The timer counted up; a clip downloads; played back, it shows the drift and the drag.
  3. Start a recording and leave it: it stops by itself at 1:00 and downloads.
  4. During recording the camera switch (if shown) is disabled.

- [ ] **Step 8: Commit.**

---

### Task 9: README and end-to-end check

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** with these sections:
  - What it is: two sentences.
  - Run: `npm start`, then open `http://localhost:8080`. Tests: `npm test`. Requires Node 20 or newer, and nothing to install.
  - Controls: drag, tap or Space, the bar buttons, the settings panel.
  - URL options: `?source=test`, `?source=<path to an image in this folder>`, `&debug=depth`.
  - On a phone: the page must be served over HTTPS. Option one: upload the folder to any static host (for example GitHub Pages). Option two: run `npm start` and expose port 8080 through an HTTPS tunnel.
  - Depth-aware mode: downloads a library and a model of tens of megabytes on first use; fastest with WebGPU; slow on phones without it.
  - Privacy: camera frames never leave the device.

- [ ] **Step 2: Run** `npm test`. Expected: every test passes, with no skipped tests.

- [ ] **Step 3: Full pass in a browser with a real camera** (the user's own machine). Tick each item of the spec's manual checks:
  1. Camera permission prompt appears; the live view shows, mirrored for a webcam.
  2. Onset, drift, fusion snap and refocus all look continuous: no jumps, no flicker at the fusion boundary.
  3. Both modes switch live. In depth-aware mode, tapping a near object and then a far one changes which of them is single.
  4. Photo and clip save and match the screen.
  5. Block the camera in the browser and reload: the "Camera access was blocked" message appears and its button retries.
  6. Switch to another tab for a minute and return: the effect carries on without a jump.
  7. On a phone, if one is set up over HTTPS: the rear camera is used, rotating the phone keeps the picture's proportions, and the share sheet opens for a photo.

- [ ] **Step 4: Tune with the user.** Ask the user to adjust the sliders until the effect feels natural, then copy their chosen values into the `value` column of `PARAM_DEFS` and into the expected defaults in `tests/params.test.js`. No other test depends on the defaults. Run `npm test`. Expected: all pass.

- [ ] **Step 5: Commit.**
