// Last night's check-in: the evening check (goal check, "How drained do you feel?") for day D stays
// open after midnight until noon on D+1, their morning Temp check, or a skip, whichever comes first.
// Answers stay on D.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const D = '2026-09-29'; // last night
const NEXT = '2026-09-30';
// Household time in New York (EDT, UTC-4): 23:30 on D is already NEXT in UTC, so the household
// day, never the UTC one, decides which night is "last night".
const at = (date: string, local: string) => new Date(`${date}T${local}:00-04:00`);
const PARENTS = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '23:00', journal: true, battery: false };
const KIDS = { ...PARENTS, eveningTime: '21:00', battery: true };
const SECRET = 'zz-secret-note';

async function setup() {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: at(D, '18:00') });
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: KEY } as Env;
  const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  await req('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#5B8DEF', grownUp: true, tempCheck: PARENTS })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', tempCheck: KIDS })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#F5A623' })).json;
  // A kid's paired device, a shared wall (no owner), or a grown-up's own phone (full access).
  const key = async (owner?: string, scope = 'display') => {
    const k = (await req('/api/keys', 'POST', { name: `k-${owner ?? 'wall'}`, scope })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const rows = () => db.prepare('SELECT member_id, date, followup, drained, private FROM temp_checks ORDER BY date').all<Record<string, unknown>>().results;
  const clock = (date: string, local: string) => mock.timers.setTime(at(date, local).getTime());
  return { env, db, req, alex, maya, leo, key, rows, clock };
}
const tc = (id: string, date?: string) => `/api/members/${id}/temp-check${date ? `?date=${date}` : ''}`;

test('last night: after midnight the evening check stays open for D, answers are stored under D', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, maya, rows, clock, key } = await setup();
  const alexs = await key(alex.id, 'admin'); // grown-ups' journals are private by default: his own phone
  await req(tc(alex.id), 'PUT', { goal: 'Call the plumber' });
  await req(tc(maya.id), 'PUT', { goal: 'Read 20 pages' });
  clock(D, '23:30');
  assert.equal((await req(tc(alex.id))).json.followupOpen, true, '23:00 evening: open before midnight');
  assert.equal((await req(tc(alex.id))).json.lastNight, null);

  clock(NEXT, '00:40');
  const today = (await req(tc(alex.id))).json;
  assert.deepEqual([today.date, today.followupOpen, today.lastNight], [NEXT, false, { date: D, pending: true }]);
  const lastNight = (await req(tc(alex.id, D))).json;
  assert.deepEqual([lastNight.date, lastNight.goal, lastNight.followupOpen], [D, 'Call the plumber', true]);
  const saved = await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'yes', helped: 'Called at lunch' } }, alexs);
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual([saved.json.date, saved.json.followup.outcome, saved.json.followupOpen], [D, 'yes', true]);
  assert.deepEqual(rows().map((r) => [r.member_id, r.date]).sort(), [[alex.id, D], [maya.id, D]].sort(), 'nothing written for the new day');
  assert.deepEqual((await req(tc(alex.id))).json.lastNight, { date: D, pending: false }, 'answered: still editable, nothing to remind');
  assert.equal((await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'partly' } }, alexs)).json.followup.outcome, 'partly', 'editable');

  // 21:00 evening with the battery: the goal check and "How drained?" both carry over.
  assert.deepEqual((await req(tc(maya.id))).json.lastNight, { date: D, pending: true });
  assert.equal((await req(tc(maya.id, D), 'PUT', { drained: 'low' })).status, 200);
  assert.deepEqual((await req(tc(maya.id))).json.lastNight, { date: D, pending: true }, 'the goal check is still waiting');
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'no' } })).status, 200);
  assert.deepEqual((await req(tc(maya.id))).json.lastNight, { date: D, pending: false });
  const journal = (await req(`/api/members/${maya.id}/journal?to=${NEXT}&days=2`)).json;
  assert.equal(journal.days.find((d: any) => d.date === D).tempCheck.followup.outcome, 'no', 'the journal shows it on D');
});

