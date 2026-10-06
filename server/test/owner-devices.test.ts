// A member's own device (a kid's tablet) acts only for its owner on notes, trackers, scrapbooks and
// plugin data; a wall screen (nobody's) and a parent's device act for anyone, except where noted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (method: string, p: string, body?: unknown, key = ADMIN_KEY) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  const send = async (method: string, p: string, body?: unknown, key?: string) => (await (await raw(method, p, body, key)).json()) as any;
  const device = async (name: string, scope: 'admin' | 'display', kind: 'kid' | 'wall' | 'grownup', owner?: string) => {
    const k = await send('POST', '/api/keys', { name, scope });
    assert.equal((await raw('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  const alex = await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true });
  const leo = await send('POST', '/api/members', { name: 'Leo', color: '#993366' });
  const maya = await send('POST', '/api/members', { name: 'Maya', color: '#339966' });
  const cal = await send('POST', '/api/calendars', { kind: 'local', name: 'Family' });
  const event = await send('POST', '/api/events', { calendarId: cal.id, allDay: false, title: 'Dinner', start: '2026-10-01T18:00:00Z', end: '2026-10-01T19:00:00Z' });
  return {
    raw, send, alex, leo, maya, target: `event:${event.id}`,
    leoKey: await device("Leo's tablet", 'display', 'kid', leo.id),
    wallKey: await device('Kitchen wall', 'display', 'wall'),
    alexKey: await device("Alex's phone", 'admin', 'grownup', alex.id),
  };
}

test("notes: a kid's device posts as its owner and changes only its own notes; a wall screen only Someone's", async () => {
  const { raw, send, alex, leo, maya, target, leoKey, wallKey, alexKey } = await setup();
  const post = (memberId: string | null, key: string) => raw('POST', '/api/notes', { target, body: 'hi', memberId }, key);

  assert.equal((await post(maya.id, leoKey)).status, 403);
  assert.equal((await post(alex.id, leoKey)).status, 403);
  const own = await (await post(leo.id, leoKey)).json() as any;
  assert.equal(own.memberId, leo.id);
  const unnamed = await (await post(null, leoKey)).json() as any;
  assert.equal(unnamed.memberId, leo.id, 'no memberId on a kid device = the kid');

  const mayas = await (await post(maya.id, wallKey)).json() as any; // the wall posts as anyone
  const someone = await (await post(null, wallKey)).json() as any;
  assert.equal(someone.memberId, null);
  const parents = await (await post(alex.id, alexKey)).json() as any;

  // Kid: own notes only.
  assert.equal((await raw('PATCH', `/api/notes/${parents.id}`, { body: 'x' }, leoKey)).status, 403);
  assert.equal((await raw('DELETE', `/api/notes/${mayas.id}`, undefined, leoKey)).status, 403);
  assert.equal((await raw('DELETE', `/api/notes/${someone.id}`, undefined, leoKey)).status, 403);
  assert.equal((await raw('PATCH', `/api/notes/${own.id}`, { body: 'edited' }, leoKey)).status, 200);
  assert.equal((await raw('DELETE', `/api/notes/${own.id}`, undefined, leoKey)).status, 200);
  // Wall: only notes posted as Someone.
  assert.equal((await raw('PATCH', `/api/notes/${mayas.id}`, { body: 'x' }, wallKey)).status, 403);
  assert.equal((await raw('DELETE', `/api/notes/${parents.id}`, undefined, wallKey)).status, 403);
  assert.equal((await raw('PATCH', `/api/notes/${someone.id}`, { body: 'edited' }, wallKey)).status, 200);
  // Parent: any.
  assert.equal((await raw('PATCH', `/api/notes/${mayas.id}`, { body: 'x' }, alexKey)).status, 200);
  assert.equal((await raw('DELETE', `/api/notes/${unnamed.id}`, undefined, alexKey)).status, 200);
  assert.equal((await send('GET', `/api/notes?target=${target}`)).length, 3);
});

test("trackers: a kid's device adds, edits and deletes only its owner's entries", async () => {
  const { raw, send, leo, maya, leoKey, wallKey, alexKey } = await setup();
  const add = (memberId: string | null, key: string) => raw('POST', '/api/trackers', { kind: 'reading', title: 'Matilda', memberId, data: {} }, key);

  assert.equal((await add(maya.id, leoKey)).status, 403);
  const own = await (await add(leo.id, leoKey)).json() as any;
  const mayas = await (await add(maya.id, wallKey)).json() as any;
  const family = await (await add(null, alexKey)).json() as any;

  assert.equal((await raw('PATCH', `/api/trackers/${mayas.id}`, { title: 'Mine now' }, leoKey)).status, 403);
  assert.equal((await raw('PATCH', `/api/trackers/${own.id}`, { memberId: maya.id }, leoKey)).status, 403, "can't hand it to a sibling");
  assert.equal((await raw('PATCH', `/api/trackers/${own.id}`, { title: 'Matilda (again)' }, leoKey)).status, 200);
  assert.equal((await raw('PATCH', `/api/trackers/${mayas.id}`, { title: 'Wall edit' }, wallKey)).status, 200);

  // Delete: the kid's own only; a wall screen none (as before); a parent's device any.
  assert.equal((await raw('DELETE', `/api/trackers/${mayas.id}`, undefined, leoKey)).status, 403);
  assert.equal((await raw('DELETE', `/api/trackers/${family.id}`, undefined, leoKey)).status, 403);
  assert.equal((await raw('DELETE', `/api/trackers/${mayas.id}`, undefined, wallKey)).status, 403);
  assert.equal((await raw('DELETE', `/api/trackers/${own.id}`, undefined, leoKey)).status, 200);
  assert.equal((await raw('DELETE', `/api/trackers/${mayas.id}`, undefined, alexKey)).status, 200);
  assert.deepEqual((await send('GET', '/api/trackers')).map((e: any) => e.id), [family.id]);
});

test("stickers: a kid's device places stickers only on its owner's scrapbook page", async () => {
  const { raw, leo, maya, leoKey, wallKey, alexKey } = await setup();
  const place = (memberId: string, key: string) => raw('POST', `/api/stickers/scrapbook/${memberId}`, { sticker: '🐶' }, key);

  assert.equal((await place(maya.id, leoKey)).status, 403);
  const own = await (await place(leo.id, leoKey)).json() as any;
  const mayas = await (await place(maya.id, wallKey)).json() as any;
  assert.equal((await place(maya.id, alexKey)).status, 201);

  assert.equal((await raw('PATCH', `/api/stickers/scrapbook/${maya.id}/${mayas.id}`, { x: 0.1 }, leoKey)).status, 403);
  assert.equal((await raw('DELETE', `/api/stickers/scrapbook/${maya.id}/${mayas.id}`, undefined, leoKey)).status, 403);
  assert.equal((await raw('PATCH', `/api/stickers/scrapbook/${leo.id}/${own.id}`, { x: 0.1 }, leoKey)).status, 200);
  assert.equal((await raw('DELETE', `/api/stickers/scrapbook/${leo.id}/${own.id}`, undefined, leoKey)).status, 200);
  assert.equal((await raw('DELETE', `/api/stickers/scrapbook/${maya.id}/${mayas.id}`, undefined, wallKey)).status, 200);
});

test("plugins: a kid's device saves data and play time only for its owner (or the family's shared data)", async () => {
  const { raw, leo, maya, leoKey, wallKey } = await setup();
  const put = (member: string, key: string) => raw('PUT', '/api/plugins/sight-words/data', { member, key: 'progress', value: 1 }, key);
  const play = (member: string, key: string) => raw('POST', '/api/plugins/sight-words/playtime', { member, seconds: 30 }, key);
  // Past the owner check, a missing plugin is a 404.
  assert.equal((await put(maya.id, leoKey)).status, 403);
  assert.equal((await play(maya.id, leoKey)).status, 403);
  assert.equal((await put(leo.id, leoKey)).status, 404);
  assert.equal((await put('', leoKey)).status, 404);
  assert.equal((await play(leo.id, leoKey)).status, 404);
  assert.equal((await put(maya.id, wallKey)).status, 404);
  assert.equal((await play(maya.id, wallKey)).status, 404);
  // Resetting a day's play time is for parent devices, even the kid's own.
  assert.equal((await raw('DELETE', `/api/plugins/sight-words/playtime?member=${leo.id}`, undefined, leoKey)).status, 403);
});
