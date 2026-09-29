// Basics: recipes of kind "basic" (seasoning blends, sauces, doughs) that other recipes' ingredient lines link to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { parseRecipeHtml } from '../src/recipe-web.ts';
import type { Env } from '../src/env.ts';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'https://ourfamily.kinwall.test', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown) => app.request(`https://ourfamily.kinwall.test${path}`, { method, headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    const res = await request(path, method, body); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  let rpc = 1;
  const tool = async (name: string, args: unknown): Promise<any> => {
    const res = await app.request('/mcp', { method: 'POST', headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }) }, env);
    const body = await res.json() as any;
    assert.ok(!body.result.isError, JSON.stringify(body.result));
    return body.result.structuredContent;
  };
  return { db, request, json, tool };
}

const seasoning = { name: 'Taco seasoning', kind: 'basic', makes: 'about ¼ cup', ingredients: [{ name: 'Chili powder', quantity: 2, unit: 'tbsp', category: 'Spices' }, { name: 'Cumin', quantity: 1, unit: 'tbsp', category: 'Spices' }] };
const tacos = (basicId: string | null) => ({ name: 'Tuesday Tacos', defaultServings: 4, ingredients: [{ name: 'Ground beef', quantity: 1, unit: 'lb' }, { name: 'Taco seasoning', quantity: 2, unit: 'tbsp', basicId }] });

test('basics: kind defaults to meal, including recipes saved before basics; makes is optional', async () => {
  const { db, json, request } = fixture();
  const plain = await json('/api/recipes', 'POST', { name: 'Toast', ingredients: [{ name: 'Bread' }] });
  assert.equal(plain.kind, 'meal');
  assert.equal(plain.makes, null);
  assert.equal(plain.ingredients[0].basicId, null);
  await db.prepare("INSERT INTO recipes (id, name, default_servings, created_at, updated_at) VALUES ('old', 'Old soup', 4, '2026-01-01', '2026-01-01')").run();
  assert.equal((await json('/api/recipes/old')).kind, 'meal');
  const basic = await json('/api/recipes', 'POST', seasoning);
  assert.equal(basic.kind, 'basic');
  assert.equal(basic.makes, 'about ¼ cup');
  assert.deepEqual((await json('/api/recipes?kind=basic')).map((r: any) => r.name), ['Taco seasoning']);
  assert.deepEqual((await json('/api/recipes?kind=meal')).map((r: any) => r.name), ['Old soup', 'Toast']);
  assert.equal((await json('/api/recipes')).length, 3);
  assert.equal((await request('/api/recipes', 'POST', { name: 'X', kind: 'side' })).status, 400);
  const edited = await json(`/api/recipes/${basic.id}`, 'PATCH', { makes: null });
  assert.equal(edited.makes, null);
  assert.equal(edited.kind, 'basic', 'a patch without kind keeps it');
});

