import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { foodMatches, expiryStatus, rankRecipes } from '../src/pantry.ts';
import { todayIn } from '../src/routes/lists.ts';
import { runNotifications } from '../src/notify.ts';
import type { PantryItem } from '../src/pantry.ts';
import type { Env } from '../src/env.ts';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown) => app.request(path, { method, headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    const res = await request(path, method, body); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  return { env, request, json };
}
// The household's today (no timezone set: the host's), and n days from it.
const today = todayIn(null);
const inDays = (n: number) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('pantry: names match when they are the same food', () => {
  assert.ok(foodMatches('Chicken breast', 'chicken breasts'));
  assert.ok(foodMatches('Chicken', 'Boneless chicken thighs')); // a cut of what you have
  assert.ok(foodMatches('Tomatoes', 'cherry tomatoes')); // a variety
  assert.ok(foodMatches('Spinach', 'Fresh baby spinach'));
  assert.ok(foodMatches('Greek yogurt', 'yogurt'));
  assert.ok(foodMatches('Ground beef', 'lean ground beef'));
  assert.ok(!foodMatches('Milk', 'coconut milk')); // a different food
  assert.ok(!foodMatches('Butter', 'peanut butter'));
  assert.ok(!foodMatches('Potatoes', 'sweet potatoes'));
  assert.ok(!foodMatches('Garlic', 'garlic powder'));
  assert.ok(!foodMatches('Rice', 'rice vinegar'));
  assert.ok(!foodMatches('', 'rice'));
  // Ambiguous colors name a different food: green beans aren't beans, brown sugar isn't sugar.
  assert.ok(!foodMatches('Beans', 'green beans'));
  assert.ok(!foodMatches('Sugar', 'brown sugar'));
  assert.ok(!foodMatches('Peppers', 'black pepper'));
  assert.ok(foodMatches('Peppers', 'red peppers'));
});

test('pantry: use-by status counts days in the household calendar', () => {
  assert.deepEqual(expiryStatus('2026-11-06', '2026-11-08'), { daysLeft: -2, status: 'expired' });
  assert.deepEqual(expiryStatus('2026-11-08', '2026-11-08'), { daysLeft: 0, status: 'today' });
  assert.deepEqual(expiryStatus('2026-11-11', '2026-11-08'), { daysLeft: 3, status: 'soon' });
  assert.deepEqual(expiryStatus('2026-11-12', '2026-11-08'), { daysLeft: 4, status: 'later' });
  assert.deepEqual(expiryStatus('2027-01-01', '2026-12-30'), { daysLeft: 2, status: 'soon' }); // across a year
  assert.equal(expiryStatus(null, '2026-11-08'), null);
  assert.equal(expiryStatus('soon-ish', '2026-11-08'), null); // not a date: no status rather than a wrong one
});

test('pantry: a pantry list keeps use-by dates, sorted soonest first, with expired items counted', async () => {
  const { json } = fixture();
  const list = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  // A to-do list underneath, so apps that know only todo, shopping and reusable keep working.
  assert.deepEqual([list.kind, list.purpose], ['todo', 'pantry']);
  assert.equal(list.sortBy, 'due'); // soonest use-by first
  assert.equal(list.groupBy, 'category'); // by where it's kept
  assert.equal(list.keepChecked, false); // used up moves to Done
  assert.equal(list.catalog, null);
  assert.equal(list.isDefault, false);
  await json(`/api/lists/${list.id}/items`, 'POST', [
    { title: 'Rice', category: 'Pantry' },
    { title: 'Yogurt', category: 'Fridge', dueDate: inDays(3) },
    { title: 'Spinach', category: 'Fridge', dueDate: inDays(-1), quantity: '1 bag' },
  ]);
  const detail = await json(`/api/lists/${list.id}`);
  assert.deepEqual(detail.items.map((i: any) => i.title), ['Spinach', 'Yogurt', 'Rice']);
  assert.equal(detail.list.overdueCount, 1);
  assert.equal(detail.items[0].category, 'Fridge'); // kept as given, nothing filled from the grocery catalog
  // Renaming keeps it a pantry list; purpose null makes it a plain to-do list, with a to-do's view.
  assert.equal((await json(`/api/lists/${list.id}`, 'PATCH', { name: 'Fridge' })).purpose, 'pantry');
  const plain = await json(`/api/lists/${list.id}`, 'PATCH', { purpose: null });
  assert.deepEqual([plain.kind, plain.purpose, plain.sortBy, plain.groupBy, plain.itemCount], ['todo', null, 'manual', 'none', 3]);
  const back = await json(`/api/lists/${list.id}`, 'PATCH', { purpose: 'pantry' });
  assert.deepEqual([back.purpose, back.sortBy, back.groupBy], ['pantry', 'due', 'category']);
  // Another kind is never a pantry list.
  const shopping = await json(`/api/lists/${list.id}`, 'PATCH', { kind: 'shopping' });
  assert.deepEqual([shopping.kind, shopping.purpose, shopping.sortBy], ['shopping', null, 'aisle']);
});

test('pantry: purpose pantry needs a to-do list', async () => {
  const { json, request } = fixture();
  assert.equal((await request('/api/lists', 'POST', { name: 'Kitchen', kind: 'shopping', purpose: 'pantry' })).status, 400);
  const chores = await json('/api/lists', 'POST', { name: 'Packing', kind: 'reusable' });
  assert.equal((await request(`/api/lists/${chores.id}`, 'PATCH', { purpose: 'pantry' })).status, 400);
  assert.equal((await json('/api/lists', 'POST', { name: 'Chores', kind: 'todo' })).purpose, null);
});

test('pantry: items move only between pantry lists, and pantry food stays off the Board', async () => {
  const { json, request } = fixture();
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  const garage = await json('/api/lists', 'POST', { name: 'Garage', kind: 'todo', purpose: 'pantry' });
  const chores = await json('/api/lists', 'POST', { name: 'Chores', kind: 'todo' });
  const [milk] = await json(`/api/lists/${kitchen.id}/items`, 'POST', [{ title: 'Milk', dueDate: today }]);
  await json(`/api/lists/${chores.id}/items`, 'POST', [{ title: 'Return library books', dueDate: today }]);
  assert.equal((await request(`/api/lists/${kitchen.id}/items/move`, 'POST', { itemIds: [milk.id], toListId: chores.id })).status, 400);
  await json(`/api/lists/${kitchen.id}/items/move`, 'POST', { itemIds: [milk.id], toListId: garage.id });
  // The Board lists to-dos that are due; milk to use today isn't one.
  const board = await json('/api/board');
  assert.ok(JSON.stringify(board).includes('Return library books'));
  assert.ok(!JSON.stringify(board).includes('"Milk"'));
});

test('pantry: only a shopping list can be a default, not a pantry', async () => {
  const { json, request } = fixture();
  const list = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  assert.equal((await request(`/api/lists/${list.id}`, 'PATCH', { isDefault: true })).status, 400);
});

test('pantry: expiring lists open pantry items due within the window, across pantry lists only', async () => {
  const { json, request } = fixture();
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  const garage = await json('/api/lists', 'POST', { name: 'Garage freezer', kind: 'todo', purpose: 'pantry' });
  const todo = await json('/api/lists', 'POST', { name: 'Chores', kind: 'todo' });
  const [, used] = await json(`/api/lists/${kitchen.id}/items`, 'POST', [
    { title: 'Milk', category: 'Fridge', dueDate: inDays(2), quantity: '½ gal' },
    { title: 'Bread', dueDate: inDays(1) },
    { title: 'Flour', dueDate: inDays(90) },
    { title: 'Salt' },
    { title: 'Spinach', dueDate: inDays(-2) },
  ]);
  await json(`/api/lists/${kitchen.id}/items/${used.id}`, 'PATCH', { done: true }); // used up: not expiring any more
  await json(`/api/lists/${garage.id}/items`, 'POST', [{ title: 'Peas', category: 'Freezer', dueDate: inDays(5) }]);
  await json(`/api/lists/${todo.id}/items`, 'POST', [{ title: 'Return library books', dueDate: inDays(1) }]);

  const week = await json('/api/pantry/expiring');
  assert.equal(week.today, today);
  assert.equal(week.days, 7);
  assert.deepEqual(week.items.map((i: any) => i.title), ['Spinach', 'Milk', 'Peas']);
  assert.deepEqual(week.items[0], { id: week.items[0].id, listId: kitchen.id, listName: 'Kitchen', title: 'Spinach', quantity: null, kept: null, useBy: inDays(-2), daysLeft: -2, status: 'expired' });
  assert.deepEqual({ kept: week.items[1].kept, quantity: week.items[1].quantity, status: week.items[1].status }, { kept: 'Fridge', quantity: '½ gal', status: 'soon' });
  assert.equal(week.items[2].listName, 'Garage freezer');

  assert.deepEqual((await json('/api/pantry/expiring?days=0')).items.map((i: any) => i.title), ['Spinach']); // expired and today
  assert.deepEqual((await json(`/api/pantry/expiring?days=365&listId=${garage.id}`)).items.map((i: any) => i.title), ['Peas']);
  assert.equal((await request('/api/pantry/expiring?days=-1')).status, 400);
  assert.equal((await request('/api/pantry/expiring?days=1000')).status, 400);
  assert.equal((await request('/api/pantry/expiring?days=two')).status, 400);
  assert.equal((await request(`/api/pantry/expiring?listId=${todo.id}`)).status, 404); // not a pantry list
  assert.equal((await request('/api/pantry/expiring?listId=nope')).status, 404);
});

test('pantry: suggestions rank recipes by what expires soonest and say what they use', async () => {
  const { json, request } = fixture();
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  await json(`/api/lists/${kitchen.id}/items`, 'POST', [
    { title: 'Chicken', category: 'Fridge', dueDate: inDays(1) },
    { title: 'Spinach', category: 'Fridge', dueDate: inDays(0) },
    { title: 'Yogurt', category: 'Fridge', dueDate: inDays(6) },
    { title: 'Mystery cheese', category: 'Fridge', dueDate: inDays(2) },
    { title: 'Rice', category: 'Pantry' },
    { title: 'Milk', category: 'Fridge', dueDate: inDays(30) },
  ]);
  const curry = await json('/api/recipes', 'POST', { name: 'Chicken spinach curry', ingredients: [{ name: 'Chicken thighs', quantity: 1, unit: 'lb' }, { name: 'Baby spinach' }, { name: 'Rice' }, { name: 'Coconut milk' }, { name: 'Salt' }] });
  const salad = await json('/api/recipes', 'POST', { name: 'Spinach salad', ingredients: [{ name: 'Spinach' }, { name: 'Walnuts' }] });
  await json('/api/recipes', 'POST', { name: 'Parfait', ingredients: [{ name: 'Greek yogurt' }, { name: 'Granola' }] });
  await json('/api/recipes', 'POST', { name: 'Toast', ingredients: [{ name: 'Bread' }] }); // nothing expiring
  const old = await json('/api/recipes', 'POST', { name: 'Old chicken dish', ingredients: [{ name: 'Chicken' }] });
  await json(`/api/recipes/${old.id}`, 'PATCH', { archived: true }); // archived: never suggested
  await json('/api/recipes', 'POST', { name: 'Chicken stock', kind: 'basic', makes: '2 quarts', ingredients: [{ name: 'Chicken' }] }); // a basic isn't a meal

  const res = await json('/api/pantry/suggestions');
  assert.equal(res.days, 7);
  assert.deepEqual(res.suggestions.map((s: any) => s.recipe.name), ['Chicken spinach curry', 'Spinach salad', 'Parfait']);
  const [first] = res.suggestions;
  assert.equal(first.recipe.id, curry.id);
  assert.deepEqual(first.uses.map((u: any) => [u.title, u.ingredient, u.status]), [['Spinach', 'Baby spinach', 'today'], ['Chicken', 'Chicken thighs', 'soon']]);
  assert.deepEqual(first.alsoHave.map((h: any) => [h.title, h.ingredient]), [['Rice', 'Rice']]);
  assert.deepEqual(first.missing, ['Coconut milk']); // salt is assumed; Milk isn't coconut milk
  assert.ok(first.score > res.suggestions[1].score);
  assert.deepEqual(res.suggestions[1].missing, ['Walnuts']);
  assert.equal(res.suggestions[1].recipe.id, salad.id);
  // Expiring things no suggested recipe uses: ideas for an assistant, or a reminder.
  assert.deepEqual(res.unmatched.map((i: any) => i.title), ['Mystery cheese']);
  assert.deepEqual(res.expiring.map((i: any) => i.title), ['Spinach', 'Chicken', 'Mystery cheese', 'Yogurt']);

  assert.deepEqual((await json('/api/pantry/suggestions?limit=1')).suggestions.map((s: any) => s.recipe.name), ['Chicken spinach curry']);
  // A short window: only what's due by tomorrow drives the ranking.
  const soon = await json('/api/pantry/suggestions?days=1');
  assert.deepEqual(soon.suggestions.map((s: any) => s.recipe.name), ['Chicken spinach curry', 'Spinach salad']);
  assert.equal((await request('/api/pantry/suggestions?limit=0')).status, 400);
  assert.equal((await request('/api/pantry/suggestions?limit=51')).status, 400);
});

test('pantry: suggestions are empty, not an error, with no pantry or no recipes', async () => {
  const { json } = fixture();
  assert.deepEqual(await json('/api/pantry/suggestions'), { today, days: 7, expiring: [], suggestions: [], unmatched: [] });
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  await json(`/api/lists/${kitchen.id}/items`, 'POST', [{ title: 'Milk', dueDate: inDays(1) }]);
  const res = await json('/api/pantry/suggestions');
  assert.deepEqual(res.suggestions, []);
  assert.deepEqual(res.unmatched.map((i: any) => i.title), ['Milk']);
});

test('pantry: export and import keep a pantry list, its use-by dates and where things are kept', async () => {
  const source = fixture();
  const list = await source.json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry', restock: true });
  await source.json(`/api/lists/${list.id}/items`, 'POST', [{ title: 'Milk', category: 'Fridge', dueDate: inDays(2) }]);
  const file = await source.json('/api/export');
  // A file without keepChecked (an older client's) still gets the to-do default: used up moves to Done.
  for (const l of file.lists) delete l.keepChecked;
  const target = fixture();
  await target.json('/api/import', 'POST', file);
  const [imported] = (await target.json('/api/lists')).filter((l: any) => l.purpose === 'pantry');
  assert.deepEqual([imported.name, imported.sortBy, imported.groupBy, imported.keepChecked, imported.restock], ['Kitchen', 'due', 'category', false, true]);
  assert.deepEqual((await target.json('/api/pantry/expiring')).items.map((i: any) => [i.title, i.kept, i.useBy]), [['Milk', 'Fridge', inDays(2)]]);
});

test('pantry: staples never match, one item per ingredient, and meal-kit ingredients are never missing', async () => {
  const { json } = fixture();
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  await json(`/api/lists/${kitchen.id}/items`, 'POST', [
    { title: 'Peppers', dueDate: inDays(1) },
    { title: 'Chicken breast', dueDate: inDays(2) },
    { title: 'Chicken thighs', dueDate: inDays(1) },
  ]);
  // "Salt and pepper" is a staple: it doesn't use up the peppers, and isn't missing either.
  await json('/api/recipes', 'POST', { name: 'Roast chicken', ingredients: [{ name: 'Chicken' }, { name: 'Salt and pepper' }, { name: 'Black pepper' }] });
  await json('/api/recipes/import', 'POST', { source: 'kit', externalId: 'k1', name: 'Kit fajitas', servings: 2, ingredients: [{ text: 'Peppers' }, { text: '1 packet Fajita spice', pantry: false }, { text: 'Tortillas' }] });
  const res = await json('/api/pantry/suggestions');
  const roast = res.suggestions.find((s: any) => s.recipe.name === 'Roast chicken');
  assert.deepEqual(roast.uses.map((u: any) => u.title), ['Chicken thighs']); // the sooner of the two, counted once
  assert.deepEqual(roast.missing, []);
  const fajitas = res.suggestions.find((s: any) => s.recipe.name === 'Kit fajitas');
  assert.deepEqual(fajitas.uses.map((u: any) => u.title), ['Peppers']);
  assert.deepEqual(fajitas.missing, ['Tortillas']); // the spice ships in the kit
});

test('pantry: an older app saving a pantry list as todo keeps it a pantry list; an archived one is refused by listId', async () => {
  const { json, request } = fixture();
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  // Apps from before purpose send the kind they know, and never purpose.
  assert.equal((await json(`/api/lists/${kitchen.id}`, 'PATCH', { kind: 'todo', name: 'Fridge' })).purpose, 'pantry');
  await json(`/api/lists/${kitchen.id}`, 'PATCH', { archived: true });
  const refused = await request(`/api/pantry/expiring?listId=${kitchen.id}`);
  assert.equal(refused.status, 404);
  assert.match(((await refused.json()) as { error: string }).error, /archived/);
});

test('pantry: a pantry list doesn\'t sync with a to-do app, and becoming one ends its link', async () => {
  const { env, json, request } = fixture();
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry' });
  const refused = await request(`/api/tasks/links/${kitchen.id}`, 'PUT', { accountId: 'ta', remoteId: 'p1' });
  assert.equal(refused.status, 400);
  const errands = await json('/api/lists', 'POST', { name: 'Errands', kind: 'todo' });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO task_accounts (id, kind, name, config, created_at) VALUES ('ta', 'todoist', 'alex@example.com', 'sealed', '2026-01-01')"),
    env.DB.prepare("INSERT INTO task_links (list_id, account_id, app, remote_id, remote_name, created_at) VALUES (?, 'ta', 'todoist', 'p1', 'Errands', '2026-01-01')").bind(errands.id),
  ]);
  await json(`/api/lists/${errands.id}`, 'PATCH', { purpose: 'pantry' });
  assert.equal(await env.DB.prepare('SELECT 1 FROM task_links WHERE list_id = ?').bind(errands.id).first(), null);
});

