// Afterimages: the settings and the per-frame timing. The picture work happens on the GPU
// (js/passes/afterimage.js); this file decides how fast the memory builds and fades.

const MAX_STEP = 0.1; // longest time one frame may cover; a hidden tab resumes without a jump

export const AFTERIMAGE_DEFS = [
  { key: 'afterStrength', label: 'Strength', min: 0, max: 1, step: 0.01, value: 0.45, format: 'percent' },
  { key: 'afterBuild', label: 'Build time', min: 1, max: 15, step: 0.5, value: 4, format: 'seconds' },
  { key: 'afterFade', label: 'Fade time', min: 1, max: 30, step: 0.5, value: 6, format: 'seconds' },
  { key: 'afterSelectivity', label: 'Selectivity', min: 0, max: 1, step: 0.01, value: 0.5, format: 'percent' },
  { key: 'afterSteady', label: 'Steady fading', min: 0, max: 1, step: 0.01, value: 0.3, format: 'percent' },
];

// How far the memory moves toward its target this frame, when building and when fading.
export function afterimageRates(dt, params) {
  const step = dt > 0 ? Math.min(dt, MAX_STEP) : 0;
  return {
    build: 1 - Math.exp(-step / params.afterBuild),
    fade: 1 - Math.exp(-step / params.afterFade),
  };
}
