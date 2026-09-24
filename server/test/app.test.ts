import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const ADMIN_KEY = 'fc_test_admin_key';
// 32 zero bytes, base64 - fine for tests, never use a fixed key like this in production.
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

function makeApp(env: Env) {
  const app = createApp();
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !path.includes('key=')) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
  return request;
}

test('auth: /api/members requires a bearer key, health does not', async () => {
  const env = makeEnv();
  const app = createApp();
  const noAuth = await app.request('/api/members', {}, env);
  assert.equal(noAuth.status, 401);

  const health = await app.request('/api/health', {}, env);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true }); // public: no build version to fingerprint

  const me = await (await app.request('/api/me', { headers: { Authorization: `Bearer ${ADMIN_KEY}` } }, env)).json() as any;
  assert.match(me.version, /^\d+\.\d+\.\d+/);

  const withAuth = await app.request('/api/members', { headers: { Authorization: `Bearer ${ADMIN_KEY}` } }, env);
  assert.equal(withAuth.status, 200);
});

test('settings: timezone defaults to null, not UTC, until set', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const fresh = await request('/api/settings');
  assert.equal((await fresh.json() as any).timezone, null);

  const patched = await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'America/New_York' }) });
  assert.equal((await patched.json() as any).timezone, 'America/New_York');
});

test('members: create, list, patch, delete', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const created = await request('/api/members', {
    method: 'POST',
    body: JSON.stringify({ name: 'Ada', color: '#ff0000' }),
  });
  assert.equal(created.status, 201);
  const member = await created.json() as any;
  assert.equal(member.name, 'Ada');
  assert.equal(member.pointsToday, 0);

  const list = await request('/api/members');
  assert.equal((await list.json() as any).length, 1);

  const patched = await request(`/api/members/${member.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Ada Lovelace' }) });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json() as any).name, 'Ada Lovelace');

  const deleted = await request(`/api/members/${member.id}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  const listAfter = await request('/api/members');
  assert.equal((await listAfter.json() as any).length, 0);
});

test('local recurring event expands correctly across a US DST boundary (spring forward)', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'America/New_York' }) });

  const cal = await request('/api/calendars', {
    method: 'POST',
    body: JSON.stringify({ kind: 'local', name: 'Home' }),
  });
  const calendar = await cal.json() as any;

  // Daily 9am event starting before the Mar 8 2026 DST change, in America/New_York.
  const created = await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      calendarId: calendar.id,
      title: 'Standup',
      start: '2026-03-06T14:00:00.000Z', // 9am EST
      end: '2026-03-06T14:30:00.000Z',
      allDay: false,
      rrule: 'FREQ=DAILY;COUNT=5',
    }),
  });
  assert.equal(created.status, 201);

  const listRes = await request('/api/events?from=2026-03-06T00:00:00.000Z&to=2026-03-11T00:00:00.000Z');
  const instances = await listRes.json() as any;
  assert.equal(instances.length, 5);

  const byDate = new Map(instances.map((i: any) => [i.start.slice(0, 10), i.start]));
  // Before the Mar 8 change: 9am EST = 14:00Z. After: 9am EDT = 13:00Z.
  assert.equal(byDate.get('2026-03-06'), '2026-03-06T14:00:00.000Z');
  assert.equal(byDate.get('2026-03-07'), '2026-03-07T14:00:00.000Z');
  assert.equal(byDate.get('2026-03-09'), '2026-03-09T13:00:00.000Z');
  assert.equal(byDate.get('2026-03-10'), '2026-03-10T13:00:00.000Z');

  // All instances share the series id, distinguished by occurrenceStart.
  const ids = new Set(instances.map((i: any) => i.id));
  assert.equal(ids.size, 1);
  const occurrenceStarts = new Set(instances.map((i: any) => i.occurrenceStart));
  assert.equal(occurrenceStarts.size, 5);
});

test('chores: day listing, complete/uncomplete, and member points', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const memberRes = await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Bob', color: '#00ff00' }) });
  const member = await memberRes.json() as any;

  const choreRes = await request('/api/chores', {
    method: 'POST',
    body: JSON.stringify({ title: 'Dishes', points: 5, dueDate: '2026-06-01' }),
  });
  const chore = await choreRes.json() as any;

  const day1 = await request('/api/chores/day?date=2026-06-01');
  const dueList = await day1.json() as any;
  assert.equal(dueList.length, 1);
  assert.equal(dueList[0].completed, false);

  const complete = await request(`/api/chores/${chore.id}/complete`, {
    method: 'POST',
    body: JSON.stringify({ date: '2026-06-01', memberId: member.id }),
  });
  assert.equal(complete.status, 200);

  const day2 = await request('/api/chores/day?date=2026-06-01');
  const dueList2 = await day2.json() as any;
  assert.equal(dueList2[0].completed, true);
  assert.equal(dueList2[0].completedBy, member.id);

  const uncomplete = await request(`/api/chores/${chore.id}/complete?date=2026-06-01`, { method: 'DELETE' });
  assert.equal(uncomplete.status, 200);
  const day3 = await request('/api/chores/day?date=2026-06-01');
  assert.equal((await day3.json() as any)[0].completed, false);
});

test('rev bumps on a mutating write', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const before = await (await request('/api/rev')).json() as any;
  await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Cy', color: '#0000ff' }) });
  // emit() fires in the background (no ExecutionContext in tests); give it a tick to land.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = await (await request('/api/rev')).json() as any;
  assert.ok(after.rev > before.rev);
});

test('webhook receives an HMAC-signed payload on a mutation', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  let received: { body: string; signature: string } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url) === 'https://example.test/hook') {
      received = { body: String(init?.body), signature: String((init?.headers as Record<string, string>)?.['X-Kinwall-Signature']) };
      return new Response('ok', { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const secret = 'whsecret';
    await request('/api/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.test/hook', events: ['member.changed'], secret }),
    });

    await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Dee', color: '#123456' }) });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.ok(received, 'webhook was called');
    const hook = received as { body: string; signature: string };
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(hook.body));
    const expectedSig = `sha256=${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    assert.equal(hook.signature, expectedSig);
    const payload = JSON.parse(hook.body);
    assert.equal(payload.type, 'member.changed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sync: syncCalendar writes through the ics provider (network stubbed) and bumps rev', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const realFetch = globalThis.fetch;
  // syncCalendar's window is now-30d..now+365d, so anchor the fixture event on "now" (+7d).
  const eventStart = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const eventEnd = new Date(eventStart.getTime() + 60 * 60 * 1000);
  const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:evt1@example.test',
    `DTSTART:${icsDate(eventStart)}`,
    `DTEND:${icsDate(eventEnd)}`,
    'SUMMARY:Imported Event',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  globalThis.fetch = (async () => new Response(ics, { status: 200 })) as typeof fetch;

  try {
    const calRes = await request('/api/calendars', {
      method: 'POST',
      body: JSON.stringify({ kind: 'ics', name: 'Subscribed', url: 'https://example.test/feed.ics' }),
    });
    const calendar = await calRes.json() as any;

    const syncRes = await request(`/api/calendars/${calendar.id}/sync`, { method: 'POST' });
    assert.equal(syncRes.status, 200);
    const syncBody = await syncRes.json() as any;
    assert.equal(syncBody.count, 1);

    const from = new Date(eventStart.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(eventStart.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const eventsRes = await request(`/api/events?from=${from}&to=${to}&calendarId=${calendar.id}`);
    const events = await eventsRes.json() as any;
    assert.equal(events.length, 1);
    assert.equal(events[0].title, 'Imported Event');
    assert.equal(events[0].readOnly, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