test('pantry: food stays out of a member\'s day and the daily summary', async () => {
  const { env, json } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const day = new Date().toISOString().slice(0, 10); // in the household's (UTC) day
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#5ae' });
  // Items assigned to Maya before the list became a pantry (or by an assistant) keep their assignee.
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo' });
  await json(`/api/lists/${kitchen.id}/items`, 'POST', [{ title: 'Spinach', dueDate: day, memberId: maya.id }, { title: 'Pack lunch', dueDate: day, memberId: maya.id }]);
  await json(`/api/lists/${kitchen.id}`, 'PATCH', { purpose: 'pantry' });
  const chores = await json('/api/lists', 'POST', { name: 'Chores', kind: 'todo' });
  await json(`/api/lists/${chores.id}/items`, 'POST', [{ title: 'Return library books', dueDate: day, memberId: maya.id }]);
  const mine = JSON.stringify(await json(`/api/snapshot?member=${maya.id}`));
  assert.ok(mine.includes('Return library books'));
  assert.ok(!mine.includes('Spinach') && !mine.includes('Pack lunch'));
  await runNotifications(env, new Date(`${day}T07:30:00Z`));
  await runNotifications(env, new Date(`${day}T08:00:00Z`));
  const summary = (await json('/api/notifications')).find((n: any) => n.kind === 'summary');
  assert.match(summary.body, /Return library books/);
  assert.doesNotMatch(summary.body, /Spinach/);
});

