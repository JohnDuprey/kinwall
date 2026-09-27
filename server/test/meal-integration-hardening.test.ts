import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import type { Meal, Projection, Recipe } from '../src/meal-schemas.ts';

const ADMIN_KEY = 'fc_test_meal_hardening';
const dates = { from: '2026-10-05', to: '2026-10-11' };
const query = new URLSearchParams(dates).toString();

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const json = async <T = any>(method: string, path: string, body?: unknown, status = 200, key = ADMIN_KEY): Promise<T> => {
    const response = await app.request(path, {
      method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env);
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path}: ${text}`);
    return JSON.parse(text) as T;
  };
  const recipe = (extra = {}) => json<Recipe>('POST', '/api/recipes', {
    name: 'Tacos', defaultServings: 4, ingredients: [{ name: 'Tomatoes', quantity: 2, category: 'Produce' }], ...extra,
  }, 201);
  const meal = (extra = {}) => json<Meal>('POST', '/api/meals', { date: dates.from, slot: 'dinner', title: 'Dinner', ...extra }, 201);
  const list = (extra = {}) => json<{ id: string }>('POST', '/api/lists', { name: 'Groceries', kind: 'shopping', ...extra }, 201);
  const key = async (owner?: string) => {
    const created = await json('POST', '/api/keys', { name: 'Test device', scope: 'display' }, 201);
    if (owner) await json('PATCH', `/api/keys/${created.id}`, { owner });
    return created.key as string;
  };
  let rpcId = 0;
  const mcp = async (method: string, params: unknown, key = ADMIN_KEY) => {
    const response = await app.request('/mcp', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    }, env);
    assert.equal(response.status, 200);
    return await response.json() as any;
  };
  const tool = async <T = any>(name: string, args: unknown, key = ADMIN_KEY): Promise<T> => {
    const body = await mcp('tools/call', { name, arguments: args }, key);
    assert.equal(body.error, undefined, JSON.stringify(body));
    assert.equal(body.result.isError, undefined, JSON.stringify(body.result));
    return body.result.structuredContent as T;
  };
  return { db, json, recipe, meal, list, key, mcp, tool };
}

test('meal hardening: recipe search, category, ingredient replacement, restore and invalid patches', async () => {
  const { json, recipe, db } = fixture();
  const created = await recipe({
    name: '  Tacos  ', description: 'Weeknight supper', preparationNotes: 'Prep ahead',
    instructions: 'Cook and assemble.', sourceUrl: 'https://recipes.example/tacos', ingredients: [
      { name: '  RED   Onion  ', quantity: 1, sort: 8, category: 'Produce' },
      { name: 'Tortillas', quantity: 8, sort: 1, category: 'Bakery' },
    ],
  });
  assert.equal(created.name, 'Tacos');
  assert.deepEqual(created.ingredients.map((i) => [i.normalizedName, i.sort]), [['tortillas', 1], ['red onion', 8]]);
  assert.equal(created.preparationNotes, 'Prep ahead');
  assert.equal(created.sourceUrl, 'https://recipes.example/tacos');
  assert.deepEqual(await json('GET', `/api/recipes/${created.id}`), created);
  await recipe({ name: 'Soup', ingredients: [{ name: 'Water', quantity: 1, unit: 'cup', category: 'Pantry' }] });
  for (const filter of ['search=TAC', 'search=SUPPER', 'category=%20produce%20']) {
    assert.deepEqual((await json<Recipe[]>('GET', `/api/recipes?${filter}`)).map((r) => r.id), [created.id]);
  }
  for (const patch of [
    { name: ' ' }, { defaultServings: 0 }, { defaultServings: -1 }, { sourceUrl: 'file:///etc/passwd' },
    { sourceUrl: 'javascript:alert(1)' }, { ingredients: [{ name: 'Rice', quantity: -1 }] },
    { ingredients: [{ name: '' }] }, { ingredients: [{ name: 'Rice', sort: -1 }] }, { unknown: true },
  ]) {
    await json('PATCH', `/api/recipes/${created.id}`, patch, 400);
    assert.deepEqual(await json('GET', `/api/recipes/${created.id}`), created);
  }
  const edit = await json<Recipe>('PATCH', `/api/recipes/${created.id}`, { description: 'New' });
  assert.deepEqual(edit.ingredients, created.ingredients);
  assert.equal(edit.createdAt, created.createdAt);
  const replaced = await json<Recipe>('PATCH', `/api/recipes/${created.id}`, { ingredients: [{ name: 'Tortillas', quantity: 12 }] });
  assert.equal(replaced.ingredients.length, 1);
  assert.equal(replaced.ingredients[0].id, created.ingredients[0].id);
  assert.equal(replaced.ingredients[0].quantity, 12);
  await json('PATCH', `/api/recipes/${created.id}`, { archived: true });
  assert.deepEqual((await json<Recipe[]>('GET', '/api/recipes')).map((r) => r.name), ['Soup']);
  assert.equal((await json<Recipe[]>('GET', '/api/recipes?archived=true')).length, 2);
  assert.equal((await json<Recipe>('GET', `/api/recipes/${created.id}`)).archived, true);
  await json('PATCH', `/api/recipes/${created.id}`, { archived: false });
  assert.equal((await json<Recipe[]>('GET', '/api/recipes')).length, 2);
  await json('DELETE', `/api/recipes/${created.id}`);
  assert.equal(db.prepare('SELECT count(*) AS n FROM recipe_ingredients WHERE recipe_id = ?').bind(created.id).first('n'), 0);
  for (const method of ['GET', 'PATCH', 'DELETE']) await json(method, `/api/recipes/${created.id}`, method === 'PATCH' ? { name: 'Gone' } : undefined, 404);
});

test('meal hardening: API range boundaries and slot ordering; changing to dining out removes snapshot', async () => {
  const { json, meal, recipe } = fixture();
  const r = await recipe();
  const entries = [];
  for (const slot of ['snack', 'dinner', 'lunch', 'breakfast']) entries.push(await meal({ slot }));
  await meal({ date: '2026-10-04' });
  await meal({ date: '2026-10-12' });
  const boundary = await meal({ date: dates.to, recipeId: r.id, plannedTime: '18:30' });
  const found = await json<Meal[]>('GET', `/api/meals?${query}`);
  assert.deepEqual(found.map((m) => m.slot), ['breakfast', 'lunch', 'dinner', 'snack', 'dinner']);
  assert.equal(found[0].plannedTime, null);
  assert.equal(found.at(-1)!.id, boundary.id);
  const dining = await json<Meal>('PATCH', `/api/meals/${boundary.id}`, { mealKind: 'dining_out', title: 'Pizza place' });
  assert.deepEqual([dining.recipeId, dining.recipeSnapshot, dining.mealKind], [null, null, 'dining_out']);
  assert.deepEqual((await json<Projection>('GET', `/api/meals/projection?${query}`)).items, []);
  await json('DELETE', `/api/meals/${entries[0].id}`);
  await json('GET', `/api/meals/${entries[0].id}`, undefined, 404);
  await json('DELETE', `/api/meals/${entries[0].id}`, undefined, 404);
  await json('PATCH', '/api/meals/missing', { notes: 'x' }, 404);
});

test('meal hardening: projection rejects invalid ranges and missing, archived or nonshopping destinations', async () => {
  const { json, list } = fixture();
  const todo = await list({ kind: 'todo' });
  const archived = await list();
  await json('PATCH', `/api/lists/${archived.id}`, { archived: true });
  for (const listId of ['missing', todo.id, archived.id]) {
    await json('GET', `/api/meals/projection?${query}&listId=${listId}`, undefined, 400);
    await json('POST', '/api/meals/projection/apply', { ...dates, listId }, 400);
  }
  const shopping = await list();
  for (const bad of [{ from: dates.to, to: dates.from }, { from: '2026-01-01', to: '2027-01-03' }, { from: '2026-02-30', to: '2026-03-01' }]) {
    await json('GET', `/api/meals/projection?${new URLSearchParams(bad)}`, undefined, 400);
    await json('POST', '/api/meals/projection/apply', { ...bad, listId: shopping.id }, 400);
  }
  assert.deepEqual((await json('GET', `/api/lists/${shopping.id}`)).items, []);
});

test('meal hardening: display authorization covers every mutation and binds notes/status to the current assignee', async () => {
  const f = fixture();
  const { json, recipe, meal, list } = f;
  const ada = await json('POST', '/api/members', { name: 'Ada', color: '#ff0000' }, 201);
  const ben = await json('POST', '/api/members', { name: 'Ben', color: '#00ff00' }, 201);
  const assigned = await f.key(ada.id);
  const others = [await f.key(ben.id), await f.key('shared'), await f.key()];
  const r = await recipe();
  const m = await meal({ recipeId: r.id, assigneeMemberId: ada.id });
  const unassigned = await meal();
  const shopping = await list();
  for (const key of [assigned, ...others]) {
    for (const path of ['/api/recipes', `/api/recipes/${r.id}`, `/api/meals?${query}`, `/api/meals/${m.id}`]) await json('GET', path, undefined, 200, key);
    await json('GET', `/api/meals/projection?${query}`, undefined, 403, key);
    for (const [method, path, body] of [
      ['POST', '/api/recipes', { name: 'Unauthorized' }], ['PATCH', `/api/recipes/${r.id}`, { archived: true }],
      ['DELETE', `/api/recipes/${r.id}`, undefined], ['POST', '/api/meals', { date: dates.from, slot: 'dinner', title: 'Unauthorized' }],
      ['PATCH', `/api/meals/${m.id}`, { servings: 99 }], ['PATCH', `/api/meals/${m.id}`, { assigneeMemberId: ben.id }],
      ['PATCH', `/api/meals/${m.id}`, { notes: 'Also change plan', date: dates.to }], ['PATCH', `/api/meals/${m.id}`, { refreshRecipe: true }],
      ['DELETE', `/api/meals/${m.id}`, undefined], ['POST', '/api/meals/projection/apply', { ...dates, listId: shopping.id }],
      ['POST', `/api/meals/${m.id}/calendar-link`, { eventId: 'x' }], ['DELETE', `/api/meals/${m.id}/calendar-link`, undefined],
      ['POST', `/api/meals/${m.id}/calendar-event`, {}],
    ] as const) await json(method, path, body, 403, key);
    await json('PATCH', `/api/meals/${unassigned.id}`, { notes: 'Unassigned' }, 403, key);
  }
  for (const key of others) await json('PATCH', `/api/meals/${m.id}`, { notes: 'Not mine', status: 'handled' }, 403, key);
  const updated = await json<Meal>('PATCH', `/api/meals/${m.id}`, { notes: 'Ready', status: 'prepared' }, 200, assigned);
  assert.deepEqual([updated.notes, updated.status, updated.assigneeMemberId], ['Ready', 'prepared', ada.id]);
  await json('PATCH', `/api/meals/${m.id}`, { notes: 'Spoof', owner: ada.id }, 400, others[0]);
  await json('PATCH', `/api/meals/${m.id}`, { assigneeMemberId: ben.id });
  await json('PATCH', `/api/meals/${m.id}`, { notes: 'Previous owner' }, 403, assigned);
  await json('PATCH', `/api/meals/${m.id}`, { notes: 'New owner' }, 200, others[0]);
  for (const path of ['/api/recipes', `/api/meals?${query}`, `/api/meals/projection?${query}`]) await json('GET', path, undefined, 401, '');
  assert.equal((await json<Recipe>('GET', `/api/recipes/${r.id}`)).archived, false);
  assert.equal((await json<Meal>('GET', `/api/meals/${m.id}`)).servings, 4);
});

test('meal hardening: export/import retains archived recipes, original snapshots, assignment and applied notes', async () => {
  const source = fixture();
  const target = fixture();
  const member = await source.json('POST', '/api/members', { name: 'Ada', color: '#ff0000' }, 201);
  const recipe = await source.recipe();
  const meal = await source.meal({ recipeId: recipe.id, assigneeMemberId: member.id, servings: 6, notes: 'Family dinner' });
  const list = await source.list();
  await source.json('POST', '/api/meals/projection/apply', { ...dates, listId: list.id, includeNotes: true });
  await source.json('PATCH', `/api/recipes/${recipe.id}`, { ingredients: [{ name: 'Tomatoes', quantity: 9 }], archived: true });
  const file = await source.json('GET', '/api/export');
  for (let i = 0; i < 2; i++) {
    const imported = await target.json('POST', '/api/import', file);
    assert.deepEqual([imported.imported.recipes, imported.imported.meals, imported.imported.mealShoppingSources], [1, 1, 1]);
    assert.deepEqual(await target.json('GET', `/api/meals/${meal.id}`), meal);
    assert.deepEqual(await target.json('GET', '/api/recipes'), []);
    assert.equal((await target.json('POST', '/api/meals/projection/apply', { ...dates, listId: list.id })).added, 0);
  }
  const restored = await target.json('GET', '/api/export');
  for (const section of ['recipes', 'meals', 'mealShoppingSources']) assert.deepEqual(restored[section], file[section]);
  assert.deepEqual(restored.lists[0].items, file.lists[0].items);
  // An import replaces an ingredient set, including an intentionally empty recipe.
  file.recipes[0].ingredients = [];
  await target.json('POST', '/api/import', file);
  assert.deepEqual((await target.json('GET', `/api/recipes/${recipe.id}`)).ingredients, []);
  assert.deepEqual((await target.json('GET', `/api/meals/${meal.id}`)).recipeSnapshot, meal.recipeSnapshot);
});

test('meal hardening: import drops dangling references and invalid source claims; legacy files keep existing plans', async () => {
  const source = fixture();
  const target = fixture();
  const recipe = await source.recipe();
  const planned = await source.meal({ recipeId: recipe.id });
  const shopping = await source.list();
  await source.json('POST', '/api/meals/projection/apply', { ...dates, listId: shopping.id });
  const file = await source.json('GET', '/api/export');
  file.recipes = [];
  file.meals[0].assigneeMemberId = 'missing-member';
  file.mealShoppingSources.push({ ...file.mealShoppingSources[0], itemId: 'missing-item', sourceRef: 'bad-item' });
  file.mealShoppingSources.push({ ...file.mealShoppingSources[0], listId: 'missing-list', sourceRef: 'bad-list' });
  const imported = await target.json('POST', '/api/import', file);
  assert.equal(imported.imported.mealShoppingSources, 1);
  const restored = await target.json<Meal>('GET', `/api/meals/${planned.id}`);
  assert.deepEqual([restored.recipeId, restored.assigneeMemberId], [null, null]);
  assert.deepEqual(restored.recipeSnapshot, planned.recipeSnapshot);
  const projection = await target.json<Projection>('GET', `/api/meals/projection?${query}&listId=${shopping.id}`);
  assert.equal(projection.items[0].applied, true);
  delete file.recipes; delete file.meals; delete file.mealShoppingSources;
  await target.json('POST', '/api/import', file);
  assert.deepEqual(await target.json('GET', `/api/meals/${planned.id}`), restored);
});

test('meal hardening: invalid imported meal data fails atomically before any settings or recipe writes', async () => {
  const source = fixture();
  const recipe = await source.recipe();
  await source.meal({ recipeId: recipe.id });
  const original = await source.json('GET', '/api/export');
  for (const mutate of [
    (file: any) => { file.meals[0].date = '2026-02-30'; },
    (file: any) => { file.meals[0].recipeSnapshot.defaultServings = 0; },
    (file: any) => { file.recipes[0].ingredients[0].quantity = -1; },
  ]) {
    const target = fixture();
    const before = await target.json('GET', '/api/settings');
    const file = structuredClone(original);
    file.settings.familyName = 'Must not be written';
    mutate(file);
    await target.json('POST', '/api/import', file, 400);
    assert.deepEqual(await target.json('GET', '/api/settings'), before);
    assert.deepEqual(await target.json('GET', '/api/recipes'), []);
    assert.deepEqual(await target.json('GET', `/api/meals?${query}`), []);
  }
});

test('meal hardening: MCP exposes recipe and meal tools and completes assignment, weekly retrieval and projection workflow', async () => {
  const { json, mcp, tool, list, db } = fixture();
  const listing = await mcp('tools/list', {});
  const tools = listing.result.tools;
  for (const name of ['list_recipes', 'get_recipe', 'create_recipe', 'update_recipe', 'list_meals', 'create_meal', 'update_meal', 'get_meal_projection', 'apply_meal_projection']) {
    const matches = tools.filter((t: any) => t.name === name);
    assert.equal(matches.length, 1, name);
    assert.ok(matches[0].outputSchema, name);
    assert.equal(matches[0].annotations.readOnlyHint, /^(list|get)_/.test(name), name);
  }
  const ada = await json('POST', '/api/members', { name: 'Ada', color: '#ff0000' }, 201);
  const recipe = (await tool<{ recipe: Recipe }>('create_recipe', {
    name: 'MCP tacos', defaultServings: 4,
    ingredients: JSON.stringify([{ name: 'Tomatoes', quantity: 2 }, { name: 'Salt', qualifier: 'to taste' }]),
  })).recipe;
  assert.equal((await tool('get_recipe', { id: recipe.id })).recipe.id, recipe.id);
  assert.deepEqual((await tool('list_recipes', { search: 'MCP' })).recipes.map((r: Recipe) => r.id), [recipe.id]);
  const planned = (await tool<{ meal: Meal }>('create_meal', { date: dates.from, slot: 'dinner', recipeId: recipe.id, servings: 6, member: 'ada' })).meal;
  assert.equal(planned.assigneeMemberId, ada.id);
  assert.equal(planned.calendarEventId, null);
  await tool('create_meal', { date: dates.to, slot: 'lunch', mealKind: 'dining_out' });
  await tool('create_meal', { date: '2026-10-12', slot: 'lunch', mealKind: 'dining_out' });
  const week = await tool<{ meals: Meal[] }>('list_meals', { from: dates.from });
  assert.deepEqual(week.meals.map((m) => m.date), [dates.from, dates.to]);
  assert.equal((await tool('update_meal', { id: planned.id, member: null })).meal.assigneeMemberId, null);
  assert.equal((await tool('update_meal', { id: planned.id, member: 'ADA' })).meal.assigneeMemberId, ada.id);
  const shopping = await list();
  const preview = await tool<Projection>('get_meal_projection', { ...dates, listName: 'groceries' });
  assert.equal(preview.listId, shopping.id);
  assert.equal(preview.items.find((i) => i.name === 'Tomatoes')!.quantity, 3);
  const saltKey = preview.items.find((i) => i.name === 'Salt')!.key;
  const args = { ...dates, listName: 'Groceries', omitKeys: JSON.stringify([saltKey]), includeNotes: true };
  assert.equal((await tool('apply_meal_projection', args)).added, 1);
  assert.equal((await tool('apply_meal_projection', args)).added, 0);
  const items = (await json('GET', `/api/lists/${shopping.id}`)).items;
  assert.equal(items.length, 1);
  assert.equal(items[0].quantity, '3');
  assert.match(items[0].notes, /2026-10-05 · dinner · MCP tacos/);
  await tool('update_recipe', { id: recipe.id, archived: true });
  assert.deepEqual((await tool('list_recipes', {})).recipes, []);
  assert.equal((await tool('list_recipes', { archived: true })).recipes.length, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM events').first('n'), 0);
});

test('meal hardening: MCP preserves REST authorization and rejects invalid ranges without mutation', async () => {
  const f = fixture();
  const ada = await f.json('POST', '/api/members', { name: 'Ada', color: '#ff0000' }, 201);
  const own = await f.key(ada.id);
  const shared = await f.key('shared');
  const recipe = await f.recipe();
  const meal = await f.meal({ recipeId: recipe.id, assigneeMemberId: ada.id });
  const shopping = await f.list();
  for (const [name, args] of [
    ['create_recipe', { name: 'Unauthorized' }], ['update_recipe', { id: recipe.id, archived: true }],
    ['create_meal', { date: dates.from, slot: 'dinner', title: 'Unauthorized' }],
    ['update_meal', { id: meal.id, member: 'Ada' }], ['apply_meal_projection', { ...dates, listId: shopping.id }],
  ] as const) {
    const result = await f.mcp('tools/call', { name, arguments: args }, own);
    assert.equal(result.result.isError, true, name);
    assert.match(result.result.content[0].text, /admin|display key/i, name);
  }
  assert.equal((await f.tool('update_meal', { id: meal.id, notes: 'Ready', status: 'handled' }, own)).meal.status, 'handled');
  assert.equal((await f.mcp('tools/call', { name: 'update_meal', arguments: { id: meal.id, notes: 'No' } }, shared)).result.isError, true);
  assert.equal((await f.tool('get_recipe', { id: recipe.id }, shared)).recipe.id, recipe.id);
  for (const name of ['list_meals', 'get_meal_projection', 'apply_meal_projection']) {
    const result = await f.mcp('tools/call', { name, arguments: { from: dates.to, to: dates.from, ...(name === 'apply_meal_projection' ? { listId: shopping.id } : {}) } });
    assert.equal(result.result.isError, true, name);
  }
  assert.equal((await f.mcp('tools/call', { name: 'create_meal', arguments: { date: dates.from, slot: 'dinner', title: 'Missing owner', member: 'nobody' } })).result.isError, true);
  assert.equal((await f.json<Meal[]>('GET', `/api/meals?${query}`)).length, 1);
  assert.deepEqual((await f.json('GET', `/api/lists/${shopping.id}`)).items, []);
});
