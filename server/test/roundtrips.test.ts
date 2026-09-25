// Measures D1 round trips (see d1-sqlite.ts's RoundTripCounter: one tick per standalone
// .all/.first/.run, one tick per batch() regardless of its statement count) for the hot GET/write
// paths named in the performance task. Seeds a realistic household first, so the numbers reflect
// real response shapes (overrides, recurrence, completions) rather than an empty DB.
//
// BEFORE / AFTER (measured against this same seeded household and the same DB-backed auth key;
// BEFORE = this file run against the pre-optimization route/auth/bus code, with only the
// round-trip counter itself added to d1-sqlite.ts):
//   endpoint                    BEFORE  AFTER
//   GET /api/events (week)        8   ->  3
//   GET /api/chores/day           5   ->  2
//   GET /api/members              12  ->  3
//   GET /api/settings             3   ->  2
//   GET /api/setup                7   ->  3
//   GET /api/rev                  3   ->  2
//   POST chore complete           7   ->  4
//   PATCH event memberIds         9   ->  4
//
// AFTER assertions below use the measured post-optimization numbers, so any regression fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations, type RoundTripCounter } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(counter: RoundTripCounter): Env {
  const db = openDb(':memory:', counter);
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env) {
  const app = createApp();
  return (p: string, init: RequestInit = {}, key = ADMIN_KEY): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !p.includes('key=')) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return Promise.resolve(app.request(p, { ...init, headers }, env));
  };
}

function icsFeed(): string {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const evt = (uid: string, summary: string) =>
    ['BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${summary}`, 'END:VEVENT'].join('\r\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', evt('a@test', 'Dentist'), evt('b@test', 'Soccer'), evt('c@test', 'Recital'), 'END:VCALENDAR', ''].join(
    '\r\n',
  );
}

// Builds a household: 4 members, a local calendar with a recurring + one-off event, an ICS
// (synced) calendar with 3 events (one given a member override), several chores with a couple of
// completions today. Returns ids needed by the measured requests below.
async function seedHousehold(request: ReturnType<typeof makeApp>) {
  const members = [];
  for (const [name, color] of [['Ava', '#e57'], ['Bo', '#5ae'], ['Cy', '#5e8'], ['Di', '#ea5']] as const) {
    members.push(await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name, color }) })).json() as any);
  }

  const localCal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json() as any;
  const today = new Date().toISOString().slice(0, 10);
  await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: localCal.id, title: 'Trash day', start: `${today}T08:00:00.000Z`, end: `${today}T08:30:00.000Z`, allDay: false, rrule: 'FREQ=WEEKLY', memberIds: [members[0].id] }),
  });
  await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: localCal.id, title: 'Checkup', start: `${today}T10:00:00.000Z`, end: `${today}T11:00:00.000Z`, allDay: false, memberIds: [members[1].id] }),
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(icsFeed(), { status: 200 })) as typeof fetch;
  let syncedCal: any;
  try {
    syncedCal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) })).json();
    await request(`/api/calendars/${syncedCal.id}/sync`, { method: 'POST' });
  } finally {
    globalThis.fetch = realFetch;
  }
  const synced = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${syncedCal.id}`)).json() as any[];
  await request(`/api/events/${synced[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [members[2].id] }) });

  const chores = [];
  for (const title of ['Dishes', 'Laundry', 'Homework', 'Feed cat', 'Vacuum']) {
    chores.push(await (await request('/api/chores', { method: 'POST', body: JSON.stringify({ title, memberId: members[0].id, points: 5, rrule: 'FREQ=DAILY' }) })).json() as any);
  }
  await request(`/api/chores/${chores[0].id}/complete`, { method: 'POST', body: JSON.stringify({ date: today }) });
  await request(`/api/chores/${chores[1].id}/complete`, { method: 'POST', body: JSON.stringify({ date: today, memberId: members[1].id }) });

  return { members, localCal, syncedCal, localEventId: (await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${localCal.id}`)).json() as any[])[1].id, choreId: chores[2].id, today };
}

test('round trips: hot GET/write paths stay within budget', async () => {
  const counter: RoundTripCounter = { count: 0 };
  const env = makeEnv(counter);
  const request = makeApp(env);
  const seed = await seedHousehold(request);

  // A real DB-backed admin key (not the ADMIN_API_KEY env bootstrap key, which resolveKey
  // short-circuits with zero DB reads) - the realistic case for an automation/wall-display
  // client, so the measured counts below include the auth SELECT.
  const created = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'admin' }) })).json()) as any;
  const key = created.key as string;
  const auth = (p: string, init: RequestInit = {}) => request(p, init, key);
  // Warm the key's last_used_at so the measured calls below hit the steady state (no write due -
  // it was just refreshed), not the one-time first-ever-use write.
  await auth('/api/rev');

  const measure = async (label: string, fn: () => Promise<Response>, max: number, expectStatus: number) => {
    counter.count = 0;
    const res = await fn();
    const n = counter.count;
    assert.equal(res.status, expectStatus, `${label}: expected status ${expectStatus}, got ${res.status}`);
    assert.ok(n <= max, `${label}: expected <= ${max} round trips, got ${n}`);
  };

  const from = '2020-01-01';
  const to = '2035-01-01';

  // Ceilings are the measured AFTER counts, including the auth SELECT (the last_used_at write
  // itself never counts here: it's fired via waitUntil and, once written, skipped again for an
  // hour - see auth.ts).
  await measure('GET /api/events (week)', () => auth(`/api/events?from=${from}&to=${to}`), 3, 200);
  await measure('GET /api/chores/day', () => auth(`/api/chores/day?date=${seed.today}`), 2, 200);
  await measure('GET /api/members', () => auth('/api/members'), 3, 200);
  await measure('GET /api/settings', () => auth('/api/settings'), 2, 200);
  await measure('GET /api/setup', () => auth('/api/setup'), 3, 200); // no auth: /api/setup is a public route
  await measure('GET /api/rev', () => auth('/api/rev'), 2, 200);
  await measure('POST chore complete', () => auth(`/api/chores/${seed.choreId}/complete`, { method: 'POST', body: JSON.stringify({ date: seed.today }) }), 4, 200);
  await measure(
    'PATCH event memberIds',
    () => auth(`/api/events/${seed.localEventId}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [seed.members[3].id] }) }),
    4,
    200,
  );

  // Uses the top-level `request` (ADMIN_API_KEY bootstrap key, zero auth DB reads - see the
  // `auth` comment above) so the measured count is exactly the route's own D1 round trips.
  const list = (await (await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) })).json()) as any;
  await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk', store: 'Costco', category: 'Dairy' }) });

  await measure('GET /api/lists', () => request('/api/lists'), 1, 200);
  await measure('GET /api/lists/{id}', () => request(`/api/lists/${list.id}`), 1, 200);
});