test('pantry: with restock on, used-up food goes on the grocery list once, and a mis-tap takes it back off', async () => {
  const { json, request } = fixture();
  const groceries = await json('/api/lists', 'POST', { name: 'Groceries', kind: 'shopping', catalog: 'groceries' });
  const market = await json('/api/lists', 'POST', { name: 'Market', kind: 'shopping', catalog: 'groceries' });
  await json(`/api/lists/${market.id}`, 'PATCH', { isDefault: true }); // the default wins over the first
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry', restock: true });
  assert.equal(kitchen.restock, true);
  // Where milk goes is remembered from an earlier trip.
  const [old] = await json(`/api/lists/${market.id}/items`, 'POST', [{ title: 'Milk', store: 'Neighborhood market', aisle: 'Dairy', category: 'Dairy' }]);
  await json(`/api/lists/${market.id}/items/${old.id}`, 'DELETE');
  const [milk, eggs] = await json(`/api/lists/${kitchen.id}/items`, 'POST', [{ title: 'milk', dueDate: inDays(1) }, { title: 'Eggs' }]);
  await json(`/api/lists/${market.id}/items`, 'POST', [{ title: 'eggs' }]); // already on the list

  await json(`/api/lists/${kitchen.id}/items/${milk.id}`, 'PATCH', { done: true });
  await json(`/api/lists/${kitchen.id}/items/${eggs.id}`, 'PATCH', { done: true });
  let items = (await json(`/api/lists/${market.id}`)).items;
  assert.deepEqual(items.map((i: any) => i.title).sort(), ['eggs', 'milk']); // eggs not twice
  const added = items.find((i: any) => i.title === 'milk');
  assert.deepEqual([added.store, added.aisle, added.category, added.done], ['Neighborhood market', 'Dairy', 'Dairy', false]);
  assert.equal((await json(`/api/lists/${groceries.id}`)).items.length, 0);

  // A mis-tap: unticking takes it back off, and only the one it added.
  await json(`/api/lists/${kitchen.id}/items/${milk.id}`, 'PATCH', { done: false });
  await json(`/api/lists/${kitchen.id}/items/${eggs.id}`, 'PATCH', { done: false });
  items = (await json(`/api/lists/${market.id}`)).items;
  assert.deepEqual(items.map((i: any) => i.title), ['eggs']);

  // Once it's bought (ticked on the grocery list), unticking the pantry item leaves it alone.
  await json(`/api/lists/${kitchen.id}/items/${milk.id}`, 'PATCH', { done: true });
  const again = (await json(`/api/lists/${market.id}`)).items.find((i: any) => i.title === 'milk');
  await json(`/api/lists/${market.id}/items/${again.id}`, 'PATCH', { done: true });
  await json(`/api/lists/${kitchen.id}/items/${milk.id}`, 'PATCH', { done: false });
  assert.ok((await json(`/api/lists/${market.id}`)).items.some((i: any) => i.id === again.id));

  // Off (the default), and on a list that stops being a pantry, nothing is added.
  assert.equal((await json(`/api/lists/${kitchen.id}`, 'PATCH', { purpose: null })).restock, false);
  const plain = await json('/api/lists', 'POST', { name: 'Fridge', kind: 'todo', purpose: 'pantry' });
  assert.equal(plain.restock, false);
  const [jam] = await json(`/api/lists/${plain.id}/items`, 'POST', [{ title: 'Jam' }]);
  await json(`/api/lists/${plain.id}/items/${jam.id}`, 'PATCH', { done: true });
  assert.ok(!(await json(`/api/lists/${market.id}`)).items.some((i: any) => i.title === 'Jam'));
  // Restock only means something on a pantry list.
  assert.equal((await json('/api/lists', 'POST', { name: 'Chores', kind: 'todo', restock: true })).restock, false);
  assert.equal((await request('/api/lists', 'POST', { name: 'X', kind: 'todo', restock: 'yes' })).status, 400);
});

