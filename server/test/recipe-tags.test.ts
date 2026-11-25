import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { applyMigrations, openDb } from '../src/d1-sqlite.ts';
import { runMigrations } from '../src/migrate.ts';
import type { Env } from '../src/env.ts';

const migrations = new URL('../migrations/', import.meta.url);
const recipeUrl = '/api/recipes';
const tagUrl = '/api/recipe-tags';
const tacos = { name: 'Tuesday Tacos', ingredients: [{ name: 'Corn tortillas', category: 'Bakery' }] };
const pizza = { name: 'Garden vegetable pizza', ingredients: [{ name: 'Mozzarella', category: 'Dairy' }] };
const oats = { name: 'Apple cinnamon oatmeal' };
const admin = 'test-local-admin';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(migrations));
  const app = createApp();
  const env: Env = { DB: db, ADMIN_API_KEY: admin, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const request = (path: string, method = 'GET', body?: unknown, key = admin) => app.request(path, {
    method,
    headers: { ...(key && { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }, env);
  const json = async (path: string, method = 'GET', body?: unknown) => {
    const response = await request(path, method, body);
    const data = await response.json() as any;
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  const tag = (name: string) => json(tagUrl, 'POST', { name });
  return { db, app, env, request, json, tag };
}

test('recipe tag catalog normalizes names, prevents duplicates, and renames by ID', async () => {
  const { json, request, tag } = fixture();
  assert.deepEqual(await json(tagUrl), []);
  const quick = await tag('  Quick   & Easy  ');
  const dinner = await tag('Dinner');
  assert.equal(quick.name, 'Quick & Easy');
  assert.deepEqual(await json(tagUrl), [dinner, quick]);
  for (const name of ['', '  ', 'x'.repeat(61), 'Meal\u0000Prep']) {
    assert.equal((await request(tagUrl, 'POST', { name })).status, 400);
  }
  const concurrent = await Promise.all(['Meal Prep', 'meal  prep'].map(name => request(tagUrl, 'POST', { name })));
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
  assert.equal((await request(tagUrl, 'POST', { name: 'quick & easy' })).status, 409);
  await tag('Crème fraîche');
  assert.equal((await request(tagUrl, 'POST', { name: 'CRE\u0300ME FRAI\u0302CHE' })).status, 409);
  assert.equal((await request(`${tagUrl}/${quick.id}`, 'PATCH', { name: 'dinner' })).status, 409);
  const renamed = await json(`${tagUrl}/${quick.id}`, 'PATCH', { name: 'Quick & easy' });
  assert.deepEqual(renamed, { id: quick.id, name: 'Quick & easy' });
  assert.equal((await request(`${tagUrl}/${crypto.randomUUID()}`, 'DELETE')).status, 404);
});

test('recipe assignments and AND filters compose with search and existing filters', async () => {
  const { json, request, tag } = fixture();
  const quick = await tag('Quick & Easy');
  const dinner = await tag('Dinner');
  const taco = await json(recipeUrl, 'POST', { ...tacos, tagIds: [quick.id, dinner.id, quick.id] });
  const garden = await json(recipeUrl, 'POST', { ...pizza, tagIds: [dinner.id] });
  const oatmeal = await json(recipeUrl, 'POST', oats);
  const query = `?tagIds=${dinner.id},${quick.id}`;
  assert.deepEqual(taco.tags, [dinner, quick]);
  assert.deepEqual(oatmeal.tags, []);
  assert.deepEqual((await json(`${recipeUrl}?tagIds=${dinner.id}`)).map((r: any) => r.id), [garden.id, taco.id]);
  assert.deepEqual((await json(recipeUrl + query)).map((r: any) => r.id), [taco.id]);
  assert.deepEqual((await json(recipeUrl + query + `,${quick.id}`)).map((r: any) => r.id), [taco.id]);
  assert.deepEqual((await json(recipeUrl + query + '&search=tacos&category=Bakery&kind=meal')).map((r: any) => r.id), [taco.id]);
  assert.deepEqual(await json(recipeUrl + query + '&search=pizza'), []);
  assert.deepEqual(await json(recipeUrl + query + '&category=Dairy'), []);
  assert.deepEqual(await json(recipeUrl + '?tagIds=' + crypto.randomUUID()), []);
  assert.equal((await request(recipeUrl + '?tagIds=invalid')).status, 400);

  assert.equal((await request(`${recipeUrl}/${taco.id}`, 'PATCH', {
    name: pizza.name, ingredients: pizza.ingredients, tagIds: [crypto.randomUUID()],
  })).status, 400);
  const unchanged = await json(`${recipeUrl}/${taco.id}`);
  assert.equal(unchanged.name, tacos.name);
  assert.equal(unchanged.ingredients[0].name, tacos.ingredients[0].name);
  assert.deepEqual(unchanged.tags, [dinner, quick]);

  const edited = await json(`${recipeUrl}/${taco.id}`, 'PATCH', { tagIds: [quick.id] });
  assert.deepEqual(edited.tags, [quick]);
  assert.deepEqual((await json(`${recipeUrl}/${taco.id}`, 'PATCH', { description: 'Family dinner' })).tags, [quick]);
  const renamed = await json(`${tagUrl}/${quick.id}`, 'PATCH', { name: 'Weeknight meals' });
  assert.deepEqual((await json(`${recipeUrl}/${taco.id}`)).tags, [renamed]);
  await json(`${tagUrl}/${quick.id}`, 'DELETE');
  assert.deepEqual((await json(`${recipeUrl}/${taco.id}`)).tags, []);
  assert.deepEqual((await json(`${recipeUrl}/${garden.id}`, 'PATCH', { tagIds: [] })).tags, []);
  await json(`${recipeUrl}/${taco.id}`, 'PATCH', { tagIds: [dinner.id] });
  await json(`${recipeUrl}/${taco.id}`, 'DELETE');
  assert.deepEqual(await json(tagUrl), [dinner]);
});

test('recipe tags follow recipe permissions and household database isolation', async () => {
  const { json, request, tag } = fixture();
  const other = fixture();
  const dinner = await tag('Dinner');
  const taco = await json(recipeUrl, 'POST', { ...tacos, tagIds: [dinner.id] });
  const { key } = await json('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' });
  assert.equal((await request(tagUrl, 'GET', undefined, '')).status, 401);
  assert.deepEqual(await (await request(tagUrl, 'GET', undefined, key)).json(), [dinner]);
  assert.deepEqual((await (await request(`${recipeUrl}/${taco.id}`, 'GET', undefined, key)).json() as any).tags, [dinner]);
  assert.equal((await request(tagUrl, 'POST', { name: 'Breakfast' }, key)).status, 403);
  assert.equal((await request(`${tagUrl}/${dinner.id}`, 'PATCH', { name: 'Breakfast' }, key)).status, 403);
  assert.equal((await request(`${tagUrl}/${dinner.id}`, 'DELETE', undefined, key)).status, 403);
  assert.equal((await request(`${recipeUrl}/${taco.id}`, 'PATCH', { tagIds: [] }, key)).status, 403);
  assert.deepEqual(await other.json(tagUrl), []);
  assert.equal((await other.request(recipeUrl, 'POST', { ...pizza, tagIds: [dinner.id] })).status, 400);
  assert.deepEqual(await other.json(recipeUrl), []);
});

test('tagged recipe reimport and public sharing keep household labels private', async () => {
  const { json, request, tag } = fixture();
  const dinner = await tag('Weeknight meals');
  const input = { source: 'web', externalId: 'our-family-tacos', name: tacos.name, ingredients: ['Corn tortillas'] };
  const { recipeId } = await json(`${recipeUrl}/import`, 'POST', { ...input, tagIds: [dinner.id] });
  assert.deepEqual((await json(`${recipeUrl}/${recipeId}`)).tags, [dinner]);
  assert.equal((await json(`${recipeUrl}/import`, 'POST', input)).recipeId, recipeId);
  assert.deepEqual((await json(`${recipeUrl}/${recipeId}`)).tags, [dinner]);
  const share = await json(`${recipeUrl}/${recipeId}/share`, 'POST');
  const page = await request(`/r/${share.token}`, 'GET', undefined, '');
  assert.equal(page.status, 200);
  assert.doesNotMatch(await page.text(), /Weeknight meals/);
});

test('family export restores used and unused recipe tags and merges by normalized name', async () => {
  const source = fixture();
  const destination = fixture();
  const restored = fixture();
  const dinner = await source.tag('Dinner');
  const unused = await source.tag('Freezer Friendly');
  const taco = await source.json(recipeUrl, 'POST', { ...tacos, tagIds: [dinner.id] });
  const backup = await source.json('/api/export');
  assert.deepEqual(backup.recipeTags, [dinner, unused]);
  await restored.json('/api/import', 'POST', backup);
  assert.deepEqual(await restored.json(tagUrl), [dinner, unused]);
  assert.deepEqual((await restored.json(`${recipeUrl}/${taco.id}`)).tags, [dinner]);

  // An ID with a different local name stays in place. The imported name gets its own ID.
  await restored.json(`${tagUrl}/${dinner.id}`, 'PATCH', { name: 'Weeknight meals' });
  await restored.json('/api/import', 'POST', backup);
  await restored.json('/api/import', 'POST', backup);
  const merged = await restored.json(tagUrl);
  assert.deepEqual(merged.map((tag: any) => tag.name), ['Dinner', 'Freezer Friendly', 'Weeknight meals']);
  assert.notEqual(merged[0].id, dinner.id);
  assert.equal(merged[2].id, dinner.id);
  assert.deepEqual((await restored.json(`${recipeUrl}/${taco.id}`)).tags, [merged[0]]);

  const local = await destination.tag('dinner');
  await destination.json('/api/import', 'POST', backup);
  await destination.json('/api/import', 'POST', backup);
  assert.deepEqual(await destination.json(tagUrl), [local, unused]);
  assert.deepEqual((await destination.json(`${recipeUrl}/${taco.id}`)).tags, [local]);
  delete backup.recipeTags;
  delete backup.recipes[0].tags;
  await destination.json('/api/import', 'POST', backup);
  assert.deepEqual((await destination.json(`${recipeUrl}/${taco.id}`)).tags, [local]);
  backup.recipes[0].tags = [];
  await destination.json('/api/import', 'POST', backup);
  assert.deepEqual((await destination.json(`${recipeUrl}/${taco.id}`)).tags, []);
});

test('Worker migration upgrades a populated pre-tag household without changing its recipes', async () => {
  const db = openDb(':memory:');
  const all = readdirSync(migrations).filter(name => name.endsWith('.sql'))
    .map(name => ({ name, sql: readFileSync(new URL(name, migrations), 'utf8') }));
  await runMigrations(db, all.filter(m => !m.name.endsWith('_recipe_tags.sql')));
  db.prepare("INSERT INTO members(id,name,color,created_at) VALUES('maya','Maya','#123456','2026-11-06')").run();
  db.prepare("INSERT INTO recipes(id,name,default_servings,created_at,updated_at) VALUES('tacos',?,4,'2026-11-06','2026-11-06')").bind(tacos.name).run();
  db.prepare("INSERT INTO recipe_ingredients(id,recipe_id,name,normalized_name) VALUES('tortillas','tacos','Corn tortillas','corn tortillas')").run();
  await runMigrations(db, all);
  await runMigrations(db, all);
  assert.equal(db.prepare("SELECT name FROM recipes WHERE id='tacos'").first<{name: string}>()?.name, tacos.name);
  assert.equal(db.prepare("SELECT name FROM members WHERE id='maya'").first<{name: string}>()?.name, 'Maya');
  assert.equal(db.prepare("SELECT name FROM recipe_ingredients WHERE recipe_id='tacos'").first<{name: string}>()?.name, 'Corn tortillas');
  assert.deepEqual(db.prepare('SELECT * FROM recipe_tags').all().results, []);
  assert.deepEqual(db.prepare('SELECT * FROM recipe_tag_links').all().results, []);
});

test('MCP discovers tags, filters by ID, and uses the recipe write scope', async () => {
  const { app, env, json, tag } = fixture();
  const dinner = await tag('Dinner');
  const wall = await json('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' });
  const tool = async (name: string, args: unknown, key = admin) => {
    const response = await app.request('/mcp', { method: 'POST', headers: {
      Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }, env);
    const data = await response.json() as any;
    return data.result ?? data.error;
  };
  assert.deepEqual((await tool('list_recipe_tags', {}, wall.key)).structuredContent, { tags: [dinner] });
  const saved = await tool('create_recipe', { ...tacos, tagIds: [dinner.id] });
  assert.deepEqual(saved.structuredContent.recipe.tags, [dinner]);
  const listed = await tool('list_recipes', { tagIds: [dinner.id], search: 'tacos' }, wall.key);
  assert.deepEqual(listed.structuredContent.recipes.map((r: any) => r.name), [tacos.name]);
  const denied = await tool('update_recipe', { id: saved.structuredContent.recipe.id, tagIds: [] }, wall.key);
  assert.ok(denied.isError || denied.code);
  assert.deepEqual((await json(`${recipeUrl}/${saved.structuredContent.recipe.id}`)).tags, [dinner]);
});

test('selective tag filtering uses indexed reads and a fixed number of batch trips', async () => {
  const { db, tag, json } = fixture();
  const dinner = await tag('Dinner');
  const quick = await tag('Quick & Easy');
  const taco = await json(recipeUrl, 'POST', { ...tacos, tagIds: [dinner.id, quick.id] });
  await json(recipeUrl, 'POST', { ...pizza, tagIds: [dinner.id] });
  const seed = db.prepare("INSERT INTO recipes(id,name,default_servings,created_at,updated_at) VALUES(?,?,4,'2026-11-06','2026-11-06')");
  for (let n = 0; n < 300; n++) seed.bind(`oats-${n}`, oats.name).run();

  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  let trips = 0;
  const plans: string[] = [];
  db.batch = (statements) => { trips++; return batch(statements); };
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...params: unknown[]) => {
      if (/^(SELECT|WITH)\b/i.test(sql)) plans.push(prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>().results.map(r => r.detail).join('\n'));
      return bind(...params);
    };
    return statement;
  };
  const { readRecipes } = await import('../src/meals.ts');
  assert.deepEqual((await readRecipes(db, { tagIds: [dinner.id, quick.id], includeTags: true })).map(r => r.id), [taco.id]);
  assert.equal(trips, 1);
  assert.ok(plans.some(plan => plan.includes('idx_recipe_tag_links_tag')), plans.join('\n'));
  for (const plan of plans) assert.doesNotMatch(plan, /SCAN (recipes|i|recipe_ratings|recipe_favorites|meals|links)\b/, plan);
  plans.length = 0;
  trips = 0;
  const [recipe] = await readRecipes(db, { id: taco.id, includeTags: true });
  assert.deepEqual(recipe.tags, [dinner, quick]);
  assert.equal(trips, 1);
  assert.ok(plans.some(plan => /SEARCH links USING.*recipe_id/.test(plan)), plans.join('\n'));
  for (const plan of plans) assert.doesNotMatch(plan, /SCAN (recipes|i|recipe_ratings|recipe_favorites|meals|links)\b/, plan);
});

test('simultaneous imports of the same source do not leave recipes or tag links behind', async () => {
  const { request, json, tag } = fixture();
  const dinner = await tag('Dinner');
  const input = { source: 'web', externalId: 'our-family-tacos', name: tacos.name, ingredients: ['Corn tortillas'], tagIds: [dinner.id] };
  const responses = await Promise.all([request(`${recipeUrl}/import`, 'POST', input), request(`${recipeUrl}/import`, 'POST', input)]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  const imported = await Promise.all(responses.map(async response => await response.json() as { recipeId: string }));
  assert.equal(imported[0].recipeId, imported[1].recipeId);
  assert.deepEqual((await json(recipeUrl)).map((recipe: any) => [recipe.id, recipe.tags]), [[imported[0].recipeId, [dinner]]]);
});