test('last night: refused outside the window (noon, further back, the future, other fields from a display)', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, maya, key, clock } = await setup();
  await req(tc(alex.id), 'PUT', { goal: 'Call the plumber' });
  await req(tc(alex.id, '2026-09-28'), 'PUT', { goal: 'Older goal' });
  clock(NEXT, '00:40');
  assert.equal((await req(tc(alex.id, '2026-09-28'), 'PUT', { followup: { outcome: 'yes' } })).status, 403, 'two nights back');
  assert.equal((await req(tc(alex.id, '2026-10-01'), 'PUT', { followup: { outcome: 'yes' } })).status, 403, 'the future');
  assert.equal((await req(tc(alex.id, '2026-09-28'))).json.followupOpen, false);
  const wall = await key();
  assert.equal((await req(tc(maya.id, D), 'PUT', { sleep: 'good' }, wall)).status, 403, 'a display answers only the evening check for last night');
  clock(NEXT, '12:00');
  assert.equal((await req(tc(alex.id))).json.lastNight, null, 'closed at noon');
  assert.equal((await req(tc(alex.id, D))).json.followupOpen, false);
  assert.equal((await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403);
  assert.equal((await req(tc(alex.id, D), 'PUT', { lastNightSkipped: true })).status, 403, 'nothing to skip');
});

test('last night: the morning Temp check or a skip closes it for good', async (t) => {
  t.after(() => mock.timers.reset());
  const { req, alex, maya, clock } = await setup();
  await req(tc(alex.id), 'PUT', { goal: 'Call the plumber' });
  await req(tc(maya.id), 'PUT', { goal: 'Read 20 pages' });
  clock(NEXT, '07:30');
  // Answering last night doesn't count as this morning's check-in.
  await req(tc(maya.id, D), 'PUT', { drained: 'ok' });
  assert.deepEqual((await req(tc(maya.id))).json.answered, { sleep: false, feelings: false, goal: false, followup: false, drained: false });
  // The morning check-in starts their day: last night closes.
  assert.equal((await req(tc(maya.id), 'PUT', { sleep: 'good' })).status, 200);
  assert.equal((await req(tc(maya.id))).json.lastNight, null);
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403);
  // Skip: closed, and stays closed.
  const skipped = await req(tc(alex.id, D), 'PUT', { lastNightSkipped: true });
  assert.equal(skipped.status, 200, JSON.stringify(skipped.json));
  assert.equal(skipped.json.followupOpen, false);
  assert.equal((await req(tc(alex.id))).json.lastNight, null);
  assert.equal((await req(tc(alex.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403);
});

test('last night: owner and privacy rules are unchanged', async (t) => {
  t.after(() => mock.timers.reset());
  const { db, req, maya, leo, key, rows, clock } = await setup();
  await db.prepare('UPDATE members SET journal_private_allowed = 1, journal_private = 1 WHERE id = ?').bind(maya.id).run();
  await req(tc(maya.id), 'PUT', { goal: 'Read 20 pages' });
  const mayas = await key(maya.id), leos = await key(leo.id), wall = await key();
  clock(NEXT, '00:40');
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'yes' } }, leos)).status, 403, "someone else's device");
  assert.equal((await req(tc(maya.id, D), 'PUT', { drained: 'low' }, wall)).status, 403, 'drained never from a wall');
  assert.equal((await req(tc(maya.id), 'GET', undefined, wall)).json.lastNight?.pending, true, 'the wall may still ask the goal check');
  const own = await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'partly', hindered: SECRET } }, mayas);
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.equal(own.json.followup.hindered, SECRET);
  assert.equal(rows().find((r) => r.member_id === maya.id)!.private, 1, 'written in her private journal: the day is private');
  assert.doesNotMatch(JSON.stringify(rows()), /zz-secret/, 'sealed');
  const parent = (await req(tc(maya.id, D))).json;
  assert.deepEqual([parent.followupHidden, parent.followup.hindered], [true, null]);
  assert.equal((await req(tc(maya.id, D), 'PUT', { followup: { outcome: 'yes' } })).status, 403, 'only her own devices change it');
});
