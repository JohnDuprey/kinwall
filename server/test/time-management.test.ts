// Leave-by time (travelMinutes), late chore completion credit, streak grace days, leaderboard toggle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { encryptConfig } from '../src/crypto.ts';
import { syncCalendar } from '../src/sync.ts';
import { computeStreak } from '../src/routes/leaderboard.ts';
import { lateCompletionPoints, type ChoreRow } from '../src/routes/chores.ts';
import { todayInTz } from '../src/routes/members.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (p: string, init: RequestInit = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env);
  const json = async (p: string, method = 'GET', body?: unknown) => (await request(p, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })).json() as Promise<any>;
  return Object.assign(request, { env, json });
}

function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

test('events: leaveAt = start - travelMinutes; null when unset or all-day; PATCH merges and clears', async () => {
  const request = makeApp();
  const cal = await request.json('/api/calendars', 'POST', { kind: 'local', name: 'Home' });
  const base = { calendarId: cal.id, start: '2030-01-01T16:05:00.000Z', end: '2030-01-01T17:00:00.000Z', allDay: false };

  const soccer = await request.json('/api/events', 'POST', { ...base, title: 'Soccer', travelMinutes: 30 });
  assert.deepEqual([soccer.travelMinutes, soccer.leaveAt, soccer.remindBeforeLeave], [30, '2030-01-01T15:35:00.000Z', false]);

  const plain = await request.json('/api/events', 'POST', { ...base, title: 'Call' });
  assert.deepEqual([plain.travelMinutes, plain.leaveAt, plain.remindBeforeLeave], [null, null, false]);

  const allDay = await request.json('/api/events', 'POST', { calendarId: cal.id, title: 'Trip', start: '2030-01-02', end: '2030-01-03', allDay: true, travelMinutes: 60 });
  assert.deepEqual([allDay.travelMinutes, allDay.leaveAt], [60, null]);

  // remindBeforeLeave alone keeps the stored travel; a recurring series gives each occurrence its own leaveAt.
  const patched = await request.json(`/api/events/${soccer.id}`, 'PATCH', { remindBeforeLeave: true, rrule: 'FREQ=DAILY;COUNT=2' });
  assert.deepEqual([patched.travelMinutes, patched.remindBeforeLeave], [30, true]);
  const list = await request.json('/api/events?from=2030-01-01T00:00:00Z&to=2030-01-03T00:00:00Z');
  assert.deepEqual(list.filter((e: any) => e.title === 'Soccer').map((e: any) => e.leaveAt), ['2030-01-01T15:35:00.000Z', '2030-01-02T15:35:00.000Z']);

  const cleared = await request.json(`/api/events/${soccer.id}`, 'PATCH', { travelMinutes: null });
  assert.deepEqual([cleared.travelMinutes, cleared.leaveAt], [null, null]);

  for (const travelMinutes of [-1, 601, 1.5]) {
    assert.equal((await request('/api/events', { method: 'POST', body: JSON.stringify({ ...base, title: 'x', travelMinutes }) })).status, 400);
  }
});