test('basics: an ingredient links to a basic; edits keep the link; bad links are dropped; deleting the basic unlinks', async () => {
  const { json } = fixture();
  const basic = await json('/api/recipes', 'POST', seasoning);
  const meal = await json('/api/recipes', 'POST', tacos(basic.id));
  assert.equal(meal.ingredients[1].basicId, basic.id);
  assert.equal(meal.ingredients[1].basicName, 'Taco seasoning');
  // Replacing the ingredient list without basicId (an older client, an MCP edit) keeps the line's link.
  const kept = await json(`/api/recipes/${meal.id}`, 'PATCH', { ingredients: [{ name: 'Ground beef', quantity: 1, unit: 'lb' }, { name: 'Taco seasoning', quantity: 3, unit: 'tbsp' }] });
  assert.equal(kept.ingredients[1].basicId, basic.id);
  const unlinked = await json(`/api/recipes/${meal.id}`, 'PATCH', { ingredients: [{ name: 'Taco seasoning', quantity: 3, unit: 'tbsp', basicId: null }] });
  assert.equal(unlinked.ingredients[0].basicId, null);
  // Only a basic can be linked, and never the recipe itself.
  const other = await json('/api/recipes', 'POST', { name: 'Rice', ingredients: [] });
  const wrong = await json(`/api/recipes/${meal.id}`, 'PATCH', { ingredients: [{ name: 'Rice', basicId: other.id }, { name: 'Ghost', basicId: 'nope' }] });
  assert.deepEqual(wrong.ingredients.map((i: any) => i.basicId), [null, null]);
  const self = await json(`/api/recipes/${basic.id}`, 'PATCH', { ingredients: [{ name: 'Taco seasoning', basicId: basic.id }] });
  assert.equal(self.ingredients[0].basicId, null);
  // A planned meal's snapshot carries the link too.
  await json(`/api/recipes/${meal.id}`, 'PATCH', { ingredients: tacos(basic.id).ingredients });
  const planned = await json('/api/meals', 'POST', { date: '2026-10-06', slot: 'dinner', recipeId: meal.id });
  assert.equal(planned.recipeSnapshot.ingredients[1].basicId, basic.id);
  // Turning the basic into a meal, or deleting it, unlinks its lines and leaves their text.
  await json(`/api/recipes/${basic.id}`, 'PATCH', { kind: 'meal' });
  assert.equal((await json(`/api/recipes/${meal.id}`)).ingredients[1].basicId, null);
  await json(`/api/recipes/${basic.id}`, 'PATCH', { kind: 'basic' });
  await json(`/api/recipes/${meal.id}`, 'PATCH', { ingredients: tacos(basic.id).ingredients });
  await json(`/api/recipes/${basic.id}`, 'DELETE');
  const after = await json(`/api/recipes/${meal.id}`);
  assert.equal(after.ingredients[1].name, 'Taco seasoning');
  assert.equal(after.ingredients[1].basicId, null);
  assert.equal(after.ingredients[1].basicName, null);
});

test('basics: export and import keep kind, makes and links', async () => {
  const source = fixture();
  const basic = await source.json('/api/recipes', 'POST', seasoning);
  const meal = await source.json('/api/recipes', 'POST', tacos(basic.id));
  const file = await source.json('/api/export');
  const target = fixture();
  await target.json('/api/import', 'POST', file);
  const copy = await target.json(`/api/recipes/${meal.id}`);
  assert.equal(copy.ingredients[1].basicId, basic.id);
  const copiedBasic = await target.json(`/api/recipes/${basic.id}`);
  assert.equal(copiedBasic.kind, 'basic');
  assert.equal(copiedBasic.makes, 'about ¼ cup');
  // A file from before basics imports as meals.
  const old = fixture();
  await old.json('/api/import', 'POST', { ...file, recipes: file.recipes.map(({ kind, makes, ...r }: any) => ({ ...r, ingredients: r.ingredients.map(({ basicId, basicName, ...i }: any) => i) })) });
  assert.deepEqual((await old.json('/api/recipes')).map((r: any) => r.kind), ['meal', 'meal']);
});

