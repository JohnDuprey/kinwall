import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { kitBalances } from '../src/meal-kits.ts';
import { createApiKey } from '../src/auth.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { runMigrations } from '../src/migrate.ts';
import type { Env } from '../src/env.ts';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown, key = 'test-admin') => app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown, key = 'test-admin'): Promise<any> => {
    const res = await request(path, method, body, key); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  return { request, json, db };
}

const box = (id: string, received_on: string, quantity = 1, done = 0) => ({ id, received_on, quantity, done });
test('meal kits allocate cooked meals to arrived boxes oldest first and return undone units', () => {
  const boxes = [box('new', '2026-11-20', 2), box('old', '2026-11-10', 2, 1)];
  const meals = [{ date: '2026-11-09', status: 'prepared' }, { date: '2026-11-21', status: 'prepared' }, { date: '2026-11-22', status: 'planned' }];
  assert.deepEqual(kitBalances(boxes, meals).map(k => [k.id, k.left, k.cookBy]), [['old', 0, '2026-11-17'], ['new', 2, '2026-11-27']]);
  assert.deepEqual(kitBalances(boxes, []).map(k => k.left), [1, 2], 'expired boxes remain on hand; undoing Cooked returns a unit');
  assert.deepEqual(kitBalances(boxes, [...meals, { date: '2026-11-23', status: 'prepared' }]).map(k => k.left), [0, 1]);
});
const imported = { source: 'box-service', externalId: 'tacos', name: 'Tacos', ingredients: [], kit: { receivedOn: '2026-11-20' } };
test('meal kit imports upsert the box, expose reads and consume only Cooked meals', async () => {
  const { json, request } = fixture();
  const { recipeId } = await json('/api/recipes/import', 'POST', imported);
  await json('/api/recipes/import', 'POST', { ...imported, kit: { ...imported.kit, quantity: 2 } });
  let kits = await json('/api/meal-kits');
  assert.equal(kits.length, 1); assert.equal(kits[0].left, 2); assert.equal(kits[0].provider, imported.source);
  const id = kits[0].id;
  assert.equal((await json('/api/recipes'))[0].kits[0].id, id);
  const meal = await json('/api/meals', 'POST', { recipeId, date: '2026-11-21', slot: 'dinner' });
  await json('/api/meals/' + meal.id, 'PATCH', { status: 'prepared' });
  assert.equal((await json('/api/recipes/' + recipeId)).kits[0].left, 1);
  await json('/api/meals/' + meal.id, 'PATCH', { status: 'planned' });
  await json('/api/meal-kits/' + id + '/done', 'POST', { count: 1 });
  assert.equal((await json('/api/meal-kits'))[0].left, 1);
  assert.equal((await request('/api/meal-kits/' + id + '/done', 'POST', { count: 2 })).status, 400);
  await json('/api/meal-kits/' + id + '/done', 'POST', {});
  assert.deepEqual(await json('/api/meal-kits'), []);
  await json('/api/meal-kits/' + id, 'DELETE');
  assert.equal((await request('/api/meal-kits/' + id, 'DELETE')).status, 404);
});

test('meal kits use the family cook-by window, validate imports, and survive full export/import', async () => {
  const { json, request } = fixture();
  assert.equal((await json('/api/settings')).mealKitDays, 7);
  await json('/api/settings', 'PATCH', { mealKitDays: 10 });
  for (const value of [0, 15, 1.5]) assert.equal((await request('/api/settings', 'PATCH', { mealKitDays: value })).status, 400);
  await json('/api/recipes/import', 'POST', imported);
  const kit = (await json('/api/meal-kits'))[0];
  assert.equal(kit.cookBy, '2026-11-30');
  await json('/api/meal-kits/' + kit.id + '/done', 'POST', {});
  const backup = await json('/api/export');
  assert.equal(backup.mealKits[0].done, 1, 'exports include consumed boxes, not just on-hand counts');
  await json('/api/meal-kits/' + kit.id, 'DELETE');
  await json('/api/import', 'POST', backup);
  const again = await json('/api/export');
  assert.deepEqual(again.mealKits, backup.mealKits);
  assert.equal((await json('/api/settings')).mealKitDays, 10);
  for (const kit of [{ receivedOn: '2026-02-30' }, { receivedOn: '2026-11-20', quantity: 21 }, { receivedOn: '2026-11-20', quantity: 0 }, { receivedOn: '2026-11-20', provider: 'x'.repeat(51) }]) {
    assert.equal((await request('/api/recipes/import', 'POST', { ...imported, kit })).status, 400);
  }
});

