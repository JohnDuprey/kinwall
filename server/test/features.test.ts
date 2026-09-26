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
const ALL_ON = { chores: true, lists: true, paint: true, photos: true, notes: true, messages: true };

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

  const off = { ...ALL_ON, chores: false, notes: false };
  const res = await request('/api/settings', 'PATCH', { features: off });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as any).features, off);
  assert.deepEqual(((await (await request('/api/settings')).json()) as any).features, off);
  assert.equal((await request('/api/settings', 'PATCH', { features: { chores: false } })).status, 400, 'the whole object, like tidbits');

  const display = (await (await request('/api/keys', 'POST', { name: 'Wall', scope: 'display' })).json()) as any;
  assert.equal((await request('/api/settings', 'PATCH', { features: ALL_ON }, display.key)).status, 403);
  assert.equal((await request('/api/settings', 'PATCH', { weekStart: 1 }, display.key)).status, 200, 'everyday settings still work');
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
