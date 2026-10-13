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
