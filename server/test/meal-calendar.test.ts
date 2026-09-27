import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { encryptConfig } from '../src/crypto.ts';
import type { Env } from '../src/env.ts';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    const res = await request(path, method, body); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  return { env, request, json };
}

// A connected Google calendar whose API is a fake that records every write.
async function google(env: Env) {
  const accountId = crypto.randomUUID(); const calendarId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
    .bind(accountId, 'google', 'family@example.test', await encryptConfig(env, accountId, { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 1e9 }), new Date().toISOString()).run();
  await env.DB.prepare('INSERT INTO calendars (id, kind, account_id, remote_id, name, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?)')
    .bind(calendarId, 'google', accountId, 'family', 'Family', await encryptConfig(env, calendarId, {}), 1, 1).run();
  const calls: { method: string; url: string; body: any }[] = [];
  const items = new Map<string, any>();
  const realFetch = globalThis.fetch;
  let fail = false;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const method = init?.method ?? 'GET'; const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url: String(url), body });
    if (fail) return new Response('backend error', { status: 500 });
    const id = String(url).match(/\/events\/([^/?]+)$/)?.[1];
    if (method === 'POST') { const item = { id: `g${items.size + 1}`, ...body }; items.set(item.id, item); return Response.json(item); }
    if (method === 'PATCH' && id) { const item = { ...items.get(id), ...body }; items.set(id, item); return Response.json(item); }
    if (method === 'DELETE' && id) { items.delete(id); return new Response(null, { status: 204 }); }
    throw new Error(`unexpected ${method} ${url}`);
  }) as typeof fetch;
  return { calendarId, calls, items, restore: () => { globalThis.fetch = realFetch; }, failNext: (v: boolean) => { fail = v; } };
}

test('meal calendar: an event on a synced calendar goes through the provider, and follows the meal', async () => {
  const { env, json, request } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const alex = await json('/api/members', 'POST', { name: 'Alex', color: '#123456' });
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#654321' });
  const recipe = await json('/api/recipes', 'POST', { name: 'Tacos', totalMinutes: 40, ingredients: [] });
  const meal = await json('/api/meals', 'POST', { date: '2026-10-05', slot: 'dinner', recipeId: recipe.id, eaterIds: [maya.id], assigneeMemberId: alex.id });
  const g = await google(env);
  try {
    const linked = await json(`/api/meals/${meal.id}/calendar-event`, 'POST', { calendarId: g.calendarId, eventStart: 'cooking' });
    assert.equal(linked.calendarEventStart, 'cooking');
    const created = g.calls.find((call) => call.method === 'POST')!;
    assert.match(created.url, /\/calendars\/family\/events$/);
    // Dinner at 18:00 (the usual time) New York; 40 minutes of cooking end at it.
    assert.deepEqual([created.body.summary, created.body.start.dateTime, created.body.end.dateTime], ['Dinner · Tacos', '2026-10-05T21:20:00.000Z', '2026-10-05T22:00:00.000Z']);
    const event = await json(`/api/events/${linked.calendarEventId}`);
    assert.equal(event.calendarId, g.calendarId);
    assert.deepEqual(event.memberIds.sort(), [alex.id, maya.id].sort(), 'eaters and the cook');

    // Moving it, retiming it and renaming it all reach Google.
    await json(`/api/meals/${meal.id}`, 'PATCH', { date: '2026-10-06', plannedTime: '19:00', title: 'Fish tacos' });
    const patched = g.calls.filter((call) => call.method === 'PATCH').at(-1)!;
    assert.deepEqual([patched.body.summary, patched.body.start.dateTime, patched.body.end.dateTime], ['Dinner · Fish tacos', '2026-10-06T22:20:00.000Z', '2026-10-06T23:00:00.000Z']);
    assert.equal((await json(`/api/events/${linked.calendarEventId}`)).title, 'Dinner · Fish tacos');
    // Only the eaters change: people are a Kinwall annotation, nothing goes to Google.
    const writes = g.calls.length;
    await json(`/api/meals/${meal.id}`, 'PATCH', { eaterIds: [alex.id] });
    assert.deepEqual((await json(`/api/events/${linked.calendarEventId}`)).memberIds, [alex.id]);
    assert.equal(g.calls.filter((call) => call.method !== 'GET').length, writes + 1, 'one PATCH (the time is unchanged, members stay local)');
    // A status change isn't an event change.
    const before = g.calls.length;
    await json(`/api/meals/${meal.id}`, 'PATCH', { status: 'prepared' });
    assert.equal(g.calls.length, before);

    // When Google refuses, the meal isn't changed either.
    g.failNext(true);
    const refused = await request(`/api/meals/${meal.id}`, 'PATCH', { title: 'Burritos' });
    assert.equal(refused.status, 502);
    assert.equal((await json(`/api/meals/${meal.id}`)).title, 'Fish tacos');
    g.failNext(false);

    await json(`/api/meals/${meal.id}`, 'DELETE');
    assert.ok(g.calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/events/g1')));
    assert.equal((await request(`/api/events/${linked.calendarEventId}`)).status, 404);
  } finally { g.restore(); }
});

test('meal calendar: without a choice it is a timed event on a local calendar, at the usual time, as long as the recipe', async () => {
  const { env, json } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  assert.deepEqual((await json('/api/settings')).mealTimes, { breakfast: '07:30', lunch: '12:00', dinner: '18:00', snack: '15:00' });
  await json('/api/settings', 'PATCH', { mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '17:30', snack: '15:00' } });
  const g = await google(env);
  try {
    const plain = await json('/api/meals', 'POST', { date: '2026-10-05', slot: 'dinner', title: 'Leftovers' });
    const event = await json(`/api/events/${(await json(`/api/meals/${plain.id}/calendar-event`, 'POST', {})).calendarEventId}`);
    assert.notEqual(event.calendarId, g.calendarId);
    assert.deepEqual([event.allDay, event.start, event.end], [false, '2026-10-05T21:30:00.000Z', '2026-10-05T22:30:00.000Z'], '17:30 for 60 minutes');
    assert.equal(g.calls.length, 0, 'nothing written to the synced calendar nobody chose');
  } finally { g.restore(); }
  // The recipe's total time sets the length; the meal's saved snapshot wins over a later recipe edit.
  const recipe = await json('/api/recipes', 'POST', { name: 'Soup', totalMinutes: 90, ingredients: [] });
  const soup = await json('/api/meals', 'POST', { date: '2026-10-06', slot: 'lunch', recipeId: recipe.id, plannedTime: '12:00' });
  await json(`/api/recipes/${recipe.id}`, 'PATCH', { totalMinutes: 20 });
  const soupEvent = await json(`/api/events/${(await json(`/api/meals/${soup.id}/calendar-event`, 'POST', {})).calendarEventId}`);
  assert.deepEqual([soupEvent.start, soupEvent.end], ['2026-10-06T16:00:00.000Z', '2026-10-06T17:30:00.000Z']);
  // Switching slot moves it to that slot's usual time; notes become the description until someone writes their own.
  await json(`/api/meals/${soup.id}`, 'PATCH', { slot: 'dinner', plannedTime: null, notes: 'Double batch' });
  const moved = await json(`/api/events/${soupEvent.id}`);
  assert.deepEqual([moved.title, moved.start, moved.description], ['Dinner · Soup', '2026-10-06T21:30:00.000Z', 'Double batch']);
  await json(`/api/events/${soupEvent.id}`, 'PATCH', { description: 'Bring bowls' });
  await json(`/api/meals/${soup.id}`, 'PATCH', { notes: 'Triple batch' });
  assert.equal((await json(`/api/events/${soupEvent.id}`)).description, 'Bring bowls');
});

