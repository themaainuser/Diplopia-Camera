# Afterimages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add afterimages as a second effect that can run alone or together with double vision, each with its own switch, and make every tap or Space press blink.

**Architecture:** The renderer is split into passes run in order: the existing double-vision pass (which can now draw into a hidden buffer) and a new afterimage pass that keeps a screen-fixed half-float "memory", updates it each frame and subtracts it from the picture. A small list of effects drives settings and the panel. Timing logic (rates, blink) is pure JavaScript with unit tests.

**Tech Stack:** JavaScript ES modules, WebGL 2 with a WebGL 1 fallback, half-float render targets, Node 24 built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-13-afterimages-design.md` (builds on `2026-10-13-diplopia-camera-design.md`)

## Global Constraints

- Plain JavaScript, ES modules, static files, no framework, no build step, no npm dependencies.
- Colour values are display values from 0 to 1. Times are seconds. Any time step is clamped to 0.1 seconds.
- No module except `js/main.js` and `js/depth-worker.js` may touch `window`, `document` or `navigator` at import time.
- The renderer never reads the clock. Everything time-dependent arrives in the `render` call.
- Each pass binds the textures it reads when it draws. No pass relies on a binding left by another.
- The storage key stays `diplopia.settings.v1`.
- Effect names in UI copy: "Double vision" and "Afterimages".
- Tests: `npm test`. 61 tests pass before this plan; the suite stays green after every task.
- Work on the `afterimages` branch. Commit at the end of each task.
- Browser checks: the preview has no camera and its pane may be hidden, in which case animation frames do not fire. Drive `renderer.render` directly and read pixels by drawing the canvas onto a 2D canvas in the same task.

## Review Focus

1. **Settings saved before this change, or with junk in a switch**: the app starts with both effects on and every value in range. Pinned in Task 1.
2. **Tab hidden, then shown** (a frame gap of seconds to hours): the ghost neither jumps nor vanishes, and a blink does not freeze shut. Pinned in Tasks 1 and 2.
3. **Afterimages or double vision switched off and on while a ghost is showing**: no stale ghost returns, and double vision starts from a single view. Pinned in Tasks 2, 4 and 5.
4. **Picture size changes mid-ghost** (camera switch, phone rotation): the ghost is cleared, not stretched. Pinned in Task 4.
5. **A device that cannot render to half-float**: the Afterimages switch is disabled with a reason and everything else works. Pinned in Tasks 4 and 5.

## File Map

| File | Task | Change |
|---|---|---|
| `js/effects/afterimage.js` | 1 | New: slider definitions, per-frame rates |
| `js/effects/index.js` | 1 | New: effects list, `defaultParams`, `sanitizeParams` |
| `js/effects/blink.js` | 2 | New: blink curve and timer |
| `js/effects/diplopia.js` | 1, 2 | Loses `defaultParams`/`sanitizeParams`; uses the blink curve; gains `reset()` |
| `js/gl.js` | 3 | New: shared WebGL helpers |
| `js/passes/diplopia.js` | 3 | New: blur and composite, moved out of `renderer.js` |
| `js/renderer.js` | 3, 4 | Rewritten: context, frame upload, pass order, zoom |
| `js/passes/afterimage.js` | 4 | New: mean, memory update, final subtraction |
| `js/ui.js`, `js/main.js`, `styles.css` | 5 | Sectioned panel with switches, standalone blink, wiring |
| `README.md` | 6 | Document the effect |

---

### Task 1: Effects list, afterimage settings and rates

**Files:**
- Create: `js/effects/afterimage.js`, `js/effects/index.js`
- Modify: `js/effects/diplopia.js`, `js/ui.js`, `js/main.js`, `tests/params.test.js`, `tests/ui.test.js`
- Test: `tests/params.test.js`, `tests/afterimage.test.js`

**Interfaces:**
- Produces:
  - `js/effects/afterimage.js`: `AFTERIMAGE_DEFS`, `afterimageRates(dt: number, params): { build: number, fade: number }`
  - `js/effects/index.js`: `EFFECTS: Array<{ id, label, switchKey, defs }>`, `ALL_DEFS`, `defaultParams()`, `sanitizeParams(raw)`
  - `js/effects/diplopia.js` keeps `PARAM_DEFS`, `MAX_SEPARATION`, `BREAKAWAY_RATIO`, `createDiplopia`; it no longer exports `defaultParams` or `sanitizeParams`.

`EFFECTS`, in order: `{ id: 'diplopia', label: 'Double vision', switchKey: 'diplopiaOn', defs: PARAM_DEFS }`, `{ id: 'afterimage', label: 'Afterimages', switchKey: 'afterimageOn', defs: AFTERIMAGE_DEFS }`.

`ALL_DEFS` is, for each effect, its switch definition `{ key: switchKey, label, min: 0, max: 1, step: 1, value: 1, format: 'switch' }` followed by its `defs`.

`AFTERIMAGE_DEFS`:

| key | label | min | max | step | value | format |
|---|---|---|---|---|---|---|
| `afterStrength` | Strength | 0 | 1 | 0.01 | 0.45 | percent |
| `afterBuild` | Build time | 1 | 15 | 0.5 | 4 | seconds |
| `afterFade` | Fade time | 1 | 30 | 0.5 | 6 | seconds |
| `afterSelectivity` | Selectivity | 0 | 1 | 0.01 | 0.5 | percent |
| `afterSteady` | Steady fading | 0 | 1 | 0.01 | 0.3 | percent |

- [ ] **Step 1: Replace `tests/params.test.js` and add `tests/afterimage.test.js`**

`tests/params.test.js`:

```js
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
```

`tests/afterimage.test.js`:

```js
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
```

In `tests/ui.test.js`, change the import of `defaultParams` to come from `'../js/effects/index.js'` (keep `PARAM_DEFS` from `diplopia.js`).

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, cannot find `js/effects/index.js` and `js/effects/afterimage.js`.

- [ ] **Step 3: Implement.**
  - `afterimageRates`: clamp `dt` to `[0, 0.1]` (not-a-number counts as 0); `build = 1 - exp(-dt / afterBuild)`, `fade = 1 - exp(-dt / afterFade)`.
  - Move `defaultParams` and `sanitizeParams` from `diplopia.js` to `index.js`, working over `ALL_DEFS`. A definition with `format: 'switch'` accepts only the numbers 0 and 1. Keep the rule `delayMin = min(delayMin, delayMax)`.
  - `js/ui.js` imports `sanitizeParams` from `./effects/index.js`.
  - `js/main.js` imports `defaultParams` and `EFFECTS` from `./effects/index.js`, and passes `defs: EFFECTS[0].defs` to the existing `createPanel` call. The panel itself changes in Task 5.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit.**

---

### Task 2: Blink timer and model reset

**Files:**
- Create: `js/effects/blink.js`
- Modify: `js/effects/diplopia.js`
- Test: `tests/blink.test.js`, `tests/diplopia-steer.test.js`

**Interfaces:**
- Produces:
  - `blinkCurve(t: number): number`, darkness 0..1 at `t` seconds into a blink: rises linearly to 1 at 0.08, holds until 0.14, falls linearly to 0 at 0.30, and is 0 outside `[0, 0.30]`.
  - `BLINK_DURATION = 0.3`
  - `createBlink(): { trigger(): void, update(dt: number): number, get active(): boolean }`
  - The model from `createDiplopia` gains `reset(): void`.

- [ ] **Step 1: Write the failing tests**

`tests/blink.test.js`:

```js
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
```

Add to `tests/diplopia-steer.test.js`:

```js
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
```

- [ ] **Step 2: Run** `npm test`. Expected: `tests/blink.test.js` fails on the missing module and `reset` is not a function.

- [ ] **Step 3: Implement.**
  - `createBlink`: `trigger()` does nothing while a blink is running. `update(dt)` clamps `dt` to `[0, 0.1]`, advances, returns `blinkCurve(elapsed)`, and goes idle once `elapsed >= BLINK_DURATION`.
  - `diplopia.js`: replace the inline blink expression in the refocus phase with `blinkCurve(tRef)` and delete the three blink constants. `reset()` sets the phase to `focused`, draws a new delay, clears the push, and sets the state to the at-rest state.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Commit.**

---

### Task 3: Split the renderer into passes

No behaviour changes in this task except the shape of the `render` call.

**Files:**
- Create: `js/gl.js`, `js/passes/diplopia.js`
- Modify: `js/renderer.js` (rewritten), `js/main.js`
- Test: `tests/renderer.test.js` (unchanged, must keep passing)

**Interfaces:**
- Produces:
  - `js/gl.js`:
    - `createContext(canvas): { gl, gl2: boolean, headers } | null` (WebGL 2 first, then WebGL 1; options `{ alpha: false, antialias: false }`)
    - `makeProgram(ctx, fragmentSource, uniformNames): { program, uniforms }` (prefixes the dialect header; attribute 0 is `a_pos`)
    - `makeTarget(ctx, width, height, { halfFloat = false } = {}): { texture, framebuffer, width, height } | null` (null when the framebuffer is incomplete)
    - `deleteTarget(ctx, target)`
    - `bindInputs(ctx, program, inputs: Record<uniformName, WebGLTexture>)`: binds each texture to units 0, 1, 2… in order and sets the sampler uniforms
    - `drawTo(ctx, target | null, width, height)`: binds the framebuffer (null is the screen), sets the viewport, draws the quad
    - `setUpQuad(ctx)`
  - `js/passes/diplopia.js`:
    - `zoomFor`, `blurScale`, `displayToSource` (moved unchanged)
    - `createDiplopiaPass(ctx): { scaleFor(desc, width): number, draw(videoTexture, desc, output): void }`
    - `desc = { frame, params, mode, depth, mirror, blink, showDepth, zoom, width, height }`; `output` is a target or `null` for the screen
  - `js/renderer.js`:
    - re-exports `zoomFor`, `blurScale`, `displayToSource`
    - `createRenderer(canvas): { resize(width, height), render(element, description), get zoom(), get supportsAfterimage() }`
    - `description = { mirror, blink = 0, showDepth = false, diplopia = null, afterimage = null }`
    - `diplopia` is `null` (the plain picture) or `{ frame, params, mode, depth }`
    - In this task `supportsAfterimage` is `false` and `afterimage` is ignored.

- [ ] **Step 1: Record the baseline.** Start the preview, open `http://localhost:8080/?source=test`, and run this against the current code. Save the printed JSON; it is the expected output for Step 4.

