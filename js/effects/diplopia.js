// Physiological diplopia: the behaviour model.
// Pure logic. Distances are fractions of frame width, times are seconds.

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

export function defaultParams() {
  return Object.fromEntries(PARAM_DEFS.map((d) => [d.key, d.value]));
}

// Turns anything (saved settings, user input) into a complete, in-range parameter set.
export function sanitizeParams(raw) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const d of PARAM_DEFS) {
    const v = src[d.key];
    out[d.key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.value;
  }
  out.delayMin = Math.min(out.delayMin, out.delayMax);
  return out;
}
