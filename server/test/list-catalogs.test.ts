// Groceries and Shopping: shopping lists come in two types (catalog 'groceries' | 'shopping'), each
// with its own catalog of remembered names, places and categories (migration 0076).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { looksLikeGroceries } from '../src/item-memory.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (method: string, p: string, body?: unknown) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
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
  return { db, raw, send, tool };
}

/** A Groceries list with milk and a Shopping list with a hammer, each bought at its own store. */
async function twoLists() {
  const t = makeApp();
  const groceries = await t.send('POST', '/api/lists', { name: 'Food', kind: 'shopping', catalog: 'groceries' });
  const hardware = await t.send('POST', '/api/lists', { name: 'Hardware store', kind: 'shopping', catalog: 'shopping' });
  await t.send('POST', `/api/lists/${groceries.id}/items`, { title: 'Milk', store: 'Market', aisle: 'Aisle 4', category: 'Dairy' });
  await t.send('POST', `/api/lists/${hardware.id}/items`, { title: 'Hammer', store: 'Home Center', aisle: 'Aisle 12', category: 'Tools' });
  return { ...t, groceries, hardware };
}

test('list types: a shopping list is Groceries or Shopping; the default follows the name', async () => {
  const { send } = makeApp();
  assert.equal((await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).catalog, 'groceries');
  // Not named like groceries: Shopping once the family has a Groceries list (the first one is Groceries).
  assert.equal((await send('POST', '/api/lists', { name: 'Department store', kind: 'shopping' })).catalog, 'shopping');
  assert.equal((await send('POST', '/api/lists', { name: 'Department store', kind: 'shopping', catalog: 'groceries' })).catalog, 'groceries');
  const todo = await send('POST', '/api/lists', { name: 'Groceries to plan', kind: 'todo', catalog: 'shopping' });
  assert.equal(todo.catalog, null);
  // Switching to a shopping list takes a type; changing the type keeps shopping behavior.
  const moved = await send('PATCH', `/api/lists/${todo.id}`, { kind: 'shopping' });
  assert.deepEqual([moved.kind, moved.catalog, moved.keepChecked], ['shopping', 'groceries', true]);
  const retyped = await send('PATCH', `/api/lists/${todo.id}`, { catalog: 'shopping' });
  assert.deepEqual([retyped.kind, retyped.catalog], ['shopping', 'shopping']);
  assert.equal((await send('PATCH', `/api/lists/${todo.id}`, { kind: 'todo' })).catalog, null);
  assert.ok(looksLikeGroceries(' Supermarket ') && looksLikeGroceries('Weekly grocery run') && looksLikeGroceries('Farmers market') && !looksLikeGroceries('Hardware store'));
});

test('list types: the first shopping list is Groceries, whatever its name', async () => {
  const { send } = makeApp();
  assert.equal((await send('POST', '/api/lists', { name: 'Shopping', kind: 'shopping' })).catalog, 'groceries');
  assert.equal((await send('POST', '/api/lists', { name: 'Warehouse club', kind: 'shopping' })).catalog, 'shopping');
});

test('catalogs: autocomplete, fill-from-memory and suggestions stay within the list type', async () => {
  const { send, groceries, hardware } = await twoLists();
  const g = await send('GET', `/api/lists/${groceries.id}`);
  const h = await send('GET', `/api/lists/${hardware.id}`);
  assert.deepEqual(g.suggestions.items.map((s: any) => s.title), ['Milk']);
  assert.deepEqual(h.suggestions.items.map((s: any) => s.title), ['Hammer']);
  assert.deepEqual([g.suggestions.stores, g.suggestions.categories], [['Market'], ['Dairy']]);
  assert.deepEqual([h.suggestions.stores, h.suggestions.categories], [['Home Center'], ['Tools']]);
  // A hammer on the grocery list isn't filled in from the hardware catalog (and vice versa).
  const [hammer] = await send('POST', `/api/lists/${groceries.id}/items`, { title: 'hammer' });
  assert.deepEqual([hammer.store, hammer.aisle, hammer.category], [null, null, null]);
  const [milk] = await send('POST', `/api/lists/${hardware.id}/items`, { title: 'milk' });
  assert.equal(milk.store, null);
  // ...but it is on the same type.
  const [again] = await send('POST', `/api/lists/${hardware.id}/items`, { title: 'hammers' });
  assert.deepEqual([again.store, again.aisle, again.category], ['Home Center', 'Aisle 12', 'Tools']);
});

