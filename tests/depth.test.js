import test from 'node:test';
import assert from 'node:assert/strict';
import { blendDepth, sampleDepth, createDepth } from '../js/depth.js';

test('blendDepth mixes maps of the same size and replaces otherwise', () => {
  const next = Uint8Array.of(100, 200);
  assert.deepEqual([...blendDepth(Uint8Array.of(0, 100), next, 0.5)], [50, 150]);
  assert.equal(blendDepth(null, next, 0.5), next);
  assert.equal(blendDepth(Uint8Array.of(1, 2, 3), next, 0.5), next);
});

test('sampleDepth averages around the point and clamps at the borders', () => {
  const data = new Uint8Array(100).fill(0);            // 10 x 10
  for (let y = 0; y < 10; y++) for (let x = 5; x < 10; x++) data[y * 10 + x] = 255;
  assert.equal(sampleDepth(data, 10, 10, 0.1, 0.5), 0);
  assert.equal(sampleDepth(data, 10, 10, 0.95, 0.05), 1);
  const edge = sampleDepth(data, 10, 10, 0.5, 0.5);
  assert.ok(edge > 0.2 && edge < 0.8);
});

const harness = () => {
  const sent = [];
  const worker = { postMessage: (m) => sent.push(m), terminate() {} };
  const depth = createDepth({
    onStatus() {}, createWorker: () => worker,
    grab: () => ({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 }),
  });
  const emit = (data) => worker.onmessage({ data });
  const result = (v) => emit({ type: 'depth', data: new Uint8Array(4).fill(v), width: 2, height: 2 });
  return { sent, depth, emit, result };
};

test('loads on start, sends one frame at a time, publishes results', () => {
  const { sent, depth, emit, result } = harness();
  depth.offer({}); assert.equal(sent.length, 0);                    // not started
  depth.start(); assert.deepEqual(sent[0], { type: 'load' });
  assert.equal(depth.status.state, 'loading');
  depth.offer({}); assert.equal(sent.length, 1);                    // not ready yet
  emit({ type: 'progress', percent: 40 }); assert.equal(depth.status.percent, 40);
  emit({ type: 'ready', device: 'wasm' });
  depth.offer({}); depth.offer({});
  assert.equal(sent.filter((m) => m.type === 'frame').length, 1);   // busy: no queue
  result(255);
  assert.deepEqual([depth.map.version, depth.map.fixation, depth.map.width], [1, 1, 2]);
  depth.offer({});
  assert.equal(sent.filter((m) => m.type === 'frame').length, 2);
});

test('a result that arrives after stop is dropped, and the mode can be re-entered', () => {
  const { sent, depth, emit, result } = harness();
  depth.start(); emit({ type: 'ready', device: 'wasm' });
  depth.offer({}); depth.stop(); result(255);
  assert.equal(depth.map, null);
  depth.start(); depth.offer({});
  assert.equal(sent.filter((m) => m.type === 'frame').length, 2);
  assert.equal(sent.filter((m) => m.type === 'load').length, 1);    // model is not reloaded
  result(0);
  assert.equal(depth.map.fixation, 0);
});

test('a worker failure becomes an error status', () => {
  const { depth, emit } = harness();
  depth.start(); emit({ type: 'error', message: 'offline' });
  assert.deepEqual([depth.status.state, depth.status.message], ['error', 'offline']);
  depth.offer({});
  assert.equal(depth.map, null);
});

test('isolated frame errors are skipped; three in a row fail the mode and stop the worker', () => {
  const sent = [];
  const worker = { terminated: 0, postMessage: (m) => sent.push(m), terminate() { this.terminated++; } };
  const depth = createDepth({ onStatus() {}, createWorker: () => worker, grab: () => ({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 }) });
  const emit = (data) => worker.onmessage({ data });
  const frames = () => sent.filter((m) => m.type === 'frame').length;
  const failFrame = () => { depth.offer({}); emit({ type: 'frame-error' }); };

  depth.start(); emit({ type: 'ready', device: 'webgpu' });
  failFrame();
  assert.equal(depth.status.state, 'ready');
  depth.offer({}); assert.equal(frames(), 2);                       // not stuck waiting for the failed frame
  emit({ type: 'depth', data: new Uint8Array(4).fill(255), width: 2, height: 2 });
  failFrame(); failFrame();
  assert.equal(depth.status.state, 'ready');                        // the success in between reset the count
  failFrame();
  assert.equal(depth.status.state, 'error');
  assert.equal(worker.terminated, 1);
  assert.equal(depth.map, null);
});

test('each frame carries the smoothing the worker should apply', () => {
  const sent = [];
  const worker = { postMessage: (m) => sent.push(m), terminate() {} };
  let smoothing = 0.016;
  const depth = createDepth({
    onStatus() {}, createWorker: () => worker, getSmoothing: () => smoothing,
    grab: () => ({ pixels: new Uint8ClampedArray(16), width: 2, height: 2 }),
  });
  depth.start(); worker.onmessage({ data: { type: 'ready', device: 'wasm' } });
  depth.offer({});
  assert.equal(sent.at(-1).smoothing, 0.016);
  worker.onmessage({ data: { type: 'depth', data: new Uint8Array(4), width: 2, height: 2 } });
  smoothing = 0.048;
  depth.offer({});
  assert.equal(sent.at(-1).smoothing, 0.048);
});
