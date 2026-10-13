import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { locate } from '../tools/serve.js';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'serve-test-'));
  await mkdir(path.join(root, 'js'));
  await mkdir(path.join(root, '.secret'));
  await writeFile(path.join(root, 'index.html'), '<p>hi</p>');
  await writeFile(path.join(root, 'js', 'ok.js'), '1');
  await writeFile(path.join(root, '.secret', 'a.js'), 'secret');
  await writeFile(path.join(root, 'notes.md'), 'notes');
  return root;
}

test('serves the app files and nothing else', async () => {
  const root = await fixture();
  try {
    const status = async (url) => (await locate(root, url)).status;
    assert.equal(await status('/js/ok.js'), 200);
    assert.equal(await status('/js/ok.js?v=1'), 200);
    assert.equal(await status('/'), 200);
    assert.equal(await status('/js/missing.js'), 404);
    assert.equal(await status('/notes.md'), 404);             // not a type the app uses
    assert.equal(await status('/.secret/a.js'), 404);
    assert.equal(await status('/.SECRET/a.js'), 404);
    assert.equal(await status('/SECRET~1/a.js'), 404);        // Windows short name for .secret
    assert.equal(await status('/js/../.secret/a.js'), 404);
    assert.equal(await status('/..%2f..%2fx.js'), 403);
    assert.equal(await status('/%E0%A4%A'), 400);
    const found = await locate(root, '/js/ok.js');
    assert.match(found.type, /^text\/javascript/);
    assert.ok(found.file.endsWith(path.join('js', 'ok.js')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
