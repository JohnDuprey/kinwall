// Calendar filters (docs/using/calendar.md "Calendar filters"): per calendar, only matching events
// or everything except them, evaluated at read time so every consumer (calendar, board, snapshot,
// reminders, daily summary, MCP) gets the same answer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runNotifications } from '../src/notify.ts';
import { filterShows, filterMatches, parseFilter, NO_FILTER, type CalendarFilter } from '../src/calendar-filter.ts';
import * as web from '../../web/src/calendarFilter.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
}

function makeApp(env: Env) {
  const app = createApp();
  return (p: string, init: RequestInit & { key?: string } = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${init.key ?? ADMIN_KEY}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
}

const f = (over: Partial<CalendarFilter>): CalendarFilter => ({ ...NO_FILTER, ...over });
const ev = (title: string, allDay = true, categoryId: string | null = null) => ({ title, allDay, categoryId });
const school = web.FILTER_PRESETS.find((p) => p.id === 'school')!.filter;

test('filters: keywords match whole words and phrases, ignoring case', () => {
  const only = f({ mode: 'only', keywords: ['break', 'no school', 'half day'] });
  assert.ok(filterMatches(only, ev('Winter Break – No School')));
  assert.ok(filterMatches(only, ev('HALF DAY - early release')));
  assert.ok(filterMatches(only, ev('No school: Teacher Workday')));
  assert.ok(!filterMatches(only, ev('Breakfast with Principal')), '"break" is not "Breakfast"');
  assert.ok(!filterMatches(only, ev('School Board meeting')), 'a phrase needs all its words, together');
});

test('filters: each mode, the all-day condition and the category condition', () => {
  const soccer = ev('Soccer practice', false, 'sports');
  const bday = ev("Maya's Birthday", true, 'bdays');
  assert.ok(filterShows(NO_FILTER, soccer));
  assert.ok(filterShows(f({ mode: 'only', keywords: ['soccer'] }), soccer));
  assert.ok(!filterShows(f({ mode: 'only', keywords: ['soccer'] }), bday));
  assert.ok(!filterShows(f({ mode: 'except', keywords: ['birthday'] }), bday));
  assert.ok(filterShows(f({ mode: 'except', keywords: ['birthday'] }), soccer));
  // all-day / timed
  assert.ok(filterShows(f({ mode: 'only', allDay: 'allDay' }), bday));
  assert.ok(!filterShows(f({ mode: 'only', allDay: 'allDay' }), soccer));
  assert.ok(!filterShows(f({ mode: 'except', allDay: 'timed' }), soccer));
  // keyword AND all-day: a timed "Holiday party" isn't a day off
  assert.ok(!filterShows(f({ mode: 'only', keywords: ['holiday'], allDay: 'allDay' }), ev('Holiday party', false)));
  // category
  assert.ok(filterShows(f({ mode: 'only', categoryIds: ['sports'] }), soccer));
  assert.ok(!filterShows(f({ mode: 'only', categoryIds: ['sports'] }), bday));
  assert.ok(!filterShows(f({ mode: 'except', categoryIds: ['bdays', 'x'] }), bday));
  // a rule with nothing in it does nothing, in either mode
  assert.ok(filterShows(f({ mode: 'only' }), soccer));
  assert.ok(filterShows(f({ mode: 'except' }), soccer));
  // stored JSON that can't be read is no filter
  assert.deepEqual(parseFilter('{nope'), NO_FILTER);
  assert.deepEqual(parseFilter(JSON.stringify({ mode: 'weird', keywords: ['a', 3, ' '], allDay: 'x' })), f({ keywords: ['a'] }));
});

test('filters: the School preset keeps days off and half days, not ordinary school events', () => {
  for (const title of ['Winter Break – No School', 'Half Day - Early Release', 'Thanksgiving Recess', 'Labor Day', 'Professional Development Day - No Students', 'Snow Day', 'Spring Break', 'Parent-Teacher Conferences', 'Early Dismissal 12:30'])
    assert.ok(filterShows(school, ev(title)), title);
  for (const title of ['Breakfast with Principal', 'Picture Day', 'Science Fair', 'First Day of School', 'Back to School Night', 'Book Fair'])
    assert.ok(!filterShows(school, ev(title)), title);
  assert.ok(!filterShows(school, ev('Holiday Concert', false)), 'a timed event is not a day off');
});

test("filters: the web mirror agrees with the server's matcher", () => {
  const titles = ['Winter Break – No School', 'Breakfast with Principal', 'HALF-DAY', 'half day', 'Café Día', 'Soccer (away)', "Presidents' Day", 'bday party', 'Holiday party', ''];
  const filters = [school, ...web.FILTER_PRESETS.map((p) => p.filter), f({ mode: 'only', keywords: ['día', '(away)', 'half-day'] }), f({ mode: 'except', allDay: 'timed', categoryIds: ['c'] })];
  for (const filter of filters) for (const title of titles) for (const allDay of [true, false]) for (const cat of [null, 'c']) {
    const e = ev(title, allDay, cat);
    assert.equal(web.filterShows(filter, e), filterShows(filter, e), `${filter.mode} ${title} ${allDay} ${cat}`);
  }
});

async function setup() {
  const env = makeEnv();
  const request = makeApp(env);
  const json = async (p: string, method = 'GET', body?: unknown, key?: string) => {
    const res = await request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), key });
    return { status: res.status, body: (await res.json()) as any };
  };
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'School' })).body;
  const add = async (title: string, start: string, end: string, allDay: boolean, extra: object = {}) =>
    (await json('/api/events', 'POST', { calendarId: cal.id, title, start, end, allDay, ...extra })).body;
  return { env, request, json, cal, add };
}