test('basics: a share link carries kind, makes and the linked basic by name; import links a same-named basic', async () => {
  const { json, request } = fixture();
  const basic = await json('/api/recipes', 'POST', seasoning);
  const meal = await json('/api/recipes', 'POST', tacos(basic.id));
  const pageOf = async (id: string) => {
    const share = await json(`/api/recipes/${id}/share`, 'POST');
    return { url: share.url, html: await (await request(`/r/${share.token}`)).text() };
  };
  const mealPage = await pageOf(meal.id);
  const data = JSON.parse(/<script type="application\/json" id="kinwall-recipe">([\s\S]*?)<\/script>/.exec(mealPage.html)![1]);
  assert.equal(data.recipe.kind, 'meal');
  assert.equal(data.recipe.ingredients[1].basic, 'Taco seasoning');
  assert.ok(!mealPage.html.includes(basic.id), 'no ids');
  const preview = parseRecipeHtml(mealPage.html, mealPage.url)!;
  assert.equal(preview.ingredients[1].basic, 'Taco seasoning');

  const importInto = async (f: ReturnType<typeof fixture>, page: { url: string; html: string }) => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(page.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })) as typeof fetch;
    try { return await f.json(`/api/recipes/${(await f.json('/api/recipes/import-url', 'POST', { url: page.url, save: true })).recipeId}`); }
    finally { globalThis.fetch = realFetch; }
  };
  // A family without that basic gets the line as text; one with it (any case) gets it linked.
  const without = await importInto(fixture(), mealPage);
  assert.equal(without.ingredients[1].basicId, null);
  const other = fixture();
  const theirs = await other.json('/api/recipes', 'POST', { ...seasoning, name: 'TACO SEASONING' });
  const linked = await importInto(other, mealPage);
  assert.equal(linked.ingredients[1].basicId, theirs.id);
  // A shared basic arrives as a basic, with how much it makes.
  const basicCopy = await importInto(fixture(), await pageOf(basic.id));
  assert.equal(basicCopy.kind, 'basic');
  assert.equal(basicCopy.makes, 'about ¼ cup');
});

test('basics: MCP recipe tools take and return kind, makes and basicId', async () => {
  const { tool } = fixture();
  const { recipe: basic } = await tool('create_recipe', { name: 'Pizza dough', kind: 'basic', makes: '2 crusts', ingredients: [{ name: 'Flour', quantity: 3, unit: 'cup' }] });
  assert.equal(basic.kind, 'basic');
  const { recipe: pizza } = await tool('create_recipe', { name: 'Pizza', ingredients: [{ name: 'Pizza dough', quantity: 1, basicId: basic.id }] });
  assert.equal((await tool('get_recipe', { id: pizza.id })).recipe.ingredients[0].basicName, 'Pizza dough');
  assert.deepEqual((await tool('list_recipes', { kind: 'basic' })).recipes.map((r: any) => r.name), ['Pizza dough']);
  const { recipe: edited } = await tool('update_recipe', { id: basic.id, makes: '3 crusts' });
  assert.equal(edited.makes, '3 crusts');
});

// ---- Part 2: groceries and import matching ----

const week = 'from=2026-10-05&to=2026-10-11';
async function plannedTacos() {
  const f = fixture();
  const basic = await f.json('/api/recipes', 'POST', seasoning);
  const meal = await f.json('/api/recipes', 'POST', { ...tacos(basic.id), ingredients: [...tacos(basic.id).ingredients, { name: 'Cumin', quantity: 1, unit: 'tbsp' }] });
  const bowls = await f.json('/api/recipes', 'POST', { name: 'Burrito bowls', defaultServings: 4, ingredients: [{ name: 'Rice', quantity: 1, unit: 'cup' }, { name: 'Taco seasoning blend', quantity: 1, unit: 'tbsp', basicId: basic.id }] });
  await f.json('/api/meals', 'POST', { date: '2026-10-06', slot: 'dinner', recipeId: meal.id, servings: 8 });
  await f.json('/api/meals', 'POST', { date: '2026-10-08', slot: 'dinner', recipeId: bowls.id });
  const list = await f.json('/api/lists', 'POST', { name: 'Groceries', kind: 'shopping' });
  const items = async () => (await f.json(`/api/lists/${list.id}`)).items.map((i: any) => ({ title: i.title, quantity: i.quantity, notes: i.notes, category: i.category }))
    .sort((a: any, b: any) => a.title.localeCompare(b.title));
  return { ...f, basic, list, items };
}

