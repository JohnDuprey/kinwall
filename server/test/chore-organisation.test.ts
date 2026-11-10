import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { applyMigrations, openDb } from '../src/d1-sqlite.ts';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key = 'k') => {
    const r = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: r.status, json: await r.json() as any };
  };
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json.id;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json.id;
  const today = new Date().toISOString().slice(0, 10);
  const make = async (body: Record<string, unknown>) => (await req('/api/chores', 'POST', { title: 'Wash clothes', points: 5, dueDate: today, ...body })).json;
  return { db, req, maya, leo, today, make };
}

test('categories survive edits, linked copies and export/import; older exports keep defaults', async () => {
  const { req, make, maya, leo } = await setup();
  const c = await make({ memberIds: [maya, leo], category: ' Kitchen ' });
  assert.equal(c.category, 'Kitchen');
  await req(`/api/chores/${c.id}`, 'PATCH', { category: 'Household' });
  assert.ok((await req('/api/chores')).json.every((x: any) => x.category === 'Household'));
  const exported = (await req('/api/export')).json;
  assert.ok(exported.chores.every((x: any) => x.category === 'Household'));
  assert.equal((await req('/api/import', 'POST', exported)).status, 200);
  assert.ok((await req('/api/chores')).json.every((x: any) => x.category === 'Household'));
  await req(`/api/chores/${c.id}`, 'PATCH', { category: null });
  assert.ok((await req('/api/chores')).json.every((x: any) => x.category === null));
  const legacy = (await req('/api/export')).json;
  for (const chore of legacy.chores) { delete chore.category; delete chore.ongoing; delete chore.sourceId; }
  assert.equal((await req('/api/import', 'POST', legacy)).status, 200);
  assert.ok((await req('/api/chores')).json.every((x: any) => x.category === null && x.ongoing === false && x.sourceId === null));
});

test('ordering is atomic, validates ids, and does not change a linked sibling order', async () => {
  const { req, make, maya, leo } = await setup();
  const a = await make({ memberIds: [maya, leo] });
  const b = await make({ title: 'Dry clothes', memberId: maya });
  const before = (await req('/api/chores')).json;
  assert.equal((await req('/api/chores/order', 'POST', { ids: [b.id, a.id] })).status, 200);
  const after = (await req('/api/chores')).json;
  assert.ok(after.find((x: any) => x.id === b.id).sort < after.find((x: any) => x.id === a.id).sort);
  assert.equal(after.find((x: any) => x.memberId === leo).sort, before.find((x: any) => x.memberId === leo).sort);
  const invalid = await req('/api/chores/order', 'POST', { ids: [a.id, 'missing'] });
  assert.equal(invalid.status, 400);
  assert.deepEqual((await req('/api/chores')).json, after);
  assert.equal((await req('/api/chores/order', 'POST', { ids: [a.id, a.id] })).status, 400);
  const key = (await req('/api/keys', 'POST', { name: 'Wall', scope: 'display' })).json.key;
  assert.equal((await req('/api/chores/order', 'POST', { ids: [a.id, b.id] }, key)).status, 403);
});

test('ongoing chores stay available, record repeated completions separately, and replay once', async () => {
  const { req, make, maya, leo, today, db } = await setup();
  const c = await make({ ongoing: true, category: 'Household' });
  assert.equal(c.ongoing, true);
  const tick = (operationId: string, memberId: string) => req(`/api/chores/${c.id}/complete`, 'POST', { date: today, memberId, operationId });
  const first = await tick('wash-1', maya);
  assert.equal(first.status, 200);
  assert.ok(first.json.completionId);
  assert.equal((await tick('wash-1', maya)).json.completionId, first.json.completionId);
  await tick('wash-2', leo);
  await tick('wash-3', maya);
  const day = (await req(`/api/chores/day?date=${today}`)).json;
  assert.equal(day.find((x: any) => x.id === c.id).completed, false);
  assert.equal(day.filter((x: any) => x.sourceId === c.id && x.completed).length, 3);
  assert.equal((await req('/api/chores')).json.length, 1, 'history is not editable chore definitions');
  assert.equal((await db.prepare('SELECT SUM(points_awarded) AS n FROM chore_completions').first() as any).n, 15);
  await req(`/api/chores/${first.json.completionId}/complete?date=${today}`, 'DELETE');
  assert.equal((await req(`/api/chores/day?date=${today}`)).json.filter((x: any) => x.completed).length, 2);
  assert.equal((await db.prepare('SELECT SUM(points_awarded) AS n FROM chore_completions').first() as any).n, 10);
  const exported = (await req('/api/export')).json;
  assert.equal((await req('/api/import', 'POST', exported)).status, 200);
  assert.equal((await req('/api/chores')).json[0].ongoing, true);
  await req(`/api/chores/${c.id}`, 'DELETE');
  assert.equal((await db.prepare('SELECT SUM(points_awarded) AS n FROM chore_completions').first() as any).n, 10, 'deleting the responsibility keeps earned points');
});

