import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { openDb } from '../src/d1-sqlite.ts';
import { runMigrations } from '../src/migrate.ts';
import { kitBalances } from '../src/kit-balances.ts';
import { createApp } from '../src/app.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';

const folder = new URL('../migrations/', import.meta.url);
const migrations = () => readdirSync(folder).filter(n => n.endsWith('.sql')).sort().map(name => ({ name, sql: readFileSync(new URL(name, folder), 'utf8') }));
test('ready balances prefer explicit items, keep leftovers separate, and apply each storage window', () => {
  const items = [
    { id: 'kit', recipe_id: 'r', kind: 'kit', received_on: '2026-11-20', quantity: 2, done: 0 },
    { id: 'prepped', recipe_id: 'r', kind: 'prepped', received_on: '2026-11-21', quantity: 1, done: 0 },
    { id: 'frozen', recipe_id: 'r', kind: 'frozen', received_on: '2026-11-22', quantity: 1, done: 0 },
    { id: 'leftover', recipe_id: null, kind: 'prepped', received_on: '2026-11-20', cook_by: '2026-11-26', quantity: 2, done: 0 },
  ];
  const meals = [
    { date: '2026-11-23', status: 'prepared', recipe_id: 'r', ready_id: 'prepped' },
    { date: '2026-11-23', status: 'prepared', recipe_id: null, ready_id: 'leftover' },
    { date: '2026-11-24', status: 'prepared', recipe_id: 'r' },
    { date: '2026-11-24', status: 'planned', ready_id: 'leftover' },
  ];
  const balance = kitBalances(items, meals);
  assert.deepEqual(balance.map(k => [k.id, k.left, k.cookBy]), [
    ['kit', 1, '2026-11-27'], ['leftover', 1, '2026-11-26'], ['prepped', 0, '2026-11-25'], ['frozen', 1, '2027-02-20'],
  ]);
  assert.equal(kitBalances(items, []).find(k => k.id === 'prepped')?.left, 1);
  assert.equal(kitBalances(items, [
    { date: '2026-11-20', status: 'prepared', recipe_id: 'r' },
    { date: '2026-11-24', status: 'prepared', recipe_id: 'r', ready_id: 'kit' },
    { date: '2026-11-24', status: 'prepared', recipe_id: 'r', ready_id: 'kit' },
  ]).find(k => k.id === 'kit')?.left, 0, 'explicit units are reserved before automatic use');
});

test('hosted ready migration preserves populated kits, recipes, done counts, unique key and planning triggers', async () => {
  const db = openDb(':memory:');
  const all = migrations();
  await runMigrations(db, all.filter(m => m.name < '0162'));
  db.prepare("INSERT INTO recipes(id,name,default_servings,created_at,updated_at) VALUES('r','Tacos',4,'now','now')").run();
  db.prepare("INSERT INTO meal_kits VALUES('k','r','delivery','2026-11-20',3,1,'created','updated')").run();
  const recipes = db.prepare('SELECT * FROM recipes').all().results;
  await runMigrations(db, all);
  await runMigrations(db, all);
  const kit = db.prepare('SELECT * FROM meal_kits').first<any>()!;
  assert.equal(kit.id, 'k'); assert.equal(kit.done, 1); assert.equal(kit.quantity, 3);
  assert.equal(kit.kind, 'kit'); assert.equal(kit.cook_by, null); assert.equal(kit.title, null);
  assert.deepEqual(db.prepare('SELECT * FROM recipes').all().results, recipes);
  assert.throws(() => db.prepare("INSERT INTO meal_kits(id,recipe_id,provider,received_on,created_at,updated_at) VALUES('duplicate','r','delivery','2026-11-20','now','now')").run(), /UNIQUE/);
  const version = () => db.prepare('SELECT version FROM weekly_plan_source').first<{ version: number }>()!.version;
  let before = version();
  db.prepare("UPDATE meal_kits SET quantity = 4 WHERE id = 'k'").run(); assert.equal(version(), before + 1);
  before = version(); db.prepare("DELETE FROM meal_kits WHERE id = 'k'").run(); assert.equal(version(), before + 1);
  before = version(); db.prepare("INSERT INTO meal_kits(id,title,kind,provider,received_on,created_at,updated_at) VALUES('leftover','Lasagna','prepped','','2026-11-20','now','now')").run(); assert.equal(version(), before + 1);
  const columns = db.prepare('PRAGMA table_info(meals)').all<{ name: string }>().results.map(c => c.name);
  assert.ok(columns.includes('ready_id')); assert.ok(columns.includes('prep_on'));
});

