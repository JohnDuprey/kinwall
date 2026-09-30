// The grocery catalog: every remembered item, where it's found per store, and editing it
// (GET/POST /api/lists/remembered, PUT/DELETE /api/lists/remembered/{key}, and the MCP tools).
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
  const send = async (method: string, p: string, body?: unknown) => (await (await raw(method, p, body)).json()) as any;
  let rpc = 1;
  const tool = async (name: string, args: unknown) => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }),
    }, env);
    return ((await res.json()) as any).result;
  };
  return { raw, send, tool };
}

async function seeded() {
  const t = makeApp();
  const list = await t.send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' });
  await t.send('POST', `/api/lists/${list.id}/items`, [
    { title: 'Milk', store: 'Costco', aisle: 'Aisle 4', category: 'Dairy' },
    { title: 'Bananas', store: 'Market', aisle: 'Produce', category: 'Produce' },
  ]);
  // Bought the milk at the market too: checkout remembers that store (no aisle known there).
  const milk = (await t.send('GET', `/api/lists/${list.id}`)).items.find((i: any) => i.title === 'Milk');
  await t.send('PATCH', `/api/lists/${list.id}/items/${milk.id}`, { done: true });
  await t.send('POST', `/api/lists/${list.id}/clear-completed`, { store: 'Market' });
  return { ...t, list };
}

test('catalog: lists every remembered item by title, with its department and places per store', async () => {
  const { send } = await seeded();
  const all = await send('GET', '/api/lists/remembered');
  assert.deepEqual(all.map((i: any) => i.title), ['Bananas', 'Milk']);
  const milk = all[1];
  assert.equal(milk.key, 'milk');
  assert.equal(milk.uses, 1);
  assert.equal(milk.category, 'Dairy');
  assert.deepEqual(milk.places.map((p: any) => [p.store, p.aisle]), [['Costco', 'Aisle 4'], ['Market', null]]);
  assert.equal(milk.lastStore, 'Market');
  assert.ok(milk.lastUsed && milk.places[0].updatedAt);

  assert.deepEqual((await send('GET', '/api/lists/remembered?q=MIL')).map((i: any) => i.key), ['milk']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?q=banana')).map((i: any) => i.key), ['banana']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?store=Costco')).map((i: any) => i.key), ['milk']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?store=Market')).map((i: any) => i.key), ['banana', 'milk']);
});

test('catalog: PUT respells the title, sets the department and replaces the places', async () => {
  const { send, raw, list } = await seeded();
  const edited = await send('PUT', '/api/lists/remembered/milk', {
    title: 'MILK',
    category: 'Cold',
    places: [{ store: 'Costco', aisle: 'Aisle 9' }, { store: 'Shaws', aisle: 'Dairy case' }],
  });
  assert.equal(edited.key, 'milk');
  assert.equal(edited.title, 'MILK');
  assert.equal(edited.category, 'Cold');
  assert.deepEqual(edited.places.map((p: any) => [p.store, p.aisle]), [['Costco', 'Aisle 9'], ['Shaws', 'Dairy case']]);
  assert.equal(edited.uses, 1); // a respelling isn't a use

  // The new aisle is offered at that store, like one saved on an item; the market is forgotten.
  const detail = await send('GET', `/api/lists/${list.id}`);
  assert.ok(detail.suggestions.aisles.some((a: any) => a.store === 'Shaws' && a.aisle === 'Dairy case'));
  assert.ok(detail.suggestions.stores.includes('Shaws'));
  const suggestion = detail.suggestions.items.find((s: any) => s.key === 'milk');
  assert.equal(suggestion.title, 'MILK');
  assert.equal(suggestion.category, 'Cold');

  // A new add at Shaws lands in the edited aisle.
  const [added] = await send('POST', `/api/lists/${list.id}/items`, { title: 'milk', store: 'Shaws' });
  assert.deepEqual([added.aisle, added.category], ['Dairy case', 'Cold']);

  // Only what's given changes; aisle null clears it; an empty places list forgets every store.
  const cleared = await send('PUT', '/api/lists/remembered/milk', { places: [{ store: 'Costco', aisle: null }] });
  assert.equal(cleared.category, 'Cold');
  assert.deepEqual(cleared.places.map((p: any) => [p.store, p.aisle]), [['Costco', null]]);
  assert.deepEqual((await send('PUT', '/api/lists/remembered/milk', { places: [] })).places, []);
  assert.equal((await send('GET', '/api/lists/remembered?q=milk'))[0].category, 'Cold');

  assert.equal((await raw('PUT', '/api/lists/remembered/nothing', { category: 'x' })).status, 404);
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { places: [{ store: ' ', aisle: null }] })).status, 400);
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { places: [{ store: 'Costco', aisle: 'x'.repeat(61) }] })).status, 400);
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { title: '  ' })).status, 400);
});

