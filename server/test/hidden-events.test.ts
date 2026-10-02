// Hiding a single event, or every one in its series (docs/using/calendar.md "Hiding events"):
// parents' devices only, on any calendar (read-only synced ones too), kept by the provider's ids so
// a resync never brings them back, and gone for every consumer like a calendar filter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { syncCalendar } from '../src/sync.ts';
import { encryptConfig } from '../src/crypto.ts';
import { runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const RANGE = '/api/events?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const json = async (p: string, method = 'GET', body?: unknown, key = ADMIN_KEY, headers: Record<string, string> = {}) => {
    const res = await app.request(p, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const titles = async (qs = '') => (await json(`${RANGE}${qs}`)).body.map((e: any) => e.hidden ? `${e.title} (${e.hidden})` : e.title);
  return { env, json, titles };
}

// A Google calendar whose feed has a weekly series (inst1..instN) and one single event.
async function googleCalendar(env: Env, count: () => number) {
  const accountId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
    .bind(accountId, 'google', 'test@example.test', await encryptConfig(env, accountId, { access_token: 'tok', refresh_token: 'r1', expires_at: Date.now() + 1e9 }), new Date().toISOString()).run();
  const calendarId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO calendars (id, kind, account_id, remote_id, name, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?)')
    .bind(calendarId, 'google', accountId, 'primary', 'School', await encryptConfig(env, calendarId, {}), 0, 1).run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    if (!String(url).includes('/events?')) throw new Error(`unexpected fetch: ${url}`);
    const items = Array.from({ length: count() }, (_, i) => ({ id: `inst${i + 1}`, recurringEventId: 'lunch-duty', summary: 'Lunch Duty', start: { dateTime: `2026-01-0${i + 1}T17:00:00Z` }, end: { dateTime: `2026-01-0${i + 1}T18:00:00Z` } }));
    items.push({ id: 'fair', summary: 'Science Fair', start: { dateTime: '2026-01-09T17:00:00Z' }, end: { dateTime: '2026-01-09T19:00:00Z' } } as any);
    return Response.json({ items });
  }) as typeof fetch;
  return { calendarId, restore: () => { globalThis.fetch = realFetch; } };
}

test('hide: a Kinwall event is gone until shown again, and parents can still list it', async () => {
  const { json, titles } = await setup();
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).body;
  const fair = (await json('/api/events', 'POST', { calendarId: cal.id, title: 'Science Fair', start: '2026-03-04T17:00:00Z', end: '2026-03-04T18:00:00Z', allDay: false })).body;
  await json('/api/events', 'POST', { calendarId: cal.id, title: 'Soccer', start: '2026-03-05T17:00:00Z', end: '2026-03-05T18:00:00Z', allDay: false });

  const hid = await json(`/api/events/${fair.id}/hidden`, 'PUT', { scope: 'occurrence' });
  assert.equal(hid.status, 200);
  assert.deepEqual([hid.body.title, hid.body.scope, hid.body.start], ['Science Fair', 'occurrence', '2026-03-04T17:00:00Z']);
  assert.deepEqual(await titles(), ['Soccer']);
  assert.deepEqual(await titles('&includeHidden=true'), ['Science Fair (event)', 'Soccer']);

  const list = (await json(`/api/calendars/${cal.id}/hidden`)).body;
  assert.deepEqual(list.map((h: any) => h.title), ['Science Fair']);
  assert.equal((await json(`/api/calendars/${cal.id}/hidden/${list[0].id}`, 'DELETE')).status, 200);
  assert.deepEqual(await titles(), ['Science Fair', 'Soccer']);
  assert.equal((await json(`/api/calendars/${cal.id}/hidden/${list[0].id}`, 'DELETE')).status, 404);

  // Hiding twice is one hide; showing again from the event works too.
  await json(`/api/events/${fair.id}/hidden`, 'PUT', { scope: 'occurrence' });
  await json(`/api/events/${fair.id}/hidden`, 'PUT', { scope: 'occurrence' });
  assert.equal((await json(`/api/calendars/${cal.id}/hidden`)).body.length, 1);
  assert.equal((await json(`/api/events/${fair.id}/hidden?scope=occurrence`, 'DELETE')).status, 200);
  assert.deepEqual(await titles(), ['Science Fair', 'Soccer']);
  // A single event has no series to hide.
  assert.equal((await json(`/api/events/${fair.id}/hidden`, 'PUT', { scope: 'series' })).status, 400);
});

test('hide: one occurrence of a recurring Kinwall event, or the whole series', async () => {
  const { json, titles } = await setup();
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).body;
  const ev = (await json('/api/events', 'POST', { calendarId: cal.id, title: 'Piano', start: '2026-03-02T17:00:00Z', end: '2026-03-02T18:00:00Z', allDay: false, rrule: 'FREQ=WEEKLY;COUNT=3' })).body;
  assert.equal((await json(`/api/events/${ev.id}/hidden`, 'PUT', { scope: 'occurrence' })).status, 400, 'which one?');
  await json(`/api/events/${ev.id}/hidden`, 'PUT', { scope: 'occurrence', occurrenceStart: '2026-03-09T17:00:00.000Z' });
  const starts = async () => (await json(RANGE)).body.map((e: any) => e.start);
  assert.deepEqual(await starts(), ['2026-03-02T17:00:00.000Z', '2026-03-16T17:00:00.000Z']);

  await json(`/api/events/${ev.id}/hidden`, 'PUT', { scope: 'series' });
  assert.deepEqual(await titles(), []);
  assert.deepEqual(await titles('&includeHidden=true'), ['Piano (series)', 'Piano (series)', 'Piano (series)']);
  const list = (await json(`/api/calendars/${cal.id}/hidden`)).body;
  assert.deepEqual(list.map((h: any) => h.scope), ['series'], 'the series covers the one hidden before');
  await json(`/api/events/${ev.id}/hidden?scope=series`, 'DELETE');
  assert.equal((await starts()).length, 3);

  // Deleting a Kinwall event takes its hides with it.
  await json(`/api/events/${ev.id}/hidden`, 'PUT', { scope: 'series' });
  await json(`/api/events/${ev.id}`, 'DELETE');
  assert.deepEqual((await json(`/api/calendars/${cal.id}/hidden`)).body, []);
});

