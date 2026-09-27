import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { itemKey } from '../src/item-memory.ts';
import { mealWrite } from '../src/meals.ts';
import type { KinwallDb } from '../src/db.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${ADMIN_KEY}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await app.request(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return (await res.json()) as any;
  };
  let rpc = 1;
  const tool = async (name: string, args: unknown) => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }),
    }, env);
    return ((await res.json()) as any).result.structuredContent;
  };
  return { db: db as unknown as KinwallDb, send, tool };
}

const shoppingList = (send: ReturnType<typeof makeApp>['send'], extra = {}) => send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping', ...extra });

test('groceries: item names match ignoring case, spacing and simple plurals', () => {
  for (const [a, b] of [['Eggs', 'egg'], ['  Whole   Milk ', 'whole milk'], ['Tomatoes', 'tomato'], ['Berries', 'berry'], ['Cookies', 'cookie'], ['Peaches', 'peach'], ['Apples', 'apple'], ['Glasses', 'glass']]) {
    assert.equal(itemKey(a), itemKey(b), `${a} = ${b}`);
  }
  for (const [a, b] of [['Hummus', 'Hummu'], ['Milk', 'Mint'], ['Glass', 'Gla']]) assert.notEqual(itemKey(a), itemKey(b), `${a} != ${b}`);
});

test('groceries: aisle round-trips on add, edit and list detail', async () => {
  const { send } = makeApp();
  const list = await shoppingList(send);
  const [milk] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Milk', store: 'Costco', aisle: 'Aisle 4' });
  assert.equal(milk.aisle, 'Aisle 4');
  const edited = await send('PATCH', `/api/lists/${list.id}/items/${milk.id}`, { aisle: 'Back wall' });
  assert.equal(edited.aisle, 'Back wall');
  const detail = await send('GET', `/api/lists/${list.id}`);
  assert.equal(detail.items[0].aisle, 'Back wall');
  assert.deepEqual(detail.suggestions.aisles, [{ store: 'Costco', aisle: 'Back wall' }]);
  assert.equal((await send('PATCH', `/api/lists/${list.id}/items/${milk.id}`, { aisle: null })).aisle, null);
});

test('groceries: a remembered store, category and aisle fill a new add; explicit values (and null) win; aisle is per store', async () => {
  const { send } = makeApp();
  const list = await shoppingList(send);
  const [first] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Eggs', store: 'Costco', category: 'Dairy', aisle: 'Aisle 4' });
  await send('DELETE', `/api/lists/${list.id}/items/${first.id}`); // memory outlives the item

  const [again] = await send('POST', `/api/lists/${list.id}/items`, { title: 'egg' });
  assert.deepEqual([again.store, again.category, again.aisle], ['Costco', 'Dairy', 'Aisle 4']);

  // A different store: the aisle comes from that store's row (none yet), not Costco's.
  const [elsewhere] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Eggs', store: 'Corner Market' });
  assert.deepEqual([elsewhere.store, elsewhere.category, elsewhere.aisle], ['Corner Market', 'Dairy', null]);
  // Saving it with an aisle there remembers that too, and makes Corner Market the latest store.
  await send('PATCH', `/api/lists/${list.id}/items/${elsewhere.id}`, { aisle: 'Fridge' });
  const [latest] = await send('POST', `/api/lists/${list.id}/items`, { title: 'EGGS' });
  assert.deepEqual([latest.store, latest.aisle], ['Corner Market', 'Fridge']);
  const [costco] = await send('POST', `/api/lists/${list.id}/items`, { title: 'eggs', store: 'Costco' });
  assert.equal(costco.aisle, 'Aisle 4');

  const [explicit] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Eggs', store: null, category: 'Breakfast', aisle: null });
  assert.deepEqual([explicit.store, explicit.category, explicit.aisle], [null, 'Breakfast', null]);

  // To-do lists neither use nor feed the memory.
  const todo = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  const [task] = await send('POST', `/api/lists/${todo.id}/items`, { title: 'Eggs' });
  assert.deepEqual([task.store, task.category, task.aisle], [null, null, null]);
});

