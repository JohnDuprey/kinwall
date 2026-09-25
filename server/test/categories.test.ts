// Event categories: CRUD, display-key access, keyword auto-match, resolution precedence,
// override survival across re-sync, series vs occurrence scope, calendar default, and delete
// cleanup. Mirrors series-member-overrides.test.ts's structure for the sync/scope cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
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

function makeApp(env: Env, key = ADMIN_KEY) {
  const app = createApp();
  return (p: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

test('categories: CRUD - create, list ordered by sort, patch, delete', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const bday = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Birthdays', emoji: '🎂', color: '#FF9E7A', keywords: ['birthday', 'bday'], sort: 1 }) }));
  assert.equal(bday.name, 'Birthdays');
  assert.deepEqual(bday.keywords, ['birthday', 'bday']);

  const sports = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Sports', emoji: '⚽', color: '#7ED9A6', sort: 0 }) }));
  assert.deepEqual(sports.keywords, []);

  const list = await json<any[]>(await request('/api/categories'));
  assert.deepEqual(list.map((c) => c.name), ['Sports', 'Birthdays']); // sort 0 before sort 1

  const patched = await json<any>(await request(`/api/categories/${bday.id}`, { method: 'PATCH', body: JSON.stringify({ color: '#FFD166', keywords: ['birthday'] }) }));
  assert.equal(patched.color, '#FFD166');
  assert.deepEqual(patched.keywords, ['birthday']);

  const del = await request(`/api/categories/${sports.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await request(`/api/categories/${sports.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'x' }) })).status, 404);
});