test('meal calendar: an event the family linked is never edited or deleted, only unlinked', async () => {
  const { env, json } = fixture();
  const g = await google(env);
  try {
    const own = await json('/api/events', 'POST', { calendarId: g.calendarId, title: 'Grandma cooks', start: '2026-10-05T22:00:00Z', end: '2026-10-05T23:00:00Z', allDay: false });
    const meal = await json('/api/meals', 'POST', { date: '2026-10-05', slot: 'dinner', title: 'Roast' });
    const linked = await json(`/api/meals/${meal.id}/calendar-link`, 'POST', { eventId: own.id });
    assert.equal(linked.calendarEventStart, null);
    const writes = g.calls.length;
    await json(`/api/meals/${meal.id}`, 'PATCH', { title: 'Ham', date: '2026-10-07', plannedTime: '17:00', notes: 'x' });
    await json(`/api/meals/${meal.id}`, 'DELETE');
    assert.equal(g.calls.length, writes, 'no provider writes');
    const kept = await json(`/api/events/${own.id}`);
    assert.deepEqual([kept.title, kept.start], ['Grandma cooks', '2026-10-05T22:00:00.000Z']);
  } finally { g.restore(); }
});

test('meal calendar: a meal-kit import can put the planned dinner on a chosen calendar', async () => {
  const { env, json, request } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const g = await google(env);
  try {
    const kit = { source: 'kit', externalId: 'r1', name: 'Chicken', totalMinutes: 30, ingredients: ['1 lb chicken'], plan: { date: '2026-10-05', slot: 'dinner', calendarId: g.calendarId, eventStart: 'cooking' } };
    const first = await json('/api/recipes/import', 'POST', kit);
    assert.equal(first.planned, true); assert.ok(first.calendarEventId);
    const posted = g.calls.find((call) => call.method === 'POST')!;
    assert.deepEqual([posted.body.summary, posted.body.start.dateTime], ['Dinner · Chicken', '2026-10-05T21:30:00.000Z']);
    const again = await json('/api/recipes/import', 'POST', kit);
    assert.equal(again.calendarEventId, first.calendarEventId);
    assert.equal(g.calls.filter((call) => call.method === 'POST').length, 1, 'no duplicate event');
    // Planned before without an event: importing with a calendar adds one.
    const plain = await json('/api/recipes/import', 'POST', { ...kit, externalId: 'r2', name: 'Pasta', plan: { date: '2026-10-06', slot: 'dinner' } });
    assert.equal(plain.calendarEventId, undefined);
    const later = await json('/api/recipes/import', 'POST', { ...kit, externalId: 'r2', name: 'Pasta', plan: { date: '2026-10-06', slot: 'dinner', calendarId: g.calendarId } });
    assert.ok(later.calendarEventId);
    assert.equal((await json(`/api/meals/${later.mealId}`)).calendarEventStart, 'meal');
    // A calendar that can't take it still plans the meal, and says why.
    const bad = await json('/api/recipes/import', 'POST', { ...kit, externalId: 'r3', name: 'Stew', plan: { date: '2026-10-07', slot: 'dinner', calendarId: 'nope' } });
    assert.equal(bad.planned, true); assert.equal(bad.calendarError, 'calendar not found');
    assert.equal((await request('/api/recipes/import', 'POST', { ...kit, plan: { ...kit.plan, eventStart: 'later' } })).status, 400);
  } finally { g.restore(); }
});