```js
const a = window.__app, el = a.state.source.element, v = document.querySelector('#view');
a.renderer.resize(1280, 720);
const P = { delayMin: 2, delayMax: 6, onsetDuration: 1.5, restSeparation: 0.035, driftAmount: 0.4, driftSpeed: 1,
  verticalMisalign: 0.002, blur: 0.006, dominance: 0.55, fusionThreshold: 0.006, depthStrength: 0.04, depthBlur: 0.006 };
const drifting = { separation: { x: 0.04, y: 0.001 }, blur: 0.006, balance: 0.56, blink: 0, relax: 1, phase: 'drifting' };
const rest = { separation: { x: 0, y: 0 }, blur: 0, balance: 0.5, blink: 0, relax: 0, phase: 'focused' };
const d = new Uint8Array(16 * 9); for (let y = 0; y < 9; y++) d.fill(255 - y * 31, y * 16, y * 16 + 16);
const depth = { data: d, width: 16, height: 9, version: 1, fixation: 0.5 };
const probe = () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const k = c.getContext('2d'); k.drawImage(v, 0, 0); const px = k.getImageData(0, 0, 1280, 720).data;
  let sum = 0; for (let i = 0; i < px.length; i += 4 * 97) sum += px[i] + px[i + 1] + px[i + 2];
  return [sum, ...[[640, 340], [200, 173], [973, 547], [100, 60]].flatMap(([x, y]) => [...px.slice((y * 1280 + x) * 4, (y * 1280 + x) * 4 + 3)])]; };
const run = (frame, mode, dep, mirror) => { for (let i = 0; i < 80; i++) window.__draw(frame, mode, dep, mirror); return probe(); };
window.__draw = (frame, mode, dep, mirror) => a.renderer.render(el, frame, { params: P, mode, mirror, depth: dep, showDepth: false });
JSON.stringify({ rest: run(rest, 'whole', null, false), drifting: run(drifting, 'whole', null, false),
  mirrored: run(drifting, 'whole', null, true), depth: run(drifting, 'depth', depth, false),
  blink: run({ ...drifting, blink: 0.5 }, 'whole', null, false) });
```