test('ongoing chores use normal parent approval and cannot credit another child', async () => {
  const { req, make, maya, leo, today } = await setup();
  const key = (await req('/api/keys', 'POST', { name: 'Maya tablet', scope: 'display' })).json;
  await req(`/api/keys/${key.id}`, 'PATCH', { owner: maya });
  const c = await make({ ongoing: true, needsApproval: true });
  const tick = await req(`/api/chores/${c.id}/complete`, 'POST', { date: today, operationId: 'one' }, key.key);
  assert.equal(tick.status, 200);
  assert.equal(tick.json.pending, true);
  const id = tick.json.completionId;
  assert.equal((await req('/api/chores/pending')).json[0].choreId, id);
  assert.equal((await req(`/api/chores/${id}/approve`, 'POST', { date: today })).status, 200);
  assert.equal((await req(`/api/chores/${c.id}/complete`, 'POST', { date: today, memberId: leo }, key.key)).status, 403);
  assert.equal((await req(`/api/chores/${id}/complete?date=${today}`, 'DELETE', undefined, key.key)).status, 200);
  assert.equal((await req(`/api/chores/day?date=${today}`)).json.find((x: any) => x.id === c.id).completed, false);
});

test('ongoing chores reject fixed assignees, goals and activities on create and update', async () => {
  const { req, maya, today, make } = await setup();
  for (const body of [{ memberId: maya }, { memberIds: [maya] }, { repeatGoal: { times: 2, every: 1, unit: 'week', weekStart: 1 } }, { pluginId: 'missing' }]) {
    assert.equal((await req('/api/chores', 'POST', { title: 'Wash', ongoing: true, dueDate: today, ...body })).status, 400);
  }
  const c = await make({ ongoing: true });
  assert.equal((await req(`/api/chores/${c.id}`, 'PATCH', { memberIds: [maya] })).status, 400);
});

test('converting a chore to ongoing preserves earlier completions as separate history', async () => {
  const { req, make, today, maya, db } = await setup();
  const c = await make({ memberId: maya });
  await req(`/api/chores/${c.id}/complete`, 'POST', { date: today });
  assert.equal((await req(`/api/chores/${c.id}`, 'PATCH', { ongoing: true, memberIds: [] })).status, 200);
  const day = (await req(`/api/chores/day?date=${today}`)).json;
  assert.equal(day.find((x: any) => x.id === c.id).completed, false);
  assert.equal(day.filter((x: any) => x.sourceId === c.id && x.completed).length, 1);
  assert.equal((await db.prepare('SELECT SUM(points_awarded) AS n FROM chore_completions').first() as any).n, 5);
});

test('ongoing checklist retries do not reset or gate the same completion again', async () => {
  const { req, make, today, maya } = await setup();
  const list = (await req('/api/lists', 'POST', { name: 'Laundry', kind: 'reusable' })).json;
  const item = (await req(`/api/lists/${list.id}/items`, 'POST', { title: 'Add detergent' })).json;
  const itemId = Array.isArray(item) ? item[0].id : item.id;
  const c = await make({ ongoing: true, listId: list.id });
  const body = { date: today, memberId: maya, operationId: 'laundry' };
  assert.equal((await req(`/api/chores/${c.id}/complete`, 'POST', body)).status, 409);
  await req(`/api/lists/${list.id}/items/${itemId}`, 'PATCH', { done: true });
  assert.equal((await req(`/api/chores/${c.id}/complete`, 'POST', body)).status, 200);
  assert.equal((await req(`/api/chores/${c.id}/complete`, 'POST', body)).status, 200, 'replay succeeds even though the checklist reset');
  const counts = (await req(`/api/chores/counts?from=${today}&to=${today}`)).json;
  assert.equal(counts.reduce((n: number, c: any) => n + c.remaining, 0), 0);
});

test('concurrent retries of an ongoing tick award points once', async () => {
  const { req, make, today, maya, db } = await setup();
  const c = await make({ ongoing: true });
  const body = { date: today, memberId: maya, operationId: 'same' };
  const ticks = await Promise.all([req(`/api/chores/${c.id}/complete`, 'POST', body), req(`/api/chores/${c.id}/complete`, 'POST', body)]);
  assert.ok(ticks.every(x => x.status === 200));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM chore_completions').first() as any).n, 1);
  assert.equal((await db.prepare('SELECT SUM(points_awarded) AS n FROM chore_completions').first() as any).n, 5);
});
