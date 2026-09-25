import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (p: string, init: RequestInit & { key?: string } = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${init.key ?? ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env);
  const send = async (method: string, p: string, body?: unknown, key?: string) => {
    const res = await request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), key });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { env, send };
}

async function household(send: ReturnType<typeof makeApp>['send']) {
  const ada = (await send('POST', '/api/members', { name: 'Ada', color: '#ff0000' })).body;
  const cal = (await send('POST', '/api/calendars', { kind: 'local', name: 'Family' })).body;
  const ev = (await send('POST', '/api/events', { calendarId: cal.id, title: 'Soccer', start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T16:00:00.000Z', allDay: false, rrule: 'FREQ=WEEKLY' })).body;
  const list = (await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' })).body;
  const [item, other] = (await send('POST', `/api/lists/${list.id}/items`, [{ title: 'Vacuum' }, { title: 'Dust' }])).body;
  return { ada, cal, ev, list, item, other };
}

test('notes: CRUD, validation, and oldest-first threads', async () => {
  const { send } = makeApp();
  const { ada, ev } = await household(send);
  const target = `event:${ev.id}`;

  const a = await send('POST', '/api/notes', { target, body: '  Bring shin guards  ', memberId: ada.id });
  assert.equal(a.status, 201);
  assert.deepEqual([a.body.targetType, a.body.targetId, a.body.memberId, a.body.body], ['event', ev.id, ada.id, 'Bring shin guards']);
  const b = await send('POST', '/api/notes', { target, body: 'Carpool with the Smiths' });
  assert.equal(b.body.memberId, null); // "Someone"

  const thread = await send('GET', `/api/notes?target=${encodeURIComponent(target)}`);
  assert.deepEqual(thread.body.map((n: any) => n.body), ['Bring shin guards', 'Carpool with the Smiths']);

  const edited = await send('PATCH', `/api/notes/${a.body.id}`, { body: 'Shin guards + water' });
  assert.equal(edited.body.body, 'Shin guards + water');
  assert.ok(edited.body.updatedAt >= edited.body.createdAt);
  assert.equal((await send('DELETE', `/api/notes/${b.body.id}`)).status, 200);
  assert.equal((await send('GET', `/api/notes?target=${encodeURIComponent(target)}`)).body.length, 1);

  assert.equal((await send('POST', '/api/notes', { target, body: '   ' })).status, 400);
  assert.equal((await send('POST', '/api/notes', { target, body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await send('POST', '/api/notes', { target: 'chore:1', body: 'hi' })).status, 400);
  assert.equal((await send('POST', '/api/notes', { target, body: 'hi', memberId: 'nobody' })).status, 400);
  assert.equal((await send('POST', '/api/notes', { target: 'event:missing', body: 'hi' })).status, 404);
  assert.equal((await send('POST', '/api/notes', { target: 'list_item:missing', body: 'hi' })).status, 404);
  assert.equal((await send('PATCH', '/api/notes/missing', { body: 'hi' })).status, 404);
  assert.equal((await send('DELETE', '/api/notes/missing')).status, 404);

  // A deleted member's notes stay, now by "Someone".
  await send('DELETE', `/api/members/${ada.id}`);
  assert.equal((await send('GET', `/api/notes?target=${encodeURIComponent(target)}`)).body[0].memberId, null);
});

test('notes: noteCount on event instances (every occurrence of a local series) and list items', async () => {
  const { send } = makeApp();
  const { ev, list, item } = await household(send);
  await send('POST', '/api/notes', { target: `event:${ev.id}`, body: 'one' });
  await send('POST', '/api/notes', { target: `event:${ev.id}`, body: 'two' });
  await send('POST', '/api/notes', { target: `list_item:${item.id}`, body: 'three' });

  const events = (await send('GET', '/api/events?from=2026-10-01&to=2026-10-15')).body;
  assert.deepEqual(events.map((e: any) => e.noteCount), [2, 2]);
  const detail = (await send('GET', `/api/lists/${list.id}`)).body;
  assert.deepEqual(detail.items.map((i: any) => [i.title, i.noteCount]).sort(), [['Dust', 0], ['Vacuum', 1]]);
});

test('notes: deleted with their target (event, item, cleared items, list, calendar)', async () => {
  const { env, send } = makeApp();
  const { cal, ev, list, item, other } = await household(send);
  const count = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM notes').first<{ n: number }>())!.n;
  await send('POST', '/api/notes', { target: `event:${ev.id}`, body: 'e' });
  await send('POST', '/api/notes', { target: `list_item:${item.id}`, body: 'i' });
  await send('POST', '/api/notes', { target: `list_item:${other.id}`, body: 'o' });
  assert.equal(await count(), 3);

  await send('DELETE', `/api/events/${ev.id}`);
  assert.equal(await count(), 2);
  await send('DELETE', `/api/lists/${list.id}/items/${item.id}`);
  assert.equal(await count(), 1);
  await send('PATCH', `/api/lists/${list.id}/items/${other.id}`, { done: true });
  await send('POST', `/api/lists/${list.id}/clear-completed`);
  assert.equal(await count(), 0);

  const list2 = (await send('POST', '/api/lists', { name: 'L2', kind: 'todo' })).body;
  const [it] = (await send('POST', `/api/lists/${list2.id}/items`, { title: 'x' })).body;
  await send('POST', '/api/notes', { target: `list_item:${it.id}`, body: 'x' });
  const ev2 = (await send('POST', '/api/events', { calendarId: cal.id, title: 'Y', start: '2026-10-01', end: '2026-10-02', allDay: true })).body;
  await send('POST', '/api/notes', { target: `event:${ev2.id}`, body: 'y' });
  await send('DELETE', `/api/lists/${list2.id}`);
  await send('DELETE', `/api/calendars/${cal.id}`);
  assert.equal(await count(), 0);
});

test('notes: a display key can read and write threads; writes bump rev', async () => {
  const { send } = makeApp();
  const { ev } = await household(send);
  const { key } = (await send('POST', '/api/keys', { name: 'Wall', scope: 'display' })).body;
  const rev = async () => (await send('GET', '/api/rev')).body.rev;
  const before = await rev();
  const note = await send('POST', '/api/notes', { target: `event:${ev.id}`, body: 'from the wall' }, key);
  assert.equal(note.status, 201);
  await new Promise((r) => setTimeout(r, 10)); // rev bumps in the background
  assert.ok((await rev()) > before);
  assert.equal((await send('GET', `/api/notes?target=event:${ev.id}`, undefined, key)).status, 200);
  assert.equal((await send('PATCH', `/api/notes/${note.body.id}`, { body: 'edited' }, key)).status, 200);
  assert.equal((await send('DELETE', `/api/notes/${note.body.id}`, undefined, key)).status, 200);
});