- [ ] **Step 2: Move the code.**
  - `js/gl.js` takes the dialect `HEADERS`, the `VERTEX` shader, shader compile and link, texture and target creation. Half-float targets use `RGBA16F` / `HALF_FLOAT` on WebGL 2 (after `getExtension('EXT_color_buffer_float') || getExtension('EXT_color_buffer_half_float')`) and `RGBA` / `HALF_FLOAT_OES` on WebGL 1 (needing `OES_texture_half_float`, `OES_texture_half_float_linear` and `EXT_color_buffer_half_float`). `makeTarget` returns `null` when a needed extension is missing or `checkFramebufferStatus` is not complete.
  - `js/passes/diplopia.js` takes the blur and composite shaders, the reduced-size blur targets, the depth texture and its upload-on-change, `blurInto`, and the composite draw. It reads `desc.blink` where the composite used `frame.blink`. Texture inputs go through `bindInputs` at every draw.
  - `js/renderer.js` keeps: context creation, the lost and restored handlers (which rebuild the passes), the video texture and its per-frame upload (mipmapped when WebGL 2 and `pass.scaleFor(...) > 2`), zoom easing, and `render`.
  - For `diplopia: null`, the renderer draws with the at-rest frame and parameters whose `blur`, `depthBlur`, `depthStrength`, `restSeparation` and `driftAmount` are all 0, so the zoom target is exactly 1.

