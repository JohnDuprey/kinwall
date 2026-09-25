import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { addDays, greetingFor } from '../src/routes/snapshot.ts';
import { describeWeather } from '../src/routes/weather.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const req = (p: string, init: RequestInit & { key?: string } = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${init.key ?? ADMIN_KEY}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }, env);
  const json = async (p: string, method = 'GET', body?: unknown) => {
    const res = await req(p, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(res.status < 300, `${method} ${p}: ${res.status} ${await res.clone().text()}`);
    return res.json() as Promise<any>;
  };
  return { req, json, db };
}

const today = new Date().toISOString().slice(0, 10); // household tz is set to UTC below
const d = (n: number) => addDays(today, n);

// A forecast shaped like Open-Meteo's, for any 7 days from today.
function fakeForecast() {
  const days = [0, 1, 2, 3, 4, 5, 6].map(d);
  const hours = Array.from({ length: 24 }, (_, h) => `${today}T${String(h).padStart(2, '0')}:00`);
  return {
    daily: { time: days, weather_code: [0, 61, 3, 3, 3, 3, 95], temperature_2m_max: [21.4, 18, 18, 18, 18, 18, 18], temperature_2m_min: [9.6, 8, 8, 8, 8, 8, 8], precipitation_probability_max: [10, 80, 0, 0, 0, 0, 60] },
    hourly: { time: hours, temperature_2m: hours.map(() => 15.2), weather_code: hours.map(() => 2), precipitation_probability: hours.map(() => 5) },
  };
}
function mockFetch(body: unknown, ok = true) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

test('snapshot: greeting by hour', () => {
  assert.equal(greetingFor('Maya', 7), 'Good morning, Maya');
  assert.equal(greetingFor('Maya', 13), 'Good afternoon, Maya');
  assert.equal(greetingFor('Maya', 19), 'Good evening, Maya');
  assert.equal(greetingFor('Maya', 2), 'Good evening, Maya');
  assert.deepEqual(describeWeather(61), { emoji: '🌧️', text: 'Light rain' });
});

test('members: birthday validation, round trip, clear', async () => {
  const { req, json } = setup();
  const m = await json('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', birthday: '2018-02-28' });
  assert.equal(m.birthday, '2018-02-28');
  for (const bad of ['2020-02-30', '--13-01', '2099-01-01', '1850-01-01', 'May 4', '2019-02-29']) {
    const res = await req(`/api/members/${m.id}`, { method: 'PATCH', body: JSON.stringify({ birthday: bad }) });
    assert.equal(res.status, 400, bad);
  }
  assert.equal((await json(`/api/members/${m.id}`, 'PATCH', { birthday: '--02-29' })).birthday, '--02-29');
  assert.equal((await json(`/api/members/${m.id}`, 'PATCH', { birthday: '2020-02-29' })).birthday, '2020-02-29');
  assert.equal((await json(`/api/members/${m.id}`, 'PATCH', { name: 'Maya B' })).birthday, '2020-02-29', 'untouched by other patches');
  assert.equal((await json(`/api/members/${m.id}`, 'PATCH', { birthday: null })).birthday, null);
  // Export carries it; import accepts files without it (older exports).
  await json(`/api/members/${m.id}`, 'PATCH', { birthday: '--07-04' });
  const exported = await json('/api/export');
  assert.equal(exported.members[0].birthday, '--07-04');
  delete exported.members[0].birthday;
  await json('/api/import', 'POST', exported);
});

