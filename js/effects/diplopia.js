// Physiological diplopia: the behaviour model.
// Pure logic. Distances are fractions of frame width, times are seconds.

import { blinkCurve } from './blink.js';

export const MAX_SEPARATION = 0.2;
export const BREAKAWAY_RATIO = 1.5;

export const PARAM_DEFS = [
  { key: 'delayMin', label: 'Onset delay, min', min: 0.5, max: 20, step: 0.1, value: 2, format: 'seconds' },
  { key: 'delayMax', label: 'Onset delay, max', min: 0.5, max: 20, step: 0.1, value: 6, format: 'seconds' },
  { key: 'onsetDuration', label: 'Onset duration', min: 0.3, max: 5, step: 0.1, value: 1.5, format: 'seconds' },
  { key: 'restSeparation', label: 'Resting separation', min: 0, max: 0.12, step: 0.001, value: 0.035, format: 'percent' },
  { key: 'driftAmount', label: 'Drift amount', min: 0, max: 1, step: 0.01, value: 0.4, format: 'percent' },
  { key: 'driftSpeed', label: 'Drift speed', min: 0.2, max: 3, step: 0.1, value: 1, format: 'times' },
  { key: 'verticalMisalign', label: 'Vertical misalignment', min: 0, max: 0.01, step: 0.0005, value: 0.002, format: 'percent' },
  { key: 'blur', label: 'Blur', min: 0, max: 0.02, step: 0.0005, value: 0.006, format: 'percent' },
  { key: 'dominance', label: 'Eye dominance', min: 0.3, max: 0.7, step: 0.01, value: 0.55, format: 'ratio' },
  { key: 'fusionThreshold', label: 'Fusion threshold', min: 0, max: 0.02, step: 0.0005, value: 0.006, format: 'percent' },
  { key: 'depthStrength', label: 'Depth doubling', min: 0, max: 0.12, step: 0.001, value: 0.04, format: 'percent', depthOnly: true },
  { key: 'depthBlur', label: 'Depth blur', min: 0, max: 0.02, step: 0.0005, value: 0.006, format: 'percent', depthOnly: true },
];

const MAX_STEP = 0.1; // longest time one update may cover; a hidden tab resumes without a jump
const FOLLOW_RATE = 10; // how quickly the shown separation follows its target, per second
const TREMOR = 0.0003;
const BALANCE_WOBBLE = 0.05;
const BLUR_LEAD = 0.7; // blur completes in this fraction of the onset, so softening precedes the split
const REFOCUS_DURATION = 0.35;
const TAU = Math.PI * 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (u) => u * u * (3 - 2 * u);
// Passes 1 and comes back to it, so a value eased with it overshoots its target by about 10%.
const easeOutBack = (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;
const atRest = () => ({ separation: { x: 0, y: 0 }, blur: 0, balance: 0.5, blink: 0, relax: 0, phase: 'focused' });

// `params` is kept by reference and read on every update, so sliders act live.
// `random` is injected so tests can run a fixed seed.
export function createDiplopia({ params, random = Math.random }) {
  const p1 = random() * TAU;
  const p2 = random() * TAU;
  const p3 = random() * TAU;
  // Slow, irregular, repeatable wander in -1..1.
  const noise = (t) => (Math.sin(0.31 * t + p1) + 0.6 * Math.sin(0.73 * t + p2) + 0.3 * Math.sin(1.57 * t + p3)) / 1.9;
  const drawDelay = () => params.delayMin + random() * (params.delayMax - params.delayMin);

  let phase = 'focused';
  let delay = drawDelay();
  let tRelax = 0;
  let noiseT = 0;
  let userOffset = 0;
  let shownX = 0;
  let shownY = 0;
  let tRef = 0;
  let from = null; // the state a refocus started from
  let state = atRest();

  function relaxed(dt) {
    tRelax += dt;
    const relax = smoothstep(Math.min(1, tRelax / params.onsetDuration));
    const blurLevel = smoothstep(Math.min(1, tRelax / (params.onsetDuration * BLUR_LEAD)));
    noiseT += dt * params.driftSpeed;

    const base = params.restSeparation * (1 + params.driftAmount * noise(noiseT)) * relax;
    // Keep the push inside the limits, so dragging back responds at once instead of unwinding first.
    userOffset = clamp(userOffset, -base, MAX_SEPARATION - base);
    const free = base + userOffset;
    if (phase === 'relaxing' && tRelax >= params.onsetDuration) phase = 'drifting';

    // Close images merge, and need a larger gap to come apart again than they needed to merge.
    const threshold = params.fusionThreshold;
    if (phase === 'drifting' && threshold > 0 && free < threshold) phase = 'fused';
    else if (phase === 'fused' && (threshold === 0 || free > threshold * BREAKAWAY_RATIO)) phase = 'drifting';
    const fused = phase === 'fused';

    const k = 1 - Math.exp(-dt * FOLLOW_RATE);
    const targetY = params.verticalMisalign * relax * (0.6 + 0.4 * noise(noiseT * 0.7 + 100));
    shownX += ((fused ? 0 : free) - shownX) * k;
    shownY += ((fused ? 0 : targetY) - shownY) * k;

    const tremor = fused ? 0 : TREMOR * relax;
    return {
      separation: {
        x: clamp(shownX + tremor * noise(noiseT * 9 + 300), 0, MAX_SEPARATION),
        y: shownY + tremor * noise(noiseT * 9 + 400),
      },
      blur: params.blur * blurLevel,
      balance: clamp(params.dominance + BALANCE_WOBBLE * noise(noiseT * 0.5 + 200), 0, 1),
      blink: 0,
      relax,
      phase,
    };
  }

  // A blink, with the eyes pulling back to a single image behind it.
  function refocusing(dt) {
    tRef += dt;
    if (tRef >= REFOCUS_DURATION) {
      phase = 'focused';
      delay = drawDelay();
      return atRest();
    }
    const u = tRef / REFOCUS_DURATION;
    const left = 1 - easeOutBack(u);
    const blink = blinkCurve(tRef);
    return {
      separation: { x: from.separation.x * left, y: from.separation.y * left },
      blur: from.blur * (1 - u),
      balance: params.dominance,
      blink,
      relax: from.relax * (1 - u),
      phase,
    };
  }

  function update(dt) {
    dt = dt > 0 ? Math.min(dt, MAX_STEP) : 0;
    if (phase === 'refocusing') return (state = refocusing(dt));
    if (phase === 'focused') {
      delay -= dt;
      if (delay > 0) return (state = atRest());
      phase = 'relaxing';
      tRelax = 0;
      userOffset = 0;
      shownX = 0;
      shownY = 0;
      dt = 0;
    }
    return (state = relaxed(dt));
  }

  function push(delta) {
    if (phase === 'focused' || phase === 'refocusing' || !Number.isFinite(delta)) return;
    userOffset += delta;
  }

  function refocus() {
    if (phase === 'focused' || phase === 'refocusing') return;
    from = state;
    phase = 'refocusing';
    tRef = 0;
  }

  // Back to a single view at once, with a fresh wait before the eyes relax again.
  function reset() {
    phase = 'focused';
    delay = drawDelay();
    userOffset = 0;
    state = atRest();
  }

  return {
    update,
    push,
    refocus,
    reset,
    get state() {
      return state;
    },
  };
}
