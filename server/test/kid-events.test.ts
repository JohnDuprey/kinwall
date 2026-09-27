import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = 'ke_test_admin';

// Kids' devices (a display key pinned to a member) change only events on their own calendars, and
// no display changes events on a calendar with "Wall screens and kids' devices can edit" off.
async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(__dirname, '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const req = (p: string, init: RequestInit = {}, key = ADMIN) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${key}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
  const json = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await req(p, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, key);
    return { status: res.status, body: (await res.json()) as any };
  };
  const member = async (name: string) => (await json('/api/members', 'POST', { name, color: '#123456' })).body.id as string;
  const alex = await member('Alex');
  const sam = await member('Sam');
  const maya = await member('Maya'); // no calendar of her own
  const calendar = async (name: string, memberIds: string[]) => (await json('/api/calendars', 'POST', { kind: 'local', name, memberIds })).body.id as string;
  const alexCal = await calendar('Alex', [alex]);
  const samCal = await calendar('Sam', [sam]);
  const familyCal = await calendar('Family', []); // "Who is this for?" Nobody
  const display = async (owner: string | null) => {
    const k = (await json('/api/keys', 'POST', { name: 'Tablet', scope: 'display' })).body;
    if (owner) assert.equal((await json(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const event = async (calendarId: string, key = ADMIN, extra: object = {}) =>
    json('/api/events', 'POST', { calendarId, title: 'Practice', start: '2026-10-01T16:00:00Z', end: '2026-10-01T17:00:00Z', allDay: false, ...extra }, key);
  return { json, alex, sam, maya, alexCal, samCal, familyCal, display, event };
}

test("kid's device: create, edit and delete on its own calendar only", async () => {
  const { json, alex, alexCal, samCal, familyCal, display, event } = await setup();
  const kid = await display(alex);

  // Own calendar: create, edit (and a series edit), delete.
  const own = await event(alexCal, kid, { rrule: 'FREQ=WEEKLY' });
  assert.equal(own.status, 201);
  assert.equal((await json(`/api/events/${own.body.id}`, 'PATCH', { title: 'Soccer' }, kid)).status, 200);
  assert.equal((await json(`/api/events/${own.body.id}`, 'PATCH', { title: 'Soccer all season', scope: 'series' }, kid)).status, 200);

  // Someone else's calendar and a Nobody calendar: 403 on create, edit (including member tags) and delete.
  for (const cal of [samCal, familyCal]) {
    const res = await event(cal, kid);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /only change events on Alex's calendars/);
    const other = (await event(cal)).body.id;
    assert.equal((await json(`/api/events/${other}`, 'PATCH', { title: 'Hacked' }, kid)).status, 403);
    assert.equal((await json(`/api/events/${other}`, 'PATCH', { memberIds: [alex] }, kid)).status, 403);
    assert.equal((await json(`/api/events/${other}`, 'DELETE', undefined, kid)).status, 403);
    assert.equal((await json(`/api/events/${other}`, 'GET', undefined, kid)).status, 200, 'reading is unchanged');
  }

  // No moves either way: PATCH has no calendarId, so an event stays on its calendar.
  const moved = await json(`/api/events/${own.body.id}`, 'PATCH', { calendarId: samCal, title: 'Moved?' }, kid);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.calendarId, alexCal);
  const samEvent = (await event(samCal)).body.id;
  assert.equal((await json(`/api/events/${samEvent}`, 'PATCH', { calendarId: alexCal }, kid)).status, 403);

  // Tasks: linking one to Sam's event is refused, to Alex's own is fine; ticking stays a list edit.
  const list = (await json('/api/lists', 'POST', { name: 'To do', kind: 'todo' })).body.id;
  assert.equal((await json(`/api/lists/${list}/items`, 'POST', { title: 'Pack bag', eventId: samEvent }, kid)).status, 403);
  const task = await json(`/api/lists/${list}/items`, 'POST', { title: 'Pack bag', eventId: own.body.id }, kid);
  assert.equal(task.status, 201);
  const taskId = (Array.isArray(task.body) ? task.body[0] : task.body).id;
  assert.equal((await json(`/api/lists/${list}/items/${taskId}`, 'PATCH', { eventId: samEvent }, kid)).status, 403);
  assert.equal((await json(`/api/lists/${list}/items/${taskId}`, 'PATCH', { done: true }, kid)).status, 200);

  // Notes on someone else's event are conversation, not an edit.
  assert.equal((await json('/api/notes', 'POST', { target: `event:${samEvent}`, body: 'Can I come?', memberId: alex }, kid)).status, 201);

  // The calendars list tells the app which ones this device may change.
  const cals = (await json('/api/calendars', 'GET', undefined, kid)).body as any[];
  assert.deepEqual(cals.filter((c) => c.canEditEvents).map((c) => c.id), [alexCal]);

  assert.equal((await json(`/api/events/${own.body.id}`, 'DELETE', undefined, kid)).status, 200);
});

test("kid's device with no calendar can't add events; shared displays and admins are unaffected", async () => {
  const { json, maya, samCal, familyCal, display, event } = await setup();
  assert.equal((await event(familyCal, await display(maya))).status, 403);

  for (const key of [await display('shared'), await display(null), ADMIN]) {
    const created = await event(samCal, key);
    assert.equal(created.status, 201);
    assert.equal((await json(`/api/events/${created.body.id}`, 'PATCH', { title: 'Moved' }, key)).status, 200);
    assert.equal((await json(`/api/events/${created.body.id}`, 'DELETE', undefined, key)).status, 200);
  }
});

test("calendar switch: displays can't change events on a calendar with it off; admins still can", async () => {
  const { json, alex, alexCal, display, event } = await setup();
  const kid = await display(alex);
  const wall = await display('shared');

  // Existing (and new) calendars start with it on.
  assert.equal((await json(`/api/calendars`)).body.find((c: any) => c.id === alexCal).displayEdit, true);
  const ev = (await event(alexCal)).body.id;

  assert.equal((await json(`/api/calendars/${alexCal}`, 'PATCH', { displayEdit: false }, wall)).status, 403, 'only admins change it');
  assert.equal((await json(`/api/calendars/${alexCal}`, 'PATCH', { displayEdit: false })).body.displayEdit, false);
  for (const key of [kid, wall]) {
    const res = await event(alexCal, key);
    assert.equal(res.status, 403);
    assert.match(res.body.error, /parent's device/);
    assert.equal((await json(`/api/events/${ev}`, 'PATCH', { title: 'x' }, key)).status, 403);
    assert.equal((await json(`/api/events/${ev}`, 'DELETE', undefined, key)).status, 403);
    assert.equal((await json('/api/calendars', 'GET', undefined, key)).body.find((c: any) => c.id === alexCal).canEditEvents, false);
  }
  assert.equal((await json(`/api/events/${ev}`, 'PATCH', { title: 'Admin edit' })).status, 200);

  assert.equal((await json(`/api/calendars/${alexCal}`, 'PATCH', { displayEdit: true })).status, 200);
  for (const key of [kid, wall]) assert.equal((await json(`/api/events/${ev}`, 'PATCH', { title: 'Back on' }, key)).status, 200);
});

test('calendar switch: calendars from before the migration keep display editing on', () => {
  const db = openDb(':memory:');
  const dir = path.join(__dirname, '..', 'migrations');
  const m = '0036_calendar_display_edit.sql';
  db.exec('CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT)');
  db.prepare('INSERT INTO _migrations (name) VALUES (?)').bind(m).run(); // hold it back
  applyMigrations(db, dir);
  db.exec("INSERT INTO calendars (id, kind, name, config) VALUES ('old', 'local', 'Old', '{}')");
  db.prepare('DELETE FROM _migrations WHERE name = ?').bind(m).run();
  applyMigrations(db, dir);
  assert.equal(db.prepare("SELECT display_edit FROM calendars WHERE id = 'old'").first<{ display_edit: number }>()?.display_edit, 1);
});