test('catalog: renaming to a different name moves it; onto another item is refused', async () => {
  const { send, raw } = await seeded();
  const moved = await send('PUT', '/api/lists/remembered/milk', { title: 'Whole milk' });
  assert.equal(moved.key, 'whole milk');
  assert.equal(moved.places.length, 2);
  const keys = (await send('GET', '/api/lists/remembered')).map((i: any) => i.key);
  assert.deepEqual(keys, ['banana', 'whole milk']);
  const clash = await raw('PUT', '/api/lists/remembered/whole%20milk', { title: 'Banana' });
  assert.equal(clash.status, 409);
});

test('catalog: POST adds an item without a list; DELETE forgets it', async () => {
  const { send, raw, list } = await seeded();
  const res = await raw('POST', '/api/lists/remembered', { title: ' Oat milk ', category: 'Dairy', places: [{ store: 'Shaws', aisle: 'Aisle 3' }] });
  assert.equal(res.status, 201);
  const oat = await res.json() as any;
  assert.deepEqual([oat.key, oat.title, oat.uses, oat.category], ['oat milk', 'Oat milk', 0, 'Dairy']);
  assert.equal((await raw('POST', '/api/lists/remembered', { title: 'oat milks' })).status, 409);

  const [added] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Oat milk' });
  assert.deepEqual([added.store, added.aisle, added.category], ['Shaws', 'Aisle 3', 'Dairy']);

  assert.deepEqual(await send('DELETE', '/api/lists/remembered/oat%20milk'), { ok: true });
  assert.ok(!(await send('GET', '/api/lists/remembered')).some((i: any) => i.key === 'oat milk'));
});

test('catalog: a wall display reads and edits it like list items, but cannot forget', async () => {
  const { send, raw } = await seeded();
  const { key } = await send('POST', '/api/keys', { name: 'wall', scope: 'display' });
  assert.equal((await raw('GET', '/api/lists/remembered', undefined, key)).status, 200);
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { category: 'Dairy' }, key)).status, 200);
  assert.equal((await raw('POST', '/api/lists/remembered', { title: 'Bread' }, key)).status, 201);
  assert.equal((await raw('DELETE', '/api/lists/remembered/milk', undefined, key)).status, 403);
});

test('catalog: MCP list_remembered_items and update_remembered_item', async () => {
  const { tool } = await seeded();
  const listed = await tool('list_remembered_items', { store: 'Costco' });
  assert.deepEqual(listed.structuredContent.items.map((i: any) => i.key), ['milk']);
  const updated = await tool('update_remembered_item', { name: 'milk', places: [{ store: 'Costco', aisle: 'Aisle 2' }] });
  assert.equal(updated.isError, undefined);
  assert.deepEqual(updated.structuredContent.item.places.map((p: any) => p.aisle), ['Aisle 2']);
  const made = await tool('update_remembered_item', { name: 'Lemons', category: 'Produce', create: true });
  assert.equal(made.structuredContent.item.key, 'lemon');
  assert.equal((await tool('update_remembered_item', { name: 'Nope', category: 'x' })).isError, true);
});

