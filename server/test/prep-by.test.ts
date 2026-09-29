// "Start prep by" for meal events: the anchor-time rule (prepBy.ts) and GET /api/events' prepAt/cookId.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { DEFAULT_PREP_MINUTES, mealPrepMinutes, prepAt, prepFor } from '../src/prepBy.ts';
import type { Env } from '../src/env.ts';

test('prep by: the recipe\'s total time, else its prep time, else 30 minutes', () => {
  assert.equal(mealPrepMinutes({ totalMinutes: 45, prepMinutes: 15 }), 45);
  assert.equal(mealPrepMinutes({ totalMinutes: null, prepMinutes: 15 }), 15);
  assert.equal(mealPrepMinutes({ totalMinutes: null, prepMinutes: null }), DEFAULT_PREP_MINUTES);
  assert.equal(mealPrepMinutes(null), 30);
});

test('prep by: a meal-time event counts back by the recipe; a cooking event already starts then', () => {
  assert.equal(prepAt('2030-01-01T18:00:00.000Z', 'meal', 45), '2030-01-01T17:15:00.000Z');
  assert.equal(prepAt('2030-01-01T18:00:00.000Z', null, 30), '2030-01-01T17:30:00.000Z', 'an event the family linked: like a meal-time one');
  assert.equal(prepAt('2030-01-01T17:15:00.000Z', 'cooking', 45), '2030-01-01T17:15:00.000Z');
});

test('prep by: the cook when one is set, else the event\'s people', () => {
  assert.deepEqual(prepFor({ eventStart: 'meal', minutes: 30, cookId: 'm1' }, ['m1', 'm2']), ['m1']);
  assert.deepEqual(prepFor({ eventStart: 'meal', minutes: 30, cookId: null }, ['m1', 'm2']), ['m1', 'm2']);
  assert.deepEqual(prepFor(undefined, ['m2']), ['m2']);
});

test('events: a meal\'s event carries prepAt and its cook; other events don\'t', async () => {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const json = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    const res = await app.request(path, { method, headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const data = await res.json(); assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const alex = await json('/api/members', 'POST', { name: 'Alex', color: '#123456' });
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#654321' });
  const tacos = await json('/api/recipes', 'POST', { name: 'Tuesday Tacos', totalMinutes: 45, ingredients: [] });
  const cooked = await json('/api/meals', 'POST', { date: '2030-01-01', slot: 'dinner', plannedTime: '18:00', recipeId: tacos.id, eaterIds: [maya.id], assigneeMemberId: alex.id });
  await json(`/api/meals/${cooked.id}/calendar-event`, 'POST', {});
  const soup = await json('/api/meals', 'POST', { date: '2030-01-02', slot: 'lunch', plannedTime: '12:00', title: 'Soup', eaterIds: [maya.id] });
  await json(`/api/meals/${soup.id}/calendar-event`, 'POST', { eventStart: 'cooking' });
  const cal = (await json('/api/calendars')).find((c: any) => c.kind === 'local');
  await json('/api/events', 'POST', { calendarId: cal.id, title: 'Soccer', start: '2030-01-01T16:00:00Z', end: '2030-01-01T17:00:00Z', allDay: false, travelMinutes: 20 });

  const list = await json('/api/events?from=2030-01-01T00:00:00Z&to=2030-01-03T00:00:00Z');
  const by = (t: string) => list.find((e: any) => e.title.includes(t));
  assert.deepEqual([by('Tacos').prepAt, by('Tacos').cookId], ['2030-01-01T17:15:00.000Z', alex.id], '45 minutes of cooking before 6:00 PM, for Alex');
  // No recipe: the 60-minute cooking event (mealEvent's default) starts at noon minus 60; prep starts with it.
  assert.deepEqual([by('Soup').start, by('Soup').prepAt, by('Soup').cookId], ['2030-01-02T11:00:00.000Z', '2030-01-02T11:00:00.000Z', null]);
  assert.deepEqual([by('Soccer').prepAt, by('Soccer').leaveAt], [null, '2030-01-01T15:40:00.000Z']);
});
