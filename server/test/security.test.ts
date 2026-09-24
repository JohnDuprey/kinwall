import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { encrypt, decrypt, encryptConfig } from '../src/crypto.ts';
import { prefilterIcs, expandICS, parseIcsEvents } from '../src/providers/ics.ts';
import { syncCalendarTick } from '../src/sync.ts';

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

function makeApp(env: Env, defaultKey = ADMIN_KEY) {
  const app = createApp();
  const request = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !path.includes('key=')) headers.set('Authorization', `Bearer ${defaultKey}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
  return request;
}

test('crypto: round-trips, fails under a mismatched AAD, and passes legacy plaintext through unchanged', async () => {
  const env = { ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
  const blob = await encrypt(env, 'super-secret-token', 'row-1');
  assert.ok(blob.startsWith('v1:'));
  assert.equal(await decrypt(env, blob, 'row-1'), 'super-secret-token');
  await assert.rejects(() => decrypt(env, blob, 'row-2'));
  // Rows written before encryption shipped have no 'v1:' prefix - read back as-is.
  assert.equal(await decrypt(env, 'plain-legacy-value', 'row-1'), 'plain-legacy-value');
});

test('key scopes: display key is 403 on admin-only routes, 200 on display-allowed ones, and GET /api/me reports scope', async () => {
  const env = makeEnv();
  const admin = makeApp(env);

  const createdKey = await (await admin('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall ipad', scope: 'display' }) })).json() as any;
  assert.equal(createdKey.scope, 'display');
  const display = makeApp(env, createdKey.key);

  for (const path of ['/api/keys', '/api/webhooks', '/api/accounts']) {
    const res = await display(path);
    assert.equal(res.status, 403, `${path} should be forbidden for a display key`);
  }

  const cal = await (await admin('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json() as any;
  const chore = await (await admin('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Dishes' }) })).json() as any;

  const eventRes = await display('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: cal.id, title: 'Dentist', start: '2026-05-01T10:00:00.000Z', end: '2026-05-01T11:00:00.000Z', allDay: false }),
  });
  assert.equal(eventRes.status, 201);

  const completeRes = await display(`/api/chores/${chore.id}/complete`, { method: 'POST', body: JSON.stringify({ date: '2026-05-01' }) });
  assert.equal(completeRes.status, 200);

  const meAdmin = await (await admin('/api/me')).json() as any;
  assert.equal(meAdmin.scope, 'admin');
  const meDisplay = await (await display('/api/me')).json() as any;
  assert.equal(meDisplay.scope, 'display');
  assert.equal(meDisplay.keyName, 'wall ipad');
});

test('secrets never appear in a GET response body, even as raw text', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const secretUrl = 'https://example.test/very-secret-feed.ics?token=sh0uldNeverLeak';
  await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Secret Feed', url: secretUrl }) });
  const calendarsText = await (await request('/api/calendars')).text();
  assert.ok(!calendarsText.includes('sh0uldNeverLeak'));
  assert.ok(!calendarsText.includes(secretUrl));

  const webhookSecret = 'wh_super_secret_signing_key';
  await request('/api/webhooks', { method: 'POST', body: JSON.stringify({ url: 'https://example.test/hook', events: [], secret: webhookSecret }) });
  const webhooksText = await (await request('/api/webhooks')).text();
  assert.ok(!webhooksText.includes(webhookSecret));
});

test('ics: prefilter drops a clearly-old non-recurring event but keeps a RECURRENCE-ID override of a kept master', () => {
  const from = new Date('2026-06-01T00:00:00Z');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:ancient@test',
    'DTSTART:20200101T090000Z',
    'DTEND:20200101T100000Z',
    'SUMMARY:Way in the past',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series@test',
    'DTSTART:20260101T090000Z',
    'DTEND:20260101T100000Z',
    'RRULE:FREQ=WEEKLY',
    'SUMMARY:Ongoing series',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series@test',
    'RECURRENCE-ID:20200601T090000Z',
    'DTSTART:20200601T093000Z',
    'DTEND:20200601T103000Z',
    'SUMMARY:Old override of an ongoing series',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  const filtered = prefilterIcs(ics, from);
  assert.ok(!filtered.includes('ancient@test'), 'old non-recurring event is dropped');
  assert.ok(filtered.includes('series@test'), 'open-ended recurring master survives');
  assert.ok(filtered.includes('Old override of an ongoing series'), 'RECURRENCE-ID override survives even though it looks old');

  // Still parses cleanly (no corrupted BEGIN/END pairing from the filter).
  const events = expandICS(filtered, new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
  assert.ok(events.length > 0);
});

test('ics: floating (no TZID, no Z) times are interpreted in the household timezone', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:floating@test',
    'DTSTART:20260615T090000',
    'DTEND:20260615T100000',
    'SUMMARY:Floating morning event',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const from = new Date('2026-06-01T00:00:00Z');
  const to = new Date('2026-07-01T00:00:00Z');

  const utc = expandICS(ics, from, to, 'UTC');
  const ny = expandICS(ics, from, to, 'America/New_York');
  assert.equal(utc[0].start, '2026-06-15T09:00:00.000Z');
  // June 15 2026 09:00 America/New_York is EDT (UTC-4) -> 13:00Z, 4 hours later than the UTC reading.
  assert.equal(ny[0].start, '2026-06-15T13:00:00.000Z');
});

test('sync: an ICS 304 (not modified) response just bumps last_synced_at without touching events', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const realFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    requestCount++;
    const headers = init?.headers as Record<string, string> | undefined;
    assert.equal(headers?.['If-None-Match'], '"abc123"');
    return new Response(null, { status: 304 });
  }) as typeof fetch;

  try {
    const cal = await (await request('/api/calendars', {
      method: 'POST',
      body: JSON.stringify({ kind: 'ics', name: 'Cached Feed', url: 'https://example.test/feed.ics' }),
    })).json() as any;
    await env.DB.prepare('UPDATE calendars SET etag = ? WHERE id = ?').bind('"abc123"', cal.id).run();

    const result = await syncCalendarTick(env, cal.id);
    assert.deepEqual(result, { ok: true });
    assert.equal(requestCount, 1);

    const row = await env.DB.prepare('SELECT last_synced_at, etag FROM calendars WHERE id = ?').bind(cal.id).first<any>();
    assert.ok(row.last_synced_at);
    assert.equal(row.etag, '"abc123"'); // untouched - we never re-fetched the body
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sync: chunked tick advances a remote calendar\'s far-slice cursor', async () => {
  const env = makeEnv();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    if (String(url).includes('googleapis.com/calendar/v3')) return Response.json({ items: [] });
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const accountId = crypto.randomUUID();
    const accountConfig = await encryptConfig(env, accountId, { access_token: 'tok', refresh_token: 'r1', expires_at: Date.now() + 1_000_000_000 });
    await env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
      .bind(accountId, 'google', 'test@example.test', accountConfig, new Date().toISOString())
      .run();

    const calendarId = crypto.randomUUID();
    const calendarConfig = await encryptConfig(env, calendarId, {});
    await env.DB.prepare(
      'INSERT INTO calendars (id, kind, account_id, remote_id, name, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?)',
    )
      .bind(calendarId, 'google', accountId, 'primary', 'Work', calendarConfig, 1, 1)
      .run();

    let row = await env.DB.prepare('SELECT sync_cursor FROM calendars WHERE id = ?').bind(calendarId).first<{ sync_cursor: string | null }>();
    assert.equal(row?.sync_cursor, null);

    const first = await syncCalendarTick(env, calendarId);
    assert.deepEqual(first, { ok: true });
    row = await env.DB.prepare('SELECT sync_cursor FROM calendars WHERE id = ?').bind(calendarId).first<{ sync_cursor: string | null }>();
    const cursorAfterFirst = JSON.parse(row!.sync_cursor!);
    assert.equal(cursorAfterFirst.farIndex, 1, 'the far slice was due on the first tick (cursor starts empty)');
    assert.ok(cursorAfterFirst.farSyncedAt);

    // Force the far slice to look stale again (as if 6h+ had passed) and tick once more.
    const stale = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE calendars SET sync_cursor = ? WHERE id = ?')
      .bind(JSON.stringify({ farIndex: 1, farSyncedAt: stale }), calendarId)
      .run();

    const second = await syncCalendarTick(env, calendarId);
    assert.deepEqual(second, { ok: true });
    row = await env.DB.prepare('SELECT sync_cursor FROM calendars WHERE id = ?').bind(calendarId).first<{ sync_cursor: string | null }>();
    const cursorAfterSecond = JSON.parse(row!.sync_cursor!);
    assert.equal(cursorAfterSecond.farIndex, 2, 'cursor advances to the next far slice once it is due again');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('validation errors: a 400 always has a plain string `error`, not zod-openapi\'s default shape', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const res = await request('/api/members', { method: 'POST', body: JSON.stringify({ name: '', color: '' }) });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
});

test('ICS stable externalId + content fingerprint: a feed that regenerates UID/DTSTAMP every fetch (real Thrillshare export) keeps stable ids and skips the DB replace on the second sync', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const fixtureA = readFileSync(path.join(__dirname, 'fixtures/thrillshare-school-a.ics'), 'utf-8');
  const fixtureB = readFileSync(path.join(__dirname, 'fixtures/thrillshare-school-b.ics'), 'utf-8');
  const from = new Date('2026-09-01T00:00:00Z');
  const to = new Date('2027-09-01T00:00:00Z');

  // Pure parse-level check: same content, different UID/DTSTAMP -> identical externalIds.
  const eventsA = await parseIcsEvents(fixtureA, from, to, 'America/New_York');
  const eventsB = await parseIcsEvents(fixtureB, from, to, 'America/New_York');
  assert.equal(eventsA.length, 11);
  assert.equal(eventsB.length, 11);
  assert.deepEqual(eventsA.map((e) => e.externalId).sort(), eventsB.map((e) => e.externalId).sort());

  const pictureDay = eventsA.find((e) => e.title === 'IBES Fall Picture Day');
  assert.ok(pictureDay);
  assert.equal(pictureDay!.allDay, true);
  assert.equal(pictureDay!.start, '2026-10-05');
  assert.equal(pictureDay!.end, '2026-10-06');

  const ptaMeetings = eventsA.filter((e) => e.title === 'IBES PTA Meeting').map((e) => e.start).sort();
  // Two occurrences either side of the Nov 1 2026 DST fallback, confirming the floating time is
  // resolved per-instance rather than with one fixed offset for the whole series.
  assert.ok(ptaMeetings.includes('2026-10-13T21:30:00.000Z'));
  assert.ok(ptaMeetings.includes('2026-11-17T22:30:00.000Z'));

  // End-to-end: two ticks against the two fixtures (same shape as consecutive real fetches -
  // fresh weak ETag each time, so ETag alone can't say "unchanged") should skip the DB replace
  // on the second tick because the content fingerprint (DTSTAMP/UID stripped) matches.
  const realFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call++;
    const text = call === 1 ? fixtureA : fixtureB;
    return new Response(text, { status: 200, headers: { ETag: `"w/${call}-${Date.now()}"` } });
  }) as typeof fetch;

  try {
    const cal = await (await request('/api/calendars', {
      method: 'POST',
      body: JSON.stringify({ kind: 'ics', name: 'School', url: 'https://example.test/school.ics' }),
    })).json() as any;

    const first = await syncCalendarTick(env, cal.id);
    assert.deepEqual(first, { ok: true });
    const rowsAfterFirst = (await env.DB.prepare('SELECT id, external_id FROM events WHERE calendar_id = ? ORDER BY start, external_id').bind(cal.id).all<any>()).results;
    assert.equal(rowsAfterFirst.length, 11);

    const second = await syncCalendarTick(env, cal.id);
    assert.deepEqual(second, { ok: true });
    const rowsAfterSecond = (await env.DB.prepare('SELECT id, external_id FROM events WHERE calendar_id = ? ORDER BY start, external_id').bind(cal.id).all<any>()).results;

    assert.deepEqual(rowsAfterSecond, rowsAfterFirst, 'same DB rows (same internal ids) - the fingerprint match skipped the delete+insert');

    const calRow = await env.DB.prepare('SELECT etag FROM calendars WHERE id = ?').bind(cal.id).first<{ etag: string }>();
    assert.ok(calRow!.etag.startsWith('"w/2-'), 'etag still reflects the latest response even though we skipped the DB replace');
  } finally {
    globalThis.fetch = realFetch;
  }
});
