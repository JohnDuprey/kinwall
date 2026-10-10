// Kids suggest chores: who may suggest for whom, parents decide (as asked, changed, or not this
// time, with a note), "I already did it" earns once on approval, and the kid hears back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const background: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => background.push(p), passThroughOnException() {}, props: {} };
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx as never);
    return { status: res.status, json: (await res.json()) as any };
  };
  const flush = async () => {
    while (background.length) await Promise.all(background.splice(0));
  };
  const key = async (name: string, scope: 'display' | 'admin', owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#5e7', grownUp: true })).json;
  const mayaKey = await key('maya-tablet', 'display', maya.id);
  const wallKey = await key('kitchen-wall', 'display', 'shared');
  const alexKey = await key('alex-phone', 'admin', alex.id);
  const today = new Date().toISOString().slice(0, 10);
  const suggest = (body: Record<string, unknown>, k = mayaKey) => req('/api/chore-suggestions', 'POST', { title: 'Flute practice', emoji: '🎵', points: 5, ...body }, k);
  const balance = async (id: string) => (await req('/api/members')).json.find((m: any) => m.id === id).balance;
  return { db, req, flush, maya, leo, alex, mayaKey, wallKey, alexKey, today, suggest, balance };
}

test('suggest: a kid\'s own device only for them, a wall names who, and nothing counts yet', async () => {
  const t = await setup();
  const mine = await t.suggest({});
  assert.equal(mine.status, 201);
  assert.equal(mine.json.memberId, t.maya.id); // own device: no memberId needed
  assert.equal(mine.json.status, 'pending');
  assert.equal(mine.json.dueDate, t.today);
  assert.equal((await t.suggest({ memberId: t.leo.id })).status, 403); // not for a sibling
  assert.equal((await t.suggest({}, t.wallKey)).status, 400); // a wall has to say who
  const wall = await t.suggest({ memberId: t.leo.id, title: 'Water plants' }, t.wallKey);
  assert.equal(wall.status, 201);
  assert.equal(wall.json.memberId, t.leo.id);
  // Not a chore yet: no chore, no points.
  assert.equal((await t.req('/api/chores')).json.length, 0);
  // Maya's device sees only hers; a parent sees both.
  assert.deepEqual((await t.req('/api/chore-suggestions', 'GET', undefined, t.mayaKey)).json.map((s: any) => s.title), ['Flute practice']);
  assert.equal((await t.req(`/api/chore-suggestions?memberId=${t.leo.id}`, 'GET', undefined, t.mayaKey)).status, 403);
  assert.equal((await t.req('/api/chore-suggestions')).json.length, 2);
  await t.flush();
  const bell = (await t.req('/api/notifications')).json.find((n: any) => n.title === 'Maya suggests a chore: Flute practice');
  assert.ok(bell, 'parents are told');
});

