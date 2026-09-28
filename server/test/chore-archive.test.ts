import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const KEY = 'k';

const count = async (db: ReturnType<typeof openDb>, sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).first<{ n: number }>())!.n;

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const req = async (p: string, method = 'GET', body?: unknown) => {
    const res = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  return { db, req };
}

test('chores: deleting a chore with completions keeps its history (archived), and it leaves every list', async () => {
  const { db, req } = setup();
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' })).json;
  const chore = (await req('/api/chores', 'POST', { title: 'Feed Pepper', memberId: maya.id, points: 5, rrule: 'FREQ=DAILY', dueDate: '2026-05-01' })).json;
  assert.equal((await req(`/api/chores/${chore.id}/complete`, 'POST', { date: '2026-05-01' })).status, 200);
  const before = (await req(`/api/members/${maya.id}/points`)).json.balance;

  assert.equal((await req(`/api/chores/${chore.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await req('/api/chores')).json, []);
  assert.deepEqual((await req('/api/chores/day?date=2026-05-02')).json, []);
  // The completion stays, and so do the points earned from it.
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM chore_completions WHERE chore_id = ?', chore.id), 1);
  assert.equal((await req(`/api/members/${maya.id}/points`)).json.balance, before);
  // Gone for every other purpose: no edit, no tick, no second delete.
  assert.equal((await req(`/api/chores/${chore.id}`, 'PATCH', { title: 'x' })).status, 404);
  assert.equal((await req(`/api/chores/${chore.id}/complete`, 'POST', { date: '2026-05-03' })).status, 404);
  assert.equal((await req(`/api/chores/${chore.id}`, 'DELETE')).status, 404);

  // An export round trip keeps the history and keeps the chore hidden.
  const file = (await req('/api/export')).json;
  const other = setup();
  assert.equal((await other.req('/api/import', 'POST', file)).status, 200);
  assert.deepEqual((await other.req('/api/chores')).json, []);
  assert.equal(await count(other.db, 'SELECT COUNT(*) AS n FROM chore_completions'), 1);
});

test('chores: deleting a chore that was never done removes it, and a pending tick goes with an archived one', async () => {
  const { db, req } = setup();
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#F5A65B' })).json;
  const fresh = (await req('/api/chores', 'POST', { title: 'Feed the fish', memberId: leo.id, dueDate: '2026-05-01' })).json;
  assert.equal((await req(`/api/chores/${fresh.id}`, 'DELETE')).status, 200);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM chores WHERE id = ?', fresh.id), 0);

  const done = (await req('/api/chores', 'POST', { title: 'Brush teeth', memberId: leo.id, rrule: 'FREQ=DAILY', dueDate: '2026-05-01' })).json;
  await req(`/api/chores/${done.id}/complete`, 'POST', { date: '2026-05-01' });
  await db.prepare("INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, points_awarded, status) VALUES ('p', ?, '2026-05-02', ?, '2026-05-02T10:00:00Z', 0, 'pending')").bind(done.id, leo.id).run();
  await req(`/api/chores/${done.id}`, 'DELETE');
  assert.deepEqual((await req('/api/chores/pending')).json, []);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM chore_completions WHERE chore_id = ?', done.id), 1);
});