test('events: travel on a synced Google event is never written through, and survives a resync', async () => {
  const request = makeApp();
  const { env } = request;
  const writes: { method: string; url: string; body: any }[] = [];
  let remote: any = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') writes.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (u.endsWith('/users/me/calendarList')) return Response.json({ items: [{ id: 'primary', summary: 'Work', accessRole: 'owner' }] });
    if (u.includes('/users/me/calendarList/')) return Response.json({ defaultReminders: [] });
    if (method === 'POST' || method === 'PATCH') {
      remote = { id: 'g1', ...remote, ...JSON.parse(String(init!.body)) };
      return Response.json(remote);
    }
    if (u.includes('/calendars/primary/events?')) return Response.json({ items: remote ? [remote] : [] });
    throw new Error(`unexpected fetch: ${method} ${u}`);
  }) as typeof fetch;

  try {
    const accountId = 'acc';
    await env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
      .bind(accountId, 'google', 'me@example.test', await encryptConfig(env, accountId, { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 1e9 }), '2026-01-01')
      .run();
    await env.DB.prepare('INSERT INTO calendars (id, kind, account_id, remote_id, name, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?)')
      .bind('gcal', 'google', accountId, 'primary', 'Work', await encryptConfig(env, 'gcal', {}), 1, 1)
      .run();

    const start = new Date(Date.now() + 86400e3);
    const created = await request.json('/api/events', 'POST', {
      calendarId: 'gcal', title: 'Soccer', start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), allDay: false, travelMinutes: 25, remindBeforeLeave: true,
    });
    assert.deepEqual([created.travelMinutes, created.remindBeforeLeave], [25, true]);
    assert.equal(writes.length, 1);
    assert.deepEqual(Object.keys(writes[0].body).sort(), ['end', 'start', 'summary']); // no travel field of any name

    // Travel-only patch: a Kinwall-only annotation, no provider call at all.
    const patched = await request.json(`/api/events/${created.id}`, 'PATCH', { travelMinutes: 40 });
    assert.deepEqual([patched.travelMinutes, patched.remindBeforeLeave], [40, true]);
    assert.equal(writes.length, 1);

    // A mixed patch writes the title through, still without travel.
    await request.json(`/api/events/${created.id}`, 'PATCH', { title: 'Soccer practice', travelMinutes: 45 });
    assert.equal(writes.length, 2);
    assert.deepEqual(Object.keys(writes[1].body).sort(), ['end', 'start', 'summary']);

    // Sync deletes and reinserts every row; the override keeps the travel time.
    assert.deepEqual(await syncCalendar(env, 'gcal'), { ok: true, count: 1 });
    const [ev] = await request.json(`/api/events?from=${new Date(Date.now()).toISOString()}&to=${new Date(Date.now() + 3 * 86400e3).toISOString()}`);
    assert.deepEqual([ev.title, ev.travelMinutes, ev.remindBeforeLeave, ev.leaveAt], ['Soccer practice', 45, true, new Date(start.getTime() - 45 * 60e3).toISOString()]);
    const row = await env.DB.prepare('SELECT travel_minutes FROM events WHERE id = ?').bind(ev.id).first<{ travel_minutes: number | null }>();
    assert.equal(row?.travel_minutes, null); // lives in event_travel_overrides, not the synced row
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('chores: late completions earn lateCompletionCredit percent, stored on the completion', async () => {
  assert.deepEqual(
    [lateCompletionPoints(5, false, 50), lateCompletionPoints(5, true, 50), lateCompletionPoints(5, true, 100), lateCompletionPoints(5, true, 0), lateCompletionPoints(-4, true, 50)],
    [5, 3, 5, 0, 0],
  );

  const request = makeApp();
  await request.json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const today = todayInTz('UTC');
  const yesterday = addDays(today, -1);
  const kid = await request.json('/api/members', 'POST', { name: 'Kid', color: '#ff0000' });
  const chore = await request.json('/api/chores', 'POST', { title: 'Dishes', memberId: kid.id, points: 5, rrule: 'FREQ=DAILY', dueDate: addDays(today, -7) });

  await request.json(`/api/chores/${chore.id}/complete`, 'POST', { date: today });
  await request.json(`/api/chores/${chore.id}/complete`, 'POST', { date: yesterday }); // default 50%: round(2.5) = 3
  const awarded = async (date: string) => (await request.env.DB.prepare('SELECT points_awarded FROM chore_completions WHERE date = ?').bind(date).first<{ points_awarded: number }>())!.points_awarded;
  assert.deepEqual([await awarded(today), await awarded(yesterday)], [5, 3]);

  // Re-ticking keeps what it earned; a later settings change doesn't rewrite history.
  await request.json('/api/settings', 'PATCH', { lateCompletionCredit: 100 });
  await request.json(`/api/chores/${chore.id}/complete`, 'POST', { date: yesterday });
  assert.equal(await awarded(yesterday), 3);
  const twoAgo = addDays(today, -2);
  await request.json(`/api/chores/${chore.id}/complete`, 'POST', { date: twoAgo });
  assert.equal(await awarded(twoAgo), 5);

  const [entry] = await request.json('/api/leaderboard?period=month');
  const monthStart = `${today.slice(0, 8)}01`;
  const expected = 5 + (yesterday >= monthStart ? 3 : 0) + (twoAgo >= monthStart ? 5 : 0);
  assert.equal(entry.points, expected);
  const [member] = await request.json('/api/members');
  assert.equal(member.pointsToday, 5);
});