- [ ] **Step 3: Update `js/main.js`** to the new call: `renderer.render(source.element, { mirror: source.mirrored, blink: frameState.blink, showDepth, diplopia: { frame: frameState, params, mode, depth: depthMap } })`.

- [ ] **Step 4: Verify.** Run `npm test` (all pass). Reload the preview and run the Step 1 script with this replacement for `window.__draw`:

```js
window.__draw = (frame, mode, dep, mirror) => a.renderer.render(el, { mirror, blink: frame.blink, diplopia: { frame, params: P, mode, depth: dep } });
```

Expected: the same JSON as Step 1, with every number within 1 of its baseline (sums within 0.01%). Then also check:

```js
for (let i = 0; i < 80; i++) a.renderer.render(el, { mirror: false });
[a.renderer.zoom, a.renderer.supportsAfterimage]   // expected: [a value within 0.001 of 1, false]
```

- [ ] **Step 5: Commit.**

---

### Task 4: Afterimage pass

**Files:**
- Create: `js/passes/afterimage.js`
- Modify: `js/renderer.js`

**Interfaces:**
- Consumes: `createContext`, `makeProgram`, `makeTarget`, `deleteTarget`, `bindInputs`, `drawTo` (Task 3); `afterimageRates` (Task 1) in the checks.
- Produces:
  - `createAfterimagePass(ctx): { supported: boolean, draw(scene, settings, width, height): void, clear(): void }`
  - `scene` is a full-size target holding the picture so far. `settings = { strength, steady, selectivity, build, fade, blink }`.
  - `renderer.supportsAfterimage` now reports the pass's `supported`.
  - `description.afterimage` is `null` or `{ strength, steady, selectivity, build, fade }`.

- [ ] **Step 1: Implement the pass.**

Buffers: `mean32` (32 x 32, 8-bit), `mean1` (1 x 1, 8-bit), and two half-float memory buffers of `ceil(width / 8)` x `ceil(height / 8)` that swap each frame. `supported` is whether a half-float target can be made (try one 4 x 4 at creation). The memory buffers are rebuilt, empty, whenever the size differs from the last draw. `clear()` empties both.

Four draws per frame:

1. `scene` to `mean32`: one sample per pixel.
2. `mean32` to `mean1`: the average of a 16 x 16 grid of samples taken at texel corners.
3. Memory update, from `scene`, `mean1` and the previous memory, into the other memory buffer:

```
s      = average of a 4 x 4 grid of scene samples spaced 2 scene pixels apart, centred on this cell
m      = mean1
d      = s - m
t      = 0.5 * selectivity
factor = smoothstep(0.5 * t, 1.5 * t + 0.02, length(d))
T      = d * factor
rate   = dot(T, T) > dot(E, E) ? build * (1 - blink) : fade
E      = E + (T - E) * rate
change = dot(E, E) > 1e-6 ? clamp(1 - dot(T, E) / dot(E, E), 0, 1) : 1
output = vec4(E, change)
```