test('catalogs: recipe ingredients are suggested on Groceries only', async () => {
  const { send, groceries, hardware } = await twoLists();
  const recipe = await send('POST', '/api/recipes', { name: 'Pancakes', ingredients: [{ name: 'Flour', quantity: 2, unit: 'cup' }] });
  assert.ok(recipe.id);
  assert.ok((await send('GET', `/api/lists/${groceries.id}`)).suggestions.items.some((s: any) => s.title === 'Flour'));
  assert.ok(!(await send('GET', `/api/lists/${hardware.id}`)).suggestions.items.some((s: any) => s.title === 'Flour'));
});

test('catalog API: ?catalog picks the catalog (default groceries) for reads, edits, tags and forgetting', async () => {
  const { send, raw } = await twoLists();
  assert.deepEqual((await send('GET', '/api/lists/remembered')).map((i: any) => i.title), ['Milk']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?catalog=shopping')).map((i: any) => i.title), ['Hammer']);
  assert.equal((await raw('GET', '/api/lists/remembered?catalog=other')).status, 400);
  // The same name can live in both catalogs, each with its own place and categories.
  assert.equal((await raw('POST', '/api/lists/remembered?catalog=shopping', { title: 'Milk', tags: ['Garage fridge'] })).status, 201);
  assert.equal((await raw('POST', '/api/lists/remembered?catalog=shopping', { title: 'Milk' })).status, 409);
  const edited = await send('PUT', '/api/lists/remembered/hammer?catalog=shopping', { tags: ['Tools'], places: [{ store: 'Home Center', aisle: 'Aisle 14' }] });
  assert.deepEqual([edited.tags, edited.places.map((p: any) => p.aisle)], [['Tools'], ['Aisle 14']]);
  assert.equal((await raw('PUT', '/api/lists/remembered/hammer', { tags: ['Tools'] })).status, 404); // not a grocery
  await send('PUT', '/api/lists/remembered/milk', { tags: ['Breakfast'] });
  assert.equal((await send('PATCH', '/api/lists/remembered-tags?catalog=shopping', { from: 'Breakfast', to: 'Morning' })).updated, 0);
  assert.equal((await send('PATCH', '/api/lists/remembered-tags', { from: 'Breakfast', to: 'Morning' })).updated, 1);
  const shop = await send('GET', '/api/lists/remembered?catalog=shopping');
  assert.deepEqual(shop.map((i: any) => [i.title, i.tags]), [['Hammer', ['Tools']], ['Milk', ['Garage fridge']]]);
  await send('DELETE', '/api/lists/remembered/milk?catalog=shopping');
  assert.deepEqual((await send('GET', '/api/lists/remembered?catalog=shopping')).map((i: any) => i.title), ['Hammer']);
  assert.deepEqual((await send('GET', '/api/lists/remembered')).map((i: any) => [i.title, i.tags]), [['Milk', ['Morning']]]);
});

test('catalogs: renaming a department changes it in one catalog; stores and aisles are shared', async () => {
  const { send, groceries, hardware } = await twoLists();
  await send('POST', `/api/lists/${hardware.id}/items`, { title: 'Milk crate', store: 'Home Center', category: 'Dairy' });
  assert.equal((await send('POST', '/api/lists/values', { field: 'category', from: 'Dairy', to: 'Cold', catalog: 'groceries' })).updated, 1);
  assert.deepEqual((await send('GET', `/api/lists/${groceries.id}`)).suggestions.categories, ['Cold']);
  assert.deepEqual((await send('GET', `/api/lists/${hardware.id}`)).suggestions.categories, ['Dairy', 'Tools']);
  await send('POST', '/api/lists/values', { field: 'store', from: 'Market', to: 'Main St Market' });
  assert.equal((await send('GET', '/api/lists/remembered')).find((i: any) => i.title === 'Milk').lastStore, 'Main St Market');
});

test('shopping behavior applies to both types: keep checked, trip view and checkout memory', async () => {
  const { send, hardware } = await twoLists();
  assert.deepEqual([hardware.keepChecked, hardware.groupBy, hardware.sortBy], [true, 'aisle', 'aisle']);
  const [nails] = await send('POST', `/api/lists/${hardware.id}/items`, { title: 'Nails' });
  const trip = (await send('GET', `/api/lists/${hardware.id}?store=Home%20Center`)).trip;
  assert.deepEqual(trip.items.map((i: any) => [i.title, i.section]), [['Hammer', 'aisle'], ['Nails', 'unknown']]);
  await send('PATCH', `/api/lists/${hardware.id}/items/${nails.id}`, { done: true });
  await send('POST', `/api/lists/${hardware.id}/clear-completed`, { store: 'Home Center' });
  const shop = await send('GET', '/api/lists/remembered?catalog=shopping');
  assert.deepEqual(shop.find((i: any) => i.title === 'Nails').lastStore, 'Home Center');
  assert.ok(!(await send('GET', '/api/lists/remembered')).some((i: any) => i.key === 'nail'));
});

test('meals add ingredients to Groceries lists only', async () => {
  const { raw, groceries, hardware } = await twoLists();
  const range = 'from=2026-10-05&to=2026-10-11';
  assert.equal((await raw('GET', `/api/meals/projection?${range}&listId=${groceries.id}`)).status, 200);
  assert.equal((await raw('GET', `/api/meals/projection?${range}&listId=${hardware.id}`)).status, 400);
  assert.equal((await raw('POST', '/api/meals/projection/apply', { from: '2026-10-05', to: '2026-10-11', listId: hardware.id })).status, 400);
});

test('MCP: create_list takes groceries as a type; catalog tools take a catalog (default groceries)', async () => {
  const { tool, send } = await twoLists();
  const created = await tool('create_list', { name: 'Warehouse club', kind: 'groceries' });
  assert.deepEqual([created.structuredContent.list.kind, created.structuredContent.list.catalog], ['shopping', 'groceries']);
  const retyped = await tool('update_list', { list: 'Warehouse club', kind: 'shopping' });
  assert.equal(retyped.structuredContent.list.catalog, 'shopping');
  const lists = (await tool('list_lists', {})).structuredContent.lists;
  assert.deepEqual(lists.map((l: any) => [l.name, l.catalog]), [['Food', 'groceries'], ['Hardware store', 'shopping'], ['Warehouse club', 'shopping']]);
  assert.deepEqual((await tool('list_remembered_items', {})).structuredContent.items.map((i: any) => i.title), ['Milk']);
  assert.deepEqual((await tool('list_remembered_items', { catalog: 'shopping' })).structuredContent.items.map((i: any) => i.title), ['Hammer']);
  const saved = await tool('update_remembered_item', { name: 'Hammer', catalog: 'shopping', tags: ['Tools'] });
  assert.ok(!saved.isError, JSON.stringify(saved));
  assert.ok((await tool('update_remembered_item', { name: 'Hammer', tags: ['Tools'] })).isError); // not in the grocery catalog
  assert.deepEqual((await send('GET', '/api/lists/remembered?catalog=shopping'))[0].tags, ['Tools']);
});

test('export/import: list types and catalogs round-trip; an older file gets the name rule', async () => {
  const source = await twoLists();
  await source.send('PUT', '/api/lists/remembered/hammer?catalog=shopping', { tags: ['Tools'] });
  const file = await source.send('GET', '/api/export');
  assert.deepEqual(file.lists.map((l: any) => [l.name, l.catalog]), [['Food', 'groceries'], ['Hardware store', 'shopping']]);
  assert.deepEqual(file.itemNames.map((n: any) => [n.catalog, n.nameKey]), [['groceries', 'milk'], ['shopping', 'hammer']]);

  const target = makeApp();
  assert.equal((await target.raw('POST', '/api/import', file)).status, 200);
  assert.deepEqual((await target.send('GET', '/api/lists')).map((l: any) => l.catalog), ['groceries', 'shopping']);
  assert.deepEqual((await target.send('GET', '/api/lists/remembered?catalog=shopping')).map((i: any) => [i.title, i.tags]), [['Hammer', ['Tools']]]);

  // Before list types: no catalog anywhere. "Food" is groceries by name, the hardware list stays
  // Shopping, and a name only on it goes to the shopping catalog.
  const old = structuredClone(file);
  for (const l of old.lists) delete l.catalog;
  for (const section of ['itemNames', 'itemMemory', 'itemTags']) for (const r of old[section]) delete r.catalog;
  const legacy = makeApp();
  assert.equal((await legacy.raw('POST', '/api/import', old)).status, 200);
  assert.deepEqual((await legacy.send('GET', '/api/lists')).map((l: any) => [l.name, l.catalog]), [['Food', 'groceries'], ['Hardware store', 'shopping']]);
  assert.deepEqual((await legacy.send('GET', '/api/lists/remembered')).map((i: any) => i.title), ['Milk']);
  assert.deepEqual((await legacy.send('GET', '/api/lists/remembered?catalog=shopping')).map((i: any) => [i.title, i.tags]), [['Hammer', ['Tools']]]);
});

function beforeTypes() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'kw-mig-'));
  for (const f of readdirSync(MIGRATIONS_DIR)) if (f < '0076') cpSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  const db = openDb(':memory:');
  applyMigrations(db, dir);
  rmSync(dir, { recursive: true, force: true });
  return db;
}

