import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMimeType, fileName, deliver } from '../js/capture.js';

test('pickMimeType prefers MP4, then WebM VP9, VP8, plain WebM', () => {
  assert.deepEqual(pickMimeType(() => true), { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' });
  assert.deepEqual(pickMimeType((t) => t === 'video/mp4'), { mimeType: 'video/mp4', ext: 'mp4' });
  assert.deepEqual(pickMimeType((t) => t.startsWith('video/webm')), { mimeType: 'video/webm;codecs=vp9', ext: 'webm' });
  assert.deepEqual(pickMimeType((t) => t === 'video/webm;codecs=vp8' || t === 'video/webm'), { mimeType: 'video/webm;codecs=vp8', ext: 'webm' });
  assert.equal(pickMimeType(() => false), null);
});

test('fileName uses local date and time', () => {
  assert.equal(fileName(new Date(2026, 9, 13, 9, 5, 7), 'jpg'), 'diplopia-20261013-090507.jpg');
});

const env = (over) => {
  const calls = [];
  return { calls, coarse: true, canShare: () => true, share: async () => { calls.push('share'); }, download: () => calls.push('download'), ...over };
};
const abort = Object.assign(new Error('dismissed'), { name: 'AbortError' });
const blocked = Object.assign(new Error('no gesture'), { name: 'NotAllowedError' });
const blob = new Blob(['x'], { type: 'image/jpeg' });

test('deliver shares on touch devices that can share files', async () => {
  const e = env();
  assert.equal(await deliver(blob, 'a.jpg', e), 'shared');
  assert.deepEqual(e.calls, ['share']);
});

test('deliver downloads on desktop, or when sharing files is unsupported', async () => {
  for (const over of [{ coarse: false }, { canShare: () => false }]) {
    const e = env(over);
    assert.equal(await deliver(blob, 'a.jpg', e), 'downloaded');
    assert.deepEqual(e.calls, ['download']);
  }
});

test('a dismissed share sheet downloads nothing', async () => {
  const e = env({ share: async () => { throw abort; } });
  assert.equal(await deliver(blob, 'a.jpg', e), 'cancelled');
  assert.deepEqual(e.calls, []);
});

test('a share that fails for another reason falls back to download', async () => {
  const e = env({ share: async () => { throw blocked; } });
  assert.equal(await deliver(blob, 'a.jpg', e), 'downloaded');
  assert.deepEqual(e.calls, ['download']);
});

import { createOutbox, createRecorder } from '../js/capture.js';

test('a file whose share sheet was dismissed can still be saved to the device', async () => {
  const e = env({ share: async () => { throw abort; } });
  const outbox = createOutbox(e);
  assert.equal(await outbox.send(blob, 'clip.mp4'), 'cancelled');
  assert.equal(outbox.pending, true);
  assert.deepEqual(e.calls, []);
  assert.equal(outbox.saveToDevice(), true);
  assert.deepEqual(e.calls, ['download']);
  assert.equal(outbox.pending, false);
  assert.equal(outbox.saveToDevice(), false);
  assert.deepEqual(e.calls, ['download']);
});

test('a delivered file is not kept, and a kept one can be discarded', async () => {
  const outbox = createOutbox(env());
  assert.equal(await outbox.send(blob, 'a.jpg'), 'shared');
  assert.equal(outbox.pending, false);
  const dismissed = createOutbox(env({ share: async () => { throw abort; } }));
  await dismissed.send(blob, 'a.jpg');
  dismissed.discard();
  assert.equal(dismissed.pending, false);
});

test('the recorder hands over one clip and stops its stream, by request or at the time limit', async () => {
  const previous = globalThis.MediaRecorder;
  let stoppedTracks = 0;
  globalThis.MediaRecorder = class {
    static isTypeSupported = (type) => type === 'video/webm';
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['abc']) }); this.onstop(); }
  };
  const canvas = { captureStream: () => ({ getTracks: () => [{ stop() { stoppedTracks++; } }] }) };
  try {
    const clips = [];
    const recorder = createRecorder(canvas, { onTick() {}, onStop: (clip, ext) => clips.push([clip.type, clip.size, ext]) });
    recorder.start();
    assert.equal(recorder.recording, true);
    recorder.stop();
    assert.deepEqual(clips, [['video/webm', 3, 'webm']]);
    assert.deepEqual([recorder.recording, stoppedTracks], [false, 1]);

    const ticks = [];
    await new Promise((resolve) => {
      createRecorder(canvas, { maxSeconds: 0, onTick: (s) => ticks.push(s), onStop: resolve }).start();
    });
    assert.equal(ticks[0], 0);
    assert.equal(stoppedTracks, 2);
  } finally {
    globalThis.MediaRecorder = previous;
  }
});