4. Final, from `scene` and the new memory, to the screen. The memory is read with B-spline bicubic interpolation (four bilinear samples):

```
shown = clamp(scene - strength * E * mix(steady, 1, change), 0, 1)
```

- [ ] **Step 2: Wire it into `js/renderer.js`.**
  - The renderer owns a full-size 8-bit `scene` target, rebuilt when the canvas size changes.
  - If `description.afterimage` is set, the pass is supported and `showDepth` is false: draw the double-vision pass into `scene`, then call `afterimage.draw(scene, { ...description.afterimage, blink }, width, height)`.
  - Otherwise draw the double-vision pass to the screen, and if afterimages were drawn on the previous frame, call `afterimage.clear()`.
  - The context-restored handler rebuilds the pass, which starts empty.

- [ ] **Step 3: Verify in the preview** at `?source=test`. Run this helper first:

```js
const a = window.__app, v = document.querySelector('#view');
const { afterimageRates } = await import('/js/effects/afterimage.js');
a.renderer.resize(1280, 720);
const scene = (draw) => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
  const k = c.getContext('2d'); k.fillStyle = 'rgb(128,128,128)'; k.fillRect(0, 0, 1280, 720); draw?.(k); return c; };
const grey = scene();
const white = scene((k) => { k.fillStyle = '#fff'; k.fillRect(300, 200, 200, 200); });
const red = scene((k) => { k.fillStyle = '#f00'; k.fillRect(300, 200, 200, 200); });
const texture = scene((k) => { for (let y = 0; y < 720; y += 16) for (let x = 0; x < 1280; x += 16) { k.fillStyle = (x + y) % 32 ? 'rgb(140,140,140)' : 'rgb(116,116,116)'; k.fillRect(x, y, 16, 16); } });
const S = { strength: 0.45, steady: 0.3, selectivity: 0.5 };
const show = (src, seconds, extra = {}) => { for (let t = 0; t < seconds; t += 1 / 30) a.renderer.render(src, { mirror: false, afterimage: { ...S, ...afterimageRates(1 / 30, { afterBuild: 4, afterFade: 6 }) }, ...extra }); };
const at = (x, y) => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const k = c.getContext('2d'); k.drawImage(v, 0, 0); return [...k.getImageData(x, y, 1, 1).data.slice(0, 3)]; };
window.__ai = { grey, white, red, texture, show, at, S };
a.renderer.supportsAfterimage
```

Expected: `true`. Then each check, with `const { grey, white, red, texture, show, at } = window.__ai;`. "Centre" is `at(400, 300)`, "away" is `at(900, 550)`. Allow ±4 on every number.

| Check | Run | Expected |
|---|---|---|
| Steady dimming | `show(grey, 1); show(white, 12)` | centre `[239, 239, 239]`, away `[128, 128, 128]` |
| Dark ghost | then `show(grey, 1 / 30)` | centre `[76, 76, 76]`, away `[128, 128, 128]` |
| Fades | then `show(grey, 6)` | centre `[109, 109, 109]` |
| Gone | then `show(grey, 30)` | centre `[128, 128, 128]` (±1) |
| Colour | `show(red, 12); show(grey, 1 / 30)` | centre about `[76, 180, 180]`: red below grey, green and blue above |
| Selective | `show(grey, 40); show(texture, 12); show(grey, 1 / 30)` | centre and away both `[128, 128, 128]` (±2) |
| Soft edge | `show(grey, 40); show(white, 12); show(grey, 1 / 30)` then `at(292, 300)`, `at(300, 300)`, `at(308, 300)` | about `124`, `102`, `81`: each between 76 and 128, and strictly darker going into the square |
| Switching off clears | then `a.renderer.render(grey, { mirror: false }); show(grey, 1 / 30)` | centre `[128, 128, 128]` (±1) |
| Size change clears | `show(white, 12); a.renderer.resize(640, 360); show(grey, 1 / 30)` then `a.renderer.resize(1280, 720)` | pixel `(200, 150)` of the 640-wide picture is `[128, 128, 128]` (±1) |
| Blink does not build | `show(grey, 40); show(white, 12, { blink: 1 }); show(grey, 1 / 30)` | centre `[128, 128, 128]` (±2) |
| Off is unchanged | Task 3 Step 4 script | the Task 3 baseline numbers |
| Both effects | `show(grey, 40)`, then `const dv = { diplopia: { frame: drifting, params: P, mode: 'whole', depth: null } }` (the `drifting` frame and `P` from Task 3 Step 1), `show(white, 12, dv); show(grey, 1 / 30, dv)` | no console errors; centre at least 30 levels darker than away; away `[128, 128, 128]` (±2) |

