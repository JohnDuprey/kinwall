// Series-level member tags for recurring events on synced calendars (SPEC.md "Series tags apply
// to every occurrence... an occurrence-level tag overrides the series tag").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { syncCalendar } from '../src/sync.ts';
import { encryptConfig } from '../src/crypto.ts';
import { parseIcsEvents } from '../src/providers/ics.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return {
    DB: db as unknown as D1Database,
    ADMIN_API_KEY: ADMIN_KEY,
    PUBLIC_URL: 'http://localhost:8080',
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
  };
}

function makeApp(env: Env, key = ADMIN_KEY) {
  const app = createApp();
  return (p: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !p.includes('key=')) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
}

async function makeGoogleCalendar(env: Env, occurrenceCount: () => number) {
  const accountId = crypto.randomUUID();
  const accountConfig = await encryptConfig(env, accountId, { access_token: 'tok', refresh_token: 'r1', expires_at: Date.now() + 1_000_000_000 });
  await env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
    .bind(accountId, 'google', 'test@example.test', accountConfig, new Date().toISOString())
    .run();

  const calendarId = crypto.randomUUID();
  const calendarConfig = await encryptConfig(env, calendarId, {});
  await env.DB.prepare('INSERT INTO calendars (id, kind, account_id, remote_id, name, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?)')
    .bind(calendarId, 'google', accountId, 'primary', 'Work', calendarConfig, 1, 1)
    .run();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    if (u.includes('/events?')) {
      const n = occurrenceCount();
      const items = Array.from({ length: n }, (_, i) => ({
        id: `inst${i + 1}`,
        recurringEventId: 'series-master-1',
        summary: 'Weekly Standup',
        start: { dateTime: `2026-01-0${i + 1}T15:00:00Z` },
        end: { dateTime: `2026-01-0${i + 1}T16:00:00Z` },
      }));
      return Response.json({ items });
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as typeof fetch;

  return { calendarId, restore: () => { globalThis.fetch = realFetch; } };
}

test('series: a series tag applies to every occurrence, including one added by a later sync', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  let n = 3;
  const { calendarId, restore } = await makeGoogleCalendar(env, () => n);
  try {
    const first = await syncCalendar(env, calendarId);
    assert.equal(first.ok, true);
    let events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.equal(events.length, 3);
    assert.ok(events.every((e) => e.seriesId === 'series-master-1'));
    assert.ok(events.every((e) => e.memberScope === 'none'));

    const m1 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json()) as any;
    const m2 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Dad', color: '#00f', avatar: 'D' }) })).json()) as any;

    const patched = (await (
      await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m1.id, m2.id], scope: 'series' }) })
    ).json()) as any;
    assert.deepEqual([...patched.memberIds].sort(), [m1.id, m2.id].sort());
    assert.equal(patched.memberScope, 'series');

    events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.equal(events.length, 3);
    for (const e of events) {
      assert.deepEqual([...e.memberIds].sort(), [m1.id, m2.id].sort());
      assert.equal(e.memberScope, 'series');
    }

    // A later sync adds a 4th occurrence sharing the same seriesId - the series tag must cover it too.
    n = 4;
    const second = await syncCalendar(env, calendarId);
    assert.equal(second.ok, true);
    events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.equal(events.length, 4);
    for (const e of events) assert.deepEqual([...e.memberIds].sort(), [m1.id, m2.id].sort());
  } finally {
    restore();
  }
});

