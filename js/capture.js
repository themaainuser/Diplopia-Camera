// Saving what is on the canvas: a still photo, or a recorded clip.

const VIDEO_TYPES = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mimeType: 'video/mp4', ext: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
  { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
  { mimeType: 'video/webm', ext: 'webm' },
];
const FRAME_RATE = 30;
const VIDEO_BITS_PER_SECOND = 8_000_000;
const TICK = 250; // milliseconds between elapsed-time updates

// The first recording format this browser supports, or null when it supports none.
export function pickMimeType(isSupported) {
  return VIDEO_TYPES.find(({ mimeType }) => isSupported(mimeType)) ?? null;
}

export function fileName(date, ext) {
  const two = (n) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `diplopia-${day}-${time}.${ext}`;
}

// Hands a finished file to the person: the share sheet on touch devices that can share files, a download elsewhere.
// A share sheet that is dismissed is a decision, not a failure, so nothing is downloaded behind it.
export async function deliver(blob, name, env) {
  const data = { files: [new File([blob], name, { type: blob.type })] };
  if (env.coarse && env.canShare(data)) {
    try {
      await env.share(data);
      return 'shared';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  env.download(blob, name);
  return 'downloaded';
}

// Delivers files and keeps the last one whose share sheet was dismissed, so a slip of the finger
// does not lose a recording: it can still be saved to the device.
export function createOutbox(env) {
  let kept = null;
  return {
    async send(blob, name) {
      kept = { blob, name };
      const result = await deliver(blob, name, env);
      if (result !== 'cancelled') kept = null;
      return result;
    },
    get pending() {
      return kept !== null;
    },
    saveToDevice() {
      if (!kept) return false;
      env.download(kept.blob, kept.name);
      kept = null;
      return true;
    },
    discard() {
      kept = null;
    },
  };
}

export function browserEnv() {
  return {
    coarse: window.matchMedia('(pointer: coarse)').matches,
    canShare: (data) => typeof navigator.canShare === 'function' && navigator.canShare(data),
    share: (data) => navigator.share(data),
    download(blob, name) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

// Call right after a render: a WebGL canvas only holds its picture until the browser presents it.
export function capturePhoto(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be read.'))),
      'image/jpeg',
      0.92,
    );
  });
}

export function canRecord() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickMimeType((type) => MediaRecorder.isTypeSupported(type)) !== null
  );
}

// Records the canvas as it is drawn, without sound. Stops by itself at `maxSeconds`.
export function createRecorder(canvas, { onStop, onTick, maxSeconds = 60 }) {
  let recorder = null;

  function start() {
    if (recorder) return;
    const picked = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
    const stream = canvas.captureStream(FRAME_RATE);
    const chunks = [];
    const startedAt = performance.now();
    recorder = new MediaRecorder(stream, { mimeType: picked.mimeType, videoBitsPerSecond: VIDEO_BITS_PER_SECOND });

    const timer = setInterval(() => {
      const seconds = Math.floor((performance.now() - startedAt) / 1000);
      onTick(seconds);
      if (seconds >= maxSeconds) stop();
    }, TICK);

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      recorder = null;
      onStop(new Blob(chunks, { type: picked.mimeType.split(';')[0] }), picked.ext);
    };
    recorder.onerror = stop;

    recorder.start();
    onTick(0);
  }

  function stop() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  return {
    start,
    stop,
    get recording() {
      return recorder !== null;
    },
  };
}
