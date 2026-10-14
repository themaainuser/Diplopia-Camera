// The list of effects, and the settings they share: one flat object of numbers holding every
// effect's switch and sliders. Adding an effect means adding an entry here.

import { PARAM_DEFS as DIPLOPIA_DEFS } from './diplopia.js';
import { AFTERIMAGE_DEFS } from './afterimage.js';

export const EFFECTS = [
  { id: 'diplopia', label: 'Double vision', switchKey: 'diplopiaOn', defs: DIPLOPIA_DEFS },
  { id: 'afterimage', label: 'Afterimages', switchKey: 'afterimageOn', defs: AFTERIMAGE_DEFS },
];

// Each effect's on/off switch, stored as 0 or 1, followed by its sliders.
export const ALL_DEFS = EFFECTS.flatMap((effect) => [
  { key: effect.switchKey, label: effect.label, min: 0, max: 1, step: 1, value: 1, format: 'switch' },
  ...effect.defs,
]);

export function defaultParams() {
  return Object.fromEntries(ALL_DEFS.map((d) => [d.key, d.value]));
}

function sanitizeValue(def, v) {
  if (def.format === 'switch') return v === 0 || v === 1 ? v : def.value;
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(def.max, Math.max(def.min, v)) : def.value;
}

// Turns anything (saved settings, user input) into a complete, in-range parameter set.
// Settings saved before an effect existed simply gain its starting values.
export function sanitizeParams(raw) {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = Object.fromEntries(ALL_DEFS.map((d) => [d.key, sanitizeValue(d, src[d.key])]));
  out.delayMin = Math.min(out.delayMin, out.delayMax);
  return out;
}
