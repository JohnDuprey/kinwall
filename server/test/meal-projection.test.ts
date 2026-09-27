import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { applyProjection, mealWrite, readMeals, shoppingProjection } from '../src/meals.ts';
import { MealDateSchema, MealRangeSchema, ProjectionApplySchema, ProjectionQuerySchema } from '../src/meal-schemas.ts';
import type { Ingredient, Meal } from '../src/meal-schemas.ts';

const range = { from: '2026-10-05', to: '2026-10-11' };
const now = '2026-09-26T12:00:00.000Z';

function database() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  for (const id of ['groceries', 'other-list']) {
    db.prepare("INSERT INTO lists (id,name,kind,created_at) VALUES (?,?,'shopping',?)").bind(id, id, now).run();
  }
  return db;
}

function ingredient(id: string, name: string, quantity: number | null, unit: string | null = null, extra: Partial<Ingredient> = {}): Ingredient {
  return { id, name, normalizedName: name.toLowerCase(), quantity, unit, preparation: null, qualifier: null, category: null, sort: 0, ...extra };
}

function meal(id: string, ingredients: Ingredient[], extra: Partial<Meal> = {}): Meal {
  return {
    id, date: range.from, slot: 'dinner', title: id, mealKind: 'recipe', recipeId: null,
    recipeSnapshot: { name: `Recipe ${id}`, defaultServings: 4, ingredients }, servings: 4,
    assigneeMemberId: null, notes: null, plannedTime: null, calendarEventId: null,
    status: 'planned', sourceUrl: null, createdAt: now, updatedAt: now, ...extra,
  };
}

test('meal projection: scales snapshots, normalizes names and compatible units, retains incompatible units', async () => {
  const db = database();
  await db.batch([
    mealWrite(db, meal('monday', [
      ingredient('chicken', 'Chicken', 2, 'lbs'),
      ingredient('eggs', ' Eggs ', 1, 'dozen'),
      ingredient('spinach-cups', 'Spinach', 2, 'cups'),
      ingredient('spinach-weight', 'Spinach', 1, 'lb'),
    ], { servings: 6 })),
    mealWrite(db, meal('wednesday', [ingredient('eggs2', 'Ｅｇｇｓ', 6, 'each')], { date: '2026-10-07' })),
  ]);
  const { items } = await shoppingProjection(db, range.from, range.to);
  const eggs = items.find((item) => item.normalizedName === 'eggs')!;
  assert.equal(eggs.quantity, 24);
  assert.equal(eggs.unit, null);
  assert.deepEqual(eggs.sources.map((s) => [s.date, s.recipeName, s.quantity]), [
    ['2026-10-05', 'Recipe monday', 18], ['2026-10-07', 'Recipe wednesday', 6],
  ]);
  const chicken = items.find((item) => item.normalizedName === 'chicken')!;
  assert.deepEqual([chicken.quantity, chicken.unit], [3, 'lb']);
  assert.deepEqual(items.filter((item) => item.normalizedName === 'spinach').map((item) => [item.quantity, item.unit]), [[3, 'cup'], [1.5, 'lb']]);
  assert.equal((await readMeals(db, range.from, range.to))[0].recipeSnapshot!.ingredients[0].quantity, 2);
});

test('meal projection: ambiguous amounts are not scaled or merged; dining out and freeform never contribute', async () => {
  const db = database();
  const ingredients = [
    ingredient('salt', 'Salt', null, null, { qualifier: 'to taste' }),
    ingredient('pasta', 'Pasta', 1, 'package'),
    ingredient('pepper', 'Pepper', 1, 'tsp', { qualifier: 'as needed' }),
  ];
  await db.batch([
    mealWrite(db, meal('one', ingredients, { servings: 8 })),
    mealWrite(db, meal('two', ingredients, { servings: 2 })),
    // Even a stale snapshot on a non-recipe row cannot generate shopping requirements.
    mealWrite(db, meal('restaurant', ingredients, { mealKind: 'dining_out' })),
    mealWrite(db, meal('leftovers', ingredients, { mealKind: 'freeform' })),
  ]);
  const { items } = await shoppingProjection(db, range.from, range.to);
  assert.equal(items.length, 6);
  assert.ok(items.every((item) => !item.scalable && item.sources.length === 1));
  assert.deepEqual(items.filter((item) => item.normalizedName === 'pasta').map((item) => item.quantity), [1, 1]);
  assert.deepEqual(items.filter((item) => item.normalizedName === 'salt').map((item) => item.quantity), [null, null]);
  assert.deepEqual(items.filter((item) => item.normalizedName === 'pepper').map((item) => item.quantity), [1, 1]);
  assert.ok(items.every((item) => ['one', 'two'].includes(item.sources[0].mealId)));
});

