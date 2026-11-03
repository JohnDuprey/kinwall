import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';

async function setup() {
  const counter = { count: 0 };
  const db = openDb(':memory:', counter); applyMigrations(db, join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const app = createApp();
  const req = (path: string, method = 'GET', body?: unknown, key = 'k') => app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
  const json = async (path: string, method = 'GET', body?: unknown, key = 'k') => { const r = await req(path, method, body, key); assert.ok(r.ok, `${r.status}: ${await r.clone().text()}`); return await r.json() as any; };
  await json('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#F28DB2' });
  const leo = await json('/api/members', 'POST', { name: 'Leo', color: '#7BCB94' });
  return { counter, db, json, req, maya, leo, app, env };
}

test('chore date counts: recurrence, anyone, approvals and mutations match the dates shown', async () => {
  const { json, db, maya, leo, counter } = await setup();
  const weekly = await json('/api/chores', 'POST', { title: 'Dishes', memberId: maya.id, dueDate: '2026-10-19', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=MO' });
  const monthly = await json('/api/chores', 'POST', { title: 'Water plants', memberId: leo.id, dueDate: '2026-10-01', rrule: 'FREQ=MONTHLY;BYMONTHDAY=1,5,24' });
  const shared = await json('/api/chores', 'POST', { title: 'Library books', dueDate: '2026-10-24' });
  await json('/api/chores', 'POST', { title: 'Paused', dueDate: '2026-10-24', active: false });
  await json(`/api/chores/${weekly.id}/complete`, 'POST', { date: '2026-10-19' });
  await db.prepare("INSERT INTO chore_completions (chore_id,date,member_id,completed_at,points_awarded,status) VALUES (?, '2026-10-24', ?, '2026-10-24T12:00:00Z',0,'pending')").bind(shared.id, maya.id).run();
  counter.count = 0;
  const counts = await json('/api/chores/counts?from=2026-10-19&to=2026-11-02');
  assert.ok(counter.count <= 3, `a whole strip took ${counter.count} database round trips`);
  const find = (date: string, memberId: string | null) => counts.find((c: any) => c.date === date && c.memberId === memberId);
  assert.deepEqual(find('2026-10-19', maya.id), { date: '2026-10-19', memberId: maya.id, total: 1, remaining: 0, pending: 0 });
  assert.equal(find('2026-10-21', maya.id).remaining, 1);
  assert.equal(find('2026-10-26', maya.id), undefined, 'alternating week is empty');
  assert.equal(find('2026-11-02', maya.id).remaining, 1);
  assert.equal(find('2026-10-24', leo.id).remaining, 1);
  assert.deepEqual(find('2026-10-24', null), { date: '2026-10-24', memberId: null, total: 1, remaining: 1, pending: 1 });
  await json(`/api/chores/${monthly.id}`, 'PATCH', { rrule: null, dueDate: '2026-10-25' });
  const edited = await json('/api/chores/counts?from=2026-10-24&to=2026-10-25');
  assert.equal(edited.some((c: any) => c.date === '2026-10-24' && c.memberId === leo.id), false);
  assert.equal(edited.find((c: any) => c.date === '2026-10-25' && c.memberId === leo.id).remaining, 1);
});

test('chore date counts: full flexible goals leave no extra work, and undo reopens the interval', async () => {
  const { json, db, maya } = await setup();
  const chore = await json('/api/chores', 'POST', { title: 'Piano', memberId: maya.id, dueDate: '2026-10-19', repeatGoal: { times: 1, every: 1, unit: 'week', weekStart: 1 } });
  await json(`/api/chores/${chore.id}/complete`, 'POST', { date: '2026-10-19' });
  let counts = await json('/api/chores/counts?from=2026-10-21&to=2026-10-26');
  assert.equal(counts.length, 1, 'goal completions outside the strip still fill its interval');
  assert.equal(counts[0].date, '2026-10-26');
  await json(`/api/chores/${chore.id}/complete?date=2026-10-19`, 'DELETE');
  counts = await json('/api/chores/counts?from=2026-10-21&to=2026-10-26');
  assert.equal(counts.length, 6);
  await db.prepare("INSERT INTO chore_completions (chore_id,date,member_id,completed_at,points_awarded,status) VALUES (?, '2026-10-19', ?, '2026-10-19T12:00:00Z',0,'pending')").bind(chore.id, maya.id).run();
  counts = await json('/api/chores/counts?from=2026-10-19&to=2026-10-25');
  assert.deepEqual(counts, [{ date: '2026-10-19', memberId: maya.id, total: 1, remaining: 1, pending: 1 }]);
});

test('chore date counts: bounded real dates, display scope, child privacy and the feature switch', async () => {
  const { json, req, maya, leo } = await setup();
  for (const dates of ['from=2026-02-30&to=2026-03-01', 'from=2026-10-20&to=2026-10-19', 'from=2026-10-01&to=2026-12-01']) assert.equal((await req('/api/chores/counts?' + dates)).status, 400);
  for (const memberId of [maya.id, leo.id, null]) await json('/api/chores', 'POST', { title: 'Dishes', memberId, dueDate: '2026-10-19' });
  const kid = await json('/api/keys', 'POST', { name: "Maya's tablet", scope: 'display' });
  await json(`/api/keys/${kid.id}`, 'PATCH', { owner: maya.id });
  const rows = await json('/api/chores/counts?from=2026-10-19&to=2026-10-19', 'GET', undefined, kid.key);
  assert.deepEqual(rows.map((r: any) => r.memberId).sort(), [maya.id, null].sort());
  const wall = await json('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' });
  assert.equal((await json('/api/chores/counts?from=2026-10-19&to=2026-10-19', 'GET', undefined, wall.key)).length, 3);
  const settings = await json('/api/settings');
  await json('/api/settings', 'PATCH', { features: { ...settings.features, chores: false } });
  assert.deepEqual(await json('/api/chores/counts?from=2026-10-19&to=2026-10-19'), []);
});


test('chore date counts: the MCP reader preserves validation and feature-off behavior', async () => {
  const { app, env, json, maya } = await setup();
  await json('/api/chores', 'POST', { title: 'Dishes', memberId: maya.id, dueDate: '2026-10-19' });
  const call = async (args: object) => {
    const r = await app.request('/mcp', { method: 'POST', headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_chore_counts', arguments: args } }) }, env);
    return (await r.json() as any).result;
  };
  const result = await call({ from: '2026-10-19', to: '2026-10-19' });
  assert.equal(result.structuredContent.counts[0].remaining, 1);
  assert.equal((await call({ from: '2026-02-30', to: '2026-03-01' })).isError, true);
  const settings = await json('/api/settings');
  await json('/api/settings', 'PATCH', { features: { ...settings.features, chores: false } });
  assert.deepEqual((await call({ from: '2026-10-19', to: '2026-10-19' })).structuredContent.counts, []);
});
