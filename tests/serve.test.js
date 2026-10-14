import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { locate, serverOptions, lanAddresses } from '../tools/serve.js';

test('normal mode stays on this computer; phone mode serves HTTPS on the network', () => {
  assert.deepEqual(serverOptions([], {}), { https: false, host: '127.0.0.1', port: 8443 });
  assert.deepEqual(serverOptions(['--phone'], {}), { https: true, host: '0.0.0.0', port: 8080 });
  assert.deepEqual(serverOptions(['--phone'], { PORT: '9000' }), { https: true, host: '0.0.0.0', port: 9000 });
});

test('lanAddresses lists the IPv4 addresses other devices can reach', () => {
  const interfaces = {
    Ethernet: [
      { family: 'IPv4', address: '10.29.36.235', internal: false },
      { family: 'IPv6', address: 'fe80::1', internal: false },
    ],
    Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    'Wi-Fi': [{ family: 4, address: '192.168.1.20', internal: false }],
  };
  assert.deepEqual(lanAddresses(interfaces), ['10.29.36.235', '192.168.1.20']);
});

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
