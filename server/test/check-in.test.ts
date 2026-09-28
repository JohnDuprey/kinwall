// Daily check-in: reading your day to the end earns a few points, once per member per household day.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { getRev } from '../src/bus.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';

// Saturday 2026-09-26, 10 pm in Los Angeles (already Sunday in UTC).
const NOW = new Date('2026-09-27T05:00:00Z');

async function setup(points = 3) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: NOW });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/Los_Angeles', ...(points ? { checkInPoints: points } : {}) });
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#5B8DEF' })).json;
  const key = async (owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name: `k-${owner ?? 'wall'}`, scope: 'display' })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  return { env, req, maya, leo, key };
}

const snapshot = async (req: Awaited<ReturnType<typeof setup>>['req'], id: string, range = 'day') => (await req(`/api/snapshot?member=${id}&range=${range}`)).json;

test('check-in: off by default (400, and the snapshot says so)', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup(0);
  assert.equal((await req('/api/settings')).json.checkInPoints, 0);
  const r = await req(`/api/members/${maya.id}/check-in`, 'POST');
  assert.equal(r.status, 400);
  const s = await snapshot(req, maya.id);
  assert.deepEqual([s.checkedIn, s.checkInPoints], [false, 0]);
  assert.equal((await req('/api/settings', 'PATCH', { checkInPoints: 4 })).status, 400); // Off, 1, 2, 3, 5 or 10
});

test('check-in: once per member per day; a second call awards nothing; points reach the balance and profile', async (t) => {
  t.after(() => mock.timers.reset());
  const { env, req, maya, leo } = await setup(3);
  assert.deepEqual([(await snapshot(req, maya.id)).checkedIn, (await snapshot(req, maya.id)).checkInPoints], [false, 3]);

  const rev = await getRev(env.DB);
  const first = await req(`/api/members/${maya.id}/check-in`, 'POST');
  assert.equal(first.status, 200);
  assert.deepEqual([first.json.date, first.json.points, first.json.awarded, first.json.balance], ['2026-09-26', 3, 3, 3]);
  const again = await req(`/api/members/${maya.id}/check-in`, 'POST');
  assert.deepEqual([again.status, again.json.date, again.json.points, again.json.awarded, again.json.balance], [200, '2026-09-26', 3, 0, 3]);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok((await getRev(env.DB)) > rev);

  assert.equal((await snapshot(req, maya.id)).checkedIn, true);
  assert.equal((await snapshot(req, leo.id)).checkedIn, false);
  assert.equal((await req('/api/members/ghost/check-in', 'POST')).status, 404);

  const members = (await req('/api/members')).json as any[];
  assert.equal(members.find((m) => m.id === maya.id).balance, 3);
  const points = (await req(`/api/members/${maya.id}/points`)).json;
  assert.deepEqual([points.balance, points.earnedTotal, points.entries.map((e: any) => [e.amount, e.reason, e.ref])], [3, 3, [[3, 'check_in', '2026-09-26']]]);
  const stats = (await req(`/api/members/${maya.id}/stats?period=week`)).json;
  assert.deepEqual([stats.checkIns, stats.pointsEarned, stats.choresDone], [1, 3, 0]);
  // The leaderboard ranks chores: a check-in isn't a chore.
  assert.equal((await req('/api/leaderboard?period=week')).json.find((e: any) => e.memberId === maya.id).points, 0);
  // Changing the setting later doesn't change what was earned.
  await req('/api/settings', 'PATCH', { checkInPoints: 10 });
  assert.deepEqual([(await req(`/api/members/${maya.id}/check-in`, 'POST')).json.awarded, (await snapshot(req, maya.id)).checkInPoints], [0, 10]);
});

test('check-in: the day is the household day, so a new one starts at local midnight', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya } = await setup(2);
  assert.equal((await req(`/api/members/${maya.id}/check-in`, 'POST')).json.date, '2026-09-26'); // 10 pm Saturday in LA
  mock.timers.setTime(new Date('2026-09-27T06:59:00Z').getTime()); // 11:59 pm: still Saturday
  assert.equal((await req(`/api/members/${maya.id}/check-in`, 'POST')).json.awarded, 0);
  mock.timers.setTime(new Date('2026-09-27T07:01:00Z').getTime()); // 12:01 am Sunday
  const sunday = (await req(`/api/members/${maya.id}/check-in`, 'POST')).json;
  assert.deepEqual([sunday.date, sunday.awarded, sunday.balance], ['2026-09-27', 2, 4]);
  assert.equal((await req(`/api/members/${maya.id}/stats?period=week`)).json.checkIns, 1); // the week started Sunday
  assert.equal((await req(`/api/members/${maya.id}/stats?period=all`)).json.checkIns, 2);
});

test("check-in: display keys may; a member's own device only for them", async (t) => {
  t.after(() => mock.timers.reset());
  const { req, maya, leo, key } = await setup(1);
  const wall = await key();
  const leos = await key(leo.id);
  const refused = await req(`/api/members/${maya.id}/check-in`, 'POST', undefined, leos);
  assert.equal(refused.status, 403);
  assert.equal((await req(`/api/members/${leo.id}/check-in`, 'POST', undefined, leos)).json.awarded, 1);
  assert.equal((await req(`/api/members/${maya.id}/check-in`, 'POST', undefined, wall)).json.awarded, 1);
});

test('check-in: export and import carry check-ins without doubling points', async (t) => {
  t.after(() => mock.timers.reset());
  const source = await setup(5);
  await source.req(`/api/members/${source.maya.id}/check-in`, 'POST');
  const file = (await source.req('/api/export')).json;
  assert.deepEqual(file.checkIns, [{ memberId: source.maya.id, date: '2026-09-26', points: 5, at: NOW.toISOString() }]);

  const target = await setup(5);
  const res = await target.req('/api/import', 'POST', file);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.imported.checkIns, 1);
  assert.equal((await target.req('/api/import', 'POST', file)).status, 200); // again: nothing doubles
  assert.deepEqual((await target.req('/api/export')).json.checkIns, file.checkIns);
  assert.equal((await target.req(`/api/members/${source.maya.id}/check-in`, 'POST')).json.awarded, 0); // already done today
  assert.equal(((await target.req('/api/members')).json as any[]).find((m) => m.id === source.maya.id).balance, 5);
});
