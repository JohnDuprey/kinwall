import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = 'ke_test_admin';

// PUT /api/calendars/{id}/events/sync: an automation (Home Assistant) pushes the events it owns
// from one source; Kinwall upserts them and drops the ones that are gone.
async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(__dirname, '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const json = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const headers = new Headers({ Authorization: `Bearer ${key}` });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const res = await app.request(p, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family', memberIds: [] })).body.id as string;
  const events = async () =>
    ((await json(`/api/events?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z&calendarId=${cal}`)).body as any[]).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const sync = (body: object, key = ADMIN, id = cal) => json(`/api/calendars/${id}/events/sync`, 'PUT', body, key);
  return { env, json, cal, events, sync };
}

const delivery = { externalId: 'delivery-1', title: 'HelloFresh delivery', start: '2026-10-07T12:00:00Z', end: '2026-10-08T00:00:00Z', allDay: false, notes: 'Tacos' };
const deadline = { externalId: 'deadline-1', title: 'Pick HelloFresh meals', start: '2026-10-02', end: '2026-10-03', allDay: true };

test('sync creates, updates and deletes missing events from its source', async () => {
  const { cal, events, sync } = await setup();
  const first = await sync({ source: 'ha:hellofresh', events: [delivery, deadline] });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { created: 2, updated: 0, deleted: 0 });
  let list = await events();
  assert.deepEqual(list.map((e) => [e.title, e.start, e.allDay, e.description]), [
    ['Pick HelloFresh meals', '2026-10-02', true, null],
    ['HelloFresh delivery', '2026-10-07T12:00:00.000Z', false, 'Tacos'],
  ]);
  assert.ok(list.every((e) => e.calendarId === cal && !e.readOnly), 'synced events are normal local events');

  const second = await sync({ source: 'ha:hellofresh', events: [{ ...delivery, notes: 'Tacos, Pasta', location: 'Porch' }] });
  assert.deepEqual(second.body, { created: 0, updated: 1, deleted: 1 });
  list = await events();
  assert.equal(list.length, 1);
  assert.equal(list[0].description, 'Tacos, Pasta');
  assert.equal(list[0].location, 'Porch');
});

test('sending the same payload twice changes nothing', async () => {
  const { events, sync } = await setup();
  const body = { source: 'ha:hellofresh', events: [delivery, deadline] };
  await sync(body);
  const before = await events();
  assert.deepEqual((await sync(body)).body, { created: 0, updated: 0, deleted: 0 });
  assert.deepEqual(await events(), before);
});

test('deletes are limited to the from/to window and to the same source', async () => {
  const { json, cal, events, sync } = await setup();
  const past = { externalId: 'delivery-0', title: 'HelloFresh delivery', start: '2026-09-02', end: '2026-09-03', allDay: true };
  await sync({ source: 'ha:hellofresh', events: [past, delivery, deadline] });
  await sync({ source: 'ha:other', events: [{ ...deadline, title: 'Other source' }] });
  const mine = await json('/api/events', 'POST', { calendarId: cal, title: 'Soccer', start: '2026-10-05T16:00:00Z', end: '2026-10-05T17:00:00Z', allDay: false });
  assert.equal(mine.status, 201);

  const res = await sync({ source: 'ha:hellofresh', from: '2026-09-27', to: '2026-11-08', events: [deadline] });
  assert.deepEqual(res.body, { created: 0, updated: 0, deleted: 1 });
  assert.deepEqual((await events()).map((e) => e.title), ['HelloFresh delivery', 'Other source', 'Pick HelloFresh meals', 'Soccer']);
  assert.equal((await events())[0].start, '2026-09-02', 'the past delivery outside the window stays');

  // An empty list with no window clears the source entirely, still leaving the user's event.
  assert.deepEqual((await sync({ source: 'ha:hellofresh', events: [] })).body, { created: 0, updated: 0, deleted: 2 });
  assert.deepEqual((await events()).map((e) => e.title), ['Other source', 'Soccer']);
});