test('basics groceries: the preview marks lines made from a basic', async () => {
  const { json, basic, list } = await plannedTacos();
  const { items } = await json(`/api/meals/projection?${week}&listId=${list.id}`);
  const linked = items.filter((i: any) => i.basicId);
  assert.deepEqual(linked.map((i: any) => [i.name, i.basicId, i.basicName]), [['Taco seasoning', basic.id, 'Taco seasoning'], ['Taco seasoning blend', basic.id, 'Taco seasoning']]);
  assert.equal(items.find((i: any) => i.name === 'Cumin').basicId, null);
});

test('basics groceries: made already skips the basic; its ingredients are never added', async () => {
  const { json, basic, list, items } = await plannedTacos();
  const result = await json('/api/meals/projection/apply', 'POST', { from: '2026-10-05', to: '2026-10-11', listId: list.id, basics: { [basic.id]: 'made' } });
  assert.deepEqual((await items()).map((i: any) => i.title), ['Cumin', 'Ground beef', 'Rice']);
  assert.equal(result.added, 3);
});

test('basics groceries: add its ingredients adds them once, as written, with the basic in the note and their category', async () => {
  const { json, basic, list, items } = await plannedTacos();
  await json('/api/meals/projection/apply', 'POST', { from: '2026-10-05', to: '2026-10-11', listId: list.id, basics: { [basic.id]: 'ingredients' } });
  const added = await items();
  assert.deepEqual(added.map((i: any) => i.title), ['Chili powder', 'Cumin', 'Ground beef', 'Rice']);
  // Two meals use the basic: one batch. Chili powder as written (not scaled for 8 servings); the tacos' own cumin
  // (2 tbsp for 8) adds up with the basic's 1 tbsp.
  const chili = added.find((i: any) => i.title === 'Chili powder');
  assert.equal(chili.quantity, '2 tbsp');
  assert.equal(chili.category, 'Spices');
  assert.match(chili.notes, /Taco seasoning/);
  assert.equal(added.find((i: any) => i.title === 'Cumin').quantity, '3 tbsp');
  // Again, with or without an answer: nothing is added twice, and the basic's lines count as done.
  for (const basics of [{ [basic.id]: 'ingredients' }, {}, { [basic.id]: 'made' }]) {
    const again = await json('/api/meals/projection/apply', 'POST', { from: '2026-10-05', to: '2026-10-11', listId: list.id, basics });
    assert.equal(again.added, 0, JSON.stringify(basics));
  }
  const { items: preview } = await json(`/api/meals/projection?${week}&listId=${list.id}`);
  assert.ok(preview.filter((i: any) => i.basicId).every((i: any) => i.applied));
  assert.equal((await items()).length, 4);
});

test('basics groceries: without an answer (older clients) the line is added as it is', async () => {
  const { json, list, items } = await plannedTacos();
  await json('/api/meals/projection/apply', 'POST', { from: '2026-10-05', to: '2026-10-11', listId: list.id });
  assert.deepEqual((await items()).map((i: any) => i.title), ['Cumin', 'Ground beef', 'Rice', 'Taco seasoning', 'Taco seasoning blend']);
});

