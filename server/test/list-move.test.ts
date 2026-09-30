// Moving items between lists of the same type (POST /api/lists/{id}/items/move, MCP move_list_items).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (method: string, p: string, body?: unknown, key = ADMIN_KEY) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  const send = async (method: string, p: string, body?: unknown, key?: string) => (await (await raw(method, p, body, key)).json()) as any;
  let rpc = 1;
  const tool = async (name: string, args: unknown) => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }),
    }, env);
    const out = (await res.json()) as any;
    return out.result ?? { isError: true, error: out.error };
  };
  return { raw, send, tool };
}

test('move: items keep their id, fields, steps, notes and meal links; both lists change', async () => {
  const { send, raw } = makeApp();
  const from = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  const to = await send('POST', '/api/lists', { name: 'Weekend', kind: 'todo' });
  const member = await send('POST', '/api/members', { name: 'Sam', color: '#123456' });
  const [item, stay] = await send('POST', `/api/lists/${from.id}/items`, [
    { title: 'Tidy garage', notes: 'Bins first', quantity: '1', memberId: member.id, dueDate: '2026-10-03', priority: 'high', steps: ['Sweep', 'Bins'] },
    { title: 'Stay here' },
  ]);
  await send('POST', '/api/notes', { target: `list_item:${item.id}`, body: 'Saturday?' });
  const revs = async () => Object.fromEntries((await send('GET', '/api/lists')).map((l: any) => [l.id, l.itemsRev]));
  const before = await revs();

  const res = await raw('POST', `/api/lists/${from.id}/items/move`, { itemIds: [item.id], toListId: to.id });
  assert.equal(res.status, 200);
  const [moved] = (await res.json()) as any[];
  assert.deepEqual(
    [moved.id, moved.listId, moved.title, moved.notes, moved.quantity, moved.memberId, moved.dueDate, moved.priority, moved.steps.map((s: any) => s.title)],
    [item.id, to.id, 'Tidy garage', 'Bins first', '1', member.id, '2026-10-03', 'high', ['Sweep', 'Bins']],
  );
  assert.deepEqual((await send('GET', `/api/lists/${from.id}`)).items.map((i: any) => i.title), ['Stay here']);
  const there = (await send('GET', `/api/lists/${to.id}`)).items;
  assert.deepEqual(there.map((i: any) => [i.title, i.noteCount]), [['Tidy garage', 1]]);
  const after = await revs();
  assert.ok(after[from.id] > before[from.id] && after[to.id] > before[to.id], 'both lists\' itemsRev go up');
  assert.equal(stay.listId, from.id);
});

test('move: a different type is refused; unknown items and lists are errors; wall screens can move', async () => {
  const { send, raw } = makeApp();
  const groceries = await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping', catalog: 'groceries' });
  const market = await send('POST', '/api/lists', { name: 'Market', kind: 'shopping', catalog: 'groceries' });
  const hardware = await send('POST', '/api/lists', { name: 'Hardware store', kind: 'shopping', catalog: 'shopping' });
  const todo = await send('POST', '/api/lists', { name: 'To-do', kind: 'todo' });
  const [milk] = await send('POST', `/api/lists/${groceries.id}/items`, { title: 'Milk', store: 'Neighborhood market', aisle: 'Dairy' });
  for (const target of [hardware.id, todo.id]) assert.equal((await raw('POST', `/api/lists/${groceries.id}/items/move`, { itemIds: [milk.id], toListId: target })).status, 400);
  assert.equal((await raw('POST', `/api/lists/${groceries.id}/items/move`, { itemIds: [milk.id], toListId: 'nope' })).status, 404);
  assert.equal((await raw('POST', `/api/lists/${groceries.id}/items/move`, { itemIds: ['nope'], toListId: market.id })).status, 404);

  const { key } = await send('POST', '/api/keys', { name: 'wall', scope: 'display' });
  const res = await raw('POST', `/api/lists/${groceries.id}/items/move`, { itemIds: [milk.id], toListId: market.id }, key);
  assert.equal(res.status, 200);
  const [moved] = (await res.json()) as any[];
  assert.deepEqual([moved.listId, moved.store, moved.aisle], [market.id, 'Neighborhood market', 'Dairy']);
});

test('move: meal links follow the item', async () => {
  const { send } = makeApp();
  const a = await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping', catalog: 'groceries' });
  const b = await send('POST', '/api/lists', { name: 'Market', kind: 'shopping', catalog: 'groceries' });
  const recipe = await send('POST', '/api/recipes', { name: 'Tacos', defaultServings: 4, ingredients: [{ name: 'Tortillas', quantity: 8 }] });
  await send('POST', '/api/meals', { date: '2026-10-05', slot: 'dinner', recipeId: recipe.id });
  const applied = await send('POST', '/api/meals/projection/apply', { from: '2026-10-05', to: '2026-10-05', listId: a.id });
  await send('POST', `/api/lists/${a.id}/items/move`, { itemIds: applied.itemIds, toListId: b.id });
  const [item] = (await send('GET', `/api/lists/${b.id}`)).items;
  assert.deepEqual([item.title, item.meals], ['Tortillas', ['Tacos']]);
});

test('MCP: move_list_items moves by list name', async () => {
  const { send, tool } = makeApp();
  const from = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  await send('POST', '/api/lists', { name: 'Weekend', kind: 'todo' });
  const [item] = await send('POST', `/api/lists/${from.id}/items`, { title: 'Mow' });
  const result = await tool('move_list_items', { list: 'Chores', items: [item.id], toList: 'Weekend' });
  assert.ok(!result.isError, JSON.stringify(result));
  assert.equal(result.structuredContent.items[0].title, 'Mow');
  assert.ok((await tool('move_list_items', { list: 'Weekend', items: ['Mow'], toList: 'Chores' })).structuredContent.items.length === 1, 'items by title too');
});