test('snapshot: day and week content for one member', async () => {
  const { req, json } = setup();
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', birthday: `${Number(today.slice(0, 4)) - 8}${today.slice(4)}` });
  const leo = await json('/api/members', 'POST', { name: 'Leo', color: '#F5A65B', birthday: `--${d(1).slice(5)}` });
  const cal = await json('/api/calendars', 'POST', { kind: 'local', name: 'Home' });
  await json('/api/categories', 'POST', { name: 'Birthdays', emoji: '🎂', color: '#FF9E7A', keywords: ['birthday'] });
  const ev = (title: string, day: number, memberIds: string[], extra = {}) =>
    json('/api/events', 'POST', { calendarId: cal.id, title, start: `${d(day)}T23:00:00.000Z`, end: `${d(day)}T23:30:00.000Z`, allDay: false, memberIds, ...extra });
  await ev('Piano', 0, [maya.id], { travelMinutes: 20 });
  await ev('Swim', 0, [leo.id]);
  await ev('Dinner', 0, []);
  await ev('Dentist', 1, [maya.id]);
  await ev('Science fair', 3, [maya.id]);
  await json('/api/events', 'POST', { calendarId: cal.id, title: "Grandma's birthday", start: d(2), end: d(3), allDay: true, memberIds: [leo.id] });

  const list = await json('/api/lists', 'POST', { name: 'To-dos', kind: 'todo' });
  const add = (title: string, extra: Record<string, unknown>) => json(`/api/lists/${list.id}/items`, 'POST', { title, ...extra });
  await add('Homework', { memberId: maya.id, dueDate: today });
  await add('Library books', { memberId: maya.id, dueDate: d(-1) });
  await add('Permission slip', { memberId: maya.id, priority: 'urgent' });
  await add('Someday', { memberId: maya.id });
  await add("Leo's thing", { memberId: leo.id, dueDate: today });
  await add('Pack bag', { memberId: maya.id, dueDate: d(1) });
  await add('Project', { memberId: maya.id, dueDate: d(5) });
  const [done] = await add('Done already', { memberId: maya.id, dueDate: today });
  await json(`/api/lists/${list.id}/items/${done.id}`, 'PATCH', { done: true });

  await json('/api/chores', 'POST', { title: 'Feed dog', memberId: maya.id, rrule: 'FREQ=DAILY' });
  await json('/api/chores', 'POST', { title: 'Tidy toys', memberId: leo.id, rrule: 'FREQ=DAILY' });
  await json('/api/chores', 'POST', { title: 'Water plants', dueDate: today });

  const day = await json(`/api/snapshot?member=${maya.id}`);
  assert.equal(day.greeting, 'Happy birthday, Maya! 🎉');
  assert.equal(day.weather, null, 'no location, no weather');
  assert.deepEqual([day.from, day.to], [today, today]);
  assert.deepEqual(day.events.map((e: any) => e.title), ['Piano', 'Dinner']);
  assert.ok(day.events[0].leaveAt, 'leave-by time carried through');
  assert.deepEqual(day.chores.map((c: any) => [c.title, c.shared]).sort(), [['Feed dog', false], ['Water plants', true]]);
  assert.deepEqual(day.items.map((i: any) => i.title), ['Library books', 'Homework', 'Permission slip']);
  assert.equal(day.items[0].overdue, true);
  assert.equal(day.items[0].listName, 'To-dos');
  assert.deepEqual(day.birthdays.map((b: any) => [b.name, b.age]), [['Maya', 8]]);
  assert.deepEqual(day.tomorrow.events.map((e: any) => e.title), ['Dentist']);
  assert.deepEqual(day.tomorrow.items.map((i: any) => i.title), ['Pack bag']);
  assert.deepEqual(day.tomorrow.birthdays.map((b: any) => [b.name, b.age]), [['Leo', null]]);

  const week = await json(`/api/snapshot?member=${maya.id}&range=week`);
  assert.equal(week.to, d(6));
  assert.equal(week.tomorrow, null);
  assert.deepEqual(week.events.map((e: any) => [e.title, e.date]), [['Piano', today], ['Dinner', today], ['Dentist', d(1)], ['Science fair', d(3)]]);
  assert.deepEqual(week.items.map((i: any) => i.title), ['Library books', 'Homework', 'Pack bag', 'Project', 'Permission slip']);
  assert.deepEqual(week.birthdays.map((b: any) => [b.name, b.date]), [['Maya', today], ['Leo', d(1)], ["Grandma's birthday", d(2)]]);
  assert.equal(week.chores.filter((c: any) => c.title === 'Feed dog').length, 7);

  assert.equal((await req('/api/snapshot?member=nope')).status, 404);
  const { key } = await json('/api/keys', 'POST', { name: 'Wall', scope: 'display' });
  assert.equal((await req(`/api/snapshot?member=${maya.id}`, { key })).status, 200, 'display keys can open snapshots');
  assert.equal((await req('/api/weather', { key })).status, 200);
});

