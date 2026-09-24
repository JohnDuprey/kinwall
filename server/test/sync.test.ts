import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { syncCalendarTick } from '../src/sync.ts';
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

// One fixed-content ICS feed - stable UID/DTSTART/DTEND/SUMMARY across calls, like a normal
// feed (contrast the "regenerates UID every fetch" case ics.ts already handles separately).
function makeIcsFetch() {
  const eventStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
  const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:stable-evt@example.test',
    `DTSTART:${icsDate(eventStart)}`,
    `DTEND:${icsDate(eventEnd)}`,
    'SUMMARY:Stable Event',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  return async () => new Response(ics, { status: 200 });
}

test('sync: full sync keeps the same event id across two syncs', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = makeIcsFetch() as typeof fetch;
  try {
    const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) })).json() as any;

    const first = await (await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' })).json() as any;
    assert.equal(first.count, 1);
    const firstEvents = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[];
    assert.equal(firstEvents.length, 1);

    const second = await (await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' })).json() as any;
    assert.equal(second.count, 1);
    const secondEvents = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[];
    assert.equal(secondEvents.length, 1);

    assert.equal(secondEvents[0].id, firstEvents[0].id);
    assert.match(firstEvents[0].id, /^e_[0-9a-f]{24}$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sync: chunked tick keeps the same event id across two ticks', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = makeIcsFetch() as typeof fetch;
  try {
    const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) })).json() as any;

    const r1 = await syncCalendarTick(env, cal.id);
    assert.equal(r1.ok, true);
    const first = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[];
    assert.equal(first.length, 1);

    const r2 = await syncCalendarTick(env, cal.id);
    assert.equal(r2.ok, true);
    const second = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[];
    assert.equal(second.length, 1);

    assert.equal(second[0].id, first[0].id);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sync: a member override survives re-sync; [] clears it back to the calendar member; 2-member override stripes', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = makeIcsFetch() as typeof fetch;
  try {
    const m1 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json() as any;
    const m2 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Emma', color: '#0f0', avatar: 'E' }) })).json() as any;
    const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics', memberId: m1.id }) })).json() as any;

    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
    const before = (await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[])[0];
    // No override yet: falls back to the calendar's member.
    assert.deepEqual(before.memberIds, [m1.id]);

    const patched = await (await request(`/api/events/${before.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m1.id, m2.id] }) })).json() as any;
    assert.equal(patched.readOnly, true);
    assert.deepEqual([...patched.memberIds].sort(), [m1.id, m2.id].sort());

    // Re-sync (wholesale delete + reinsert) - the override must survive because the id/rows are
    // keyed by the stable externalId, not by the transient row.
    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
    const afterSync = (await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[])[0];
    assert.equal(afterSync.id, before.id);
    assert.deepEqual([...afterSync.memberIds].sort(), [m1.id, m2.id].sort());

    // [] clears the override back to the calendar member fallback.
    const cleared = await (await request(`/api/events/${afterSync.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [] }) })).json() as any;
    assert.deepEqual(cleared.memberIds, [m1.id]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sync: ICS read-only event accepts a memberIds-only patch but rejects a title patch', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = makeIcsFetch() as typeof fetch;
  try {
    const member = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json() as any;
    const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) })).json() as any;
    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
    const event = (await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[])[0];

    const memberRes = await request(`/api/events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [member.id] }) });
    assert.equal(memberRes.status, 200);
    const memberBody = await memberRes.json() as any;
    assert.deepEqual(memberBody.memberIds, [member.id]);

    const titleRes = await request(`/api/events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) });
    assert.equal(titleRes.status, 400);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sync: a display key can set memberIds on a synced event', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const realFetch = globalThis.fetch;
  globalThis.fetch = makeIcsFetch() as typeof fetch;
  try {
    const member = await (await admin('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Mom', color: '#f00', avatar: 'M' }) })).json() as any;
    const cal = await (await admin('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) })).json() as any;
    await admin(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
    const event = (await (await admin(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[])[0];

    const keyBody = await (await admin('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Wall display' }) })).json() as any;
    assert.equal(keyBody.scope, 'display');
    const display = makeApp(env, keyBody.key);

    const res = await display(`/api/events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [member.id] }) });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json() as any).memberIds, [member.id]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
