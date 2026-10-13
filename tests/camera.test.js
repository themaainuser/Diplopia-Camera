import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, describeCameraError, sourceSize } from '../js/camera.js';

test('parseSource', () => {
  assert.deepEqual(parseSource(''), { kind: 'camera' });
  assert.deepEqual(parseSource('?source='), { kind: 'camera' });
  assert.deepEqual(parseSource('?source=test'), { kind: 'test' });
  assert.deepEqual(parseSource('?debug=depth&source=photos/desk.jpg'), { kind: 'image', path: 'photos/desk.jpg' });
  for (const bad of ['https://x.test/a.jpg', '//x.test/a.jpg', 'data:image/png;base64,AA', '/etc/x'])
    assert.deepEqual(parseSource('?source=' + encodeURIComponent(bad)), { kind: 'camera' });
});

test('describeCameraError', () => {
  const d = (name, secure = true) => describeCameraError(name ? { name, message: 'boom' } : null, { secure });
  assert.deepEqual([d('NotAllowedError', false).title, d('NotAllowedError', false).action], ['The camera needs a secure address', null]);
  assert.equal(d('NotAllowedError').action, 'retry');
  assert.equal(d('NotFoundError').action, 'test');
  assert.equal(d('NotReadableError').title, 'The camera is busy');
  assert.deepEqual(d('Weird'), { title: 'The camera could not start', detail: 'boom', action: 'retry' });
  assert.equal(d(null).detail, 'Unknown error.');
});

test('sourceSize reads video, image and canvas, and is null until ready', () => {
  assert.deepEqual(sourceSize({ videoWidth: 720, videoHeight: 1280 }), { width: 720, height: 1280 });
  assert.deepEqual(sourceSize({ naturalWidth: 800, naturalHeight: 600 }), { width: 800, height: 600 });
  assert.deepEqual(sourceSize({ width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.equal(sourceSize({ videoWidth: 0, videoHeight: 0 }), null);
  assert.equal(sourceSize(null), null);
});

import { openSource } from '../js/camera.js';

function stubGlobals(stubs) {
  const saved = Object.keys(stubs).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  for (const [key, value] of Object.entries(stubs)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

test('a camera that stops by itself reports it', async () => {
  const listeners = {};
  const track = { stopped: false, stop() { this.stopped = true; }, getSettings: () => ({}), addEventListener: (type, fn) => { listeners[type] = fn; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const video = { style: {}, setAttribute() {}, play: async () => {}, remove() {} };
  const restore = stubGlobals({
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    document: { createElement: () => video, body: { append() {} } },
  });
  try {
    let ended = 0;
    const source = await openSource({ kind: 'camera' }, { facing: 'user', onEnded: () => ended++ });
    assert.equal(source.mirrored, true);                      // a webcam that reports no direction faces the user
    listeners.ended();
    assert.equal(ended, 1);
    source.stop();
    assert.equal(track.stopped, true);
  } finally {
    restore();
  }
});