test('filters: GET/PATCH /api/calendars carry the filter, and events read without the filtered ones', async () => {
  const { json, cal, add } = await setup();
  assert.deepEqual(cal.filter, NO_FILTER);
  await add('Winter Break – No School', '2030-12-23', '2031-01-02', true);
  await add('Breakfast with Principal', '2030-12-20T13:00:00Z', '2030-12-20T14:00:00Z', false);
  await add('Half Day - Early Release', '2030-12-20', '2030-12-21', true);

  const patched = await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: school });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.filter.mode, 'only');
  assert.deepEqual((await json('/api/calendars')).body[0].filter, patched.body.filter);

  const range = '/api/events?from=2030-12-01T00:00:00Z&to=2031-02-01T00:00:00Z';
  assert.deepEqual((await json(range)).body.map((e: any) => e.title), ['Half Day - Early Release', 'Winter Break – No School']);
  // Parents can ask for everything (the settings preview), each marked with why it's hidden.
  const all = (await json(`${range}&includeHidden=true`)).body;
  assert.deepEqual(all.map((e: any) => [e.title, e.hidden]), [['Half Day - Early Release', null], ['Breakfast with Principal', 'filter'], ['Winter Break – No School', null]]);

  // Changing the filter needs no resync.
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: { mode: 'except', keywords: ['breakfast'], allDay: 'any', categoryIds: [] } });
  assert.equal((await json(range)).body.length, 2);
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: null });
  assert.equal((await json(range)).body.length, 3);
});

test('filters: bad filters are refused', async () => {
  const { json, cal } = await setup();
  assert.equal((await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: { mode: 'sometimes', keywords: [], allDay: 'any', categoryIds: [] } })).status, 400);
  assert.equal((await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: { mode: 'only', keywords: ['x'.repeat(201)], allDay: 'any', categoryIds: [] } })).status, 400);
});