test('migration 0076: grocery-named lists become Groceries; names only on other shopping lists go to Shopping', () => {
  const db = beforeTypes();
  const now = '2026-01-01T00:00:00.000Z';
  const lists = [['g', 'Groceries', 'shopping'], ['s', 'Supermarket', 'shopping'], ['h', 'Hardware store', 'shopping'], ['t', 'Department store', 'shopping'], ['m', 'Weekly', 'shopping'], ['d', 'Food to try', 'todo']];
  for (const [id, name, kind] of lists) db.prepare('INSERT INTO lists (id, name, kind, created_at) VALUES (?, ?, ?, ?)').bind(id, name, kind, now).run();
  const items = [['1', 'g', 'Milk', 'milk'], ['2', 'h', 'Hammer', 'hammer'], ['3', 'h', 'Batteries', 'batteri'], ['4', 's', 'Battery', 'batteri'], ['5', 't', 'Socks', 'sock']];
  for (const [id, list, title, key] of items) db.prepare('INSERT INTO list_items (id, list_id, title, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, list, title, key, now, now).run();
  db.prepare("INSERT INTO meal_shopping_sources (list_id, source_ref, item_id, fingerprint) VALUES ('m', 'meal-plan:x:ingredient:y', '1', 'f')").run();
  for (const key of ['milk', 'hammer', 'batteri', 'sock', 'bread']) {
    db.prepare("INSERT INTO item_names (name_key, title, uses, last_used) VALUES (?, ?, 1, '2026-01-01')").bind(key, key).run();
    db.prepare("INSERT INTO item_memory (name_key, store, category, updated_at) VALUES (?, 'Store', 'Dept', '2026-01-01')").bind(key).run();
    db.prepare("INSERT INTO item_tags (name_key, tag) VALUES (?, 'Tag')").bind(key).run();
  }
  applyMigrations(db, MIGRATIONS_DIR);
  const catalogs = db.prepare('SELECT id, catalog FROM lists ORDER BY id').all<{ id: string; catalog: string | null }>().results;
  assert.deepEqual(Object.fromEntries(catalogs.map((r) => [r.id, r.catalog])), { d: null, g: 'groceries', h: 'shopping', m: 'groceries', s: 'groceries', t: 'shopping' });
  for (const table of ['item_names', 'item_memory', 'item_tags']) {
    const rows = db.prepare(`SELECT catalog || ':' || name_key AS k FROM ${table} ORDER BY catalog, name_key`).all<{ k: string }>().results.map((r) => r.k);
    // batteries: on a grocery and a hardware list, so both; bread: checked out, so groceries.
    assert.deepEqual(rows, ['groceries:batteri', 'groceries:bread', 'groceries:milk', 'shopping:batteri', 'shopping:hammer', 'shopping:sock'], table);
  }
});

test('migration 0076: a family with one shopping list keeps it as Groceries, whatever its name', () => {
  const db = beforeTypes();
  db.prepare("INSERT INTO lists (id, name, kind, created_at) VALUES ('only', 'Shopping', 'shopping', '2026-01-01')").run();
  applyMigrations(db, MIGRATIONS_DIR);
  assert.equal(db.prepare("SELECT catalog FROM lists WHERE id = 'only'").first<{ catalog: string }>()!.catalog, 'groceries');
});

test('combined trip: a trip at a store also walks the other type\'s items for that store', async () => {
  const { send, groceries, hardware } = await twoLists();
  await send('POST', `/api/lists/${groceries.id}/items`, [{ title: 'Bread', store: 'Supercenter', aisle: 'Aisle 4' }]);
  await send('POST', '/api/lists/remembered?catalog=shopping', { title: 'Tape', places: [{ store: 'Supercenter', aisle: 'Aisle 9' }] });
  const [batteries] = await send('POST', `/api/lists/${hardware.id}/items`, [{ title: 'Batteries', store: 'Supercenter', aisle: 'Aisle 2' }, { title: 'Tape', store: null }, { title: 'Glue', store: null }]);

  const trip = await send('GET', `/api/lists/${groceries.id}?store=Supercenter`);
  // Planned for Supercenter, or found there before (Tape); Glue (anywhere, never seen there) and the Home Center hammer stay off.
  assert.deepEqual(trip.alsoAtStore.map((i: any) => [i.title, i.listId, i.listName, i.places]), [
    ['Batteries', hardware.id, 'Hardware store', [{ store: 'Supercenter', aisle: 'Aisle 2' }]],
    ['Tape', hardware.id, 'Hardware store', [{ store: 'Supercenter', aisle: 'Aisle 9' }]],
  ]);
  assert.deepEqual(trip.trip.items.map((i: any) => [i.title, i.aisle, i.section, i.listName ?? null]), [
    ['Batteries', 'Aisle 2', 'aisle', 'Hardware store'],
    ['Bread', 'Aisle 4', 'aisle', null],
    ['Tape', 'Aisle 9', 'aisle', 'Hardware store'],
    ['Milk', 'Aisle 4', 'other', null],
  ]);
  assert.equal(trip.items.length, 2); // the list's own items are unchanged
  assert.equal((await send('GET', `/api/lists/${groceries.id}`)).alsoAtStore, undefined);
  assert.deepEqual((await send('GET', `/api/lists/${groceries.id}?store=Market`)).alsoAtStore, []);
  // The other way round too.
  assert.deepEqual((await send('GET', `/api/lists/${hardware.id}?store=Supercenter`)).alsoAtStore.map((i: any) => i.title), ['Bread']);

  // Checkout at the end of the trip: each list's ticked items go, remembered at Supercenter in their own catalog.
  const bread = trip.items.find((i: any) => i.title === 'Bread');
  await send('PATCH', `/api/lists/${groceries.id}/items/${bread.id}`, { done: true });
  await send('PATCH', `/api/lists/${hardware.id}/items/${batteries.id}`, { done: true });
  await send('POST', `/api/lists/${groceries.id}/clear-completed`, { itemIds: [bread.id], store: 'Supercenter' });
  await send('POST', `/api/lists/${hardware.id}/clear-completed`, { itemIds: [batteries.id], store: 'Supercenter' });
  assert.deepEqual((await send('GET', `/api/lists/${groceries.id}`)).items.map((i: any) => i.title), ['Milk']);
  assert.deepEqual((await send('GET', `/api/lists/${hardware.id}`)).items.map((i: any) => i.title).sort(), ['Glue', 'Hammer', 'Tape']);
  assert.deepEqual((await send('GET', '/api/lists/remembered?catalog=shopping')).find((i: any) => i.title === 'Batteries').lastStore, 'Supercenter');
});
