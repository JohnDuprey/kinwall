import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const req = async (method: string, url: string, body?: unknown, key = 'k') => {
    const r = await app.request(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await r.text();
    return { status: r.status, json: (r.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text) as any };
  };
  await req('PATCH', '/api/settings', { timezone: 'UTC' });
  const today = (await req('GET', '/api/board')).json.today;
  const day = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  return { db, req, today, day };
}

test('dismiss a missed date across devices without completing, awarding points or changing the schedule; undo is repeatable', async () => {
  const t = await setup();
  const c = (await t.req('POST', '/api/chores', { title: 'Feed the fish', points: 10, dueDate: t.day(-5), rrule: 'FREQ=DAILY' })).json;
  const late = async () => (await t.req('GET', '/api/board')).json.overdueChores;
  assert.equal((await late()).length, 1);
  for (let i = 0; i < 2; i++) assert.equal((await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date: t.day(-1), dismissed: true })).status, 200);
  assert.deepEqual(await late(), [], 'no fallback to an older missed repeat');
  assert.equal(await t.db.prepare('SELECT COUNT(*) AS n FROM chore_completions').first<number>('n'), 0);
  const today = (await t.req('GET', `/api/chores/day?date=${t.today}`)).json;
  assert.ok(JSON.stringify(today).includes(c.id), 'today remains scheduled');
  assert.equal((await t.req('GET', '/api/chores')).json.find((x: any) => x.id === c.id).active, true);
  for (let i = 0; i < 2; i++) assert.equal((await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date: t.day(-1), dismissed: false })).status, 200);
  assert.equal((await late())[0].date, t.day(-1));
});

test('dismissals are parent-only, date-validated and never applied to completed or future chores', async () => {
  const t = await setup();
  const c = (await t.req('POST', '/api/chores', { title: 'Clean garage', dueDate: t.day(-2) })).json;
  const wall = (await t.req('POST', '/api/keys', { name: 'Kitchen wall', scope: 'display' })).json.key;
  const kid = (await t.req('POST', '/api/members', { name: 'Leo', color: '#e57' })).json;
  const childKey = (await t.req('POST', '/api/keys', { name: "Leo's tablet", scope: 'display' })).json;
  await t.req('PATCH', `/api/keys/${childKey.id}`, { owner: kid.id });
  assert.equal((await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date: t.day(-2), dismissed: true }, childKey.key)).status, 403);
  assert.equal((await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date: t.day(-2), dismissed: false }, childKey.key)).status, 403);

  assert.equal((await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date: t.day(-2), dismissed: true }, wall)).status, 403);
  for (const date of [t.today, t.day(1), t.day(-1), '2026-02-30']) assert.equal((await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date, dismissed: true })).status, 400);
  assert.equal((await t.req('PUT', '/api/chores/missing/dismissal', { date: t.day(-2), dismissed: true })).status, 404);
  await t.req('POST', `/api/chores/${c.id}/complete`, { date: t.day(-2) });
  assert.equal((await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date: t.day(-2), dismissed: true })).status, 409);
});

test('dismissed dates survive backup round trips and old backups remain accepted', async () => {
  const t = await setup();
  const c = (await t.req('POST', '/api/chores', { title: 'Sweep porch', dueDate: t.day(-2) })).json;
  await t.req('PUT', `/api/chores/${c.id}/dismissal`, { date: t.day(-2), dismissed: true });
  const backup = (await t.req('GET', '/api/export')).json;
  assert.equal(backup.choreDismissals.length, 1);
  const restored = await setup();
  assert.equal((await restored.req('POST', '/api/import', backup)).status, 200);
  assert.deepEqual((await restored.req('GET', '/api/board')).json.overdueChores, []);
  delete backup.choreDismissals;
  assert.equal((await restored.req('POST', '/api/import', backup)).status, 200);
});