test('chores: an export without pointsAwarded imports completions at the chore\'s full points', async () => {
  const source = makeApp();
  const chore = await source.json('/api/chores', 'POST', { title: 'Bins', points: 4 });
  await source.json(`/api/chores/${chore.id}/complete`, 'POST', { date: '2020-01-01' });
  const file = await source.json('/api/export');
  assert.equal(file.choreCompletions[0].pointsAwarded, 2); // late, 50%
  delete file.choreCompletions[0].pointsAwarded;

  const target = makeApp();
  assert.equal((await target('/api/import', { method: 'POST', body: JSON.stringify(file) })).status, 200);
  const row = await target.env.DB.prepare('SELECT points_awarded FROM chore_completions').first<{ points_awarded: number }>();
  assert.equal(row?.points_awarded, 4);
});

test('streak grace: a streak survives up to N missed days in any rolling 7 days', () => {
  // Day patterns, today first then walking back: x = everything due was done, . = missed,
  // - = nothing due. Today (first char) left undone never counts as a miss.
  const TODAY = '2026-06-30';
  const cases: [pattern: string, grace: number, streak: number][] = [
    ['xxxxx', 0, 5],
    ['xx.xx', 0, 2],
    ['xx.xx', 1, 4], // one miss forgiven
    ['xx..xx', 1, 2], // two misses in 7 days: the second one ends it
    ['xx..xx', 2, 4],
    ['xx.xxxx.xx', 1, 6], // misses 5 days apart share a 7-day window: the second ends it
    ['xx.xxxxxx.xx', 1, 10], // misses 7 days apart are in different windows: both forgiven
    ['.xxx', 1, 3], // today undone is skipped, not a miss
    ['.xx.x', 0, 2],
    ['x-x-.-x', 1, 3], // nothing-due days neither count nor break
    ['....', 3, 0], // today skipped, then 3 forgiven misses, nothing done
    ['x...x', 2, 1],
    ['x...x', 3, 2],
  ];

  for (const [pattern, grace, expected] of cases) {
    const chores: ChoreRow[] = [];
    const done = new Set<string>();
    [...pattern].forEach((ch, i) => {
      if (ch === '-') return;
      const date = addDays(TODAY, -i);
      chores.push({ id: `c${i}`, title: 't', emoji: null, member_id: 'm', points: 1, rrule: null, due_date: date, due_time: null, active: 1, sort: 0, created_at: '2026-01-01' });
      if (ch === 'x') done.add(`c${i}:${date}`);
    });
    assert.equal(computeStreak(chores, done, 'UTC', TODAY, grace), expected, `${pattern} grace ${grace}`);
  }
});

test('settings: new chore keys have defaults, validate ranges, and the leaderboard still answers when disabled', async () => {
  const request = makeApp();
  const defaults = await request.json('/api/settings');
  assert.deepEqual([defaults.lateCompletionCredit, defaults.streakGraceDays, defaults.leaderboardEnabled], [50, 1, true]);

  for (const bad of [{ lateCompletionCredit: 101 }, { lateCompletionCredit: -1 }, { lateCompletionCredit: 12.5 }, { streakGraceDays: 4 }, { streakGraceDays: -1 }, { leaderboardEnabled: 'no' }]) {
    assert.equal((await request('/api/settings', { method: 'PATCH', body: JSON.stringify(bad) })).status, 400, JSON.stringify(bad));
  }
  const saved = await request.json('/api/settings', 'PATCH', { lateCompletionCredit: 0, streakGraceDays: 3, leaderboardEnabled: false });
  assert.deepEqual([saved.lateCompletionCredit, saved.streakGraceDays, saved.leaderboardEnabled], [0, 3, false]);
  assert.equal((await request('/api/leaderboard')).status, 200);
});