test('hide: a read-only synced event and its series stay hidden across resyncs, including new occurrences', async () => {
  const { env, json, titles } = await setup();
  let n = 3;
  const { calendarId, restore } = await googleCalendar(env, () => n);
  try {
    await syncCalendar(env, calendarId);
    const events = (await json(RANGE)).body;
    const fair = events.find((e: any) => e.title === 'Science Fair');
    const duty = events.find((e: any) => e.title === 'Lunch Duty');
    assert.equal(fair.readOnly, true);
    await json(`/api/events/${fair.id}/hidden`, 'PUT', { scope: 'occurrence' });
    await json(`/api/events/${duty.id}/hidden`, 'PUT', { scope: 'occurrence' });
    assert.deepEqual(await titles(), ['Lunch Duty', 'Lunch Duty']);

    n = 4;
    await syncCalendar(env, calendarId);
    assert.deepEqual(await titles(), ['Lunch Duty', 'Lunch Duty', 'Lunch Duty'], 'the resync kept both hides');

    await json(`/api/events/${duty.id}/hidden`, 'PUT', { scope: 'series' });
    n = 5;
    await syncCalendar(env, calendarId);
    assert.deepEqual(await titles(), [], 'a new occurrence joins its hidden series');
    assert.deepEqual((await json(`/api/calendars/${calendarId}/hidden`)).body.map((h: any) => [h.title, h.scope]), [['Lunch Duty', 'series'], ['Science Fair', 'occurrence']]);
  } finally {
    restore();
  }
});

test("hide: wall screens and kids' devices can't hide, list or show hidden events; connected apps follow calendar settings", async () => {
  const { json } = await setup();
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).body;
  const ev = (await json('/api/events', 'POST', { calendarId: cal.id, title: 'Science Fair', start: '2026-03-04T17:00:00Z', end: '2026-03-04T18:00:00Z', allDay: false })).body;
  const display = (await json('/api/keys', 'POST', { name: 'Wall', scope: 'display' })).body.key;
  assert.equal((await json(`/api/events/${ev.id}/hidden`, 'PUT', { scope: 'occurrence' }, display)).status, 403);
  const hid = (await json(`/api/events/${ev.id}/hidden`, 'PUT', { scope: 'occurrence' })).body;
  assert.equal((await json(`/api/calendars/${cal.id}/hidden`, 'GET', undefined, display)).status, 403);
  assert.equal((await json(`/api/calendars/${cal.id}/hidden/${hid.id}`, 'DELETE', undefined, display)).status, 403);
  assert.equal((await json(`/api/events/${ev.id}/hidden?scope=occurrence`, 'DELETE', undefined, display)).status, 403);
  assert.equal((await json(`${RANGE}&includeHidden=true`, 'GET', undefined, display)).status, 403);
  assert.deepEqual((await json(RANGE, 'GET', undefined, display)).body, []);
  // Like PATCH /api/calendars, an admin-scoped connected app may.
  assert.equal((await json(`/api/events/${ev.id}/hidden?scope=occurrence`, 'DELETE', undefined, ADMIN_KEY, { 'X-Kinwall-Source': 'mcp' })).status, 200);
});

test('hide: no reminder, board line or assistant listing for a hidden event', async () => {
  const { env, json } = await setup();
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).body;
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  const add = async (title: string) => (await json('/api/events', 'POST', { calendarId: cal.id, title, start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), allDay: false, reminders: [30] })).body;
  const fair = await add('Science Fair');
  await add('Soccer');
  await json(`/api/events/${fair.id}/hidden`, 'PUT', { scope: 'occurrence' });

  await runNotifications(env, now);
  const reminders = (await json('/api/notifications')).body.filter((n: any) => n.kind === 'reminder');
  assert.deepEqual(reminders.map((n: any) => n.title), ['Soccer']);
  assert.ok(!(await json('/api/board')).body.events.some((e: any) => e.title === 'Science Fair'));

  const res = await createApp().request('/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_events', arguments: {} } }),
  }, env);
  assert.deepEqual(((await res.json()) as any).result.structuredContent.events.map((e: any) => e.title), ['Soccer']);
});

test('hide: hidden events travel in the export and come back on import', async () => {
  const { json } = await setup();
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family' })).body;
  const ev = (await json('/api/events', 'POST', { calendarId: cal.id, title: 'Science Fair', start: '2026-03-04T17:00:00Z', end: '2026-03-04T18:00:00Z', allDay: false })).body;
  await json(`/api/events/${ev.id}/hidden`, 'PUT', { scope: 'occurrence' });
  const file = (await json('/api/export')).body;
  assert.deepEqual(file.hiddenEvents.map((h: any) => [h.title, h.scope]), [['Science Fair', 'occurrence']]);
  const other = await setup();
  assert.equal((await other.json('/api/import', 'POST', file)).status, 200);
  assert.deepEqual(await other.titles(), []);
  assert.equal((await other.json(`/api/calendars/${cal.id}/hidden`)).body.length, 1);
});