- [ ] **Step 4: Verify the unsupported and context-loss paths.**

```js
const { createRenderer } = await import('/js/renderer.js');
const c = document.createElement('canvas'); const real = c.getContext.bind(c);
c.getContext = (type, opts) => { const gl = real(type, opts); if (gl) { const ext = gl.getExtension.bind(gl);
  gl.getExtension = (name) => /float/i.test(name) ? null : ext(name); } return gl; };
const r = createRenderer(c); r.resize(1280, 720);
r.render(window.__ai.grey, { mirror: false, afterimage: { strength: 0.45, steady: 0.3, selectivity: 0.5, build: 0.1, fade: 0.1 } });
[r.supportsAfterimage, c.getContext('webgl2')?.getError() ?? c.getContext('webgl').getError()]   // expected: [false, 0]
```

Then on the main canvas: `show(white, 12)`, lose and restore the context through `WEBGL_lose_context` (wait for `webglcontextrestored`), `show(grey, 1 / 30)`. Expected: centre `[128, 128, 128]` (±1) and no console errors.

- [ ] **Step 5: Run** `npm test`. Expected: all pass.

- [ ] **Step 6: Commit.**

---

### Task 5: Switches, sectioned panel and standalone blink

**Files:**
- Modify: `js/ui.js`, `js/main.js`, `styles.css`, `tests/ui.test.js`

**Interfaces:**
- Consumes: `EFFECTS`, `defaultParams` (Task 1); `afterimageRates` (Task 1); `createBlink`, model `reset()` (Task 2); the new `render` description and `supportsAfterimage` (Tasks 3, 4).
- Produces:
  - `createPanel(container, { effects, params, onChange(key, value), unavailable = {} }): { refresh(): void }`. `unavailable` maps an effect id to the reason it cannot be used.
  - `formatStatus({ phase, mode, depth, doubleVision = true }): string`

- [ ] **Step 1: Add the failing test** to `tests/ui.test.js`

```js
test('formatStatus says so when double vision is off', () => {
  assert.equal(formatStatus({ phase: undefined, mode: 'depth', depth: { state: 'ready', rate: 12, device: 'webgpu' }, doubleVision: false }), 'double vision off');
  assert.equal(formatStatus({ phase: 'drifting', mode: 'whole', depth: null, doubleVision: true }), 'drifting');
});
```

- [ ] **Step 2: Run** `npm test`. Expected: the new test fails (it returns `undefined`).

- [ ] **Step 3: Implement in `js/ui.js`.**
  - `formatStatus` returns `'double vision off'` when `doubleVision` is false.
  - `createPanel` builds one `<section class="effect">` per effect:
    - a heading row holding a checkbox with id `switch-<effect id>` and a label with the effect's name;
    - a `<p class="reason">` with `unavailable[id]` when present, in which case the checkbox is disabled and unchecked;
    - a `<div class="rows">` with the slider rows built as today.
  - The section has the class `off` when its switch is off or it is unavailable. Toggling the checkbox writes 1 or 0 to `params[switchKey]`, updates the class and calls `onChange(switchKey, value)`.
  - `refresh()` also re-reads the switches.

- [ ] **Step 4: Run** `npm test`. Expected: all pass.

