import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { todayInTz, weekStartDate } from '../src/routes/members.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env) {
  const app = createApp();
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
}

function addDaysStr(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

async function member(request: ReturnType<typeof makeApp>, name: string) {
  const res = await request('/api/members', { method: 'POST', body: JSON.stringify({ name, color: '#ff0000' }) });
  return (await res.json()) as { id: string };
}

// One-off chore due on `date`, assigned to `memberId`, worth `points`.
async function oneOffChore(request: ReturnType<typeof makeApp>, memberId: string, date: string, points = 5) {
  const res = await request('/api/chores', {
    method: 'POST',
    body: JSON.stringify({ title: `chore-${date}-${Math.random()}`, memberId, points, dueDate: date }),
  });
  return (await res.json()) as { id: string };
}

async function complete(request: ReturnType<typeof makeApp>, choreId: string, date: string) {
  const res = await request(`/api/chores/${choreId}/complete`, { method: 'POST', body: JSON.stringify({ date }) });
  assert.equal(res.status, 200);
}

test('leaderboard: ranking, ties, and zero-activity members', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const today = todayInTz('UTC');

  const amy = await member(request, 'Amy');
  const bob = await member(request, 'Bob');
  const cy = await member(request, 'Cy');
  await member(request, 'Dee'); // no chores/completions at all

  for (const m of [amy, bob]) {
    const c1 = await oneOffChore(request, m.id, today, 5);
    const c2 = await oneOffChore(request, m.id, today, 5);
    await complete(request, c1.id, today);
    await complete(request, c2.id, today);
  }
  const cyChore = await oneOffChore(request, cy.id, today, 5);
  await complete(request, cyChore.id, today);

  const res = await request('/api/leaderboard'); // default period=week
  assert.equal(res.status, 200);
  const board = (await res.json()) as any[];
  assert.equal(board.length, 4);

  const byName = new Map(board.map((e) => [e.name, e]));
  assert.equal(byName.get('Amy').points, 10);
  assert.equal(byName.get('Amy').completed, 2);
  assert.equal(byName.get('Bob').points, 10);
  assert.equal(byName.get('Cy').points, 5);
  assert.equal(byName.get('Dee').points, 0);
  assert.equal(byName.get('Dee').completed, 0);

  // Amy and Bob tie for rank 1 (points+completed equal); Cy is rank 3 (standard competition
  // ranking skips rank 2, since two members occupy it); Dee is rank 4.
  assert.equal(byName.get('Amy').rank, 1);
  assert.equal(byName.get('Bob').rank, 1);
  assert.equal(byName.get('Cy').rank, 3);
  assert.equal(byName.get('Dee').rank, 4);

  // Tied members break ties by name for a stable order.
  assert.deepEqual(board.slice(0, 2).map((e) => e.name), ['Amy', 'Bob']);
});

test('leaderboard: period boundaries respect settings.weekStart', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC', weekStart: 1, lateCompletionCredit: 100 }) }); // full points for past days: this is about boundaries
  const today = todayInTz('UTC');
  const weekFrom = weekStartDate('UTC', 1);
  const beforeWeek = addDaysStr(weekFrom, -1);

  const m = await member(request, 'Em');
  const outside = await oneOffChore(request, m.id, beforeWeek, 5);
  const atWeekStart = await oneOffChore(request, m.id, weekFrom, 5);
  const atToday = await oneOffChore(request, m.id, today, 5);
  await complete(request, outside.id, beforeWeek);
  await complete(request, atWeekStart.id, weekFrom);
  await complete(request, atToday.id, today);

  const todayBoard = (await (await request('/api/leaderboard?period=today')).json()) as any[];
  assert.equal(todayBoard[0].points, 5); // only today's completion

  const weekBoard = (await (await request('/api/leaderboard?period=week')).json()) as any[];
  assert.equal(weekBoard[0].points, 10); // weekFrom + today, not the day before week start
});

test('leaderboard: streak skips no-chore days and today-incomplete does not break it', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const today = todayInTz('UTC');

  const m = await member(request, 'Fin');
  // Due (and completed) on today-1, today-2, today-4, today-5; today-3 has nothing due (skip,
  // doesn't break); today has a chore due but left incomplete (skip today, doesn't break).
  const dueTodayChore = await oneOffChore(request, m.id, today);
  void dueTodayChore; // left incomplete on purpose
  for (const offset of [1, 2, 4, 5]) {
    const date = addDaysStr(today, -offset);
    const c = await oneOffChore(request, m.id, date);
    await complete(request, c.id, date);
  }

  const board = (await (await request('/api/leaderboard?period=month')).json()) as any[];
  const entry = board.find((e) => e.memberId === m.id);
  assert.equal(entry.streak, 4);
});

test('leaderboard: a missed day breaks the streak (no grace days)', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC', streakGraceDays: 0 }) });
  const today = todayInTz('UTC');

  const m = await member(request, 'Gia');
  const day1 = addDaysStr(today, -1); // completed
  const day2 = addDaysStr(today, -2); // due, NOT completed -> breaks the streak
  const day3 = addDaysStr(today, -3); // due & completed, but unreachable past the break

  const c1 = await oneOffChore(request, m.id, day1);
  await complete(request, c1.id, day1);
  await oneOffChore(request, m.id, day2); // left incomplete
  const c3 = await oneOffChore(request, m.id, day3);
  await complete(request, c3.id, day3);

  const board = (await (await request('/api/leaderboard?period=month')).json()) as any[];
  const entry = board.find((e) => e.memberId === m.id);
  assert.equal(entry.streak, 1);
});

test('leaderboard: display key may call it', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const keyRes = await admin('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) });
  const { key } = (await keyRes.json()) as { key: string };

  const app = createApp();
  const res = await app.request('/api/leaderboard', { headers: { Authorization: `Bearer ${key}` } }, env);
  assert.equal(res.status, 200);
});

test('chores: a daily chore created in the evening is due that same local day', async () => {
  const { dueOnDate } = await import('../src/routes/chores.ts');
  // 9pm in New York on Sep 24 is already Sep 25 in UTC.
  const row = { rrule: 'FREQ=DAILY', due_date: null, created_at: '2026-09-25T01:00:00.000Z' } as any;
  assert.equal(dueOnDate(row, '2026-09-24', 'America/New_York'), true);
  assert.equal(dueOnDate(row, '2026-09-23', 'America/New_York'), false);
});
