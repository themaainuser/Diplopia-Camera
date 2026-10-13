// Interface pieces: messages, layout, and (later) gestures and the settings panel.
// Functions take the elements they work on, so nothing here touches the page at import time.

const ACTION_LABELS = { retry: 'Try again', test: 'Use the test picture' };

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
