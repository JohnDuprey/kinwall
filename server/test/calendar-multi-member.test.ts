import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runMigrations } from '../src/migrate.ts';
import { readdirSync, readFileSync } from 'node:fs';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env) {
  const app = createApp();
  return (p: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !p.includes('key=')) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return Promise.resolve(app.request(p, { ...init, headers }, env));
  };
}

function icsFeed(uid: string, summary: string): string {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${summary}`, 'END:VEVENT', 'END:VCALENDAR', ''].join(
    '\r\n',
  );
}

test('calendars: legacy memberId on create still works and shows up in memberIds', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const m = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#f00' }) })).json() as any;
  const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home', memberId: m.id }) })).json() as any;
  assert.equal(cal.memberId, m.id);
  assert.deepEqual(cal.memberIds, [m.id]);
});

test('calendars: memberIds multi -> a synced event with no overrides returns all of them, memberScope calendar', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const m1 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#f00' }) })).json() as any;
  const m2 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Bo', color: '#0f0' }) })).json() as any;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(icsFeed('a@test', 'Recital'), { status: 200 })) as typeof fetch;
  try {
    const cal = await (
      await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics', memberIds: [m1.id, m2.id] }) })
    ).json() as any;
    assert.deepEqual([...cal.memberIds].sort(), [m1.id, m2.id].sort());
    assert.equal(cal.memberId, m1.id); // first element, for compat

    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
    const events = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[];
    assert.equal(events.length, 1);
    assert.deepEqual([...events[0].memberIds].sort(), [m1.id, m2.id].sort());
    assert.equal(events[0].memberScope, 'calendar');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('calendars: occurrence and series overrides still win over calendar members', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const m1 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#f00' }) })).json() as any;
  const m2 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Bo', color: '#0f0' }) })).json() as any;
  const m3 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Cy', color: '#00f' }) })).json() as any;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(icsFeed('b@test', 'Recital'), { status: 200 })) as typeof fetch;
  try {
    const cal = await (
      await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics', memberIds: [m1.id, m2.id] }) })
    ).json() as any;
    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
    const before = (await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[])[0];
    assert.deepEqual([...before.memberIds].sort(), [m1.id, m2.id].sort());

    const occOverridden = await (await request(`/api/events/${before.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [m3.id] }) })).json() as any;
    assert.deepEqual(occOverridden.memberIds, [m3.id]);
    assert.equal(occOverridden.memberScope, 'occurrence');

    // clear the occurrence override; add a series override instead (event has no seriesId here
    // since it's a non-recurring ICS event, so this reuses the same occurrence-scope path to
    // prove the resolution order still beats the calendar fallback either way).
    await request(`/api/events/${before.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [] }) });
    const cleared = await (await request(`/api/events/${before.id}`)).json() as any;
    assert.deepEqual([...cleared.memberIds].sort(), [m1.id, m2.id].sort());
    assert.equal(cleared.memberScope, 'calendar');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('events: ?memberId filter matches the second calendar member too', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const m1 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#f00' }) })).json() as any;
  const m2 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Bo', color: '#0f0' }) })).json() as any;
  const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home', memberIds: [m1.id, m2.id] }) })).json() as any;
  const today = new Date().toISOString().slice(0, 10);
  await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: cal.id, title: 'Dinner', start: `${today}T18:00:00.000Z`, end: `${today}T19:00:00.000Z`, allDay: false }),
  });

  const matches = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&memberId=${m2.id}`)).json() as any[];
  assert.equal(matches.length, 1);
  assert.deepEqual([...matches[0].memberIds].sort(), [m1.id, m2.id].sort());
});

test('members: deleting a member removes them from calendars.memberIds', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const m1 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#f00' }) })).json() as any;
  const m2 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Bo', color: '#0f0' }) })).json() as any;
  const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home', memberIds: [m1.id, m2.id] }) })).json() as any;

  const del = await request(`/api/members/${m1.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);

  const cals = await (await request('/api/calendars')).json() as any[];
  const updated = cals.find((c) => c.id === cal.id);
  assert.deepEqual(updated.memberIds, [m2.id]);
  assert.equal(updated.memberId, m2.id);
});

test('migration 0008: backfills member_ids from a pre-existing member_id column', async () => {
  const dir = MIGRATIONS_DIR;
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const upTo0007 = files.filter((f) => f <= '0007_series_member_overrides.sql').map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));
  const rest = files.filter((f) => f > '0007_series_member_overrides.sql').map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));

  const db = openDb(':memory:') as unknown as D1Database;
  await runMigrations(db, upTo0007);

  await db.prepare("INSERT INTO members (id, name, color, sort, created_at) VALUES ('mem1','Ava','#f00',0,'now')").run();
  await db
    .prepare(
      "INSERT INTO calendars (id, kind, name, member_id, config, writable, enabled) VALUES ('cal1','local','Home','mem1','{}',1,1)",
    )
    .run();
  await db.prepare("INSERT INTO calendars (id, kind, name, config, writable, enabled) VALUES ('cal2','local','Unassigned','{}',1,1)").run();

  await runMigrations(db, rest); // applies 0008+

  const row1 = await db.prepare('SELECT member_ids FROM calendars WHERE id = ?').bind('cal1').first<{ member_ids: string }>();
  assert.deepEqual(JSON.parse(row1!.member_ids), ['mem1']);
  const row2 = await db.prepare('SELECT member_ids FROM calendars WHERE id = ?').bind('cal2').first<{ member_ids: string }>();
  assert.deepEqual(JSON.parse(row2!.member_ids), []);
});