test('categories: a display-scoped key can manage categories (allow-listed in auth.ts)', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const created = await json<any>(await admin('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) }));
  const display = makeApp(env, created.key);

  const cat = await json<any>(await display('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Travel', color: '#4DA3FF' }) }));
  assert.equal(cat.name, 'Travel');
  assert.equal((await display('/api/categories')).status, 200);
  assert.equal((await display(`/api/categories/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ color: '#B39DFF' }) })).status, 200);
  assert.equal((await display('/api/categories/reorder', { method: 'POST', body: JSON.stringify({ ids: [cat.id] }) })).status, 200);
  assert.equal((await display(`/api/categories/${cat.id}`, { method: 'DELETE' })).status, 200);
});

test('categories: keyword whole-word/phrase match, case-insensitive, regex-special chars escaped', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const cal = await json<any>(await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Family' }) }));
  await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Birthdays', color: '#FF9E7A', keywords: ['bday', 'b-day'], sort: 0 }) });
  await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Sports', color: '#7ED9A6', keywords: ['soccer'], sort: 1 }) });

  const mk = (title: string) => request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title, start: '2026-05-01T15:00:00.000Z', end: '2026-05-01T16:00:00.000Z', allDay: false }) });

  const bdayMatch = await json<any>(await mk('Grandpa BDAY'));
  assert.equal(bdayMatch.categorySource, 'keyword');

  const hyphenMatch = await json<any>(await mk("Ava's b-day party"));
  assert.equal(hyphenMatch.categorySource, 'keyword'); // regex-special hyphen in keyword matches literally

  const noMatch = await json<any>(await mk('soccerball shopping'));
  assert.equal(noMatch.categoryId, null); // "soccer" must NOT match inside "soccerball"

  const wordMatch = await json<any>(await mk('Soccer practice'));
  assert.equal(wordMatch.categorySource, 'keyword');
});

test('categories: resolution precedence - occurrence override > series override > keyword > calendar default > none', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const kwCat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Birthdays', color: '#FF9E7A', keywords: ['bday'], sort: 0 }) }));
  const calDefaultCat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Family', color: '#7AB8FF', sort: 1 }) }));
  const seriesCat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Sports', color: '#7ED9A6', sort: 2 }) }));
  const occCat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Travel', color: '#B39DFF', sort: 3 }) }));

  const cal = await json<any>(await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Family', categoryId: calDefaultCat.id }) }));

  // No override, no keyword match -> calendar default.
  const plain = await json<any>(await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 'Dinner', start: '2026-06-01T15:00:00.000Z', end: '2026-06-01T16:00:00.000Z', allDay: false }) }));
  assert.deepEqual([plain.categoryId, plain.categorySource], [calDefaultCat.id, 'calendar']);

  // Keyword match beats calendar default.
  const kw = await json<any>(await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 'Sam bday', start: '2026-06-02T15:00:00.000Z', end: '2026-06-02T16:00:00.000Z', allDay: false }) }));
  assert.deepEqual([kw.categoryId, kw.categorySource], [kwCat.id, 'keyword']);

  // A recurring local event, tagged via categoryId on create, reports scope 'series' (single row = whole series).
  const recurring = await json<any>(await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 'Weekly bday club', start: '2026-06-03T15:00:00.000Z', end: '2026-06-03T16:00:00.000Z', allDay: false, rrule: 'FREQ=WEEKLY', categoryId: seriesCat.id }) }));
  assert.deepEqual([recurring.categoryId, recurring.categorySource], [seriesCat.id, 'series']);

  // Occurrence-level categoryId on a non-recurring local event beats calendar default AND keyword.
  const occ = await json<any>(await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 'Sam bday', start: '2026-06-04T15:00:00.000Z', end: '2026-06-04T16:00:00.000Z', allDay: false, categoryId: occCat.id }) }));
  assert.deepEqual([occ.categoryId, occ.categorySource], [occCat.id, 'event']);

  // Clearing back to null (categoryId: null) on the occurrence falls through to keyword again.
  const cleared = await json<any>(await request(`/api/events/${occ.id}`, { method: 'PATCH', body: JSON.stringify({ categoryId: null }) }));
  assert.deepEqual([cleared.categoryId, cleared.categorySource], [kwCat.id, 'keyword']);

  // No category anywhere -> null/null.
  const noCat = await json<any>(await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Bare' }) }));
  const none = await json<any>(await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: noCat.id, title: 'Plain thing', start: '2026-06-05T15:00:00.000Z', end: '2026-06-05T16:00:00.000Z', allDay: false }) }));
  assert.deepEqual([none.categoryId, none.categorySource], [null, null]);
});

function icsFeed(uid: string, summary: string) {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `UID:${uid}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${summary}`, 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

test('categories: an occurrence-level override on a synced (ICS) event survives re-sync', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const cat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Appointments', color: '#4DA3FF' }) }));

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(icsFeed('evt-1@test', 'Dentist'), { status: 200 })) as typeof fetch;
  let cal: any;
  try {
    cal = await json<any>(await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'ics', name: 'Feed', url: 'https://example.test/feed.ics' }) }));
    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
  } finally {
    globalThis.fetch = realFetch;
  }

  let events = await json<any[]>(await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`));
  assert.equal(events.length, 1);
  assert.equal(events[0].categoryId, null);

  const patched = await json<any>(await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ categoryId: cat.id }) }));
  assert.deepEqual([patched.categoryId, patched.categorySource], [cat.id, 'event']);

  // Re-sync (same fetch mock -> same deterministic ids) - the override must still apply.
  globalThis.fetch = (async () => new Response(icsFeed('evt-1@test', 'Dentist'), { status: 200 })) as typeof fetch;
  try {
    await request(`/api/calendars/${cal.id}/sync`, { method: 'POST' });
  } finally {
    globalThis.fetch = realFetch;
  }
  events = await json<any[]>(await request(`/api/events?from=2020-01-01&to=2035-01-01&calendarId=${cal.id}`));
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].categoryId, events[0].categorySource], [cat.id, 'event']);
});

