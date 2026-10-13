// Runs the depth model off the main thread, so the picture never stutters.
// This is the only file in the app that loads code from the network.

const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const MODEL = 'onnx-community/depth-anything-v2-small';

let RawImage = null;
let estimator = null;

function reportProgress(info) {
  // Several small files download too; the model file is the one worth showing.
  if (info?.status !== 'progress' || typeof info.file !== 'string' || !info.file.endsWith('.onnx')) return;
  const percent = info.progress ?? (info.total ? (info.loaded / info.total) * 100 : 0);
  self.postMessage({ type: 'progress', percent: Math.round(percent) });
}

// Errors raised here are shown to the user, so they say what to do rather than what broke.
async function load() {
  let library;
  try {
    library = await import(LIBRARY);
  } catch (err) {
    console.warn('Depth library failed to load:', err);
    throw new Error('the depth library could not be downloaded. Check your connection.');
  }
  RawImage = library.RawImage;

  // WebGPU with the half-precision model when the browser has it, otherwise the smaller model on WASM.
  const attempts = [];
  if (self.navigator?.gpu) attempts.push({ device: 'webgpu', dtype: 'fp16' });
  attempts.push({ device: 'wasm', dtype: 'q8' });

  let lastError = null;
  for (const { device, dtype } of attempts) {
    try {
      const candidate = await library.pipeline('depth-estimation', MODEL, { device, dtype, progress_callback: reportProgress });
      // A first run here, so a device that loads the model but cannot run it falls through to the next one.
      await candidate(warmUpImage());
      estimator = candidate;
      self.postMessage({ type: 'ready', device });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  console.warn('Depth model failed to start:', lastError);
  throw new Error('the depth model could not be downloaded or started on this device.');
}

function warmUpImage() {
  const size = 64;
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) pixels.set([(i % size) * 4, Math.floor(i / size) * 4, 128, 255], i * 4);
  return new RawImage(pixels, size, size, 4);
}

async function estimate({ pixels, width, height }) {
  const image = new RawImage(pixels, width, height, 4);
  const { depth } = await estimator(image);
  // `depth` is a one-channel image scaled to 0..255, brighter meaning nearer.
  const data = depth.data instanceof Uint8Array ? depth.data : new Uint8Array(depth.data);
  self.postMessage({ type: 'depth', data, width: depth.width, height: depth.height }, [data.buffer]);
}

self.onmessage = async ({ data: msg }) => {
  try {
    if (msg.type === 'load') await load();
    else if (msg.type === 'frame') await estimate(msg);
  } catch (err) {
    if (msg.type === 'frame') {
      // The page skips a failed frame and only gives up after several in a row.
      console.warn('Depth estimation failed:', err);
      self.postMessage({ type: 'frame-error' });
    } else {
      self.postMessage({ type: 'error', message: err.message });
    }
  }
};
