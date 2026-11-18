// A memory can own only a photo uploaded for it (routes/trackers.ts check). Coloring pages and
// profile pictures are stored with family = 0 too, but they're never a memory's to take: a kid's
// device naming one as its memory's photo, then deleting the memory (or dropping the photo), would
// delete a parent's coloring page or a sibling's profile picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_test_admin';
const bytes = (n: number): Uint8Array<ArrayBuffer> => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 0xff);

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const raw = (method: string, p: string, init: { body?: BodyInit; headers?: Record<string, string>; key?: string } = {}) =>
    app.request(p, { method, body: init.body, headers: { Authorization: `Bearer ${init.key ?? ADMIN}`, ...init.headers } }, env);
  const req = async (method: string, p: string, body?: unknown, key = ADMIN) => {
    const res = await raw(method, p, { body: body === undefined ? undefined : JSON.stringify(body), key, headers: { 'Content-Type': 'application/json' } });
    return { status: res.status, json: (await res.json()) as any };
  };
  const leo = (await req('POST', '/api/members', { name: 'Leo', color: '#e57' })).json;
  const maya = (await req('POST', '/api/members', { name: 'Maya', color: '#57e' })).json;
  const k = (await req('POST', '/api/keys', { name: "Leo's tablet", scope: 'display' })).json;
  assert.equal((await req('PATCH', `/api/keys/${k.id}`, { kind: 'kid', owner: leo.id })).status, 200);
  const photoExists = async (id: string) => !!(await db.prepare('SELECT id FROM photos WHERE id = ?').bind(id).first());
  return { raw, req, leo, maya, leoKey: k.key as string, photoExists };
}

test("trackers: a memory can't take a coloring page as its own photo (deleting the memory would delete the page)", async () => {
  const t = await setup();
  const res = await t.raw('POST', '/api/coloring-pages?name=Dino', { body: bytes(2000), headers: { 'Content-Type': 'image/png', 'X-Photo-Width': '100', 'X-Photo-Height': '100' } });
  assert.equal(res.status, 201);
  const page = (await res.json()) as { id: string };
  const made = await t.req('POST', '/api/trackers', { kind: 'memory', memberId: t.leo.id, data: { text: 'My dino' }, photoId: page.id }, t.leoKey);
  if (made.status === 201) {
    // Had it been taken, deleting the memory takes the coloring page with it.
    assert.equal((await t.req('DELETE', `/api/trackers/${made.json.id}`, undefined, t.leoKey)).status, 200);
    assert.ok(await t.photoExists(page.id), 'the coloring page was deleted with the memory');
  }
  assert.equal(made.status, 400, JSON.stringify(made.json));
  assert.ok(await t.photoExists(page.id));
});

test("trackers: a kid's memory can't take a sibling's profile picture (dropping it would delete their picture)", async () => {
  const t = await setup();
  const put = await t.raw('PUT', `/api/members/${t.maya.id}/picture`, { body: bytes(3000), headers: { 'Content-Type': 'image/webp', 'X-Photo-Width': '256', 'X-Photo-Height': '256' } });
  assert.equal(put.status, 200);
  const pictureId = ((await put.json()) as { picture: string }).picture.split('/')[3];
  assert.ok(await t.photoExists(pictureId));
  const made = await t.req('POST', '/api/trackers', { kind: 'memory', memberId: t.leo.id, data: { text: 'Hi' }, photoId: pictureId }, t.leoKey);
  if (made.status === 201) {
    assert.equal((await t.req('PATCH', `/api/trackers/${made.json.id}`, { photoId: null }, t.leoKey)).status, 200);
    assert.ok(await t.photoExists(pictureId), "Maya's profile picture was deleted when Leo's memory let go of it");
  }
  assert.equal(made.status, 400, JSON.stringify(made.json));
  // Nor can an edit point an existing memory at it.
  const memory = (await t.req('POST', '/api/trackers', { kind: 'memory', memberId: t.leo.id, data: { text: 'Hi' } }, t.leoKey)).json;
  assert.equal((await t.req('PATCH', `/api/trackers/${memory.id}`, { photoId: pictureId }, t.leoKey)).status, 400);
  assert.ok(await t.photoExists(pictureId));
});
