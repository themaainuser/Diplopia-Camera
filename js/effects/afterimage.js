// Afterimages: the settings and the per-frame timing. The picture work happens on the GPU
// (js/passes/afterimage.js); this file decides how fast the memory builds and fades.

const MAX_STEP = 0.1; // longest time one frame may cover; a hidden tab resumes without a jump
const MIN_TICK = 1 / 60;
const MAX_TICK = 0.1;
const STEPS_PER_TIME = 60; // memory steps per build or fade time

export const AFTERIMAGE_DEFS = [
  { key: 'afterStrength', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.45, format: 'percent' },
  { key: 'afterBuild', label: 'Build time', min: 1, max: 15, step: 0.5, value: 4, format: 'seconds' },
  { key: 'afterFade', label: 'Fade time', min: 1, max: 30, step: 0.5, value: 6, format: 'seconds' },
  { key: 'afterSelectivity', label: 'Selectivity', min: 0, max: 1, step: 0.01, value: 0.5, format: 'percent' },
  { key: 'afterSteady', label: 'Steady fading', min: 0, max: 1, step: 0.01, value: 0.3, format: 'percent' },
];

function ratesFor(step, params) {
  return {
    build: 1 - Math.exp(-step / params.afterBuild),
    fade: 1 - Math.exp(-step / params.afterFade),
  };
}

// How far the memory moves toward its target over one time step, when building and when fading.
export function afterimageRates(dt, params) {
  return ratesFor(dt > 0 ? Math.min(dt, MAX_STEP) : 0, params);
}

// The memory lives in half-float, which cannot hold the tiny step a single frame makes on a fast
// screen: at 120 Hz those steps partly round away, so a ghost would stop fading (or fade too fast)
// and build less than on a 60 Hz screen. The clock gathers frame time and lets the memory move only
// once per tick, by the whole time gathered; between ticks the rates are 0 and the memory is copied
// unchanged. A tick is a sixtieth of the shorter of the build and fade times, so each step is large
// enough to survive rounding yet too small to see.
export function createMemoryClock() {
  let pending = 0;
  return {
    advance(dt, params) {
      pending += dt > 0 ? Math.min(dt, MAX_STEP) : 0;
      const shortest = Math.min(params.afterBuild, params.afterFade);
      const tick = Math.min(MAX_TICK, Math.max(MIN_TICK, shortest / STEPS_PER_TIME));
      if (pending + 1e-9 < tick) return { build: 0, fade: 0 };
      const rates = ratesFor(pending, params);
      pending = 0;
      return rates;
    },
  };
}
