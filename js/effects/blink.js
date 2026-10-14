// A blink: the eyes close quickly, stay shut for a moment, and open more slowly.
// Pure logic, shared by the double-vision refocus and the standalone blink on tap or Space.

const CLOSED_AT = 0.08;
const OPENS_AT = 0.14;
const MAX_STEP = 0.1; // longest time one update may cover; a hidden tab cannot freeze a blink shut

export const BLINK_DURATION = 0.3;

// Darkness, 0 (open) to 1 (closed), `t` seconds into a blink.
export function blinkCurve(t) {
  if (!(t > 0) || t >= BLINK_DURATION) return 0;
  if (t < CLOSED_AT) return t / CLOSED_AT;
  if (t < OPENS_AT) return 1;
  return Math.max(0, 1 - (t - OPENS_AT) / (BLINK_DURATION - OPENS_AT));
}

export function createBlink() {
  let elapsed = null; // seconds into the current blink, or null when the eyes are open

  return {
    // Starts a blink, unless one is already running.
    trigger() {
      if (elapsed === null) elapsed = 0;
    },
    update(dt) {
      if (elapsed === null) return 0;
      elapsed += dt > 0 ? Math.min(dt, MAX_STEP) : 0;
      if (elapsed >= BLINK_DURATION) {
        elapsed = null;
        return 0;
      }
      return blinkCurve(elapsed);
    },
    get active() {
      return elapsed !== null;
    },
  };
}