- [ ] **Step 5: Wire `js/main.js` and `styles.css`.**
  - Build the panel with `effects: EFFECTS` and, when `renderer.supportsAfterimage` is false, `unavailable: { afterimage: "This device's graphics cannot keep the slow memory this effect needs." }`.
  - `doubleVisionOn()` is `params.diplopiaOn === 1`. `afterimagesOn()` is `params.afterimageOn === 1 && renderer.supportsAfterimage`.
  - `applyDoubleVision()`, called at start, when the `diplopiaOn` switch changes and after reset: the two mode buttons are disabled when double vision is off (and `#mode-depth` stays disabled after a depth failure). When off, call `model.reset()` and `depth.stop()`. When on and the selected mode is depth-aware, call `depth.start()`.
  - Create one `createBlink()`. Tap and Space call `blink.trigger()`, and `model.refocus()` only when double vision is on. A tap in depth-aware mode still sets the fixation point when double vision is on. Dragging calls `model.push` only when double vision is on.
  - Frame loop:
    - `frameState = doubleVisionOn() ? model.update(dt) : null`
    - `darkness = max(blink.update(dt), frameState ? frameState.blink : 0)`
    - depth frames are offered, and a depth map used, only when double vision is on
    - `renderer.render(source.element, { mirror, blink: darkness, showDepth, diplopia: frameState ? { frame: frameState, params, mode, depth: depthMap } : null, afterimage: afterimagesOn() ? { strength: params.afterStrength, steady: params.afterSteady, selectivity: params.afterSelectivity, ...afterimageRates(dt, params) } : null })`
    - the status line passes `doubleVision: doubleVisionOn()`
  - Reset restores every value and both switches, refreshes the panel and calls `applyDoubleVision()`.
  - `styles.css`: sections separated by a thin line; the heading row at least 44px tall with the checkbox on the right; `.effect.off .rows { display: none; }`; `.reason` in the muted colour at 13px.

- [ ] **Step 6: Verify in the preview** at `?source=test`. Where animation frames are not firing, dispatch the events and step by hand as in earlier checks.
  1. The panel shows two sections, "Double vision" and "Afterimages", each with a checked switch and its sliders (12 and 5 rows; the two depth rows hidden outside depth-aware mode).
  2. Unchecking "Double vision": its sliders hide, both mode buttons are disabled, the status line reads `double vision off`, and after a few frames `__app.renderer.zoom` is within 0.001 of 1. Checking it again: the model's phase is `focused` and the buttons are enabled.
  3. Unchecking "Afterimages" hides its sliders. Reload: both switch states are kept. "Reset to defaults" turns both back on.
  4. With double vision off, pressing Space gives a blink: `__app` frames show the picture going dark and back within 0.3 s (read the centre pixel during it).
  5. With double vision on and the view drifting, Space blinks and the phase becomes `refocusing` then `focused`.
  6. Moving the "Strength" slider to 0 makes a built-up ghost disappear on the next frame; moving it back shows it again.
  7. At 375 x 812 the panel still scrolls and each switch row is at least 44px tall.
  8. The unavailable state, checked on a detached panel because the preview supports the effect:

```js
const { createPanel } = await import('/js/ui.js'); const { EFFECTS, defaultParams } = await import('/js/effects/index.js');
const box = document.createElement('div');
createPanel(box, { effects: EFFECTS, params: defaultParams(), onChange() {}, unavailable: { afterimage: 'No half-float support.' } });
const s = box.querySelectorAll('.effect')[1], c = s.querySelector('#switch-afterimage');
[c.disabled, c.checked, s.classList.contains('off'), s.querySelector('.reason').textContent]
// expected: [true, false, true, 'No half-float support.']
```

  9. No console errors throughout.

- [ ] **Step 7: Commit.**

---

### Task 6: README and end-to-end check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update `README.md`.**
  - Opening: the app now has two effects.
  - Controls table: "Tap the picture, or press Space" always blinks, and also refocuses double vision.
  - Settings: describe the two sections and their switches; add the five afterimage sliders with one line each.
  - A short "Afterimages" section: what to do to see one (hold the camera on a lamp, a window or something strongly coloured for a few seconds, then pan to a plain wall), that the ghost stays fixed on the screen, and that it needs half-float graphics support.
  - Layout table: add `js/gl.js`, `js/passes/`, `js/effects/index.js`, `js/effects/afterimage.js`, `js/effects/blink.js`.

- [ ] **Step 2: Run** `npm test`. Expected: every test passes, none skipped.

- [ ] **Step 3: Hand over the real-camera pass** to the user, with these checks:
  1. Hold the camera on a bright window or lamp for about five seconds, then pan to a plain wall: a dark soft patch stays where the light was and fades over a few seconds.
  2. The same with a strongly coloured object: the ghost has the opposite colour.
  3. Ordinary scenes and normal movement leave no obvious trails.
  4. Each switch works alone, and both effects work together.
  5. Tap or Space blinks in every combination.
  6. A photo and a clip include the ghost.

- [ ] **Step 4: Commit.**
