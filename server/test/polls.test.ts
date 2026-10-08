// Family polls (routes/polls.ts): parents start and close, everyone votes once and can change it,
// a member's own device votes only for them, a shared wall for anyone; the feature switch takes it
// all away; export/import carries polls with their votes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const ALL_ON = { chores: true, lists: true, contacts: true, paint: true, photos: true, notes: true, messages: true, trackersReading: true, trackersMemories: true, trackersHealth: true, meals: true, newscast: true, polls: true, checkIns: true };

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  const device = async (name: string, kind: 'kid' | 'wall', owner?: string) => {
    const k = (await send('POST', '/api/keys', { name, scope: 'display' })).body;
    assert.equal((await send('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  const alex = (await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true })).body;
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#339966' })).body;
  const leo = (await send('POST', '/api/members', { name: 'Leo', color: '#996633' })).body;
  const tacos = (await send('POST', '/api/recipes', { name: 'Tacos', defaultServings: 4, ingredients: [] })).body;
  const slice = (await send('POST', '/api/restaurants', { name: 'Corner Slice', menu: [] })).body;
  return { env, send, alex, maya, leo, tacos, slice, leoKey: await device("Leo's tablet", 'kid', leo.id), wallKey: await device('Kitchen wall', 'wall') };
}

test('polls: a parent starts one with ideas and recipes; the bell says so; walls and kids can\'t start one', async () => {
  const t = await setup();
  const created = await t.send('POST', '/api/polls', { question: 'Where are we eating Friday?', date: '2026-10-09', slot: 'dinner', options: [{ label: 'Pizza night' }, { recipeId: t.tacos.id }, { restaurantId: t.slice.id }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const poll = created.body;
  assert.equal(poll.status, 'open');
  assert.deepEqual(poll.options.map((o: any) => [o.label, o.recipeId, o.restaurantId, o.votes]), [['Pizza night', null, null, []], ['Tacos', t.tacos.id, null, []], ['Corner Slice', null, t.slice.id, []]]);
  assert.equal((await t.send('GET', `/api/polls/${poll.id}`, undefined, t.leoKey)).body.question, 'Where are we eating Friday?');
  assert.equal((await t.send('GET', '/api/polls?status=open', undefined, t.wallKey)).body.length, 1);
  // Everyone hears about it, kids too.
  await new Promise((r) => setTimeout(r, 20));
  const feed = (await t.send('GET', '/api/notifications', undefined, t.leoKey)).body;
  assert.equal(feed[0].kind, 'poll');
  assert.equal(feed[0].title, '🗳 New poll: Where are we eating Friday?');
  assert.equal(feed[0].url, `/#/calendar?poll=${poll.id}`);
  for (const key of [t.leoKey, t.wallKey]) assert.equal((await t.send('POST', '/api/polls', { question: 'x', options: [{ label: 'a' }, { label: 'b' }] }, key)).status, 403);
  assert.equal((await t.send('POST', `/api/polls/${poll.id}/close`, {}, t.wallKey)).status, 403);
  assert.equal((await t.send('DELETE', `/api/polls/${poll.id}`, undefined, t.leoKey)).status, 403);
  assert.equal((await t.send('POST', '/api/polls', { question: 'x', options: [{ label: 'only one' }] })).status, 400);
  assert.equal((await t.send('POST', '/api/polls', { question: 'x', options: [{ label: 'a' }, { recipeId: 'nope' }] })).status, 400);
  assert.equal((await t.send('POST', '/api/polls', { question: 'x', options: [{ label: 'a' }, { restaurantId: 'nope' }] })).status, 400);
  assert.equal((await t.send('POST', '/api/polls', { question: 'x', options: [{ label: 'a' }, { recipeId: t.tacos.id, restaurantId: t.slice.id }] })).status, 400);
});

test('polls: one vote each, changeable while open; a kid\'s device votes only for them, a wall for anyone; closed polls refuse votes', async () => {
  const t = await setup();
  const poll = (await t.send('POST', '/api/polls', { question: 'Which movie tonight?', options: [{ label: 'Paddington' }, { label: 'Moana' }, { label: 'Cars' }] })).body;
  const [paddington, moana, cars] = poll.options.map((o: any) => o.id);
  const vote = (memberId: string, optionId: string | null, key?: string) => t.send('PUT', `/api/polls/${poll.id}/vote`, { memberId, optionId }, key);
  assert.equal((await vote(t.leo.id, moana, t.leoKey)).status, 200);
  const blocked = await vote(t.maya.id, moana, t.leoKey);
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /only do that for Leo/);
  assert.equal((await vote(t.maya.id, paddington, t.wallKey)).status, 200, 'a shared wall votes for whoever picked themselves');
  assert.equal((await vote(t.alex.id, paddington)).status, 200);
  let now = (await vote(t.leo.id, paddington, t.leoKey)).body; // Leo changes his mind
  assert.deepEqual(now.options.map((o: any) => o.votes.length), [3, 0, 0]);
  now = (await vote(t.leo.id, null, t.leoKey)).body; // and takes it back
  assert.deepEqual(now.options.map((o: any) => o.votes), [[t.alex.id, t.maya.id], [], []]);
  assert.equal((await vote(t.leo.id, 'nope')).status, 400);
  assert.equal((await vote('nobody', cars)).status, 404);

  const closed = (await t.send('POST', `/api/polls/${poll.id}/close`, {})).body;
  assert.equal(closed.status, 'closed');
  assert.equal(closed.winnerOptionId, paddington, 'the most votes wins');
  assert.equal((await vote(t.leo.id, cars, t.leoKey)).status, 409);
  // A parent can pick another winner afterwards, and link the meal they planned.
  assert.equal((await t.send('POST', `/api/polls/${poll.id}/close`, { optionId: cars })).body.winnerOptionId, cars);
  const meal = (await t.send('POST', '/api/meals', { date: '2026-10-09', slot: 'dinner', title: 'Cars night', mealKind: 'freeform' })).body;
  assert.equal((await t.send('PATCH', `/api/polls/${poll.id}`, { mealId: meal.id })).body.mealId, meal.id);
  assert.equal((await t.send('PATCH', `/api/polls/${poll.id}`, { mealId: 'nope' })).status, 400);
  assert.equal((await t.send('DELETE', `/api/meals/${meal.id}`)).status, 200);
  assert.equal((await t.send('GET', `/api/polls/${poll.id}`)).body.mealId, null, 'a deleted meal unlinks');
  // A tie goes to the choice listed first.
  const tie = (await t.send('POST', '/api/polls', { question: 'Park or pool?', options: [{ label: 'Park' }, { label: 'Pool' }] })).body;
  await t.send('PUT', `/api/polls/${tie.id}/vote`, { memberId: t.maya.id, optionId: tie.options[1].id });
  await t.send('PUT', `/api/polls/${tie.id}/vote`, { memberId: t.leo.id, optionId: tie.options[0].id });
  assert.equal((await t.send('POST', `/api/polls/${tie.id}/close`, {})).body.winnerOptionId, tie.options[0].id);
  assert.deepEqual((await t.send('GET', '/api/polls')).body.map((p: any) => p.question), ['Park or pool?', 'Which movie tonight?']);
  assert.equal((await t.send('DELETE', `/api/polls/${tie.id}`)).status, 200);
  assert.equal((await t.send('GET', `/api/polls/${tie.id}`)).status, 404);
});

test('polls: off in Settings → General → Features means gone: routes answer 404, no notes in the bell; recipe choices need Meals', async () => {
  const t = await setup();
  const poll = (await t.send('POST', '/api/polls', { question: 'Weekend plans?', options: [{ label: 'Hike' }, { label: 'Zoo' }] })).body;
  await new Promise((r) => setTimeout(r, 20));
  await t.send('PATCH', '/api/settings', { features: { ...ALL_ON, polls: false } });
  for (const [method, p, body] of [['GET', '/api/polls'], ['GET', `/api/polls/${poll.id}`], ['POST', '/api/polls', { question: 'x', options: [{ label: 'a' }, { label: 'b' }] }], ['PUT', `/api/polls/${poll.id}/vote`, { memberId: t.leo.id, optionId: poll.options[0].id }], ['POST', `/api/polls/${poll.id}/close`, {}], ['PATCH', `/api/polls/${poll.id}`, { question: 'y' }], ['DELETE', `/api/polls/${poll.id}`]] as const) {
    assert.equal((await t.send(method, p, body)).status, 404, `${method} ${p}`);
  }
  assert.equal((await t.send('GET', '/api/notifications')).body.some((n: any) => n.kind === 'poll'), false);
  await t.send('PATCH', '/api/settings', { features: { ...ALL_ON, meals: false } });
  assert.equal((await t.send('GET', '/api/polls')).body.length, 1, 'kept while off');
  const res = await t.send('POST', '/api/polls', { question: 'Dinner?', options: [{ label: 'Pizza' }, { recipeId: t.tacos.id }] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Meals/);
  assert.equal((await t.send('POST', '/api/polls', { question: 'Dinner?', options: [{ label: 'Pizza' }, { restaurantId: t.slice.id }] })).status, 400);
});

test('polls: export and import carry polls, choices and votes', async () => {
  const t = await setup();
  const poll = (await t.send('POST', '/api/polls', { question: 'Which game?', options: [{ label: 'Uno' }, { label: 'Chess' }, { restaurantId: t.slice.id }] })).body;
  await t.send('PUT', `/api/polls/${poll.id}/vote`, { memberId: t.maya.id, optionId: poll.options[1].id });
  const file = (await t.send('GET', '/api/export')).body;
  assert.equal(file.polls[0].options[1].votes[0], t.maya.id);
  await t.send('DELETE', `/api/polls/${poll.id}`);
  const imported = await t.send('POST', '/api/import', file);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.imported.polls, 1);
  const back = (await t.send('GET', `/api/polls/${poll.id}`)).body;
  assert.deepEqual(back.options.map((o: any) => [o.label, o.restaurantId, o.votes]), [['Uno', null, []], ['Chess', null, [t.maya.id]], ['Corner Slice', t.slice.id, []]]);
});