test('meal projection: ranges include both boundaries and keep calendar dates through DST and year changes', async () => {
  const db = database();
  const dates = ['2026-10-04', range.from, range.to, '2026-10-12', '2026-11-01', '2026-12-31', '2027-01-01'];
  await db.batch(dates.map((date) => mealWrite(db, meal(date, [], { date }))));
  for (const slot of ['snack', 'lunch', 'breakfast'] as const) {
    await mealWrite(db, meal(slot, [], { date: range.from, slot })).run();
  }
  const week = await readMeals(db, range.from, range.to);
  assert.deepEqual(week.map((m) => [m.date, m.slot]), [
    [range.from, 'breakfast'], [range.from, 'lunch'], [range.from, 'dinner'], [range.from, 'snack'], [range.to, 'dinner'],
  ]);
  assert.deepEqual((await readMeals(db, '2026-11-01', '2026-11-01')).map((m) => m.date), ['2026-11-01']);
  assert.deepEqual((await readMeals(db, '2026-12-31', '2027-01-01')).map((m) => m.date), ['2026-12-31', '2027-01-01']);
});

test('meal schemas: real dates and bounded ordered ranges also apply to projection query and apply', () => {
  for (const date of ['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '2026-10-05T00:00:00Z']) {
    assert.equal(MealDateSchema.safeParse(date).success, false, date);
  }
  assert.equal(MealDateSchema.safeParse('2028-02-29').success, true);
  for (const schema of [MealRangeSchema, ProjectionQuerySchema, ProjectionApplySchema]) {
    assert.equal(schema.safeParse({ ...range, listId: 'groceries' }).success, true);
    for (const bad of [{ from: range.to, to: range.from }, { from: '2026-01-01', to: '2027-01-03' }]) {
      assert.equal(schema.safeParse({ ...bad, listId: 'groceries' }).success, false, JSON.stringify(bad));
    }
  }
});

test('meal projection: omit, existing matches, source notes, stale preview retries and independent list ledgers', async () => {
  const db = database();
  await mealWrite(db, meal('Tacos', [
    ingredient('tomato', 'Tomatoes', 2, null, { preparation: 'diced', category: 'Produce' }),
    ingredient('rice', 'Rice', 1, 'cup'),
  ])).run();
  db.prepare('INSERT INTO list_items (id,list_id,title,quantity,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind('manual', 'groceries', ' tomatoes ', '9', now, now).run();
  const preview = await shoppingProjection(db, range.from, range.to, 'groceries');
  const tomato = preview.items.find((item) => item.normalizedName === 'tomatoes')!;
  const rice = preview.items.find((item) => item.normalizedName === 'rice')!;
  assert.deepEqual(tomato.matches, [{ id: 'manual', title: ' tomatoes ', quantity: '9', done: false }]);
  const ids = await applyProjection(db, preview, 'groceries', [rice.key], true);
  assert.equal(ids.length, 1);
  const item = db.prepare('SELECT * FROM list_items WHERE id = ?').bind(ids[0]).first<{ quantity: string; category: string; notes: string }>()!;
  assert.equal(item.quantity, '2');
  assert.equal(item.category, 'Produce');
  for (const detail of [range.from, 'dinner', 'Tacos', 'Recipe Tacos', 'diced']) assert.ok(item.notes.includes(detail), detail);
  assert.equal(db.prepare("SELECT quantity FROM list_items WHERE id = 'manual'").first('quantity'), '9');
  assert.deepEqual(await applyProjection(db, preview, 'groceries', [rice.key], true), []);
  const after = await shoppingProjection(db, range.from, range.to, 'groceries');
  assert.equal(after.items.find((i) => i.key === tomato.key)!.applied, true);
  assert.equal(after.items.find((i) => i.key === rice.key)!.applied, false);
  const riceIds = await applyProjection(db, after, 'groceries', [], false);
  assert.equal(riceIds.length, 1);
  assert.equal(db.prepare('SELECT notes FROM list_items WHERE id = ?').bind(riceIds[0]).first('notes'), null);
  assert.deepEqual(await applyProjection(db, await shoppingProjection(db, range.from, range.to, 'groceries'), 'groceries', [], false), []);
  const other = await shoppingProjection(db, range.from, range.to, 'other-list');
  assert.equal((await applyProjection(db, other, 'other-list', [], false)).length, 2);
});

test('meal projection: overlapping ranges claim each contribution once, including competing stale previews', async () => {
  const db = database();
  await db.batch([
    mealWrite(db, meal('Monday', [ingredient('a', 'Tomatoes', 2)])),
    mealWrite(db, meal('Wednesday', [ingredient('b', 'Tomatoes', 3)], { date: '2026-10-07' })),
  ]);
  const wholeWeek = await shoppingProjection(db, range.from, range.to, 'groceries');
  const monday = await shoppingProjection(db, range.from, range.from, 'groceries');
  assert.equal((await applyProjection(db, monday, 'groceries', [], true)).length, 1);
  const partial = await shoppingProjection(db, range.from, range.to, 'groceries');
  assert.equal(partial.items[0].partiallyApplied, true);
  assert.equal(partial.items[0].applied, false);
  const attempts = await Promise.all([
    applyProjection(db, wholeWeek, 'groceries', [], true),
    applyProjection(db, wholeWeek, 'groceries', [], true),
  ]);
  assert.equal(attempts.flat().length, 1);
  const items = db.prepare("SELECT quantity,notes FROM list_items WHERE list_id = 'groceries' ORDER BY CAST(quantity AS REAL)").all<{ quantity: string; notes: string }>().results;
  assert.deepEqual(items.map((i) => i.quantity), ['2', '3']);
  assert.match(items[1].notes, /Wednesday/);
  assert.doesNotMatch(items[1].notes, /Monday/, 'source notes must describe only contributions added to this item');
  assert.equal(db.prepare('SELECT count(*) AS n FROM meal_shopping_sources').first('n'), 2);
});

test('meal projection: changed servings are flagged without duplicating; deleting an item releases only its claims', async () => {
  const db = database();
  const original = meal('Dinner', [ingredient('beans', 'Beans', 2, 'cup')]);
  await mealWrite(db, original).run();
  const first = await shoppingProjection(db, range.from, range.to, 'groceries');
  const [id] = await applyProjection(db, first, 'groceries', [], false);
  db.prepare('UPDATE list_items SET done = 1 WHERE id = ?').bind(id).run();
  await mealWrite(db, { ...original, servings: 8 }).run();
  const changed = await shoppingProjection(db, range.from, range.to, 'groceries');
  assert.deepEqual([changed.items[0].quantity, changed.items[0].applied, changed.items[0].changedSinceApplied], [4, true, true]);
  assert.deepEqual(await applyProjection(db, changed, 'groceries', [], false), []);
  assert.equal(db.prepare('SELECT quantity FROM list_items WHERE id = ?').bind(id).first('quantity'), '2 cup');
  db.prepare('DELETE FROM list_items WHERE id = ?').bind(id).run();
  const released = await shoppingProjection(db, range.from, range.to, 'groceries');
  assert.equal(released.items[0].applied, false);
  const [replacement] = await applyProjection(db, released, 'groceries', [], false);
  assert.equal(db.prepare('SELECT quantity FROM list_items WHERE id = ?').bind(replacement).first('quantity'), '4 cup');
});