const kit = (ingredients: unknown[], externalId = 'hf-1') => ({ source: 'hellofresh', externalId, name: 'Southwest Chicken Tacos', servings: 2, ingredients });
test('basics import: an imported ingredient whose name matches a basic links to it', async () => {
  const { json } = fixture();
  const basic = await json('/api/recipes', 'POST', seasoning);
  const southwest = await json('/api/recipes', 'POST', { name: 'Southwest spice', kind: 'basic', ingredients: [] });
  await json('/api/recipes', 'POST', { name: 'Ranch', kind: 'basic', ingredients: [] });
  await json('/api/recipes', 'POST', { name: 'Ranch mix', kind: 'basic', ingredients: [] });
  const archived = await json('/api/recipes', 'POST', { name: 'Pesto', kind: 'basic', archived: true, ingredients: [] });
  await json('/api/recipes', 'POST', { name: 'Salsa', ingredients: [] }); // a meal, not a basic
  const { recipeId } = await json('/api/recipes/import', 'POST', kit([
    '1 tablespoon Taco Seasoning Blend', { text: '1 unit Southwest-Spice Mix', pantry: false }, '2 unit Taco Shells', '1 tablespoon Ranch', '1 ounce Pesto', '½ cup Salsa',
  ]));
  let recipe = await json(`/api/recipes/${recipeId}`);
  assert.deepEqual(recipe.ingredients.map((i: any) => [i.name, i.basicId]), [
    ['Taco Seasoning Blend', basic.id], ['Southwest-Spice Mix', southwest.id], ['Taco Shells', null], ['Ranch', null], ['Pesto', null], ['Salsa', null],
  ]);
  assert.equal(archived.archived, true);
  // Reimporting keeps links, including one made by hand that the name doesn't match.
  const shells = await json('/api/recipes', 'POST', { name: 'Taco shells from scratch', kind: 'basic', ingredients: [] });
  await json(`/api/recipes/${recipeId}`, 'PATCH', { ingredients: recipe.ingredients.map((i: any) => (i.name === 'Taco Shells' ? { name: i.name, quantity: i.quantity, basicId: shells.id } : { name: i.name, quantity: i.quantity, unit: i.unit, qualifier: i.qualifier })) });
  await json('/api/recipes/import', 'POST', kit(['1 tablespoon Taco Seasoning Blend', { text: '1 unit Southwest-Spice Mix', pantry: false }, '2 unit Taco Shells']));
  recipe = await json(`/api/recipes/${recipeId}`);
  assert.deepEqual(recipe.ingredients.map((i: any) => i.basicId), [basic.id, southwest.id, shells.id]);
});

test('basics import: link to recipes that use it links unlinked matching lines once, never the basic itself', async () => {
  const { json, request } = fixture();
  const tacosNow = await json('/api/recipes', 'POST', tacos(null));
  const bowls = await json('/api/recipes', 'POST', { name: 'Burrito bowls', ingredients: [{ name: 'Taco seasoning blend', quantity: 1 }, { name: 'Taco', quantity: 1 }] });
  const other = await json('/api/recipes', 'POST', { name: 'Other taco seasoning', kind: 'basic', ingredients: [] });
  const chili = await json('/api/recipes', 'POST', { name: 'Chili', ingredients: [{ name: 'Taco seasoning', basicId: other.id }] });
  const basic = await json('/api/recipes', 'POST', { ...seasoning, ingredients: [{ name: 'Taco seasoning', quantity: 1 }] });
  assert.deepEqual(await json(`/api/recipes/${basic.id}/link-uses`, 'POST'), { linked: 2 });
  assert.equal((await json(`/api/recipes/${tacosNow.id}`)).ingredients[1].basicId, basic.id);
  assert.deepEqual((await json(`/api/recipes/${bowls.id}`)).ingredients.map((i: any) => i.basicId), [basic.id, null]);
  assert.equal((await json(`/api/recipes/${chili.id}`)).ingredients[0].basicId, other.id, 'an existing link stays');
  assert.equal((await json(`/api/recipes/${basic.id}`)).ingredients[0].basicId, null, 'not itself');
  assert.deepEqual(await json(`/api/recipes/${basic.id}/link-uses`, 'POST'), { linked: 0 });
  assert.equal((await request(`/api/recipes/${tacosNow.id}/link-uses`, 'POST')).status, 400, 'only a basic');
  assert.equal((await request('/api/recipes/nope/link-uses', 'POST')).status, 404);
});

test('basics groceries: MCP apply_meal_projection takes the answers', async () => {
  const { tool, basic, list, items } = await plannedTacos();
  const result = await tool('apply_meal_projection', { from: '2026-10-05', to: '2026-10-11', listId: list.id, basics: { [basic.id]: 'made' } });
  assert.equal(result.added, 3);
  assert.ok(!(await items()).some((i: any) => i.title.startsWith('Taco seasoning')));
});