test('suggest: bad input, the waiting cap and the family setting', async () => {
  const t = await setup();
  assert.equal((await t.suggest({ points: 500 })).status, 400);
  assert.equal((await t.suggest({ rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30' })).status, 400); // never happens
  for (let i = 0; i < 10; i++) assert.equal((await t.suggest({ title: `Idea ${i}` })).status, 201);
  assert.equal((await t.suggest({ title: 'One more' })).status, 409);
  assert.equal((await t.req('/api/settings', 'PATCH', { kidChoreSuggestions: false })).json.kidChoreSuggestions, false);
  assert.equal((await t.suggest({ memberId: t.leo.id }, t.wallKey)).status, 403);
});

test('permissions: kids can\'t decide, and can\'t make or reprice real chores', async () => {
  const t = await setup();
  const s = (await t.suggest({})).json;
  for (const k of [t.mayaKey, t.wallKey]) {
    assert.equal((await t.req(`/api/chore-suggestions/${s.id}/approve`, 'POST', { points: 50 }, k)).status, 403);
    assert.equal((await t.req(`/api/chore-suggestions/${s.id}/decline`, 'POST', {}, k)).status, 403);
    assert.equal((await t.req('/api/chores', 'POST', { title: 'Free points', points: 999, memberId: t.maya.id }, k)).status, 403);
  }
  const chore = (await t.req('/api/chores', 'POST', { title: 'Dishes', points: 2, memberId: t.maya.id })).json;
  assert.equal((await t.req(`/api/chores/${chore.id}`, 'PATCH', { points: 99 }, t.mayaKey)).status, 403);
});

test('approve as asked: a repeating chore with its start time and timer, the parent named', async () => {
  const t = await setup();
  const s = (await t.suggest({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', dueTime: '16:00', timerMinutes: 20 })).json;
  const r = await t.req(`/api/chore-suggestions/${s.id}/approve`, 'POST', { note: 'Proud of you for practicing' }, t.alexKey);
  assert.equal(r.status, 200);
  assert.equal(r.json.status, 'approved');
  assert.equal(r.json.pointsGiven, 5);
  assert.equal(r.json.decidedByName, 'Alex');
  const chore = (await t.req('/api/chores')).json.find((c: any) => c.id === r.json.choreId);
  assert.deepEqual([chore.title, chore.emoji, chore.memberId, chore.points, chore.rrule, chore.dueTime, chore.timerMinutes], ['Flute practice', '🎵', t.maya.id, 5, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '16:00', 20]);
  assert.equal(await t.balance(t.maya.id), 0); // not done yet: nothing earned
  // Twice is once.
  assert.equal((await t.req(`/api/chore-suggestions/${s.id}/approve`, 'POST', {})).status, 404);
  await t.flush();
  const kidBell = (await t.req('/api/notifications', 'GET', undefined, t.mayaKey)).json.find((n: any) => n.title === 'Alex said yes: Flute practice');
  assert.ok(kidBell);
  assert.match(kidBell.body, /Proud of you for practicing/);
  // The answer stays on Maya's list until she puts it away.
  const open = (await t.req('/api/chore-suggestions', 'GET', undefined, t.mayaKey)).json;
  assert.deepEqual(open.map((x: any) => [x.status, x.note]), [['approved', 'Proud of you for practicing']]);
  assert.equal((await t.req(`/api/chore-suggestions/${s.id}/seen`, 'POST', undefined, t.mayaKey)).status, 200);
  assert.equal((await t.req('/api/chore-suggestions', 'GET', undefined, t.mayaKey)).json.length, 0);
});

test('approve with changes: other points and schedule', async () => {
  const t = await setup();
  const s = (await t.suggest({ rrule: 'FREQ=DAILY', timerMinutes: 20 })).json;
  const r = await t.req(`/api/chore-suggestions/${s.id}/approve`, 'POST', { points: 4, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', timerMinutes: 15, note: 'Great idea!' });
  assert.equal(r.status, 200);
  assert.equal(r.json.points, 5); // what she asked stays on record
  assert.equal(r.json.pointsGiven, 4);
  assert.equal(r.json.decidedByName, null); // the server's own key is nobody's
  const chore = (await t.req('/api/chores')).json[0];
  assert.deepEqual([chore.points, chore.rrule, chore.timerMinutes], [4, 'FREQ=WEEKLY;BYDAY=MO,WE,FR', 15]);
  await t.flush();
  assert.ok((await t.req('/api/notifications', 'GET', undefined, t.mayaKey)).json.some((n: any) => n.title === 'A grown-up said yes: Flute practice'));
});

test('"I already did it": done today on approval, points once', async () => {
  const t = await setup();
  const s = (await t.suggest({ title: 'Folded laundry', done: true, dueDate: '2001-01-01' })).json;
  assert.equal(s.dueDate, t.today); // done means today
  assert.equal(await t.balance(t.maya.id), 0);
  const r = await t.req(`/api/chore-suggestions/${s.id}/approve`, 'POST', { points: 8 });
  const day = (await t.req(`/api/chores/day?date=${t.today}`)).json.find((c: any) => c.id === r.json.choreId);
  assert.equal(day.completed, true);
  assert.equal(await t.balance(t.maya.id), 8);
  assert.equal((await t.req(`/api/chore-suggestions/${s.id}/approve`, 'POST', { points: 8 })).status, 404);
  assert.equal(await t.balance(t.maya.id), 8);
});

test('not this time: a note for the kid, no chore, and a shared wall never shows it', async () => {
  const t = await setup();
  const s = (await t.suggest({})).json;
  const r = await t.req(`/api/chore-suggestions/${s.id}/decline`, 'POST', { note: "Let's talk about it at dinner" }, t.alexKey);
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.status, r.json.note, r.json.decidedByName, r.json.choreId], ['declined', "Let's talk about it at dinner", 'Alex', null]);
  assert.equal((await t.req('/api/chores')).json.length, 0);
  assert.equal((await t.req('/api/chore-suggestions', 'GET', undefined, t.mayaKey)).json[0].status, 'declined');
  assert.equal((await t.req('/api/chore-suggestions', 'GET', undefined, t.wallKey)).json.length, 0);
  assert.equal((await t.req(`/api/chore-suggestions/${s.id}/approve`, 'POST', {})).status, 404);
  await t.flush();
  assert.ok((await t.req('/api/notifications', 'GET', undefined, t.mayaKey)).json.some((n: any) => n.title === 'Not this time: Flute practice' && n.body === "Let's talk about it at dinner"));
});