test('weather: fetched once an hour per location + unit, US defaults to fahrenheit', async () => {
  const { json, db } = setup();
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  assert.equal(await json('/api/weather'), null, 'no location');
  const s = await json('/api/settings', 'PATCH', { location: { name: 'Portland', lat: 45.5152, lon: -122.6784, countryCode: 'US' } });
  assert.deepEqual([s.location.name, s.temperatureUnit], ['Portland', 'fahrenheit']);

  const calls = mockFetch(fakeForecast());
  const w = await json('/api/weather');
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.origin + url.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual([url.searchParams.get('temperature_unit'), url.searchParams.get('timezone'), url.searchParams.get('forecast_days')], ['fahrenheit', 'UTC', '7']);
  assert.deepEqual([w.location, w.unit, w.days.length], ['Portland', 'fahrenheit', 7]);
  assert.deepEqual(w.days[0], { date: today, code: 0, emoji: '☀️', text: 'Clear', high: 21, low: 10, rainChance: 10 });
  assert.deepEqual(w.now, { temp: 15, code: 2, emoji: '⛅', text: 'Partly cloudy', rainChance: 5 });

  await json('/api/weather');
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' });
  const snap = await json(`/api/snapshot?member=${maya.id}`);
  assert.equal(calls.length, 1, 'cached: no second request within the hour');
  assert.deepEqual(snap.weather.days.map((x: any) => x.date), [today, d(1)], 'day snapshot: today + tomorrow');

  await json('/api/settings', 'PATCH', { temperatureUnit: 'celsius' });
  await json('/api/weather');
  assert.equal(calls.length, 2, 'a different unit is its own cache entry');
  assert.equal(new URL(calls[1]).searchParams.get('temperature_unit'), 'celsius');

  // An hour later it refetches; a failure keeps the stale forecast and backs off.
  await db.prepare("UPDATE weather_cache SET fetched_at = '2000-01-01T00:00:00.000Z'").run();
  const failing = mockFetch({}, false);
  assert.equal((await json('/api/weather')).days.length, 7, 'stale forecast beats none');
  await json('/api/weather');
  assert.equal(failing.length, 1, 'no retry storm after a failure');

  assert.equal((await json('/api/settings', 'PATCH', { location: null })).location, null);
  assert.equal(await json('/api/weather'), null);
});

test('geocode: proxied through the server', async () => {
  const { req, json } = setup();
  const calls = mockFetch({ results: [{ name: 'Springfield', admin1: 'Illinois', country: 'United States', country_code: 'us', latitude: 39.8, longitude: -89.64 }] });
  const results = await json('/api/geocode?q=Springfield');
  assert.deepEqual(results, [{ name: 'Springfield', label: 'Springfield, Illinois, United States', lat: 39.8, lon: -89.64, countryCode: 'US' }]);
  const url = new URL(calls[0]);
  assert.deepEqual([url.host, url.searchParams.get('name'), url.searchParams.get('count')], ['geocoding-api.open-meteo.com', 'Springfield', '5']);
  assert.equal((await req('/api/geocode?q=a')).status, 400);
  mockFetch({}, false);
  assert.equal((await req('/api/geocode?q=Nowhere')).status, 502);
  assert.deepEqual(await (mockFetch({}), json('/api/geocode?q=Atlantis')), [], 'no results');
});
