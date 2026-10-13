import { createDiplopia, defaultParams, PARAM_DEFS } from './effects/diplopia.js';
import { parseSource, openSource, sourceSize, describeCameraError, countCameras } from './camera.js';
import { createRenderer, zoomFor, displayToSource } from './renderer.js';
import { createDepth } from './depth.js';
import { capturePhoto, canRecord, createRecorder, deliver, browserEnv, fileName } from './capture.js';
import {
  showMessage, hideMessage, containFit, createGestures, createPanel, loadSettings, saveSettings, formatStatus,
} from './ui.js';

const STATUS_INTERVAL = 250; // milliseconds between status line updates
const NOTICE_TIME = 8000; // milliseconds a one-off notice stays up

const $ = (id) => document.getElementById(id);
const canvas = $('view');
const stage = $('stage');
const message = $('message');
const panelEl = $('panel');
const statusEl = $('status');
const noticeEl = $('notice');
const cameraSwitch = $('camera-switch');
const recordButton = $('record');
const recordTime = $('record-time');
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
const state = { mode: 'whole', source: null, facing: 'environment', depthOverride: null, pendingPhoto: false };
let recorder = null;
let switchingCamera = false;
const depth = createDepth({ onStatus: onDepthStatus });
let depthError = null; // why depth-aware mode is unavailable, once it has failed

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

// Switching cameras can change the picture size, which would break a recording in progress.
function updateCameraSwitch() {
  cameraSwitch.disabled = switchingCamera || Boolean(recorder?.recording);
}

async function switchCamera() {
  const previous = state.facing;
  switchingCamera = true;
  updateCameraSwitch();
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
    switchingCamera = false;
    updateCameraSwitch();
  }
}

async function save(blob, ext) {
  const name = fileName(new Date(), ext);
  const result = await deliver(blob, name, browserEnv());
  window.__app.lastSaved = { name, type: blob.type, size: blob.size, result };
  if (result === 'downloaded') showNotice(`Saved ${name}`);
}

function savePhoto() {
  capturePhoto(canvas)
    .then((blob) => save(blob, 'jpg'))
    .catch(() => showNotice('The photo could not be saved.'));
}

function showRecording(on) {
  recordButton.setAttribute('aria-pressed', String(on));
  recordButton.setAttribute('aria-label', on ? 'Stop recording' : 'Record video');
  recordTime.hidden = !on;
  updateCameraSwitch();
}

function setUpRecording() {
  if (!canRecord()) {
    recordButton.parentElement.hidden = true;
    return;
  }
  recorder = createRecorder(canvas, {
    onTick: (seconds) => {
      recordTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    },
    onStop: (blob, ext) => {
      showRecording(false);
      save(blob, ext).catch(() => showNotice('The clip could not be saved.'));
    },
  });
  recordButton.addEventListener('click', () => {
    if (recorder.recording) {
      recorder.stop();
      return;
    }
    try {
      recorder.start();
      showRecording(true);
    } catch {
      showNotice('Recording could not start.');
    }
  });
}

// A short line above the bar. With `lasting` it stays until replaced; otherwise it clears itself.
let noticeTimer = 0;
function showNotice(text, { lasting = false } = {}) {
  clearTimeout(noticeTimer);
  noticeEl.textContent = text;
  noticeEl.hidden = !text;
  if (text && !lasting) noticeTimer = setTimeout(() => showNotice(''), NOTICE_TIME);
}

function setMode(mode) {
  state.mode = mode;
  for (const [name, button] of Object.entries(modeButtons)) {
    button.setAttribute('aria-pressed', String(name === mode));
  }
  document.body.classList.toggle('depth-mode', mode === 'depth');
  if (mode === 'depth') depth.start();
  else depth.stop();
  showLoading(depth.status);
}

// The model is fetched the first time depth-aware mode is chosen; the whole-frame picture keeps running meanwhile.
let loadingShown = false;
function showLoading(status) {
  const loading = state.mode === 'depth' && status.state === 'loading';
  modeButtons.depth.setAttribute('aria-busy', String(loading));
  if (loading) showNotice(`Loading depth model ${Math.round(status.percent)}%`, { lasting: true });
  else if (loadingShown) showNotice('');
  loadingShown = loading;
}

function onDepthStatus(status) {
  if (status.state === 'error' && !depthError) {
    depthError = `Depth-aware mode is unavailable: ${status.message}`;
    modeButtons.depth.disabled = true;
    modeButtons.depth.title = depthError;
    setMode('whole');
    showNotice(depthError);
    return;
  }
  showLoading(status);
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
  // In depth-aware mode the tapped spot also becomes what the eyes are looking at.
  createGestures(canvas, {
    onDrag: (fraction) => model.push(fraction),
    onTap: (u, v) => {
      model.refocus();
      if (state.mode !== 'depth' || !state.source) return;
      const point = displayToSource(u, v, { zoom: zoomFor(params, 'depth'), mirror: state.source.mirrored });
      depth.setFixationPoint(point.u, point.v);
    },
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
  $('photo').addEventListener('click', () => {
    state.pendingPhoto = true;
  });
  setUpRecording();
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
  if (state.mode === 'depth') depth.offer(source.element);
  // Until the first depth map arrives, depth-aware mode draws as whole-frame.
  const depthMap = state.depthOverride ?? (state.mode === 'depth' ? depth.map : null);
  renderer.render(source.element, frameState, {
    params,
    mode: depthMap ? 'depth' : 'whole',
    mirror: source.mirrored,
    depth: depthMap,
    showDepth,
  });

  // The photo is taken here, straight after drawing, while the canvas still holds this frame.
  if (state.pendingPhoto) {
    state.pendingPhoto = false;
    savePhoto();
  }

  if (now - lastStatus >= STATUS_INTERVAL) {
    lastStatus = now;
    const line = formatStatus({ phase: frameState.phase, mode: state.mode, depth: depth.status });
    statusEl.textContent = depthError ? `${line} · ${depthError}` : line;
  }
}

if (renderer) {
  window.addEventListener('resize', fit);
  setUpControls();
  window.__app = { model, params, renderer, state, depth };
  openCurrentSource();
  requestAnimationFrame(frame);
}
