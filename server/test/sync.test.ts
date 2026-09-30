import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { refreshWritable, replaceSlice, syncCalendarTick } from '../src/sync.ts';
import type { Env } from '../src/env.ts';
import { encryptConfig } from '../src/crypto.ts';
import { expandICS } from '../src/providers/ics.ts';

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

// Providers return events that OVERLAP a window (e.g. a multi-day event that started before it),
// but a slice only clears events that START inside it - so a slice can write an id that's still
// stored from an earlier slice. That must refresh the row, not fail the whole sync.
test('sync: a slice re-writing an event that started before its window upserts it', async () => {
  const env = makeEnv();
  await env.DB.prepare("INSERT INTO calendars (id, kind, name, config, writable, enabled) VALUES ('c1', 'google', 'G', '{}', 1, 1)").run();
  const offsite = { externalId: 'offsite', title: 'Offsite', start: '2026-10-24', end: '2026-11-01', allDay: true };
  const provider = { listEvents: async () => [offsite] } as any;
  const cal = { id: 'c1' } as any;
  await replaceSlice(env, provider, cal, {} as any, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-26T00:00:00Z'));
  // Next slice starts after the event's start, so its DELETE doesn't touch it.
  await replaceSlice(env, provider, cal, {} as any, new Date('2026-10-26T00:00:00Z'), new Date('2026-11-20T00:00:00Z'));
  const { results } = await env.DB.prepare("SELECT title FROM events WHERE calendar_id = 'c1'").all();
  assert.equal(results.length, 1);
});

test('sync: a provider calendar that became read-only is marked not writable (and back)', async () => {
  const env = makeEnv();
  await env.DB.prepare("INSERT INTO calendars (id, kind, remote_id, name, config, writable, enabled) VALUES ('c1', 'google', 'holidays', 'Holidays', '{}', 1, 1)").run();
  const cal = async () => (await env.DB.prepare("SELECT * FROM calendars WHERE id = 'c1'").first()) as any;
  let remoteWritable = false;
  const provider = { listCalendars: async () => [{ remoteId: 'holidays', name: 'Holidays', writable: remoteWritable }] } as any;
  await refreshWritable(env, provider, await cal(), {} as any);
  assert.equal((await cal()).writable, 0);
  remoteWritable = true;
  await refreshWritable(env, provider, await cal(), {} as any);
  assert.equal((await cal()).writable, 1);
  // A listing failure leaves the flag alone rather than failing the sync.
  const broken = { listCalendars: async () => { throw new Error('offline'); } } as any;
  await refreshWritable(env, broken, await cal(), {} as any);
  assert.equal((await cal()).writable, 1);
});

// Hosted Kinwall is billed per row written, so a sync must only write what changed.
// total_changes() counts every row the connection has inserted, updated or deleted.
const flush = () => new Promise((r) => setImmediate(r)); // let fire-and-forget publish() finish
const writes = async (env: Env) => { await flush(); return ((await env.DB.prepare('SELECT total_changes() AS n').first()) as any).n as number; };
const rev = async (env: Env) => Number(((await env.DB.prepare("SELECT value FROM settings WHERE key = 'rev'").first()) as any)?.value ?? 0);

function sliceEvents(n: number, base = Date.parse('2026-10-01T00:00:00Z')) {
  return Array.from({ length: n }, (_, i) => ({
    externalId: `evt-${i}`,
    title: `Event ${i}`,
    start: new Date(base + i * 3600_000).toISOString(),
    end: new Date(base + i * 3600_000 + 1800_000).toISOString(),
    allDay: false,
    reminders: [10],
  }));
}

test('sync: a slice writes only new, changed and removed events', async () => {
  const env = makeEnv();
  await env.DB.prepare("INSERT INTO calendars (id, kind, name, config, writable, enabled) VALUES ('c1', 'google', 'G', '{}', 1, 1)").run();
  let events: any[] = sliceEvents(60);
  const provider = { listEvents: async () => events } as any;
  const cal = { id: 'c1' } as any;
  const from = new Date('2026-09-30T00:00:00Z');
  const to = new Date('2026-10-31T00:00:00Z');
  const slice = async () => { const before = await writes(env); await replaceSlice(env, provider, cal, {} as any, from, to); return (await writes(env)) - before; };

  assert.equal(await slice(), 60, 'first sync inserts every event');
  const stored = await env.DB.prepare("SELECT id, rowid, updated_at FROM events WHERE calendar_id = 'c1' ORDER BY id").all();
  assert.equal(await slice(), 0, 'unchanged provider data writes nothing');
  const after = await env.DB.prepare("SELECT id, rowid, updated_at FROM events WHERE calendar_id = 'c1' ORDER BY id").all();
  assert.deepEqual(after.results, stored.results, 'unchanged rows are left alone');

  events = events.map((e, i) => (i === 5 ? { ...e, title: 'Moved dentist' } : e));
  assert.equal(await slice(), 1, 'one changed event is one write');
  events = events.map((e, i) => (i === 6 ? { ...e, allDay: true, start: '2026-10-02', end: '2026-10-03' } : e));
  assert.equal(await slice(), 1, 'timed to all-day is one write');
  events = events.map((e, i) => (i === 7 ? { ...e, reminders: [] } : e));
  assert.equal(await slice(), 1, 'reminder change is one write');
  events = events.filter((_, i) => i !== 9);
  assert.equal(await slice(), 1, 'a removed event is one delete');
  const titles = (await env.DB.prepare("SELECT title FROM events WHERE calendar_id = 'c1'").all()).results.map((r: any) => r.title);
  assert.equal(titles.length, 59);
  assert.ok(titles.includes('Moved dentist') && !titles.includes('Event 9'));
});

test('sync: an event moving to another slice is kept whichever slice syncs first', async () => {
  const env = makeEnv();
  await env.DB.prepare("INSERT INTO calendars (id, kind, name, config, writable, enabled) VALUES ('c1', 'google', 'G', '{}', 1, 1)").run();
  const a = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
  const b = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-12-01T00:00:00Z') };
  let ev = { externalId: 'trip', title: 'Trip', start: '2026-10-10T10:00:00.000Z', end: '2026-10-10T12:00:00.000Z', allDay: false };
  const inWindow = (w: typeof a) => ({ listEvents: async () => (ev.start >= w.from.toISOString() && ev.start < w.to.toISOString() ? [ev] : []) }) as any;
  const cal = { id: 'c1' } as any;
  const count = async () => ((await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE calendar_id = 'c1'").first()) as any).n;

  await replaceSlice(env, inWindow(a), cal, {} as any, a.from, a.to);
  ev = { ...ev, start: '2026-11-10T10:00:00.000Z', end: '2026-11-10T12:00:00.000Z' };
  await replaceSlice(env, inWindow(b), cal, {} as any, b.from, b.to); // new slice first: updates in place
  assert.equal(await count(), 1);
  await replaceSlice(env, inWindow(a), cal, {} as any, a.from, a.to); // old slice no longer owns it
  assert.equal(await count(), 1);

  ev = { ...ev, start: '2026-10-12T10:00:00.000Z', end: '2026-10-12T12:00:00.000Z' };
  await replaceSlice(env, inWindow(b), cal, {} as any, b.from, b.to); // old slice first: deleted there...
  assert.equal(await count(), 0);
  await replaceSlice(env, inWindow(a), cal, {} as any, a.from, a.to); // ...and re-added by its new slice
  const row = (await env.DB.prepare("SELECT start FROM events WHERE calendar_id = 'c1'").first()) as any;
  assert.equal(row.start, '2026-10-12T10:00:00.000Z');
});

// One base time for every feed in a run: taken from Date.now() per call, two feeds built either side
// of a second boundary moved every event (and so every ICS id), which made the write counts flaky.
const FEED_BASE = Math.floor(Date.now() / 3600_000) * 3600_000 + 7 * 24 * 3600_000;
function makeFeed(summaries: string[]) {
  const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const base = FEED_BASE;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0'];
  summaries.forEach((s, i) => lines.push('BEGIN:VEVENT', `UID:evt-${i}@example.test`, `DTSTART:${icsDate(new Date(base + i * 3600_000))}`, `DTEND:${icsDate(new Date(base + i * 3600_000 + 1800_000))}`, `SUMMARY:${s}`, 'END:VEVENT'));
  lines.push('END:VCALENDAR', '');
  return lines.join('\r\n');
}

test('sync: a changed ICS feed and a full sync write only the difference, and rev moves only on change', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  let feed = makeFeed(['A', 'B', 'C']);
  globalThis.fetch = (async () => new Response(feed, { status: 200 })) as typeof fetch;
  try {
    const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) })).json() as any;
    await syncCalendarTick(env, cal.id);
    await flush();

    // Changed feed: one event renamed. ICS ids hash title + time (feeds may regenerate UIDs), so
    // that's 1 insert + 1 delete, plus 1 calendars bookkeeping row and the rev and area rev bumps; A and C untouched.
    feed = makeFeed(['A', 'B2', 'C']);
    let w = await writes(env);
    let r = await rev(env);
    await syncCalendarTick(env, cal.id);
    assert.equal((await writes(env)) - w, 5);
    assert.equal((await rev(env)) - r, 1);

    // Full sync ("Sync now") with the same data: only the calendars bookkeeping row, no rev bump.
    w = await writes(env);
    r = await rev(env);
    const res = await (await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' })).json() as any;
    assert.equal(res.count, 3);
    assert.equal((await writes(env)) - w, 1);
    assert.equal(await rev(env), r);

    // Unchanged feed on a tick: fingerprint matches, bookkeeping only, no rev bump.
    w = await writes(env);
    await syncCalendarTick(env, cal.id);
    assert.equal((await writes(env)) - w, 1);
    assert.equal(await rev(env), r);

    // Full sync with one event dropped: exactly it is deleted.
    feed = makeFeed(['A', 'B2']);
    w = await writes(env);
    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
    assert.equal((await writes(env)) - w, 1 + 1 + 2); // delete, bookkeeping, rev + area rev
    const left = await (await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`)).json() as any[];
    assert.deepEqual(left.map((e) => e.title).sort(), ['A', 'B2']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Background ticks run every 10 minutes. One that finds nothing new must stay silent: no event
// writes, no rev bump and no webhook, since Home Assistant up to 1.7.0 refetched everything on
// every webhook (hosted 2026-09-30: ~26k rows read every 10 minutes). Each provider kind, with
// free and busy events, recurring instances, all-day and timed, and events outside the slice.
const settle = () => new Promise((r) => setTimeout(r, 30)); // fire-and-forget publish + webhook POST

async function idleTicks(kind: 'google' | 'microsoft' | 'ics', serve: (url: string) => Response | undefined) {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  const hooks: string[] = [];
  globalThis.fetch = (async (u: any, init: RequestInit = {}) => {
    const url = u instanceof Request ? u.url : String(u);
    if (url.startsWith('https://hooks.example.com/')) {
      hooks.push(JSON.parse(String(init.body)).type);
      return new Response('ok');
    }
    return serve(url) ?? new Response('not mocked', { status: 500 });
  }) as typeof fetch;
  try {
    await request('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://hooks.example.com/ha', events: [] }) });
    let calId: string;
    if (kind === 'ics') {
      calId = ((await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'School', url: 'https://example.test/school.ics' }) })).json()) as any).id;
    } else {
      calId = 'c1';
      const token = { access_token: 't', refresh_token: 'r', expires_at: Date.now() + 3600_000 };
      await env.DB.prepare("INSERT INTO accounts (id, kind, name, config, created_at) VALUES ('a1', ?, 'Acct', ?, '2026-01-01')").bind(kind, await encryptConfig(env, 'a1', token)).run();
      await env.DB.prepare("INSERT INTO calendars (id, kind, account_id, remote_id, name, config, writable, enabled) VALUES ('c1', ?, 'a1', 'cal1', 'Family', ?, 1, 1)")
        .bind(kind, await encryptConfig(env, 'c1', {}))
        .run();
    }
    const res = await syncCalendarTick(env, calId);
    assert.equal(res.ok, true, JSON.stringify(res));
    await settle();
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE calendar_id = ?').bind(calId).first<{ n: number }>();
    assert.ok(stored!.n > 0, 'the first tick stored the events');
    assert.ok(hooks.includes('events.changed'), 'the first tick announced them');

    const w = await writes(env);
    const r = await rev(env);
    hooks.length = 0;
    assert.equal((await syncCalendarTick(env, calId)).ok, true);
    await settle();
    assert.equal((await writes(env)) - w, 1, 'only the calendars bookkeeping row');
    assert.equal(await rev(env), r, 'rev stays put');
    assert.deepEqual(hooks, [], 'no webhook');
  } finally {
    globalThis.fetch = realFetch;
  }
}

const at = (days: number) => new Date(Date.now() + days * 86400_000);
const dateOnly = (days: number) => at(days).toISOString().slice(0, 10);

test('sync: an idle Google tick writes and publishes nothing', async () => {
  const items = [
    { id: 'busy', summary: 'Dentist', start: { dateTime: at(2).toISOString() }, end: { dateTime: at(2.05).toISOString() }, reminders: { useDefault: true } },
    { id: 'free', summary: 'Hold', transparency: 'transparent', start: { dateTime: at(3).toISOString() }, end: { dateTime: at(3.1).toISOString() } },
    { id: 'opaque', summary: 'Work', transparency: 'opaque', start: { date: dateOnly(4) }, end: { date: dateOnly(5) } },
    { id: 'series_1', summary: 'Soccer', recurringEventId: 'series', start: { dateTime: at(5).toISOString() }, end: { dateTime: at(5.05).toISOString() }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] } },
    { id: 'series_2', summary: 'Soccer', recurringEventId: 'series', start: { dateTime: at(12).toISOString() }, end: { dateTime: at(12.05).toISOString() } },
    { id: 'started', summary: 'Trip', start: { date: dateOnly(-3) }, end: { date: dateOnly(2) } }, // began before the slice
    { id: 'far', summary: 'Wedding', start: { dateTime: at(90).toISOString() }, end: { dateTime: at(90.2).toISOString() } }, // a far slice
  ];
  await idleTicks('google', (url) => {
    if (url.includes('/calendarList/')) return Response.json({ defaultReminders: [{ method: 'popup', minutes: 30 }] });
    if (url.includes('/calendarList')) return Response.json({ items: [{ id: 'cal1', accessRole: 'owner' }] });
    if (url.includes('/events?')) {
      const q = new URL(url).searchParams;
      const from = q.get('timeMin')!;
      const to = q.get('timeMax')!;
      const iso = (t: any) => t.dateTime ?? `${t.date}T00:00:00.000Z`;
      return Response.json({ items: items.filter((i) => iso(i.end) > from && iso(i.start) < to) });
    }
  });
});

test('sync: an idle Microsoft tick writes and publishes nothing', async () => {
  const graph = (d: Date) => d.toISOString().slice(0, 19);
  const items = [
    { id: 'busy', subject: 'Dentist', start: { dateTime: graph(at(2)) }, end: { dateTime: graph(at(2.05)) }, showAs: 'busy', isReminderOn: true, reminderMinutesBeforeStart: 15 },
    { id: 'free', subject: 'Hold', start: { dateTime: graph(at(3)) }, end: { dateTime: graph(at(3.1)) }, showAs: 'free', isReminderOn: false },
    { id: 'tentative', subject: 'Maybe', start: { dateTime: graph(at(4)) }, end: { dateTime: graph(at(4.1)) }, showAs: 'tentative' },
    { id: 'noshow', subject: 'Old client', start: { dateTime: graph(at(5)) }, end: { dateTime: graph(at(5.1)) } }, // no showAs at all
    { id: 'allday', subject: 'Holiday', isAllDay: true, start: { dateTime: `${dateOnly(6)}T00:00:00.0000000` }, end: { dateTime: `${dateOnly(7)}T00:00:00.0000000` }, seriesMasterId: 'm1' },
  ];
  await idleTicks('microsoft', (url) => {
    if (url.includes('/calendarView')) return Response.json({ value: items });
    if (url.includes('/me/calendars')) return Response.json({ value: [{ id: 'cal1', name: 'Family', canEdit: true }] });
  });
});

test('sync: an idle ICS tick writes and publishes nothing, even when the feed body changes', async () => {
  const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const start = new Date(FEED_BASE);
  const vevent = (uid: string, extra: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, ...extra, 'END:VEVENT'];
  let fetches = 0;
  const feed = () => [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    `X-WR-CALDESC:Generated ${fetches}`, // a feed that rewrites its header on every fetch
    ...vevent('busy@x', [`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(new Date(FEED_BASE + 3600_000))}`, 'SUMMARY:Concert', 'TRANSP:OPAQUE']),
    ...vevent('free@x', [`DTSTART;VALUE=DATE:${dateOnly(9).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${dateOnly(10).replace(/-/g, '')}`, 'SUMMARY:Spirit week', 'TRANSP:TRANSPARENT']),
    ...vevent('plain@x', [`DTSTART:${icsDate(new Date(FEED_BASE + 2 * 86400_000))}`, `DTEND:${icsDate(new Date(FEED_BASE + 2 * 86400_000 + 3600_000))}`, 'SUMMARY:Picture day']),
    ...vevent('weekly@x', [`DTSTART:${icsDate(new Date(FEED_BASE - 14 * 86400_000))}`, `DTEND:${icsDate(new Date(FEED_BASE - 14 * 86400_000 + 3600_000))}`, 'RRULE:FREQ=WEEKLY;COUNT=10', 'SUMMARY:Band']),
    ...vevent('old@x', [`DTSTART:${icsDate(at(-400))}`, `DTEND:${icsDate(at(-399.9))}`, 'SUMMARY:Long ago']), // outside the window
    'END:VCALENDAR', '',
  ].join('\r\n');
  await idleTicks('ics', (url) => {
    if (url.startsWith('https://example.test/school.ics')) {
      fetches++;
      return new Response(feed(), { status: 200 });
    }
  });
});

// CalDAV shares the chunked tick (and so tickSynced) with Google and Microsoft; its events come from
// the same ICS parser, so check that path's data diffs to nothing on a repeat.
test('sync: a CalDAV slice with no changes writes nothing', async () => {
  const env = makeEnv();
  await env.DB.prepare("INSERT INTO calendars (id, kind, name, config, writable, enabled) VALUES ('c1', 'caldav', 'Nextcloud', '{}', 1, 1)").run();
  const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const from = at(-1);
  const to = at(31);
  const objects = [
    ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a', `DTSTART:${icsDate(at(2))}`, `DTEND:${icsDate(at(2.1))}`, 'SUMMARY:Busy', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR'],
    ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:b', `DTSTART:${icsDate(at(3))}`, `DTEND:${icsDate(at(3.1))}`, 'SUMMARY:Free', 'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR'],
    ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:c', `DTSTART:${icsDate(at(-10))}`, `DTEND:${icsDate(at(-9.9))}`, 'RRULE:FREQ=DAILY;COUNT=40', 'SUMMARY:Walk', 'END:VEVENT', 'END:VCALENDAR'],
  ].map((l) => l.join('\r\n'));
  const provider = {
    listEvents: async (_ctx: unknown, f: Date, t: Date) =>
      (await Promise.all(objects.map(async (o, i) => (await expandICS(o, f, t)).map((ev) => ({ ...ev, externalId: `/cal/${i}.ics::${ev.externalId}` }))))).flat(),
  } as any;
  const cal = { id: 'c1' } as any;
  const first = await replaceSlice(env, provider, cal, {} as any, from, to);
  assert.equal(first.changed, true);
  const w = await writes(env);
  const again = await replaceSlice(env, provider, cal, {} as any, from, to);
  assert.equal(again.changed, false);
  assert.equal((await writes(env)) - w, 0);
});

test('sync: a tick that keeps failing the same way announces the error once', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const realFetch = globalThis.fetch;
  const hooks: string[] = [];
  globalThis.fetch = (async (u: any, init: RequestInit = {}) => {
    if ((u instanceof Request ? u.url : String(u)).startsWith('https://hooks.example.com/')) {
      hooks.push(JSON.parse(String(init.body)).type);
      return new Response('ok');
    }
    return new Response('gone', { status: 404 });
  }) as typeof fetch;
  try {
    await request('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://hooks.example.com/ha', events: [] }) });
    const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) })).json()) as any;
    await settle();
    hooks.length = 0;
    assert.equal((await syncCalendarTick(env, cal.id)).ok, false);
    await settle();
    assert.deepEqual(hooks, ['calendar.synced']);
    const r = await rev(env);
    assert.equal((await syncCalendarTick(env, cal.id)).ok, false);
    await settle();
    assert.deepEqual(hooks, ['calendar.synced'], 'the same error again is not news');
    assert.equal(await rev(env), r);
  } finally {
    globalThis.fetch = realFetch;
  }
});
