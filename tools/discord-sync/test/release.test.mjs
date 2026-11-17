import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../store.mjs';
import { ReleaseStorage, ReleaseAssets } from '../release.mjs';

import { fakeGithub } from './fakes.mjs';

test('release checkpoints restore pending intents on a fresh runner and retain immutable attachments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-sync-'));
  const github = fakeGithub();
  let store;
  try {
    const remote = new ReleaseStorage(github, 'discord-sync-data');
    await remote.init(true);
    store = new Store(join(dir, 'local.db'), 'scope');
    store.begin('comment:100', { type: 'create-comment' });
    await remote.checkpoint(store, dir);
    await remote.restore(join(dir, 'restored.db'));
    const recovered = new Store(join(dir, 'restored.db'), 'scope');
    assert.equal(recovered.operation('comment:100').status, 'pending'); recovered.close();
    for (let i = 0; i < 4; i++) { store.set('n', i); await remote.checkpoint(store, dir); }
    await github.uploadAsset(1, 'attachment-example.png', Buffer.from('image'), 'image/png');
    await remote.prune();
    assert.equal(github.files.filter(f => f.name.startsWith('state-')).length, 3);
    assert.ok(github.files.some(f => f.name === 'attachment-example.png'));
  } finally { store?.close(); await rm(dir, { recursive: true, force: true }); }
});

test('corrupt newest state fails closed rather than falling back to an older snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-sync-'));
  const github = fakeGithub();
  const store = new Store(join(dir, 'local.db'), 'scope');
  try {
    const remote = new ReleaseStorage(github, 'discord-sync-data'); await remote.init(true);
    await remote.checkpoint(store, dir); await remote.checkpoint(store, dir);
    github.files.at(-1).bytes = Buffer.from('corrupted');
    await assert.rejects(remote.restore(join(dir, 'restored.db')), /checksum/);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});

test('plan does not create a storage release and existing empty releases require explicit initialization', async () => {
  const github = fakeGithub();
  const remote = new ReleaseStorage(github, 'discord-sync-data');
  await remote.init(false); assert.equal(await github.release(), undefined);
  await github.createStorageRelease('discord-sync-data');
  await assert.rejects(new ReleaseStorage(github, 'discord-sync-data').init(true), /empty/);
  await new ReleaseStorage(github, 'discord-sync-data').init(true, true);
});

test('release attachment backend publishes once and recovers the permanent URL after local cache loss', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'release-sync-'));
  const github = fakeGithub();
  const store = new Store(':memory:', 'scope');
  try {
    const remote = new ReleaseStorage(github, 'discord-sync-data'); await remote.init(true);
    const assets = new ReleaseAssets(dir, store, remote, { fetcher: async () => new Response(Buffer.from('89504e470d0a1a0a', 'hex')) });
    const a = { id: '7', filename: 'image.png', url: 'https://cdn.discordapp.com/attachments/image.png' };
    const first = await assets.copy(a);
    await rm(dir, { recursive: true, force: true });
    const second = await assets.copy(a);
    assert.equal(first.url, second.url);
    assert.match(first.url, /releases\/download\/discord-sync-data\/attachment-[a-f0-9]{64}\.png$/);
    assert.equal(github.files.length, 1);
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