test('walls and child devices can read meal kits but cannot import, mark done, delete or change the window', async () => {
  const { json, request, db } = fixture();
  await json('/api/recipes/import', 'POST', imported);
  const kit = (await json('/api/meal-kits'))[0];
  const child = await json('/api/members', 'POST', { name: 'Maya', color: '#123857', grownUp: false });
  const wall = await createApiKey(db, 'Wall', 'display');
  const kid = await createApiKey(db, 'Maya’s device', 'display', { owner: child.id });
  for (const key of [wall.key, kid.key]) {
    assert.equal((await request('/api/meal-kits', 'GET', undefined, key)).status, 200);
    for (const [path, method, body] of [
      ['/api/meal-kits/' + kit.id + '/done', 'POST', {}], ['/api/meal-kits/' + kit.id, 'DELETE', undefined],
      ['/api/recipes/import', 'POST', imported], ['/api/settings', 'PATCH', { mealKitDays: 10 }],
    ] as const) assert.equal((await request(path, method, body, key)).status, 403);
  }
});

test('weekly planning suggests main-dish kits oldest first, omits planned kits and respects cook-by', async () => {
  const { json, request } = fixture();
  const week = (await json('/api/weekly-plan')).weekStart;
  const date = (days: number) => new Date(Date.parse(week) + days * 86400000).toISOString().slice(0, 10);
  const add = (id: string, receivedOn: string, kind = 'meal') => json('/api/recipes/import', 'POST', { ...imported, externalId: id, name: id, kind, kit: { receivedOn } });
  const newer = await add('A newer box', date(-1));
  const older = await add('Z older box', date(-5));
  await add('Past cook-by', date(-8));
  await add('Side kit', date(-2), 'side');
  let plan = await json('/api/weekly-plan');
  assert.deepEqual(plan.suggestions.filter((s: any) => s.kit).map((s: any) => s.id), [older.recipeId, newer.recipeId]);
  await json('/api/meals', 'POST', { date: week, slot: 'dinner', recipeId: older.recipeId });
  plan = await json('/api/weekly-plan');
  assert.ok(!plan.suggestions.some((s: any) => s.id === older.recipeId));
  await json('/api/settings', 'PATCH', { mealKitDays: 2 });
  plan = await json('/api/weekly-plan');
  const apply = (day: string) => request('/api/weekly-plan/' + week + '/apply', 'POST', {
    revision: plan.revision, sourceVersion: plan.sourceVersion, requestId: crypto.randomUUID(),
    draft: { dinners: [{ date: day, kind: 'meal', title: 'Tacos', recipeId: newer.recipeId }], prep: [] },
  });
  assert.equal((await apply(date(2))).status, 400);
  assert.equal((await apply(date(1))).status, 200, 'the cook-by date itself is allowed');
});

test('hosted meal-kit migration adds one empty table without changing existing family data or settings', async () => {
  const db = openDb(':memory:');
  const folder = new URL('../migrations/', import.meta.url);
  const all = readdirSync(folder).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, sql: readFileSync(new URL(name, folder), 'utf8') }));
  await runMigrations(db, all.filter(m => m.name < '0161'));
  db.prepare("INSERT INTO recipes(id,name,default_servings,created_at,updated_at) VALUES('tacos','Tacos',4,'2026-11-20','2026-11-20')").run();
  const recipes = db.prepare('SELECT * FROM recipes').all().results;
  const settings = db.prepare('SELECT * FROM settings').all().results;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>().results.map(r => r.name);
  await runMigrations(db, all);
  await runMigrations(db, all);
  assert.deepEqual(db.prepare('SELECT * FROM meal_kits').all().results, []);
  assert.deepEqual(db.prepare('SELECT * FROM recipes').all().results, recipes);
  assert.deepEqual(db.prepare('SELECT * FROM settings').all().results, settings);
  const after = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>().results.map(r => r.name);
  assert.deepEqual(after.filter(name => !tables.includes(name)), ['meal_kits']);
});
