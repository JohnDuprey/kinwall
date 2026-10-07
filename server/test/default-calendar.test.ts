// The family's default calendar for new events (Settings → Calendars): a parent picks one, and
// otherwise Kinwall picks: the family's own Kinwall calendar before ones fed from elsewhere (a
// Home Assistant meal-kit sync, a school feed), then the first writable one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { pickDefaultCalendar } from '../src/default-calendar.ts';

const cal = (id: string, over: Partial<Parameters<typeof pickDefaultCalendar>[0][number]> = {}) => ({ id, name: id, kind: 'local', writable: 1, enabled: 1, placeholder: 0, fed: 0, ...over });

test('default calendar: the chosen one while it is writable and on, else the fallback order', () => {
  const meals = cal('Meal kit', { fed: 1 });
  const school = cal('School', { kind: 'ics', writable: 0 });
  const shared = cal('Shared', { kind: 'google' });
  const family = cal('Family');
  assert.equal(pickDefaultCalendar([meals, school, shared, family], 'Shared'), 'Shared', 'the chosen one');
  // Unset, or gone, read-only or off: the family's own local calendar first.
  for (const chosen of [null, 'Gone', 'School', 'Off']) {
    assert.equal(pickDefaultCalendar([meals, school, shared, family, cal('Off', { enabled: 0 })], chosen), 'Family', String(chosen));
  }
  // No own local calendar: a writable one not fed by a sync, by name (not the meal kit's).
  assert.equal(pickDefaultCalendar([meals, school, cal('Zed', { kind: 'google' }), shared], null), 'Shared');
  // An account that needs reconnecting isn't saving anything.
  assert.equal(pickDefaultCalendar([meals, cal('Away', { kind: 'google', placeholder: 1 })], null), 'Meal kit', 'only a fed one is left');
  assert.equal(pickDefaultCalendar([school], null), null, 'nothing writable');
  assert.equal(pickDefaultCalendar([], 'Family'), null);
});

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'https://kinwall.example', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const call = async (method: string, path: string, body?: unknown, key = 'test-admin'): Promise<{ status: number; json: any }> => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, json: await res.json() };
  };
  const defaultId = async () => ((await call('GET', '/api/calendars')).json as any[]).filter((c) => c.default).map((c) => c.id);
  return { db, call, defaultId };
}

test('default calendar: GET /api/calendars marks it; a meal-kit sync calendar loses to the family one', async () => {
  const { call, defaultId } = fixture();
  assert.equal((await call('GET', '/api/settings')).json.defaultCalendarId, null, 'unset');
  const meals = (await call('POST', '/api/calendars', { kind: 'local', name: 'A meal kit' })).json;
  assert.deepEqual(await defaultId(), [meals.id], 'the only one');
  // Home Assistant feeds it: it's imported now, and a calendar of the family's own wins.
  const synced = await call('PUT', `/api/calendars/${meals.id}/events/sync`, { source: 'ha:mealkit', events: [{ externalId: 'm1', title: 'Tacos', start: '2027-05-08', end: '2027-05-09', allDay: true }] });
  assert.equal(synced.status, 200, JSON.stringify(synced.json));
  const family = (await call('POST', '/api/calendars', { kind: 'local', name: 'Our Family' })).json;
  assert.deepEqual(await defaultId(), [family.id]);

  // A parent picks one; turning it off falls back.
  assert.equal((await call('PATCH', '/api/settings', { defaultCalendarId: meals.id })).json.defaultCalendarId, meals.id);
  assert.deepEqual(await defaultId(), [meals.id]);
  await call('PATCH', `/api/calendars/${meals.id}`, { enabled: false });
  assert.deepEqual(await defaultId(), [family.id], 'off');
  assert.equal((await call('PATCH', '/api/settings', { defaultCalendarId: null })).json.defaultCalendarId, null, 'cleared');
});

test("default calendar: only a parent's device changes it", async () => {
  const { call } = fixture();
  const family = (await call('POST', '/api/calendars', { kind: 'local', name: 'Our Family' })).json;
  const wall = (await call('POST', '/api/keys', { name: 'Wall', scope: 'display' })).json;
  assert.equal((await call('PATCH', '/api/settings', { defaultCalendarId: family.id }, wall.key)).status, 403);
  assert.equal((await call('GET', '/api/settings')).json.defaultCalendarId, null);
});

test('default calendar: REST, MCP and share create on it when no calendar is given', async () => {
  const { call, db } = fixture();
  await call('POST', '/api/calendars', { kind: 'ics', name: 'School', url: 'https://school.example/cal.ics' });
  const one = { title: 'Swim', start: '2027-05-08T14:00:00Z', end: '2027-05-08T15:00:00Z', allDay: false };
  const none = await call('POST', '/api/events', one);
  assert.equal(none.status, 400, 'nothing writable');
  assert.match(none.json.error, /calendar/);

  const family = (await call('POST', '/api/calendars', { kind: 'local', name: 'Our Family' })).json;
  const shared = (await call('POST', '/api/calendars', { kind: 'local', name: 'Grown-ups' })).json;
  await call('PATCH', '/api/settings', { defaultCalendarId: shared.id });
  const rest = await call('POST', '/api/events', one);
  assert.equal(rest.status, 201, JSON.stringify(rest.json));
  assert.equal(rest.json.calendarId, shared.id);
  assert.equal((await call('POST', '/api/events', { ...one, calendarId: family.id })).json.calendarId, family.id, 'a named one wins');

  const mcp = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_event', arguments: { title: 'Piano', start: '2027-05-09T14:00:00Z', end: '2027-05-09T15:00:00Z' } } });
  assert.equal(mcp.json.result.isError, undefined, JSON.stringify(mcp.json));
  assert.equal(mcp.json.result.structuredContent.event.calendarId, shared.id);

  const share = await call('POST', '/api/share', { kind: 'event', text: 'Title: Bake sale\nDate: 2027-05-10', save: true });
  assert.equal(share.status, 200, JSON.stringify(share.json));
  assert.match(share.json.summary, /^Added Bake sale to Grown-ups/);
  const n = await db.prepare('SELECT count(*) AS n FROM events WHERE calendar_id = ?').bind(shared.id).first<{ n: number }>();
  assert.equal(n?.n, 3);
});