test('pantry: with restock on and no Groceries list, checking food off just checks it off', async () => {
  const { json } = fixture();
  const kitchen = await json('/api/lists', 'POST', { name: 'Kitchen', kind: 'todo', purpose: 'pantry', restock: true });
  const [milk] = await json(`/api/lists/${kitchen.id}/items`, 'POST', [{ title: 'Milk' }]);
  assert.equal((await json(`/api/lists/${kitchen.id}/items/${milk.id}`, 'PATCH', { done: true })).done, true);
});

test('pantry: ranking accepts unsorted pantry items without changing their order', async () => {
  const { json } = fixture();
  const first = await json('/api/recipes', 'POST', { name: 'Roast chicken', ingredients: [{ name: 'Chicken' }] });
  const second = await json('/api/recipes', 'POST', { name: 'Chicken soup', ingredients: [{ name: 'Chicken' }] });
  const item = (id: string, daysLeft: number | null): PantryItem => ({ id, title: 'Chicken', listId: 'kitchen', listName: 'Kitchen', quantity: null, kept: null, useBy: null, daysLeft, status: null });
  const pantry = [item('undated', null), item('later', 3), item('soonest', 0)];
  const suggestions = rankRecipes([first, second], pantry, pantry.slice(1));
  assert.equal(suggestions.length, 2);
  for (const suggestion of suggestions) assert.deepEqual(suggestion.uses.map(i => i.id), ['soonest']);
  assert.deepEqual(pantry.map(i => i.id), ['undated', 'later', 'soonest']);
});
