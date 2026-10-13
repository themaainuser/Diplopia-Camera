// Depth-map maths with no page or worker dependencies, so the depth worker and the tests can both use it.

const MIN_SIGMA = 0.3; // below this a Gaussian changes nothing worth the work
const SMOOTHING_FLOOR = 0.01;
const SMOOTHING_PER_STRENGTH = 0.4;

// How much to smooth a depth map, as a fraction of its width, for a given depth doubling strength.
//
// The depth map is used to push pixels sideways. Wherever it changes faster than the push can follow,
// the picture folds over itself and tears along the depth map's own coarse grid. The stronger the
// push, the gentler the depth map has to be, so the smoothing scales with the strength. The floor
// removes the model's fine ripples even when the push is small.
export function depthSmoothing(depthStrength) {
  return Math.max(SMOOTHING_FLOOR, SMOOTHING_PER_STRENGTH * depthStrength);
}

// Gaussian blur of a one-byte-per-pixel depth map. `sigma` is in depth-map pixels.
// Returns the input itself when sigma is too small to matter.
export function smoothDepth(data, width, height, sigma) {
  if (!(sigma >= MIN_SIGMA)) return data;

  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-0.5 * (i / sigma) ** 2);
    total += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;

  // Across, then down. Edges repeat the border value, so the map does not darken toward its sides.
  const across = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        sum += kernel[i + radius] * data[row + Math.min(width - 1, Math.max(0, x + i))];
      }
      across[row + x] = sum;
    }
  }

  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        sum += kernel[i + radius] * across[Math.min(height - 1, Math.max(0, y + i)) * width + x];
      }
      out[y * width + x] = Math.round(sum);
    }
  }
  return out;
}