test('ready API plans and eats leftovers, edits storage, completes prep once and unlinks on deletion', async () => {
  const db = openDb(':memory:'); await runMigrations(db, migrations());
  const app = createApp();
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const request = (path: string, method = 'GET', body?: unknown, key = 'test-admin') => app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const call = async (path: string, method = 'GET', body?: unknown): Promise<any> => { const res = await request(path, method, body); const data = await res.json(); assert.ok(res.ok, JSON.stringify(data)); return data; };
  const item = await call('/api/meal-kits', 'POST', { kind: 'prepped', title: 'Leftover lasagna', receivedOn: '2026-11-20', quantity: 2 });
  const wall = await createApiKey(db, 'Wall', 'display');
  for (const [path, method, body] of [
    ['/api/meal-kits', 'POST', { kind: 'prepped', title: 'Leftovers', receivedOn: '2026-11-20', quantity: 1 }],
    ['/api/meal-kits/' + item.id, 'PATCH', { quantity: 2 }],
    ['/api/meals/prep', 'POST', { date: '2026-11-20', mealIds: ['fake'] }],
  ] as const) assert.equal((await request(path, method, body, wall.key)).status, 403);
  assert.equal(item.cookBy, '2026-11-24');
  assert.equal((await request('/api/meal-kits', 'POST', { kind: 'prepped', receivedOn: '2026-11-20', quantity: 1 })).status, 400);
  const meal = await call('/api/meals', 'POST', { readyId: item.id, date: '2026-11-21', slot: 'dinner' });
  assert.equal(meal.title, 'Leftover lasagna'); assert.equal(meal.mealKind, 'freeform');
  await call('/api/meals/' + meal.id, 'PATCH', { status: 'prepared' });
  assert.equal((await call('/api/meal-kits'))[0].left, 1);
  await call('/api/meals/' + meal.id, 'PATCH', { status: 'planned' });
  assert.equal((await call('/api/meal-kits'))[0].left, 2);
  await call('/api/meal-kits/' + item.id, 'PATCH', { kind: 'frozen', cookBy: '2027-03-01', title: 'Frozen lasagna' });
  assert.equal((await call('/api/meal-kits'))[0].cookBy, '2027-03-01');
  await call('/api/meal-kits/' + item.id, 'DELETE');
  assert.equal((await call('/api/meals/' + meal.id)).readyId, null);
  const recipe = await call('/api/recipes', 'POST', { name: 'Tacos', ingredients: [] });
  const planned = await call('/api/meals', 'POST', { recipeId: recipe.id, date: '2026-11-24', slot: 'dinner', prepOn: '2026-11-22' });
  assert.equal((await request('/api/meals', 'POST', { recipeId: recipe.id, date: '2026-11-24', slot: 'dinner', prepOn: '2026-11-25' })).status, 400);
  await call('/api/meals/prep', 'POST', { date: '2026-11-22', mealIds: [planned.id] });
  await call('/api/meals/prep', 'POST', { date: '2026-11-22', mealIds: [planned.id] });
  const ready = await call('/api/meal-kits'); assert.equal(ready.length, 1); assert.equal(ready[0].quantity, 1); assert.equal(ready[0].kind, 'prepped'); assert.equal(ready[0].cookBy, '2026-11-24');
  const linked = await call('/api/meals/' + planned.id); assert.equal(linked.readyId, ready[0].id);
  await call('/api/meals/' + planned.id, 'PATCH', { status: 'prepared' }); assert.deepEqual(await call('/api/meal-kits'), []);
  await call('/api/meals/' + planned.id, 'PATCH', { status: 'planned', readyId: ready[0].id });
  const backup = await call('/api/export'); await call('/api/import', 'POST', backup);
  assert.deepEqual((await call('/api/export')).mealKits, backup.mealKits);
  assert.equal((await call('/api/meals/' + planned.id)).readyId, ready[0].id);
  await call('/api/meal-kits/' + ready[0].id, 'DELETE');
  const second = await call('/api/meals', 'POST', { recipeId: recipe.id, date: '2026-11-28', slot: 'lunch', prepOn: '2026-11-22' });
  await Promise.all([
    call('/api/meals/prep', 'POST', { date: '2026-11-22', mealIds: [planned.id, second.id] }),
    call('/api/meals/prep', 'POST', { date: '2026-11-22', mealIds: [planned.id] }),
  ]);
  const batch = await call('/api/meal-kits');
  assert.equal(batch.reduce((sum: number, k: any) => sum + k.quantity, 0), 2);
  assert.ok(batch.every((k: any) => k.cookBy <= '2026-11-26'));
  await call('/api/meal-kits', 'POST', { kind: 'frozen', recipeId: recipe.id, receivedOn: '2026-11-20', quantity: 3 });
  // Two meals of the same recipe on one day each use a unit (the read must not deduplicate them).
  await call('/api/meals', 'POST', { recipeId: recipe.id, date: '2026-11-21', slot: 'lunch', status: 'prepared' });
  await call('/api/meals', 'POST', { recipeId: recipe.id, date: '2026-11-21', slot: 'dinner', status: 'prepared' });
  assert.equal((await call('/api/meal-kits')).find((k: any) => k.kind === 'frozen').left, 1);
  const linkedFrozen = (await call('/api/meal-kits')).find((k: any) => k.kind === 'frozen');
  const fromFrozen = await call('/api/meals', 'POST', { readyId: linkedFrozen.id, date: '2026-11-29', slot: 'dinner' });
  await call('/api/recipes/' + recipe.id, 'DELETE');
  assert.equal((await call('/api/meals/' + fromFrozen.id)).readyId, null, 'recipe cascade deletion also clears ready links');
  const soup = await call('/api/recipes', 'POST', { name: 'Soup', ingredients: [] });
  await call('/api/meals', 'POST', { recipeId: soup.id, date: '2026-11-25', slot: 'dinner', status: 'prepared' });
  const alreadyEaten = await call('/api/meal-kits', 'POST', { recipeId: soup.id, kind: 'prepped', receivedOn: '2026-11-25', quantity: 1 });
  assert.equal(alreadyEaten.left, 0, 'creation still returns an item used by an existing cooked meal');
  const pasta = await call('/api/recipes', 'POST', { name: 'Pasta', defaultServings: 6, ingredients: [] });
  const pastaItem = await call('/api/meal-kits', 'POST', { recipeId: pasta.id, kind: 'frozen', receivedOn: '2026-11-25', quantity: 1 });
  const soupMeal = await call('/api/meals', 'POST', { recipeId: soup.id, date: '2026-11-27', slot: 'dinner' });
  const changed = await call('/api/meals/' + soupMeal.id, 'PATCH', { readyId: pastaItem.id });
  assert.equal(changed.recipeSnapshot.name, 'Pasta'); assert.equal(changed.servings, 6);
  const withProvider = { kind: 'kit', recipeId: pasta.id, provider: 'delivery', receivedOn: '2026-11-27', quantity: 2 };
  await call('/api/meal-kits', 'POST', withProvider);
  assert.equal((await request('/api/meal-kits', 'POST', withProvider)).status, 400);
  const dates = (await call('/api/meal-kits')).map((k: any) => k.cookBy);
  assert.deepEqual(dates, [...dates].sort(), 'ready food is shown by its effective use-by date, including overrides');
});
