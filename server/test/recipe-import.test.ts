import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { parseIngredientLine } from '../src/meals.ts';
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
  return { request, json };
}

test('recipe import: ingredient lines parse into amount, unit and name', () => {
  const cases: [string, { name: string; quantity: number | null; unit: string | null }][] = [
    ['1.5 tablespoon Sour Cream', { name: 'Sour Cream', quantity: 1.5, unit: 'tablespoon' }],
    ['2 unit Garlic Clove', { name: 'Garlic Clove', quantity: 2, unit: null }],
    ['½ cup Rice', { name: 'Rice', quantity: 0.5, unit: 'cup' }],
    ['1½ cups Rice', { name: 'Rice', quantity: 1.5, unit: 'cups' }],
    ['1 1/2 teaspoon Chili Flakes', { name: 'Chili Flakes', quantity: 1.5, unit: 'teaspoon' }],
    ['1 package Chicken Thighs', { name: 'Chicken Thighs', quantity: 1, unit: 'package' }],
    ['2 Tomatoes', { name: 'Tomatoes', quantity: 2, unit: null }],
    ['4 fl oz Cream', { name: 'Cream', quantity: 4, unit: 'fl oz' }],
    ['Salt', { name: 'Salt', quantity: null, unit: null }],
    ['  Pepper  ', { name: 'Pepper', quantity: null, unit: null }],
    ['2x Bacon', { name: '2x Bacon', quantity: null, unit: null }],
  ];
  for (const [line, expected] of cases) assert.deepEqual(parseIngredientLine(line), expected, line);
});

const kit = (plan?: unknown) => ({
  source: 'hellofresh', externalId: 'abc123', name: 'Creamy Chicken', description: 'Weeknight', sourceUrl: 'https://example.com/card.pdf', imageUrl: 'https://example.com/a.jpg', servings: 2,
  ingredients: [{ text: '1.5 tablespoon Sour Cream', pantry: false }, { text: '2 unit Garlic Clove', pantry: false, category: 'Produce' }, { text: '1 teaspoon Olive Oil', pantry: true }, 'Salt'],
  steps: ['Boil water.', 'Cook chicken.'], ...(plan ? { plan } : {}),
});

test('recipe import: upserts by source and externalId, keeps the card link, numbers the steps', async () => {
  const { json } = fixture();
  const first = await json('/api/recipes/import', 'POST', kit());
  assert.deepEqual({ created: first.created, planned: first.planned }, { created: true, planned: false });
  let recipe = await json(`/api/recipes/${first.recipeId}`);
  assert.equal(recipe.sourceUrl, 'https://example.com/card.pdf');
  assert.equal(recipe.imageUrl, 'https://example.com/a.jpg');
  assert.deepEqual([recipe.source, recipe.externalId, recipe.defaultServings], ['hellofresh', 'abc123', 2]);
  assert.equal(recipe.instructions, '1. Boil water.\n2. Cook chicken.');
  assert.deepEqual(recipe.ingredients.map((i: any) => [i.name, i.quantity, i.unit, i.qualifier, i.category]), [
    ['Sour Cream', 1.5, 'tablespoon', 'in the kit', null], ['Garlic Clove', 2, null, 'in the kit', 'Produce'], ['Olive Oil', 1, 'teaspoon', null, null], ['Salt', null, null, null, null],
  ]);
  const again = await json('/api/recipes/import', 'POST', { ...kit(), name: 'Creamy Chicken v2', steps: ['Just eat.'] });
  assert.deepEqual([again.recipeId, again.created], [first.recipeId, false]);
  recipe = await json(`/api/recipes/${first.recipeId}`);
  assert.equal(recipe.name, 'Creamy Chicken v2');
  assert.equal(recipe.instructions, '1. Just eat.');
  assert.equal((await json('/api/recipes')).length, 1);
  const other = await json('/api/recipes/import', 'POST', { ...kit(), source: 'other-kit' });
  assert.notEqual(other.recipeId, first.recipeId);
});

test('recipe import: planning is idempotent and skips an occupied slot', async () => {
  const { json } = fixture();
  const planned = await json('/api/recipes/import', 'POST', kit({ date: '2026-10-05', slot: 'dinner', servings: 4 }));
  assert.equal(planned.planned, true);
  const meal = await json(`/api/meals/${planned.mealId}`);
  assert.deepEqual([meal.date, meal.slot, meal.servings, meal.recipeId, meal.sourceUrl], ['2026-10-05', 'dinner', 4, planned.recipeId, 'https://example.com/card.pdf']);
  // Again (same or a later night in that week): the meal it already planned, not a second one.
  const again = await json('/api/recipes/import', 'POST', kit({ date: '2026-10-05', slot: 'dinner' }));
  assert.deepEqual([again.planned, again.mealId], [true, planned.mealId]);
  assert.equal((await json('/api/recipes/import', 'POST', kit({ date: '2026-10-04', slot: 'dinner' }))).mealId, planned.mealId);
  assert.equal((await json('/api/meals?from=2026-10-01&to=2026-10-12')).length, 1);
  // Another recipe for that night is refused with the reason; the next night is free.
  const busy = await json('/api/recipes/import', 'POST', { ...kit({ date: '2026-10-05', slot: 'dinner' }), externalId: 'xyz' });
  assert.equal(busy.planned, false);
  assert.equal(busy.mealId, undefined);
  assert.match(busy.reason, /dinner on 2026-10-05 already has Creamy Chicken/);
  assert.equal((await json('/api/recipes/import', 'POST', { ...kit({ date: '2026-10-06', slot: 'dinner' }), externalId: 'xyz' })).planned, true);
});

test('recipe import: grocery lists skip what ships in the kit unless asked', async () => {
  const { json } = fixture();
  await json('/api/recipes/import', 'POST', kit({ date: '2026-10-05', slot: 'dinner' }));
  const list = await json('/api/lists', 'POST', { name: 'Groceries', kind: 'shopping' });
  const range = { from: '2026-10-05', to: '2026-10-11', listId: list.id };
  const preview = await json(`/api/meals/projection?${new URLSearchParams(range)}`);
  assert.equal(preview.items.length, 4, 'the preview still shows everything');
  const applied = await json('/api/meals/projection/apply', 'POST', range);
  assert.deepEqual(applied.projection.items.filter((i: any) => i.applied).map((i: any) => i.name).sort(), ['Olive Oil', 'Salt']);
  assert.equal((await json('/api/meals/projection/apply', 'POST', { ...range, includeKitItems: true })).added, 2);
});

test('recipe import: a display key cannot import', async () => {
  const { json, request } = fixture();
  const display = await json('/api/keys', 'POST', { name: 'wall', scope: 'display' });
  assert.equal((await request('/api/recipes/import', 'POST', kit(), display.key)).status, 403);
  assert.equal((await request('/api/recipes/import', 'POST', { ...kit(), ingredients: [{ text: 'x', shipped: true }] })).status, 400);
});
