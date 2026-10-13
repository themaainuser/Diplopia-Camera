// Depth pipeline for depth-aware mode: owns the worker that runs the depth model,
// feeds it one small frame at a time, and smooths what comes back.

import { sourceSize } from './camera.js';

const INPUT_WIDTH = 256; // frames are shrunk to this width before inference
const BLEND = 0.5; // share of each new map mixed into the shown one, to calm flicker
const FIXATION_FOLLOW = 0.3; // how far the fixation depth moves toward its new value per map
const RATE_SMOOTHING = 0.2;
const LOAD_FAILED = 'the depth model could not be loaded. Check your connection.';

// Mixes a new depth map into the previous one. Maps of different sizes are not mixed.
export function blendDepth(prev, next, alpha) {
  if (!prev || prev.length !== next.length) return next;
  const out = new Uint8Array(next.length);
  for (let i = 0; i < next.length; i++) out[i] = Math.round(prev[i] + (next[i] - prev[i]) * alpha);
  return out;
}

// Depth (0..1, 1 = nearest) around a point, as the mean of a 5 x 5 block. v = 0 is the top row.
export function sampleDepth(data, width, height, u, v) {
  const cx = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
  const cy = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
  let sum = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const y = Math.min(height - 1, Math.max(0, cy + dy));
    for (let dx = -2; dx <= 2; dx++) {
      const x = Math.min(width - 1, Math.max(0, cx + dx));
      sum += data[y * width + x];
    }
  }
  return sum / (25 * 255);
}

function defaultWorker() {
  return new Worker(new URL('./depth-worker.js', import.meta.url), { type: 'module' });
}

// Shrinks the current frame and returns its RGBA pixels, reusing one small canvas.
function createGrabber() {
  let canvas = null;
  let ctx = null;
  return (element) => {
    const size = sourceSize(element);
    if (!size) return null;
    const width = INPUT_WIDTH;
    const height = Math.max(1, Math.round((INPUT_WIDTH * size.height) / size.width));
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    ctx.drawImage(element, 0, 0, width, height);
    return { pixels: ctx.getImageData(0, 0, width, height).data, width, height };
  };
}

export function createDepth({ onStatus = () => {}, createWorker = defaultWorker, grab = createGrabber() } = {}) {
  let worker = null;
  let active = false;
  let waiting = false; // a frame is with the worker; nothing else is sent until it answers
  let status = { state: 'idle', percent: 0, device: null, message: null, rate: 0 };
  let map = null;
  let version = 0;
  let fixU = 0.5;
  let fixV = 0.5;
  let lastMapTime = 0;

  function setStatus(patch) {
    status = { ...status, ...patch };
    onStatus(status);
  }

  function fail(message) {
    waiting = false;
    map = null;
    setStatus({ state: 'error', message });
  }

  function onDepth({ data, width, height }) {
    waiting = false;
    if (!active) return; // the mode was left while this frame was being worked on

    const sameSize = map && map.width === width && map.height === height;
    const blended = blendDepth(sameSize ? map.data : null, data, BLEND);
    const target = sampleDepth(blended, width, height, fixU, fixV);
    const fixation = map ? map.fixation + (target - map.fixation) * FIXATION_FOLLOW : target;
    version += 1;
    map = { data: blended, width, height, version, fixation };

    const now = performance.now();
    if (lastMapTime) {
      const instant = 1000 / Math.max(1, now - lastMapTime);
      setStatus({ rate: status.rate ? status.rate + (instant - status.rate) * RATE_SMOOTHING : instant });
    }
    lastMapTime = now;
  }

  function onMessage({ data: msg }) {
    if (msg.type === 'progress') setStatus({ percent: msg.percent });
    else if (msg.type === 'ready') setStatus({ state: 'ready', device: msg.device, percent: 100 });
    else if (msg.type === 'error') fail(msg.message);
    else if (msg.type === 'depth') onDepth(msg);
  }

  function start() {
    active = true;
    if (worker || status.state === 'error') return;
    try {
      worker = createWorker();
    } catch {
      fail(LOAD_FAILED);
      return;
    }
    worker.onmessage = onMessage;
    worker.onerror = () => fail(LOAD_FAILED);
    setStatus({ state: 'loading', percent: 0 });
    worker.postMessage({ type: 'load' });
  }

  // Leaves the worker and the loaded model in place, so coming back is instant.
  function stop() {
    active = false;
    map = null;
    lastMapTime = 0;
  }

  function offer(element) {
    if (!active || status.state !== 'ready' || waiting) return;
    let frame = null;
    try {
      frame = grab(element);
    } catch {
      // A frame that cannot be read (not decoded yet, or from another origin) is skipped.
    }
    if (!frame) return;
    waiting = true;
    worker.postMessage({ type: 'frame', pixels: frame.pixels, width: frame.width, height: frame.height }, [frame.pixels.buffer]);
  }

  function setFixationPoint(u, v) {
    fixU = Math.min(1, Math.max(0, u));
    fixV = Math.min(1, Math.max(0, v));
    if (map) map = { ...map, fixation: sampleDepth(map.data, map.width, map.height, fixU, fixV) };
  }

  return {
    start,
    stop,
    offer,
    setFixationPoint,
    get map() {
      return map;
    },
    get status() {
      return status;
    },
  };
}