test('series: an occurrence tag overrides the series tag for that occurrence only', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const { calendarId, restore } = await makeGoogleCalendar(env, () => 3);
  try {
    await syncCalendar(env, calendarId);
    let events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];

    const m1 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json()) as any;
    const m2 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Dad', color: '#00f', avatar: 'D' }) })).json()) as any;

    await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m1.id], scope: 'series' }) });
    const occPatched = (await (
      await request(`/api/events/${events[1].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m2.id], scope: 'occurrence' }) })
    ).json()) as any;
    assert.deepEqual(occPatched.memberIds, [m2.id]);
    assert.equal(occPatched.memberScope, 'occurrence');

    events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    const byExternalOrder = [...events].sort((a, b) => a.start.localeCompare(b.start));
    assert.deepEqual(byExternalOrder[0].memberIds, [m1.id]); // series tag
    assert.deepEqual(byExternalOrder[1].memberIds, [m2.id]); // occurrence override wins
    assert.equal(byExternalOrder[1].memberScope, 'occurrence');
    assert.deepEqual(byExternalOrder[2].memberIds, [m1.id]); // series tag
  } finally {
    restore();
  }
});

test('series: scope "series" clears prior occurrence tags in that series ("All events" really means all)', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const { calendarId, restore } = await makeGoogleCalendar(env, () => 3);
  try {
    await syncCalendar(env, calendarId);
    let events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];

    const m1 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json()) as any;
    const m2 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Dad', color: '#00f', avatar: 'D' }) })).json()) as any;

    // Tag one occurrence individually first.
    await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m2.id], scope: 'occurrence' }) });

    // Then "All events in the series" with a different member - must win everywhere, including
    // the occurrence that had its own tag.
    await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m1.id], scope: 'series' }) });

    events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.equal(events.length, 3);
    for (const e of events) {
      assert.deepEqual(e.memberIds, [m1.id]);
      assert.equal(e.memberScope, 'series');
    }
  } finally {
    restore();
  }
});

test('series: [] on scope "series" clears the series tag back to the calendar member fallback', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const { calendarId, restore } = await makeGoogleCalendar(env, () => 3);
  try {
    const owner = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Owner', color: '#0f0', avatar: 'O' }) })).json()) as any;
    await request(`/api/calendars/${calendarId}`, { method: 'PATCH', body: JSON.stringify({ memberId: owner.id }) });
    await syncCalendar(env, calendarId);
    let events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.ok(events.every((e) => e.memberScope === 'calendar' && e.memberIds[0] === owner.id));

    const m1 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json()) as any;
    await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m1.id], scope: 'series' }) });
    events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.ok(events.every((e) => e.memberScope === 'series'));

    const cleared = (await (await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [], scope: 'series' }) })).json()) as any;
    assert.deepEqual(cleared.memberIds, [owner.id]);
    assert.equal(cleared.memberScope, 'calendar');

    events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.ok(events.every((e) => e.memberScope === 'calendar' && e.memberIds[0] === owner.id));
  } finally {
    restore();
  }
});

test('series: 400 when scope "series" is used on an event with no series (non-recurring)', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    Response.json({
      items: [{ id: 'single-1', summary: 'One-off', start: { dateTime: '2026-01-05T15:00:00Z' }, end: { dateTime: '2026-01-05T16:00:00Z' } }],
    })) as typeof fetch;
  try {
    const accountId = crypto.randomUUID();
    const accountConfig = await encryptConfig(env, accountId, { access_token: 'tok', refresh_token: 'r1', expires_at: Date.now() + 1_000_000_000 });
    await env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
      .bind(accountId, 'google', 'test@example.test', accountConfig, new Date().toISOString())
      .run();
    const calendarId = crypto.randomUUID();
    const calendarConfig = await encryptConfig(env, calendarId, {});
    await env.DB.prepare('INSERT INTO calendars (id, kind, account_id, remote_id, name, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?)')
      .bind(calendarId, 'google', accountId, 'primary', 'Work', calendarConfig, 1, 1)
      .run();
    await syncCalendar(env, calendarId);
    const events = (await (await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`)).json()) as any[];
    assert.equal(events.length, 1);
    assert.equal(events[0].seriesId, null);

    const m1 = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json()) as any;
    const res = await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m1.id], scope: 'series' }) });
    assert.equal(res.status, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('series: an ICS RRULE feed gets a stable seriesId across two fetches with regenerated UIDs', async () => {
  // Content-stable key (SUMMARY + RRULE text), not the UID - matches the same problem
  // withStableExternalIds already solves for externalId (a feed that regenerates UID/DTSTAMP
  // every fetch, e.g. Thrillshare/icalendar-ruby).
  const makeFixture = (uid: string) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
      'DTSTART:20260105T150000Z',
      'DTEND:20260105T160000Z',
      'RRULE:FREQ=WEEKLY;COUNT=3',
      'SUMMARY:Weekly Standup',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');

  const from = new Date('2026-01-01T00:00:00Z');
  const to = new Date('2026-04-01T00:00:00Z');
  const eventsA = await parseIcsEvents(makeFixture('regenerated-uid-a@feed.test'), from, to, 'UTC');
  const eventsB = await parseIcsEvents(makeFixture('regenerated-uid-b@feed.test'), from, to, 'UTC');

  assert.equal(eventsA.length, 3);
  assert.equal(eventsB.length, 3);
  assert.ok(eventsA.every((e) => e.seriesId?.startsWith('ics:')));
  assert.deepEqual(eventsA.map((e) => e.seriesId).sort(), eventsB.map((e) => e.seriesId).sort());
  // externalId is also stable across the UID change (existing behavior), independently of seriesId.
  assert.deepEqual(eventsA.map((e) => e.externalId).sort(), eventsB.map((e) => e.externalId).sort());
});