test('only local calendars, only admin keys', async () => {
  const { env, json, cal, sync } = await setup();
  await env.DB.prepare("INSERT INTO calendars (id, kind, name, config, writable, enabled) VALUES ('g1', 'google', 'G', '{}', 1, 1)").run();
  const remote = await sync({ source: 'ha:hellofresh', events: [delivery] }, ADMIN, 'g1');
  assert.equal(remote.status, 400);
  assert.match(remote.body.error, /local/);
  assert.equal((await sync({ source: 'ha:hellofresh', events: [delivery] }, ADMIN, 'nope')).status, 404);

  const display = (await json('/api/keys', 'POST', { name: 'Tablet', scope: 'display' })).body.key as string;
  assert.equal((await sync({ source: 'ha:hellofresh', events: [delivery] }, display)).status, 403);
  assert.equal((await sync({ source: 'ha:hellofresh', events: [{ ...delivery, start: 'soon' }] })).status, 400);
  void cal;
});

test('export and import keep an event synced, so the next sync updates it instead of duplicating', async () => {
  const a = await setup();
  await a.sync({ source: 'ha:hellofresh', events: [delivery] });
  const file = (await a.json('/api/export')).body;
  assert.equal(file.events[0].syncSource, 'ha:hellofresh');
  assert.equal(file.events[0].externalId, 'delivery-1');

  const b = await setup();
  assert.equal((await b.json('/api/import', 'POST', file)).status, 200);
  assert.deepEqual((await b.sync({ source: 'ha:hellofresh', events: [delivery] }, ADMIN, a.cal)).body, { created: 0, updated: 0, deleted: 0 });
});

test('free/busy: events are busy unless told otherwise; REST create, update and the sync take busy', async () => {
  const { env, json, cal, events, sync } = await setup();
  // A row written before migration 0073 (no busy column value) reads as busy.
  await env.DB.prepare("INSERT INTO events (id, calendar_id, title, start, end, all_day, member_ids, updated_at) VALUES ('old', ?, 'Old', '2026-10-01T10:00:00.000Z', '2026-10-01T11:00:00.000Z', 0, '[]', '')").bind(cal).run();
  const made = await json('/api/events', 'POST', { calendarId: cal, title: 'Soccer', start: '2026-10-02T10:00:00Z', end: '2026-10-02T11:00:00Z', allDay: false, travelMinutes: 15 });
  assert.equal(made.body.busy, true);
  assert.ok(made.body.leaveAt, 'busy: has a leave-by');
  const free = await json(`/api/events/${made.body.id}`, 'PATCH', { busy: false });
  assert.equal(free.status, 200);
  assert.equal(free.body.busy, false);
  assert.equal(free.body.leaveAt, null, 'a free event never asks anyone to leave');
  assert.equal(free.body.travelMinutes, 15, 'travel time is kept');
  const window = await json('/api/events', 'POST', { calendarId: cal, title: 'Window', start: '2026-10-03T10:00:00Z', end: '2026-10-03T20:00:00Z', allDay: false, busy: false });
  assert.equal(window.body.busy, false);

  await sync({ source: 'ha:hellofresh', events: [{ ...delivery, busy: false }, deadline] });
  const byTitle = async () => new Map((await events()).map((e) => [e.title, e.busy]));
  let list = await byTitle();
  assert.deepEqual([list.get('Old'), list.get('Soccer'), list.get('Window'), list.get('HelloFresh delivery'), list.get('Pick HelloFresh meals')], [true, false, false, false, true]);
  // Same payload: nothing changes. Dropping busy makes it busy again (the sync is the whole truth).
  assert.deepEqual((await sync({ source: 'ha:hellofresh', events: [{ ...delivery, busy: false }, deadline] })).body, { created: 0, updated: 0, deleted: 0 });
  assert.deepEqual((await sync({ source: 'ha:hellofresh', events: [delivery, deadline] })).body, { created: 0, updated: 1, deleted: 0 });
  list = await byTitle();
  assert.equal(list.get('HelloFresh delivery'), true);

  // Export and import keep it.
  await sync({ source: 'ha:hellofresh', events: [{ ...delivery, busy: false }] });
  const exported = (await json('/api/export')).body;
  assert.equal(exported.events.find((e: any) => e.title === 'HelloFresh delivery').busy, false);
  assert.equal(exported.events.find((e: any) => e.title === 'Old').busy, true);
});
