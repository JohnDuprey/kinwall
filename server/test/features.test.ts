// Household feature switches (settings.features): defaults, round trip, and what the server
// itself stops doing while one is off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { runNotifications } from '../src/notify.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const ALL_ON = { chores: true, lists: true, contacts: true, paint: true, photos: true, notes: true, messages: true, trackersReading: true, trackersMemories: true, trackersHealth: true, meals: true, newscast: true, checkIns: true };

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const request = (p: string, method = 'GET', body?: unknown, key = ADMIN_KEY) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  return { env, request };
}

test('features: all on by default; a PATCH round-trips; a display key cannot change them', async () => {
  const { request } = setup();
  assert.deepEqual(((await (await request('/api/settings')).json()) as any).features, ALL_ON);

  const off = { ...ALL_ON, chores: false, contacts: false, notes: false };
  const res = await request('/api/settings', 'PATCH', { features: off });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as any).features, off);
  assert.deepEqual(((await (await request('/api/settings')).json()) as any).features, off);
  assert.equal((await request('/api/settings', 'PATCH', { features: { chores: false } })).status, 400, 'the whole object, like tidbits');

  const { contacts: _contacts, ...oldClientFeatures } = ALL_ON;
  const oldClient = await request('/api/settings', 'PATCH', { features: oldClientFeatures });
  assert.equal(oldClient.status, 200);
  assert.equal(((await oldClient.json()) as any).features.contacts, true);

  const display = (await (await request('/api/keys', 'POST', { name: 'Wall', scope: 'display' })).json()) as any;
  assert.equal((await request('/api/settings', 'PATCH', { features: ALL_ON }, display.key)).status, 403);
  assert.equal((await request('/api/settings', 'PATCH', { weekStart: 1 }, display.key)).status, 403, 'family settings are for parent devices');
});

test('features: messages off refuses POST /api/notify; chores off drops the nudge and the summary\'s chore count', async () => {
  const { env, request } = setup();
  await request('/api/settings', 'PATCH', { timezone: 'UTC', features: { ...ALL_ON, messages: false, chores: false } });
  const send = await request('/api/notify', 'POST', { title: 'Dinner', body: 'Now' });
  assert.equal(send.status, 403);
  assert.match(((await send.json()) as any).error, /turned off/);

  const bo = (await (await request('/api/members', 'POST', { name: 'Bo', color: '#5ae' })).json()) as any;
  await request('/api/chores', 'POST', { title: 'Feed cat', memberId: bo.id, dueDate: '2030-03-04' });
  await runNotifications(env, new Date('2030-03-04T07:30:00Z'));
  await runNotifications(env, new Date('2030-03-04T08:00:00Z'));
  const rows = (await (await request('/api/notifications')).json()) as any[];
  assert.deepEqual(rows.map((n) => n.kind), ['summary']);
  assert.equal(rows[0].body, '0 events');

  // The chores API itself keeps answering, so nothing is lost and integrations keep working.
  assert.equal((await request('/api/chores')).status, 200);
});

test('features: meals off drops meals from the Board, a member\'s day and the daily summary', async () => {
  const { env, request } = setup();
  await request('/api/settings', 'PATCH', { timezone: 'UTC', features: { ...ALL_ON, meals: false } });
  const bo = (await (await request('/api/members', 'POST', { name: 'Bo', color: '#5ae' })).json()) as any;
  const today = new Date().toISOString().slice(0, 10);
  await request('/api/meals', 'POST', { date: today, slot: 'dinner', title: 'Soup' });
  await request('/api/meals', 'POST', { date: '2030-03-04', slot: 'dinner', title: 'Tacos' });
  assert.deepEqual(((await (await request('/api/board')).json()) as any).meals, []);
  assert.deepEqual(((await (await request(`/api/snapshot?member=${bo.id}`)).json()) as any).meals, []);

  await runNotifications(env, new Date('2030-03-04T07:30:00Z'));
  await runNotifications(env, new Date('2030-03-04T08:00:00Z'));
  const rows = (await (await request('/api/notifications')).json()) as any[];
  assert.doesNotMatch(rows.find((n) => n.kind === 'summary').body, /Meals/);

  // The meals API keeps answering.
  assert.equal(((await (await request(`/api/meals?from=${today}&to=${today}`)).json()) as any[]).length, 1);
});

test('features: check-in points only while chores and check-ins are both on', async () => {
  const { request } = setup();
  await request('/api/settings', 'PATCH', { timezone: 'UTC', checkInPoints: 5 });
  const bo = (await (await request('/api/members', 'POST', { name: 'Bo', color: '#5ae' })).json()) as any;
  for (const off of ['chores', 'checkIns'] as const) {
    await request('/api/settings', 'PATCH', { features: { ...ALL_ON, [off]: false } });
    assert.equal((await request(`/api/members/${bo.id}/check-in`, 'POST')).status, 400, off);
  }
  await request('/api/settings', 'PATCH', { features: ALL_ON });
  assert.equal(((await (await request(`/api/members/${bo.id}/check-in`, 'POST')).json()) as any).awarded, 5);
});

test('rewardsEnabled: on by default; off refuses a reward request, and so does chores off', async () => {
  const { request } = setup();
  assert.equal(((await (await request('/api/settings')).json()) as any).rewardsEnabled, true);
  const bo = (await (await request('/api/members', 'POST', { name: 'Bo', color: '#5ae' })).json()) as any;
  const reward = (await (await request('/api/rewards', 'POST', { title: 'Movie night', cost: 1 })).json()) as any;
  const redeem = () => request(`/api/rewards/${reward.id}/redeem`, 'POST', { memberId: bo.id });
  const off = await request('/api/settings', 'PATCH', { rewardsEnabled: false });
  assert.equal(((await off.json()) as any).rewardsEnabled, false);
  const res = await redeem();
  assert.equal(res.status, 403);
  assert.match(((await res.json()) as any).error, /Rewards are turned off/);
  await request('/api/settings', 'PATCH', { rewardsEnabled: true, features: { ...ALL_ON, chores: false } });
  assert.equal((await redeem()).status, 403);
  await request('/api/settings', 'PATCH', { features: ALL_ON });
  assert.equal((await redeem()).status, 402, 'on again: on to the points check');
  assert.equal(((await (await request('/api/rewards')).json()) as any[]).length, 1, 'rewards are kept');
});
