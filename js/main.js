import { createDiplopia, sanitizeParams } from './effects/diplopia.js';
import { parseSource, openSource, sourceSize, describeCameraError } from './camera.js';
import { createRenderer } from './renderer.js';
import { showMessage, hideMessage, containFit } from './ui.js';

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const stage = $('stage');
const message = $('message');

const sourceDesc = parseSource(location.search);
const showDepth = new URLSearchParams(location.search).get('debug') === 'depth';

const params = sanitizeParams(null);
const model = createDiplopia({ params });
const state = { mode: 'whole', source: null, facing: 'environment', depthOverride: null };

let renderer = null;
try {
  renderer = createRenderer(canvas);
} catch {
  showMessage(message, { title: 'This browser cannot draw the effect', detail: 'WebGL is not available.', action: null });
}

// The canvas keeps the source's pixel size; CSS scales it to fit the stage.
function fit() {
  if (!canvas.width || !canvas.height) return;
  const box = containFit(stage.clientWidth, stage.clientHeight, canvas.width, canvas.height);
  canvas.style.width = box.width + 'px';
  canvas.style.height = box.height + 'px';
}

function describeSourceError(err) {
  if (sourceDesc.kind === 'image') {
    return { title: 'The picture could not be loaded', detail: err.message, action: 'test' };
  }
  return describeCameraError(err, { secure: window.isSecureContext });
}

async function openCurrentSource() {
  hideMessage(message);
  try {
    state.source = await openSource(sourceDesc, { facing: state.facing });
  } catch (err) {
    showMessage(message, describeSourceError(err), (action) => {
      if (action === 'test') location.assign('?source=test');
      else openCurrentSource();
    });
  }
}

let lastTime = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = lastTime ? (now - lastTime) / 1000 : 0;
  lastTime = now;

  const source = state.source;
  const size = source && sourceSize(source.element);
  if (!size) return;
  if (size.width !== canvas.width || size.height !== canvas.height) {
    renderer.resize(size.width, size.height);
    fit();
  }

  const depth = state.depthOverride;
  renderer.render(source.element, model.update(dt), {
    params,
    mode: depth ? 'depth' : 'whole',
    mirror: source.mirrored,
    depth,
    showDepth,
  });
}

if (renderer) {
  window.addEventListener('resize', fit);
  window.__app = { model, params, renderer, state };
  openCurrentSource();
  requestAnimationFrame(frame);
}