test('catalog tags: PUT and POST set categories (trimmed, deduped ignoring case, family spelling), GET filters by tag', async () => {
  const { send, raw } = await seeded();
  const milk = await send('PUT', '/api/lists/remembered/milk', { tags: [' Breakfast ', 'breakfast', 'Staples'] });
  assert.deepEqual(milk.tags, ['Breakfast', 'Staples']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?q=banana'))[0].tags, []);
  // A new spelling of a category the family already has takes the family's spelling.
  const oat = await send('POST', '/api/lists/remembered', { title: 'Oat milk', tags: ['BREAKFAST', 'Lunchbox'] });
  assert.deepEqual(oat.tags, ['Breakfast', 'Lunchbox']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?tag=breakfast')).map((i: any) => i.key), ['milk', 'oat milk']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?tag=Lunchbox&q=oat')).map((i: any) => i.key), ['oat milk']);
  // Only given fields change; an empty list clears them.
  assert.deepEqual((await send('PUT', '/api/lists/remembered/milk', { category: 'Dairy' })).tags, ['Breakfast', 'Staples']);
  assert.deepEqual((await send('PUT', '/api/lists/remembered/milk', { tags: [] })).tags, []);
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { tags: ['x'.repeat(41)] })).status, 400);
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { tags: Array.from({ length: 11 }, (_, n) => `T${n}`) })).status, 400);
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { tags: ['  '] })).status, 400);
});

test('catalog tags: a rename carries them; forgetting removes them', async () => {
  const { send } = await seeded();
  await send('PUT', '/api/lists/remembered/milk', { tags: ['Breakfast'] });
  const moved = await send('PUT', '/api/lists/remembered/milk', { title: 'Whole milk' });
  assert.deepEqual(moved.tags, ['Breakfast']);
  await send('DELETE', '/api/lists/remembered/whole%20milk');
  // Added back later, it starts with no categories.
  assert.deepEqual((await send('POST', '/api/lists/remembered', { title: 'Whole milk' })).tags, []);
});

test('catalog tags: PATCH /api/lists/remembered-tags renames or removes a category on every item', async () => {
  const { send, raw } = await seeded();
  await send('PUT', '/api/lists/remembered/milk', { tags: ['Breakfast', 'Snacks'] });
  await send('PUT', '/api/lists/remembered/banana', { tags: ['Snacks'] });
  assert.deepEqual(await send('PATCH', '/api/lists/remembered-tags', { from: 'snacks', to: 'Snack time' }), { updated: 2 });
  let all = await send('GET', '/api/lists/remembered');
  assert.deepEqual(all.map((i: any) => i.tags), [['Snack time'], ['Breakfast', 'Snack time']]);
  // Renaming onto a category an item already has merges them.
  assert.deepEqual(await send('PATCH', '/api/lists/remembered-tags', { from: 'Snack time', to: 'Breakfast' }), { updated: 2 });
  all = await send('GET', '/api/lists/remembered');
  assert.deepEqual(all.map((i: any) => i.tags), [['Breakfast'], ['Breakfast']]);
  assert.deepEqual(await send('PATCH', '/api/lists/remembered-tags', { from: 'Breakfast', to: null }), { updated: 2 });
  assert.deepEqual((await send('GET', '/api/lists/remembered')).map((i: any) => i.tags), [[], []]);
  assert.equal((await raw('PATCH', '/api/lists/remembered-tags', { from: 'x', to: 'y'.repeat(41) })).status, 400);
});

test('catalog tags: a wall display edits an item’s categories, but only parents rename or remove one everywhere', async () => {
  const { send, raw } = await seeded();
  const { key } = await send('POST', '/api/keys', { name: 'wall', scope: 'display' });
  assert.equal((await raw('PUT', '/api/lists/remembered/milk', { tags: ['Breakfast'] }, key)).status, 200);
  assert.equal((await raw('PATCH', '/api/lists/remembered-tags', { from: 'Breakfast', to: 'Mornings' }, key)).status, 403);
  assert.equal((await raw('PATCH', '/api/lists/remembered-tags', { from: 'Breakfast', to: null }, key)).status, 403);
  assert.deepEqual((await send('GET', '/api/lists/remembered?tag=Breakfast')).map((i: any) => i.key), ['milk']);
});

test('catalog tags: MCP filters by tag and sets tags', async () => {
  const { tool } = await seeded();
  const updated = await tool('update_remembered_item', { name: 'milk', tags: ['Breakfast'] });
  assert.deepEqual(updated.structuredContent.item.tags, ['Breakfast']);
  const listed = await tool('list_remembered_items', { tag: 'breakfast' });
  assert.deepEqual(listed.structuredContent.items.map((i: any) => i.key), ['milk']);
});
