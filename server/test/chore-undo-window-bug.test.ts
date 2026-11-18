// A wall screen or kid's device ticks a chore only for the last DISPLAY_DAYS_BACK days (older days
// are for a parent's device). Undoing a tick follows the same window: otherwise a wall screen could
// wipe a completion from months ago, and its points with it, that it could never put back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_test_admin';
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const req = async (method: string, p: string, body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  assert.equal((await req('PATCH', '/api/settings', { timezone: 'UTC' })).status, 200);
  const leo = (await req('POST', '/api/members', { name: 'Leo', color: '#e57' })).json;
  const device = async (name: string, owner: string) => {
    const k = (await req('POST', '/api/keys', { name, scope: 'display' })).json;
    assert.equal((await req('PATCH', `/api/keys/${k.id}`, { owner })).status, 200);
    return k.key as string;
  };
  const done = async (choreId: string, date: string) => !!(await db.prepare('SELECT 1 FROM chore_completions WHERE chore_id = ? AND date = ?').bind(choreId, date).first());
  return { req, leo, done, leoKey: await device("Leo's tablet", leo.id), wallKey: await device('Kitchen wall', 'shared') };
}

test("chores: a wall screen or kid's device can't undo a tick older than it could make", async () => {
  const t = await setup();
  const chore = (await t.req('POST', '/api/chores', { title: 'Feed the cat', points: 10, memberId: t.leo.id, dueDate: daysAgo(60), rrule: 'FREQ=DAILY', needsApproval: false })).json;
  const old = daysAgo(30);
  assert.equal((await t.req('POST', `/api/chores/${chore.id}/complete`, { date: old })).status, 200, 'a parent ticks an old day');
  // The same devices can't tick that day...
  assert.equal((await t.req('POST', `/api/chores/${chore.id}/complete`, { date: old }, t.wallKey)).status, 400);
  // ...so they can't wipe it either.
  for (const key of [t.wallKey, t.leoKey]) {
    const res = await t.req('DELETE', `/api/chores/${chore.id}/complete?date=${old}`, undefined, key);
    assert.equal(res.status, 400, JSON.stringify(res.json));
    assert.ok(await t.done(chore.id, old), 'the old completion is still there');
  }
  // Inside the window an undo still works, and a parent's device can undo any day.
  const recent = daysAgo(2);
  assert.equal((await t.req('POST', `/api/chores/${chore.id}/complete`, { date: recent }, t.leoKey)).status, 200);
  assert.equal((await t.req('DELETE', `/api/chores/${chore.id}/complete?date=${recent}`, undefined, t.leoKey)).status, 200);
  assert.equal(await t.done(chore.id, recent), false);
  assert.equal((await t.req('DELETE', `/api/chores/${chore.id}/complete?date=${old}`)).status, 200);
  assert.equal(await t.done(chore.id, old), false);
});
