// Picture sources: the live camera, a generated test pattern, or an image file.

// `?source=test` is the test pattern, `?source=<relative path>` an image in the project folder.
// Anything that could point at another site falls back to the camera.
export function parseSource(search) {
  const value = new URLSearchParams(search).get('source');
  if (!value) return { kind: 'camera' };
  if (value === 'test') return { kind: 'test' };
  if (value.includes(':') || value.startsWith('/') || value.startsWith('\\')) return { kind: 'camera' };
  return { kind: 'image', path: value };
}

export function describeCameraError(err, { secure }) {
  if (!secure) {
    return { title: 'The camera needs a secure address', detail: 'Open this page on localhost or over HTTPS.', action: null };
  }
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        title: 'Camera access was blocked',
        detail: "Allow the camera for this site in your browser's address bar, then try again.",
        action: 'retry',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { title: 'No camera found', detail: 'You can still try the effect with the test picture.', action: 'test' };
    case 'NotReadableError':
    case 'AbortError':
      return {
        title: 'The camera is busy',
        detail: 'Close other apps that are using the camera, then try again.',
        action: 'retry',
      };
    default:
      return { title: 'The camera could not start', detail: err?.message || 'Unknown error.', action: 'retry' };
  }
}

// Pixel size of a video, image or canvas, or null while it has none (a camera that has not delivered a frame yet).
export function sourceSize(element) {
  if (!element) return null;
  let width;
  let height;
  if ('videoWidth' in element) [width, height] = [element.videoWidth, element.videoHeight];
  else if ('naturalWidth' in element) [width, height] = [element.naturalWidth, element.naturalHeight];
  else [width, height] = [element.width, element.height];
  return width > 0 && height > 0 ? { width, height } : null;
}

// A still scene with plenty of hard edges, which is where doubling and blur show.
export function createTestPattern(width = 1280, height = 720) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const u = height / 720;

  const sky = ctx.createLinearGradient(0, 0, width, height);
  sky.addColorStop(0, '#23344d');
  sky.addColorStop(0.55, '#5b6f73');
  sky.addColorStop(1, '#c9a47a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  for (let x = 0; x <= width; x += 80 * u) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += 80 * u) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  const circles = [
    [0.13, 0.24, 70, '#f4efe6'],
    [0.86, 0.2, 46, '#e2574c'],
    [0.22, 0.76, 28, '#f2c14e'],
    [0.76, 0.74, 92, '#1d2b3a'],
    [0.5, 0.17, 18, '#f4efe6'],
    [0.93, 0.56, 12, '#1d2b3a'],
  ];
  for (const [cx, cy, r, fill] of circles) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx * width, cy * height, r * u, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${Math.round(170 * u)}px system-ui, sans-serif`;
  ctx.fillText('FOCUS', width / 2, height * 0.47);

  ctx.font = `500 ${Math.round(24 * u)}px system-ui, sans-serif`;
  const lines = [
    'Let your eyes rest on this line and wait.',
    'Two soft images drift apart, then slide back together.',
    'Blink to pull them into one.',
  ];
  lines.forEach((line, i) => ctx.fillText(line, width / 2, height * 0.68 + i * 36 * u));

  return canvas;
}

async function openCamera(facing, onEnded) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('The camera API is not available.'), { name: 'SecurityError' });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());

  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  // Some phones only keep decoding a video that is in the page, so park it out of sight.
  video.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.append(video);
  video.srcObject = stream;
  try {
    await video.play();
  } catch (err) {
    stopTracks();
    video.remove();
    throw err;
  }

  const track = stream.getVideoTracks()[0];
  // Fires when the camera goes away by itself (unplugged, permission withdrawn), not when we stop it.
  track?.addEventListener?.('ended', () => onEnded?.());
  const reported = track?.getSettings?.().facingMode;
  return {
    element: video,
    kind: 'camera',
    // A webcam that reports no direction faces the user.
    mirrored: reported ? reported === 'user' : true,
    facing,
    stop() {
      stopTracks();
      video.srcObject = null;
      video.remove();
    },
  };
}

function openImage(path) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ element: img, kind: 'image', mirrored: false, facing: null, stop() {} });
    img.onerror = () => reject(new Error('Could not load image: ' + path));
    img.src = path;
  });
}

export async function openSource(desc, { facing = 'environment', onEnded } = {}) {
  if (desc.kind === 'test') {
    return { element: createTestPattern(), kind: 'test', mirrored: false, facing: null, stop() {} };
  }
  if (desc.kind === 'image') return openImage(desc.path);
  return openCamera(facing, onEnded);
}

export async function countCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'videoinput').length;
  } catch {
    return 0;
  }
}
