// Interface pieces: messages, layout, gestures, the settings panel and saved settings.
// Functions take the elements they work on, so nothing here touches the page at import time.

import { sanitizeParams } from './effects/index.js';

const ACTION_LABELS = { retry: 'Try again', test: 'Use the test picture' };
const SETTINGS_KEY = 'diplopia.settings.v1';

// The largest size with the source's proportions that fits inside the stage.
export function containFit(stageW, stageH, srcW, srcH) {
  const scale = Math.min(stageW / srcW, stageH / srcH);
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

export function showMessage(root, { title, detail, action }, onAction) {
  root.querySelector('#message-title').textContent = title;
  root.querySelector('#message-detail').textContent = detail;
  const button = root.querySelector('#message-action');
  button.hidden = !action;
  button.textContent = ACTION_LABELS[action] ?? '';
  button.onclick = action ? () => onAction?.(action) : null;
  root.hidden = false;
}

export function hideMessage(root) {
  root.hidden = true;
}

// Tap and sideways drag on the picture. A press that moves less than `threshold` pixels is a tap,
// reported as a position on the picture (0..1). Anything longer is a drag, reported move by move
// as a fraction of the picture's width.
export function createGestures(el, { onTap, onDrag, threshold = 8 }) {
  let press = null;

  el.addEventListener('pointerdown', (event) => {
    if (press || (event.button !== undefined && event.button !== 0)) return;
    press = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, dragging: false };
    try {
      // Keeps the drag alive when the pointer leaves the picture. Not every pointer can be captured.
      el.setPointerCapture?.(event.pointerId);
    } catch {
      // The gesture still works while the pointer stays over the picture.
    }
  });

  el.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.id) return;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) <= threshold) return;
      press.dragging = true;
    }
    const { width } = el.getBoundingClientRect();
    const moved = event.clientX - press.lastX;
    press.lastX = event.clientX;
    if (width > 0 && moved !== 0) onDrag(moved / width);
  });

  el.addEventListener('pointerup', (event) => {
    if (!press || event.pointerId !== press.id) return;
    const wasDrag = press.dragging;
    press = null;
    if (wasDrag) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      onTap((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
    }
  });

  el.addEventListener('pointercancel', (event) => {
    if (press && event.pointerId === press.id) press = null;
  });
}

// Space blinks, unless it belongs to the focused control: a button it would press or a field it would
// type into. A slider does nothing with Space, so it does not count.
export function spaceRefocuses(target) {
  const control = target?.closest?.('button, select, textarea, input');
  if (!control) return true;
  return control.tagName === 'INPUT' && control.type === 'range';
}

// A mouse or touch click leaves focus on the button, which would then swallow the next Space.
// Give the focus back. A button reached with the keyboard keeps it.
export function releasePointerFocus(event) {
  if (event.detail > 0) event.target?.closest?.('button')?.blur();
}

export function formatValue(def, value) {
  switch (def.format) {
    case 'seconds':
      return value.toFixed(1) + ' s';
    case 'percent':
      return (value * 100).toFixed(1) + '%';
    case 'times':
      return value.toFixed(1) + '×';
    default:
      return value.toFixed(2);
  }
}

// One labelled slider per parameter. Sliders write straight into `params`, which the model reads live.
export function createPanel(container, { defs, params, onChange }) {
  const rows = defs.map((def) => {
    const row = document.createElement('div');
    row.className = def.depthOnly ? 'row depth-only' : 'row';

    const id = 'param-' + def.key;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = def.label;

    const output = document.createElement('output');
    output.htmlFor = id;

    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;

    input.addEventListener('input', () => {
      const value = Number(input.value);
      params[def.key] = value;
      // The two ends of the delay range push each other, so the minimum never passes the maximum.
      if (def.key === 'delayMin' && value > params.delayMax) params.delayMax = value;
      if (def.key === 'delayMax' && value < params.delayMin) params.delayMin = value;
      refresh();
      onChange?.(def.key, value);
    });

    row.append(label, output, input);
    container.append(row);
    return { def, input, output };
  });

  function refresh() {
    for (const { def, input, output } of rows) {
      input.value = params[def.key];
      output.textContent = formatValue(def, params[def.key]);
    }
  }

  refresh();
  return { refresh };
}

// Saved settings are untrusted: anything unreadable or out of range falls back to the defaults.
export function loadSettings(storage) {
  try {
    return sanitizeParams(JSON.parse(storage.getItem(SETTINGS_KEY)));
  } catch {
    return sanitizeParams(null);
  }
}

export function saveSettings(storage, params) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(params));
  } catch {
    // Storage can be full or blocked; the settings then last for this visit only.
  }
}

export function formatStatus({ phase, mode, depth }) {
  if (mode !== 'depth' || !depth) return phase;
  if (depth.state === 'loading') return `${phase} · loading depth model ${Math.round(depth.percent ?? 0)}%`;
  if (depth.state === 'ready') return `${phase} · depth ${Math.round(depth.rate ?? 0)}/s (${depth.device})`;
  if (depth.state === 'error') return `${phase} · depth unavailable`;
  return phase;
}
