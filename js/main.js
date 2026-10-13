import { createDiplopia, defaultParams, PARAM_DEFS } from './effects/diplopia.js';
import { parseSource, openSource, sourceSize, describeCameraError, countCameras } from './camera.js';
import { createRenderer } from './renderer.js';
import {
  showMessage, hideMessage, containFit, createGestures, createPanel, loadSettings, saveSettings, formatStatus,
} from './ui.js';

const STATUS_INTERVAL = 250; // milliseconds between status line updates

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const stage = $('stage');
const message = $('message');
const panelEl = $('panel');
const statusEl = $('status');
const cameraSwitch = $('camera-switch');
const modeButtons = { whole: $('mode-whole'), depth: $('mode-depth') };

const sourceDesc = parseSource(location.search);
const showDepth = new URLSearchParams(location.search).get('debug') === 'depth';

// Reading the storage object itself can throw when the browser blocks it.
let storage = null;
try {
  storage = window.localStorage;
} catch {
  // Settings then last for this visit only.
}

const params = loadSettings(storage);
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

function showSourceError(err) {
  showMessage(message, describeSourceError(err), (action) => {
    if (action === 'test') {
      location.assign('?source=test');
      return;
    }
    hideMessage(message);
    if (!state.source) openCurrentSource();
  });
}

async function refreshCameraSwitch() {
  cameraSwitch.hidden = !(state.source?.kind === 'camera' && (await countCameras()) >= 2);
}

async function openCurrentSource() {
  hideMessage(message);
  try {
    state.source = await openSource(sourceDesc, { facing: state.facing });
  } catch (err) {
    showSourceError(err);
  }
  refreshCameraSwitch();
}

async function switchCamera() {
  const previous = state.facing;
  cameraSwitch.disabled = true;
  state.source?.stop();
  state.source = null;
  try {
    state.facing = previous === 'environment' ? 'user' : 'environment';
    state.source = await openSource(sourceDesc, { facing: state.facing });
  } catch (err) {
    // Go back to the camera that was working, then say what went wrong.
    state.facing = previous;
    state.source = await openSource(sourceDesc, { facing: previous }).catch(() => null);
    showSourceError(err);
  } finally {
    cameraSwitch.disabled = false;
  }
}

function setMode(mode) {
  state.mode = mode;
  for (const [name, button] of Object.entries(modeButtons)) {
    button.setAttribute('aria-pressed', String(name === mode));
  }
  document.body.classList.toggle('depth-mode', mode === 'depth');
}

function setUpControls() {
  const panel = createPanel($('sliders'), {
    defs: PARAM_DEFS,
    params,
    onChange: () => saveSettings(storage, params),
  });

  $('reset').addEventListener('click', () => {
    Object.assign(params, defaultParams());
    saveSettings(storage, params);
    panel.refresh();
  });

  // Dragging right moves the two images apart, left brings them together. A tap blinks and refocuses.
  createGestures(canvas, {
    onDrag: (fraction) => model.push(fraction),
    onTap: () => model.refocus(),
  });

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space' || event.repeat) return;
    if (event.target instanceof Element && event.target.closest('button, input, select, textarea')) return;
    event.preventDefault();
    model.refocus();
  });

  const settingsToggle = $('settings-toggle');
  settingsToggle.addEventListener('click', () => {
    panelEl.hidden = !panelEl.hidden;
    settingsToggle.setAttribute('aria-expanded', String(!panelEl.hidden));
  });

  modeButtons.whole.addEventListener('click', () => setMode('whole'));
  modeButtons.depth.addEventListener('click', () => setMode('depth'));
  cameraSwitch.addEventListener('click', switchCamera);
}

let lastTime = 0;
let lastStatus = 0;
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

  const frameState = model.update(dt);
  const depth = state.depthOverride;
  renderer.render(source.element, frameState, {
    params,
    mode: depth ? 'depth' : 'whole',
    mirror: source.mirrored,
    depth,
    showDepth,
  });

  if (now - lastStatus >= STATUS_INTERVAL) {
    lastStatus = now;
    statusEl.textContent = formatStatus({ phase: frameState.phase, mode: state.mode, depth: null });
  }
}

if (renderer) {
  window.addEventListener('resize', fit);
  setUpControls();
  window.__app = { model, params, renderer, state };
  openCurrentSource();
  requestAnimationFrame(frame);
}