test("filters: wall screens and kids' devices can't change a filter or see filtered events", async () => {
  const { json, cal, add } = await setup();
  await add('Winter Break', '2030-12-23', '2031-01-02', true);
  await add('Science Fair', '2030-12-20T13:00:00Z', '2030-12-20T14:00:00Z', false);
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: school });
  const display = (await json('/api/keys', 'POST', { name: 'Wall', scope: 'display' })).body.key;
  assert.equal((await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: null }, display)).status, 403);
  const range = '/api/events?from=2030-12-01T00:00:00Z&to=2031-02-01T00:00:00Z';
  assert.deepEqual((await json(range, 'GET', undefined, display)).body.map((e: any) => e.title), ['Winter Break']);
  assert.equal((await json(`${range}&includeHidden=true`, 'GET', undefined, display)).status, 403);
});

test('filters: the board and snapshots leave filtered events out', async () => {
  const { json, cal, add } = await setup();
  const maya = (await json('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' })).body;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  await add('Science Fair', today, tomorrow, true);
  await add('Half Day', today, tomorrow, true);
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: school });
  const board = (await json('/api/board')).body;
  assert.deepEqual(board.events.map((e: any) => e.title), ['Half Day']);
  const snap = (await json(`/api/snapshot?member=${maya.id}`)).body;
  assert.deepEqual(snap.events.map((e: any) => e.title), ['Half Day']);
});

test('filters: no reminder for a filtered event', async () => {
  const { env, json, cal, add } = await setup();
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  const end = new Date(start.getTime() + 3600e3);
  await add('Science Fair', start.toISOString(), end.toISOString(), false, { reminders: [30] });
  await add('Early Release Pickup', start.toISOString(), end.toISOString(), false, { reminders: [30] });
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: { mode: 'except', keywords: ['science fair'], allDay: 'any', categoryIds: [] } });
  await runNotifications(env, now);
  const reminders = (await json('/api/notifications')).body.filter((n: any) => n.kind === 'reminder');
  assert.deepEqual(reminders.map((n: any) => n.title), ['Early Release Pickup']);
});

test('filters: the daily summary counts only shown events', async () => {
  const { env, json, cal, add } = await setup();
  await add('Science Fair', '2030-03-04T15:00:00Z', '2030-03-04T16:00:00Z', false);
  await add('Early Release Pickup', '2030-03-04T17:00:00Z', '2030-03-04T18:00:00Z', false);
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: { mode: 'except', keywords: ['science fair'], allDay: 'any', categoryIds: [] } });
  await runNotifications(env, new Date('2030-03-04T07:30:00Z'));
  await runNotifications(env, new Date('2030-03-04T08:00:00Z'));
  const summary = (await json('/api/notifications')).body.find((n: any) => n.kind === 'summary');
  assert.match(summary.body, /^1 event · 0 chores — Early Release Pickup/);
});

test('filters: MCP lists the filter with the calendars and leaves filtered events out', async () => {
  const { env, json, cal, add } = await setup();
  await add('Winter Break', '2030-12-23', '2031-01-02', true);
  await add('Science Fair', '2030-12-20T13:00:00Z', '2030-12-20T14:00:00Z', false);
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: school });
  const app = createApp();
  let id = 1;
  const call = async (name: string, args: object) => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
    }, env);
    return ((await res.json()) as any).result.structuredContent;
  };
  assert.equal((await call('get_household', {})).calendars[0].filter.mode, 'only');
  assert.deepEqual((await call('list_events', { from: '2030-12-01', to: '2031-01-31' })).events.map((e: any) => e.title), ['Winter Break']);
});

test('filters: a calendar filter travels in the export and comes back on import', async () => {
  const { json, cal } = await setup();
  await json(`/api/calendars/${cal.id}`, 'PATCH', { filter: school });
  const file = (await json('/api/export')).body;
  assert.equal(file.calendars[0].filter.mode, 'only');
  const other = await setup();
  assert.equal((await other.json('/api/import', 'POST', file)).status, 200);
  const imported = (await other.json('/api/calendars')).body.find((c: any) => c.id === cal.id);
  assert.deepEqual(imported.filter, (await json('/api/calendars')).body[0].filter);
});