test('groceries: the MCP add_list_items uses the remembered place; update_list_item sets an aisle', async () => {
  const { send, tool } = makeApp();
  const list = await shoppingList(send);
  await send('POST', `/api/lists/${list.id}/items`, { title: 'Bananas', store: 'Costco', category: 'Produce', aisle: 'Produce' });
  const added = await tool('add_list_items', { listName: 'Groceries', items: ['banana', { title: 'Bananas', category: 'Snacks' }] });
  assert.deepEqual(added.items.map((i: any) => [i.store, i.category, i.aisle]), [['Costco', 'Produce', 'Produce'], ['Costco', 'Snacks', 'Produce']]);
  const updated = await tool('update_list_item', { list: 'Groceries', itemId: added.items[0].id, aisle: 'Aisle 1' });
  assert.equal(updated.item.aisle, 'Aisle 1');
});

test('groceries: meal groceries use the remembered place and note which meals they are for', async () => {
  const { db, send } = makeApp();
  const list = await shoppingList(send);
  const [seed] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Tortillas', store: 'Costco', category: 'Bakery', aisle: 'Aisle 2' });
  await send('DELETE', `/api/lists/${list.id}/items/${seed.id}`);
  const now = '2026-09-26T12:00:00.000Z';
  const ing = (id: string, name: string, category: string | null) => ({ id, name, normalizedName: name.toLowerCase(), quantity: 1, unit: null, preparation: null, qualifier: null, category, sort: 0, scalable: true });
  await db.batch([
    mealWrite(db, { id: 'm1', date: '2026-10-05', slot: 'dinner', title: 'Taco night', mealKind: 'recipe', recipeId: null, recipeSnapshot: { name: 'Tacos', defaultServings: 4, ingredients: [ing('i1', 'Tortillas', 'Grains'), ing('i2', 'Limes', 'Produce')] }, servings: 4, assigneeMemberId: null, notes: null, plannedTime: null, calendarEventId: null, status: 'planned', sourceUrl: null, createdAt: now, updatedAt: now }),
  ]);
  const applied = await send('POST', '/api/meals/projection/apply', { from: '2026-10-05', to: '2026-10-05', listId: list.id });
  assert.equal(applied.added, 2);
  const detail = await send('GET', `/api/lists/${list.id}`);
  const tortillas = detail.items.find((i: any) => i.title === 'Tortillas');
  const limes = detail.items.find((i: any) => i.title === 'Limes');
  assert.deepEqual([tortillas.store, tortillas.category, tortillas.aisle, tortillas.meals], ['Costco', 'Bakery', 'Aisle 2', ['Taco night']]);
  assert.deepEqual([limes.store, limes.category, limes.aisle], [null, 'Produce', null]); // nothing remembered: the recipe's category
});

test('groceries: renaming or removing a store, category or aisle updates items, memory and orders', async () => {
  const { send } = makeApp();
  const list = await shoppingList(send);
  const [milk] = await send('POST', `/api/lists/${list.id}/items`, [{ title: 'Milk', store: 'Costco', category: 'Dairy', aisle: 'Aisle 4' }, { title: 'Bread', store: 'Safeway', aisle: 'Aisle 4' }]);
  await send('PUT', '/api/lists/aisles', { store: 'Costco', aisles: ['Produce', 'Aisle 4'] });

  assert.deepEqual(await send('POST', '/api/lists/values', { field: 'store', from: 'Costco', to: 'Warehouse' }), { updated: 1 });
  assert.deepEqual(await send('POST', '/api/lists/values', { field: 'aisle', from: 'Aisle 4', to: 'Dairy case', store: 'Warehouse' }), { updated: 1 });
  assert.deepEqual(await send('POST', '/api/lists/values', { field: 'category', from: 'Dairy', to: 'Cold' }), { updated: 1 });
  let detail = await send('GET', `/api/lists/${list.id}`);
  const byTitle = (t: string) => detail.items.find((i: any) => i.title === t);
  assert.deepEqual([byTitle('Milk').store, byTitle('Milk').aisle, byTitle('Milk').category], ['Warehouse', 'Dairy case', 'Cold']);
  assert.equal(byTitle('Bread').aisle, 'Aisle 4'); // another store's aisle of the same name is untouched
  assert.deepEqual(detail.aisleOrder, [{ store: 'Warehouse', aisles: ['Produce', 'Dairy case'] }]);
  assert.deepEqual(detail.suggestions.stores, ['Safeway', 'Warehouse']);
  const [again] = await send('POST', `/api/lists/${list.id}/items`, { title: 'milk' });
  assert.deepEqual([again.store, again.category, again.aisle], ['Warehouse', 'Cold', 'Dairy case']);

  await send('POST', '/api/lists/values', { field: 'category', from: 'Cold', to: null });
  detail = await send('GET', `/api/lists/${list.id}`);
  assert.equal(detail.items.find((i: any) => i.id === milk.id).category, null);
  assert.deepEqual(detail.suggestions.categories, []);
});