test('categories: series vs occurrence scope on a recurring synced event', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const accountId = crypto.randomUUID();
  const { encryptConfig } = await import('../src/crypto.ts');
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
    if (String(url).includes('/events?')) {
      const items = [1, 2, 3].map((i) => ({
        id: `inst${i}`,
        recurringEventId: 'series-master-1',
        summary: 'Weekly Standup',
        start: { dateTime: `2026-01-0${i}T15:00:00Z` },
        end: { dateTime: `2026-01-0${i}T16:00:00Z` },
      }));
      return Response.json({ items });
    }
    throw new Error('unexpected fetch');
  }) as typeof fetch;

  const cat1 = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'A', color: '#f00' }) }));
  const cat2 = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'B', color: '#0f0' }) }));

  try {
    const { syncCalendar } = await import('../src/sync.ts');
    await syncCalendar(env, calendarId);
    let events = await json<any[]>(await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`));
    assert.equal(events.length, 3);

    // Series scope applies to all occurrences.
    await request(`/api/events/${events[0].id}`, { method: 'PATCH', body: JSON.stringify({ categoryId: cat1.id, scope: 'series' }) });
    events = await json<any[]>(await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`));
    for (const e of events) assert.deepEqual([e.categoryId, e.categorySource], [cat1.id, 'series']);

    // An occurrence override wins for that one occurrence only.
    const occPatched = await json<any>(await request(`/api/events/${events[1].id}`, { method: 'PATCH', body: JSON.stringify({ categoryId: cat2.id, scope: 'occurrence' }) }));
    assert.deepEqual([occPatched.categoryId, occPatched.categorySource], [cat2.id, 'event']);
    events = await json<any[]>(await request(`/api/events?from=2025-01-01&to=2027-01-01&calendarId=${calendarId}`));
    const byStart = [...events].sort((a, b) => a.start.localeCompare(b.start));
    assert.deepEqual([byStart[0].categoryId, byStart[0].categorySource], [cat1.id, 'series']);
    assert.deepEqual([byStart[1].categoryId, byStart[1].categorySource], [cat2.id, 'event']);
    assert.deepEqual([byStart[2].categoryId, byStart[2].categorySource], [cat1.id, 'series']);

    // 400 on a non-recurring event with scope 'series'.
    // (reuse the single-occurrence override path instead - series-member-overrides.test.ts covers the 400 case for memberIds identically.)
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('categories: calendar default applies when no override/keyword match', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const cat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Family', color: '#7AB8FF' }) }));
  const cal = await json<any>(await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) }));
  assert.equal(cal.categoryId, null);

  const withDefault = await json<any>(await request(`/api/calendars/${cal.id}`, { method: 'PATCH', body: JSON.stringify({ categoryId: cat.id }) }));
  assert.equal(withDefault.categoryId, cat.id);

  const ev = await json<any>(await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 'Untitled thing', start: '2026-07-01T15:00:00.000Z', end: '2026-07-01T16:00:00.000Z', allDay: false }) }));
  assert.deepEqual([ev.categoryId, ev.categorySource], [cat.id, 'calendar']);

  const cleared = await json<any>(await request(`/api/calendars/${cal.id}`, { method: 'PATCH', body: JSON.stringify({ categoryId: null }) }));
  assert.equal(cleared.categoryId, null);
});

test('categories: deleting a category clears every reference - events fall back to the next source', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const kwCat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Birthdays', color: '#FF9E7A', keywords: ['bday'], sort: 0 }) }));
  const calDefaultCat = await json<any>(await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'Family', color: '#7AB8FF', sort: 1 }) }));
  const cal = await json<any>(await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home', categoryId: calDefaultCat.id }) }));

  // Occurrence override on a category that keyword-matches too (occurrence should still win pre-delete).
  const ev = await json<any>(await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 'Sam bday', start: '2026-08-01T15:00:00.000Z', end: '2026-08-01T16:00:00.000Z', allDay: false, categoryId: calDefaultCat.id }) }));
  assert.deepEqual([ev.categoryId, ev.categorySource], [calDefaultCat.id, 'event']);

  // Delete the occurrence's own category (calDefaultCat, also the calendar default) - falls back to
  // the keyword match (kwCat), since the occurrence override itself is gone.
  await request(`/api/categories/${calDefaultCat.id}`, { method: 'DELETE' });
  const afterDelete = await json<any>(await request(`/api/events/${ev.id}`));
  assert.deepEqual([afterDelete.categoryId, afterDelete.categorySource], [kwCat.id, 'keyword']);

  const calendars = await json<any[]>(await request('/api/calendars'));
  assert.equal(calendars.find((c) => c.id === cal.id)?.categoryId, null);
});

test('categories and members created without a sort go last, not all at 0', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const a = await (await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'A', color: '#111111' }) })).json() as any;
  const b = await (await request('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'B', color: '#222222' }) })).json() as any;
  assert.ok(b.sort > a.sort);
  const m1 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'One', color: '#111111' }) })).json() as any;
  const m2 = await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Two', color: '#222222' }) })).json() as any;
  assert.ok(m2.sort > m1.sort);
});
