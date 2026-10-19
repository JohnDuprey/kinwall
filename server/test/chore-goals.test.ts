import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { goalPeriod } from '../src/chore-goal.ts';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';

const goal = { times: 3, every: 1, unit: 'week' as const, weekStart: 1 };
test('goal periods use calendar boundaries, anchored multiweek cycles and real month lengths', () => {
  assert.deepEqual(goalPeriod(goal, '2026-10-21', '2026-10-25'), { from: '2026-10-19', to: '2026-10-25' });
  assert.deepEqual(goalPeriod({ ...goal, every: 2 }, '2026-10-19', '2026-11-01'), { from: '2026-10-19', to: '2026-11-01' });
  assert.deepEqual(goalPeriod({ ...goal, unit: 'day', every: 3 }, '2026-10-19', '2026-10-22'), { from: '2026-10-22', to: '2026-10-24' });
  assert.deepEqual(goalPeriod({ ...goal, unit: 'month' }, '2024-01-31', '2024-02-29'), { from: '2024-02-01', to: '2024-02-29' });
  assert.deepEqual(goalPeriod({ ...goal, unit: 'month', every: 2 }, '2026-12-15', '2027-01-20'), { from: '2026-12-01', to: '2027-01-31' });
});

function setup() {
  const db = openDb(':memory:'); applyMigrations(db, join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const json = async (path: string, method = 'GET', body?: unknown) => { const r = await request(path, method, body); assert.ok(r.ok, `${method} ${path}: ${r.status} ${await r.clone().text()}`); return await r.json() as any; };
  return { db, env, app, request, json };
}

test('flexible goal: counts distinct days, caps the interval atomically, resets, and supports undo', async () => {
  const { json, request } = setup();
  const ch = await json('/api/chores', 'POST', { title: 'Practice piano', dueDate: '2026-10-19', repeatGoal: goal, points: 5 });
  assert.deepEqual(ch.repeatGoal, goal);
  assert.equal((await json('/api/chores/day?date=2026-10-18')).length, 0);
  const complete = (date: string) => json(`/api/chores/${ch.id}/complete`, 'POST', { date });
  await complete('2026-10-19'); await complete('2026-10-19');
  let day = (await json('/api/chores/day?date=2026-10-20'))[0];
  assert.equal(day.goalProgress.done, 1); assert.equal(day.completed, false);
  await complete('2026-10-21');
  const last = await Promise.all(['2026-10-23', '2026-10-24'].map(date => request(`/api/chores/${ch.id}/complete`, 'POST', { date })));
  assert.deepEqual(last.map(r => r.status).sort(), [200, 400]);
  day = (await json('/api/chores/day?date=2026-10-25'))[0];
  assert.equal(day.goalProgress.done, 3); assert.equal(day.goalProgress.full, true); assert.equal(day.completed, false, 'goal reached must not invent a daily completion');
  assert.equal((await request(`/api/chores/${ch.id}/complete`, 'POST', { date: '2026-10-25' })).status, 400);
  assert.equal((await json('/api/chores/day?date=2026-10-26'))[0].goalProgress.done, 0);
  await json(`/api/chores/${ch.id}/complete?date=2026-10-19`, 'DELETE');
  assert.equal((await json('/api/chores/day?date=2026-10-25'))[0].goalProgress.full, false);
  await complete('2026-10-25');
  const edited = await json(`/api/chores/${ch.id}`, 'PATCH', { title: 'Piano practice' }); assert.deepEqual(edited.repeatGoal, goal);
  assert.equal((await json('/api/export')).chores.find((c: any) => c.id === ch.id).repeatGoal.times, 3);
});

test('goal validation refuses impossible daily targets, malformed anchors and conflicting schedules', async () => {
  const { request } = setup();
  for (const body of [
    { repeatGoal: { ...goal, times: 0 } },
    { repeatGoal: { ...goal, unit: 'day', times: 2 } },
    { repeatGoal: goal, dueDate: '2026-02-30' },
    { repeatGoal: goal, rrule: 'FREQ=WEEKLY;BYDAY=MO' },
  ]) assert.equal((await request('/api/chores', 'POST', { title: 'Piano', dueDate: '2026-10-19', ...body })).status, 400);
});

test('pending approvals reserve a place, rejection frees it, and kids cannot edit the goal', async () => {
  const { db, json, app, env } = setup();
  const today = new Date().toISOString().slice(0, 10);
  const leo = await json('/api/members', 'POST', { name: 'Leo', color: '#7BCB94' });
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#F28DB2' });
  const device = await json('/api/keys', 'POST', { name: 'Leo test tablet', scope: 'display' });
  await json(`/api/keys/${device.id}`, 'PATCH', { owner: leo.id });
  const child = (path: string, body: unknown, method = 'POST') => app.request(path, { method, headers: { Authorization: `Bearer ${device.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  const ch = await json('/api/chores', 'POST', { title: 'Piano', dueDate: today, repeatGoal: { ...goal, times: 1 }, memberId: leo.id, needsApproval: true });
  assert.equal((await child('/api/chores', { title: 'Extra', repeatGoal: goal, dueDate: today })).status, 403);
  assert.equal((await child(`/api/chores/${ch.id}`, { repeatGoal: { ...goal, times: 7 } }, 'PATCH')).status, 403);
  assert.equal((await (await child(`/api/chores/${ch.id}/complete`, { date: today })).json() as any).pending, true);
  let day = (await json(`/api/chores/day?date=${today}`))[0];
  assert.equal(day.goalProgress.done, 0); assert.equal(day.goalProgress.pending, 1); assert.equal(day.goalProgress.full, true);
  await json(`/api/chores/${ch.id}/reject`, 'POST', { date: today });
  assert.equal((await json(`/api/chores/day?date=${today}`))[0].goalProgress.full, false);
  await child(`/api/chores/${ch.id}/complete`, { date: today });
  await json(`/api/chores/${ch.id}/approve`, 'POST', { date: today });
  day = (await json(`/api/chores/day?date=${today}`))[0]; assert.equal(day.goalProgress.done, 1); assert.equal(day.goalProgress.pending, 0);
  const theirs = await json('/api/chores', 'POST', { title: 'Piano', dueDate: today, repeatGoal: goal, memberId: maya.id });
  assert.equal((await child(`/api/chores/${theirs.id}/complete`, { date: today })).status, 403);
  assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM chore_completions WHERE chore_id = ?').bind(ch.id).first<{ n: number }>())!.n), 1);
});

test('flexible goals do not penalize rest days; interval ends judge the full target', async () => {
  const { streakStats } = await import('../src/routes/leaderboard.ts');
  const row = { id: 'p', title: 'Piano', emoji: null, member_id: 'leo', points: 5, due_date: '2026-10-19', due_time: null, active: 1, sort: 0, created_at: '2026-10-19T12:00:00Z', rrule: 'FREQ=DAILY', repeat_goal: JSON.stringify(goal) };
  const keys = new Set(['p:2026-10-19', 'p:2026-10-21', 'p:2026-10-23']);
  assert.equal(streakStats([row], keys, 'America/New_York', '2026-10-26', 0, 8).current, 1);
  assert.equal(streakStats([row], keys, 'America/New_York', '2026-11-02', 0, 15).current, 0);
  assert.equal(streakStats([row], new Set(['p:2026-10-25']), 'UTC', '2026-10-26', 0, 8).current, 0);
  const daily = { ...row, id: 'daily', repeat_goal: null };
  const recent = new Set(['daily:2026-10-25', 'daily:2026-10-26', 'daily:2026-10-27', 'daily:2026-10-28']);
  assert.equal(streakStats([row, daily], recent, 'UTC', '2026-10-28', 0, 4).current, 4, 'a partially observed goal interval does not create a false miss');
});

test('reached goals stop appearing as open work on the board and snapshots; exports restore them', async () => {
  const { json } = setup();
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const today = new Date().toISOString().slice(0, 10);
  const { shiftGoalDate } = await import('../src/chore-goal.ts');
  const yesterday = shiftGoalDate(today, -1);
  const leo = await json('/api/members', 'POST', { name: 'Leo', color: '#7BCB94' });
  const ch = await json('/api/chores', 'POST', { title: 'Piano', memberId: leo.id, dueDate: yesterday, repeatGoal: { ...goal, times: 1, every: 7, unit: 'day' }, dueTime: '16:00', timerMinutes: 5 });
  await json(`/api/chores/${ch.id}/complete`, 'POST', { date: yesterday });
  const board = await json('/api/board');
  assert.equal(board.timedChores.some((c: any) => c.id === ch.id), false);
  assert.equal(board.chores.some((c: any) => c.memberId === leo.id && c.remaining > 0), false);
  const snap = await json(`/api/snapshot?member=${leo.id}`);
  assert.equal(snap.chores.some((c: any) => c.id === ch.id), false);
  const backup = await json('/api/export');
  const restored = setup();
  await restored.json('/api/import', 'POST', backup);
  const reloaded = (await restored.json('/api/chores')).find((c: any) => c.id === ch.id);
  assert.deepEqual(reloaded.repeatGoal, ch.repeatGoal);
  assert.equal((await restored.json(`/api/chores/day?date=${today}`))[0].goalProgress.full, true);
});

test('converting an older chore to a goal counts only dates on or after the goal start', async () => {
  const { json } = setup();
  const ch = await json('/api/chores', 'POST', { title: 'Piano', rrule: 'FREQ=DAILY', dueDate: '2026-10-19' });
  await json(`/api/chores/${ch.id}/complete`, 'POST', { date: '2026-10-19' });
  await json(`/api/chores/${ch.id}`, 'PATCH', { repeatGoal: { ...goal, times: 1 }, dueDate: '2026-10-21' });
  assert.equal((await json('/api/chores/day?date=2026-10-21'))[0].goalProgress.done, 0);
  await json(`/api/chores/${ch.id}/complete`, 'POST', { date: '2026-10-21' });
  assert.equal((await json('/api/chores/day?date=2026-10-22'))[0].goalProgress.full, true);
});
