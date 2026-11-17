import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';
import { Assets, assetServer } from '../assets.mjs';

test('attachments use immutable content hashes, are cached, and cannot fetch arbitrary hosts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-assets-'));
  const store = new Store(':memory:', 'scope');
  let calls = 0;
  const assets = new Assets(dir, 'https://files.example/assets', store, { fetcher: async () => { calls++; return new Response(Buffer.from('89504e470d0a1a0a', 'hex')); } });
  try {
    const first = await assets.copy({ id: '1', filename: 'image.png', url: 'https://cdn.discordapp.com/attachments/1/image.png' });
    const second = await assets.copy({ id: '1', filename: 'image.png', url: 'https://cdn.discordapp.com/attachments/1/image.png?expires=2' });
    assert.equal(first.url, second.url); assert.equal(calls, 1); assert.equal(first.image, true);
    assert.match(first.url, /^https:\/\/files.example\/assets\/[a-f0-9]{64}$/);
    await assert.rejects(assets.copy({ id: '2', filename: 'x', url: 'https://127.0.0.1/private' }), /host/);
    const server = assetServer(assets, () => ({ status: 'ok' }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      const response = await fetch(`http://127.0.0.1:${port}/assets/${first.hash}`);
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal((await response.arrayBuffer()).byteLength, 8);
      assert.equal((await fetch(`http://127.0.0.1:${port}/assets/not-a-hash`)).status, 404);
      assert.equal((await fetch(`http://127.0.0.1:${port}/assets/${first.hash}`, { method: 'POST' })).status, 405);
    } finally { await new Promise(resolve => server.close(resolve)); }
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('attachments stop on excessive size and do not follow redirects', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-assets-'));
  const store = new Store(':memory:', 'scope');
  const attachment = { id: '1', filename: 'x', url: 'https://cdn.discordapp.com/attachments/x' };
  try {
    const assets = new Assets(dir, 'https://files.example/assets', store, { maxBytes: 3, fetcher: async (_, options) => { assert.equal(options.redirect, 'error'); return new Response('1234'); } });
    await assert.rejects(assets.copy(attachment), /limit/);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('public hosting must serve the exact stored bytes before writes are enabled', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-assets-'));
  const store = new Store(':memory:', 'scope');
  try {
    const assets = new Assets(dir, 'https://files.example/assets', store, { fetcher: async () => new Response('wrong bytes') });
    await assert.rejects(assets.verifyPublic(), /verification/);
    assert.equal(store.entries('blob:').length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