test('groceries: checkout deletes only the checked items asked for; reset unchecks only those', async () => {
  const { send } = makeApp();
  const list = await shoppingList(send);
  const [a, b, c] = await send('POST', `/api/lists/${list.id}/items`, [{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
  for (const it of [a, b]) await send('PATCH', `/api/lists/${list.id}/items/${it.id}`, { done: true });
  // c is open and b checked: only a goes (c isn't checked, b wasn't asked for).
  assert.deepEqual(await send('POST', `/api/lists/${list.id}/clear-completed`, { itemIds: [a.id, c.id] }), { deleted: 1 });
  assert.deepEqual((await send('GET', `/api/lists/${list.id}`)).items.map((i: any) => i.title).sort(), ['B', 'C']);
  assert.deepEqual(await send('POST', `/api/lists/${list.id}/clear-completed`), { deleted: 1 }); // no body: every checked item

  const packing = await send('POST', '/api/lists', { name: 'Packing', kind: 'reusable' });
  const [x, y] = await send('POST', `/api/lists/${packing.id}/items`, [{ title: 'X' }, { title: 'Y' }]);
  for (const it of [x, y]) await send('PATCH', `/api/lists/${packing.id}/items/${it.id}`, { done: true });
  assert.deepEqual(await send('POST', `/api/lists/${packing.id}/reset`, { itemIds: [x.id] }), { reset: 1 });
  assert.deepEqual((await send('GET', `/api/lists/${packing.id}`)).items.map((i: any) => [i.title, i.done]).sort(), [['X', false], ['Y', true]]);
});

test('groceries: keep checked in place and aisle sort default by kind; kind change takes the new default', async () => {
  const { send } = makeApp();
  const shopping = await shoppingList(send);
  const reusable = await send('POST', '/api/lists', { name: 'Packing', kind: 'reusable' });
  const todo = await send('POST', '/api/lists', { name: 'Jobs', kind: 'todo' });
  assert.deepEqual([shopping.keepChecked, reusable.keepChecked, todo.keepChecked], [true, true, false]);
  assert.deepEqual([shopping.sortBy, reusable.sortBy, todo.sortBy], ['aisle', 'manual', 'manual']);
  assert.equal((await send('POST', '/api/lists', { name: 'Off', kind: 'shopping', keepChecked: false })).keepChecked, false);
  assert.equal((await send('PATCH', `/api/lists/${todo.id}`, { kind: 'shopping' })).keepChecked, true);
  assert.equal((await send('PATCH', `/api/lists/${todo.id}`, { keepChecked: false })).keepChecked, false);
  assert.equal((await send('PATCH', `/api/lists/${todo.id}`, { name: 'Renamed' })).keepChecked, false);

  // Kept in place: a checked item doesn't drop below the open ones.
  const list = await send('POST', '/api/lists', { name: 'Manual', kind: 'shopping', sortBy: 'manual' });
  const [first] = await send('POST', `/api/lists/${list.id}/items`, [{ title: 'First' }, { title: 'Second' }]);
  await send('PATCH', `/api/lists/${list.id}/items/${first.id}`, { done: true });
  assert.deepEqual((await send('GET', `/api/lists/${list.id}`)).items.map((i: any) => i.title), ['First', 'Second']);
});

test('groceries: aisle sort - by store, natural or custom aisle order, no aisle last, then A-Z', async () => {
  const { send, tool } = makeApp();
  const list = await shoppingList(send);
  await send('POST', `/api/lists/${list.id}/items`, [
    { title: 'Ice cream', store: 'Costco', aisle: 'Frozen' },
    { title: 'Soup', store: 'Costco', aisle: 'Aisle 10' },
    { title: 'Rice', store: 'Costco', aisle: 'Aisle 2' },
    { title: 'Beans', store: 'Costco', aisle: 'Aisle 2' },
    { title: 'Batteries', store: 'Costco' },
    { title: 'Apples', store: 'Costco', aisle: 'Produce' },
    { title: 'Stamps', store: 'Post office' },
    { title: 'Gum' },
  ]);
  const titles = async () => (await send('GET', `/api/lists/${list.id}`)).items.map((i: any) => i.title);
  // Natural: Aisle 2 < Aisle 10 < Frozen < Produce; Batteries (no aisle) last in Costco; no store last.
  assert.deepEqual(await titles(), ['Beans', 'Rice', 'Soup', 'Ice cream', 'Apples', 'Batteries', 'Stamps', 'Gum']);

  // A walking order (set over MCP), with Frozen between numbered aisles; unlisted aisles follow in natural order.
  const set = await tool('set_store_aisle_order', { store: 'Costco', aisles: ['Produce', 'Aisle 10', 'Frozen', 'Bakery'] });
  assert.deepEqual(set.order, { store: 'Costco', aisles: ['Produce', 'Aisle 10', 'Frozen', 'Bakery'] });
  assert.deepEqual(await titles(), ['Apples', 'Soup', 'Ice cream', 'Beans', 'Rice', 'Batteries', 'Stamps', 'Gum']);
  const detail = await send('GET', `/api/lists/${list.id}`);
  assert.deepEqual(detail.aisleOrder, [{ store: 'Costco', aisles: ['Produce', 'Aisle 10', 'Frozen', 'Bakery'] }]);
  assert.ok(detail.suggestions.aisles.some((a: any) => a.store === 'Costco' && a.aisle === 'Bakery')); // offered though no item uses it

  await send('PUT', '/api/lists/aisles', { store: 'Costco', aisles: [] });
  assert.deepEqual(await titles(), ['Beans', 'Rice', 'Soup', 'Ice cream', 'Apples', 'Batteries', 'Stamps', 'Gum']);
  const updated = await tool('update_list', { list: 'Groceries', sortBy: 'alpha', groupBy: 'aisle', keepChecked: false });
  assert.deepEqual([updated.list.sortBy, updated.list.groupBy, updated.list.keepChecked], ['alpha', 'aisle', false]);
});

test('groceries: migration 0040 gives existing lists the default by kind and seeds the memory', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kw-mig-'));
  try {
    for (const f of readdirSync(MIGRATIONS_DIR)) if (f < '0040') cpSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    const db = openDb(':memory:');
    applyMigrations(db, dir);
    const now = '2026-01-01T00:00:00.000Z';
    for (const [id, kind] of [['s', 'shopping'], ['r', 'reusable'], ['t', 'todo']]) db.prepare('INSERT INTO lists (id, name, kind, created_at) VALUES (?, ?, ?, ?)').bind(id, id, kind, now).run();
    db.prepare("INSERT INTO list_items (id, list_id, title, store, category, created_at, updated_at) VALUES ('1', 's', ' Cherries ', 'Costco', 'Produce', ?, '2026-01-01'), ('2', 's', 'cherry', NULL, 'Fruit', ?, '2026-02-01'), ('3', 't', 'Call Sam', 'Nowhere', NULL, ?, ?)").bind(now, now, now, now).run();
    applyMigrations(db, MIGRATIONS_DIR);
    assert.deepEqual(db.prepare('SELECT id, keep_checked FROM lists ORDER BY id').all().results.map((r) => ({ ...r })), [{ id: 'r', keep_checked: 1 }, { id: 's', keep_checked: 1 }, { id: 't', keep_checked: 0 }]);
    assert.deepEqual(db.prepare('SELECT name_key, store, category FROM item_memory ORDER BY store').all().results.map((r) => ({ ...r })), [
      { name_key: itemKey('cherry'), store: '', category: 'Fruit' },
      { name_key: itemKey('Cherries'), store: 'Costco', category: 'Produce' },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
