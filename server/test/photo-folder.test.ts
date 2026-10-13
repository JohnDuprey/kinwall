// A photo folder on the server (PHOTO_FOLDER, self-hosted only) for the Night screen and the Board:
// the folder reader (photo-folder-node.ts) and GET /api/photo-folder/next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { photoFolder } from '../src/photo-folder-node.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

async function folder(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'kinwall-photos-'));
  for (const [name, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), body);
  }
  return root;
}

function makeApp(root?: string) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ...(root ? { PHOTO_FOLDER: photoFolder(root) } : {}) };
  const app = createApp();
  const raw = (method: string, p: string, key = ADMIN_KEY, body?: unknown) =>
    app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
  const displayKey = async () => ((await (await raw('POST', '/api/keys', ADMIN_KEY, { name: 'Wall', scope: 'display' })).json()) as { key: string }).key;
  return { raw, displayKey };
}

test('the reader takes one shuffled pass over pictures in the folder and its subfolders, skipping hidden folders and other files', async () => {
  const root = await folder({
    'a.jpg': 'A', 'Maine trip/b.JPEG': 'B', 'Maine trip/day 2/c.webp': 'C',
    'notes.txt': 'x', 'clip.mp4': 'x', 'd.heic': 'x', '.hidden.jpg': 'x', '@eaDir/a.jpg/SYNOPHOTO_THUMB.jpg': 'x', '.thumbs/e.png': 'x',
  });
  try {
    const f = photoFolder(root);
    const seen = [];
    for (let i = 0; i < 3; i++) seen.push(await f.next());
    assert.deepEqual(seen.map((p) => new TextDecoder().decode(p!.bytes)).sort(), ['A', 'B', 'C'], 'each picture once per pass');
    const byBody = Object.fromEntries(seen.map((p) => [new TextDecoder().decode(p!.bytes), p!]));
    assert.equal(byBody.A.caption, undefined, 'no caption at the top of the folder');
    assert.equal(byBody.B.caption, 'Maine trip', 'the folder name is the caption');
    assert.equal(byBody.C.caption, 'day 2');
    assert.equal(byBody.B.type, 'image/jpeg');
    assert.equal(byBody.C.type, 'image/webp');
    assert.ok(await f.next(), 'a new pass starts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a picture deleted since the list was read is skipped; an empty or missing folder gives nothing', async () => {
  const root = await folder({ 'a.jpg': 'A', 'b.jpg': 'B' });
  try {
    const f = photoFolder(root);
    await rm(path.join(root, 'a.jpg'));
    await rm(path.join(root, 'b.jpg'));
    assert.equal(await f.next(), null);
    assert.equal(await photoFolder(path.join(root, 'missing')).next(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('GET /api/photo-folder/next serves a picture to wall screens, with its folder as the caption', async () => {
  const root = await folder({ 'Beach day/a.png': 'PNG' });
  try {
    const t = makeApp(root);
    const res = await t.raw('GET', '/api/photo-folder/next', await t.displayKey());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(decodeURIComponent(res.headers.get('x-caption')!), 'Beach day');
    assert.equal(await res.text(), 'PNG');
    const settings = (await (await t.raw('GET', '/api/settings')).json()) as { photoFolder?: boolean };
    assert.equal(settings.photoFolder, true, 'settings say the folder is there');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('without PHOTO_FOLDER, or with nothing in it, there is no picture', async () => {
  const t = makeApp();
  assert.equal((await t.raw('GET', '/api/photo-folder/next')).status, 404);
  assert.equal(((await (await t.raw('GET', '/api/settings')).json()) as { photoFolder?: boolean }).photoFolder, false);
  const root = await folder({ 'notes.txt': 'x' });
  try {
    assert.equal((await makeApp(root).raw('GET', '/api/photo-folder/next')).status, 404);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
