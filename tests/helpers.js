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
