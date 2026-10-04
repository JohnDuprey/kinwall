// PUT / DELETE /api/members/{id}/picture: a profile picture (a small square crop, stored like a family
// photo). Same people as the emoji avatar: parents for anyone, a kid's own device for them only; never
// a wall screen, the app's widgets or a connected app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { MAX_PICTURE_BYTES } from '../src/routes/photos.ts';
import { readZip } from '../src/zip.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_test_admin';
const bytes = (n: number, seed = 7): Uint8Array<ArrayBuffer> => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const raw = (method: string, p: string, init: { body?: BodyInit; headers?: Record<string, string>; key?: string } = {}) =>
    app.request(p, { method, body: init.body, headers: { Authorization: `Bearer ${init.key ?? ADMIN}`, ...init.headers } }, env);
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN, headers: Record<string, string> = {}) => {
    const res = await raw(method, p, { body: body === undefined ? undefined : JSON.stringify(body), key, headers: { 'Content-Type': 'application/json', ...headers } });
    return { status: res.status, json: (await res.json()) as any };
  };
  const put = async (id: string, data: Uint8Array<ArrayBuffer>, opts: { key?: string; mime?: string; query?: string; headers?: Record<string, string> } = {}) => {
    const res = await raw('PUT', `/api/members/${id}/picture${opts.query ?? ''}`, {
      body: data, key: opts.key, headers: { 'Content-Type': opts.mime ?? 'image/webp', 'X-Photo-Width': '256', 'X-Photo-Height': '256', ...opts.headers },
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const member = async (id: string) => ((await req('/api/members')).json as any[]).find((m) => m.id === id);
  const photoCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM photos').first<{ n: number }>())!.n;
  return { db, raw, req, put, member, photoCount };
}

async function family() {
  const t = makeApp();
  const leo = (await t.req('/api/members', 'POST', { name: 'Leo', color: '#e57', avatar: '🦊' })).json;
  const maya = (await t.req('/api/members', 'POST', { name: 'Maya', color: '#57e', avatar: '🦄' })).json;
  const display = async (name: string, owner: string) => {
    const k = (await t.req('/api/keys', 'POST', { name, scope: 'display' })).json;
    assert.equal((await t.req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  return { ...t, leo, maya, leoKey: await display('leo-tablet', leo.id), wallKey: await display('wall', 'shared') };
}

test('picture: a parent sets one; it shows on the member, serves with cache headers, stays out of the album', async () => {
  const t = await family();
  assert.equal((await t.member(t.maya.id)).picture, null);
  const res = await t.put(t.maya.id, bytes(4000));
  assert.equal(res.status, 200);
  assert.match(res.json.picture, /^\/api\/photos\/[\w-]+\/image$/);
  const m = await t.member(t.maya.id);
  assert.deepEqual([m.picture, m.avatar, m.color], [res.json.picture, '🦄', '#57e'], 'the emoji and color stay as the fallback and ring');
  const img = await t.raw('GET', res.json.picture);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('Content-Type'), 'image/webp');
  assert.equal(img.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), bytes(4000));
  assert.deepEqual((await t.req('/api/photos')).json, [], 'not a family photo');
  assert.equal((await t.req('/api/photos/quota')).json.memoryPhotos, 0, "not a memory's photo either");
});

test('picture: a new one replaces the old (no second copy); clearing goes back to the emoji', async () => {
  const t = await family();
  const first = (await t.put(t.maya.id, bytes(1000, 1))).json.picture;
  const second = (await t.put(t.maya.id, bytes(1000, 2))).json.picture;
  assert.notEqual(first, second, 'a new url, so caches never show the old one');
  assert.equal((await t.raw('GET', first)).status, 404);
  assert.equal(await t.photoCount(), 1);
  const cleared = await t.req(`/api/members/${t.maya.id}/picture`, 'DELETE');
  assert.deepEqual([cleared.status, cleared.json], [200, { picture: null }]);
  assert.equal((await t.member(t.maya.id)).picture, null);
  assert.equal(await t.photoCount(), 0);
  assert.equal((await t.req(`/api/members/${t.maya.id}/picture`, 'DELETE')).status, 200, 'clearing twice is fine');
});

test("picture: cropped from an album photo keeps a reference to it, without copying the original", async () => {
  const t = await family();
  const up = await t.raw('POST', '/api/photos', { body: bytes(9000), headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Width': '1280', 'X-Photo-Height': '960' } });
  const album = (await up.json()) as any;
  assert.equal((await t.put(t.maya.id, bytes(800), { query: `?from=${album.id}` })).status, 200);
  const row = await t.db.prepare('SELECT source_id, bytes FROM photos WHERE avatar = 1').first<{ source_id: string; bytes: number }>();
  assert.deepEqual({ ...row }, { source_id: album.id, bytes: 800 });
  assert.equal((await t.put(t.maya.id, bytes(800), { query: '?from=nope' })).status, 400, 'an unknown album photo');
});

test("picture: a kid's own device sets and clears its own; not a sibling's, a wall's, the widgets' or a connected app's", async () => {
  const t = await family();
  assert.equal((await t.put(t.leo.id, bytes(500), { key: t.leoKey })).status, 200, 'their own');
  assert.equal((await t.req(`/api/members/${t.leo.id}/picture`, 'DELETE', undefined, t.leoKey)).status, 200, 'and back to the emoji');
  assert.equal((await t.put(t.maya.id, bytes(500), { key: t.leoKey })).status, 403, "Maya's");
  assert.equal((await t.put(t.leo.id, bytes(500), { key: t.wallKey })).status, 403, 'a wall screen');
  const widgets = (await t.req('/api/device-keys', 'POST', { name: 'Widgets on iPhone' }, t.leoKey)).json.key as string;
  assert.equal((await t.put(t.leo.id, bytes(500), { key: widgets })).status, 403, "Leo's widgets");
  assert.equal((await t.put(t.leo.id, bytes(500), { headers: { 'X-Kinwall-Source': 'mcp' } })).status, 403, 'a connected app');
  assert.equal((await t.req(`/api/members/${t.maya.id}/picture`, 'DELETE', undefined, ADMIN, { 'X-Kinwall-Source': 'mcp' })).status, 403, 'a connected app clearing');
  await t.put(t.maya.id, bytes(500));
  assert.equal((await t.req(`/api/members/${t.maya.id}/picture`, 'DELETE', undefined, t.leoKey)).status, 403, "clearing Maya's");
  assert.equal((await t.req(`/api/members/${t.maya.id}/picture`, 'DELETE', undefined, t.wallKey)).status, 403, 'clearing from a wall');
  assert.equal(await t.photoCount(), 1);
  assert.notEqual((await t.member(t.maya.id)).picture, null);
});

test('picture: type, size and member are checked', async () => {
  const t = await family();
  assert.equal((await t.put(t.maya.id, bytes(10), { mime: 'image/gif' })).status, 415);
  assert.equal((await t.put(t.maya.id, bytes(10), { mime: 'text/plain' })).status, 415);
  assert.equal((await t.put(t.maya.id, bytes(MAX_PICTURE_BYTES + 1))).status, 413);
  assert.equal((await t.put(t.maya.id, bytes(MAX_PICTURE_BYTES))).status, 200, 'exactly the cap');
  assert.equal((await t.put(t.maya.id, new Uint8Array(0))).status, 400, 'empty');
  assert.equal((await t.put(t.maya.id, bytes(10), { headers: { 'X-Photo-Width': '0' } })).status, 400, 'bad size');
  assert.equal((await t.put('nope', bytes(10))).status, 404);
  assert.equal((await t.req('/api/members/nope/picture', 'DELETE')).status, 404);
});

test('picture: deleted with the member', async () => {
  const t = await family();
  await t.put(t.maya.id, bytes(700));
  assert.equal(await t.photoCount(), 1);
  assert.equal((await t.req(`/api/members/${t.maya.id}`, 'DELETE')).status, 200);
  assert.equal(await t.photoCount(), 0);
});

test('picture: the photo zip carries it, and importing it into a fresh family gives it back (matched by name)', async () => {
  const a = await family();
  await a.put(a.maya.id, bytes(1200, 3));
  const zip = new Uint8Array(await (await a.raw('GET', '/api/photos/export.zip')).arrayBuffer());
  const entries = readZip(zip, 1e6);
  const manifest = JSON.parse(new TextDecoder().decode((await entries[0].read())!));
  assert.equal(manifest.length, 1);
  assert.deepEqual([manifest[0].picture, manifest[0].memberName, manifest[0].family], [true, 'Maya', false]);

  const b = makeApp();
  const maya = (await b.req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const imported = await b.raw('POST', '/api/photos/import', { body: zip, headers: { 'Content-Type': 'application/zip' } });
  assert.deepEqual(await imported.json(), { imported: 1, skipped: 0 });
  const pic = (await b.member(maya.id)).picture;
  assert.ok(pic);
  assert.deepEqual(new Uint8Array(await (await b.raw('GET', pic)).arrayBuffer()), bytes(1200, 3));
  assert.deepEqual((await b.req('/api/photos')).json, [], 'still not in the album');
});
