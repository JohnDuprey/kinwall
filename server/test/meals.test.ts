import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import { applyProjection, shoppingProjection } from '../src/meals.ts';
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
  return { db, env, app, request, json };
}
const dates = { from: '2026-10-05', to: '2026-10-11' };
const range = new URLSearchParams(dates);

test('meals: snapshots survive recipe editing, archive, deletion; refresh is explicit', async () => {
  const { json, request } = fixture();
  const recipe = await json('/api/recipes', 'POST', { name: 'Tacos', defaultServings: 4, ingredients: [{ name: 'Tomatoes', quantity: 2 }] });
  const meal = await json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', recipeId: recipe.id, servings: 6 });
  assert.equal(meal.recipeSnapshot.ingredients[0].quantity, 2);
  await json(`/api/recipes/${recipe.id}`, 'PATCH', { ingredients: [{ name: 'Tomatoes', quantity: 8 }] });
  assert.equal((await json(`/api/meals/${meal.id}`)).recipeSnapshot.ingredients[0].quantity, 2);
  let projection = await json(`/api/meals/projection?${range}`);
  assert.equal(projection.items[0].quantity, 3);
  const refreshed = await json(`/api/meals/${meal.id}`, 'PATCH', { refreshRecipe: true });
  assert.equal(refreshed.recipeSnapshot.ingredients[0].quantity, 8);
  assert.equal(refreshed.recipeSnapshot.ingredients[0].id, recipe.ingredients[0].id);
  await json(`/api/recipes/${recipe.id}`, 'PATCH', { archived: true });
  assert.deepEqual(await json('/api/recipes'), []);
  assert.equal((await json('/api/recipes?archived=true')).length, 1);
  assert.equal((await request('/api/meals', 'POST', { date: dates.from, slot: 'lunch', recipeId: recipe.id })).status, 400);
  await json(`/api/recipes/${recipe.id}`, 'DELETE');
  const kept = await json(`/api/meals/${meal.id}`);
  assert.equal(kept.recipeId, null); assert.equal(kept.recipeSnapshot.name, 'Tacos');
  projection = await json(`/api/meals/projection?${range}`);
  assert.equal(projection.items[0].quantity, 12);
  assert.equal((await request(`/api/meals/${meal.id}`, 'PATCH', { refreshRecipe: true })).status, 400);
});

test('meals: quantities scale, dozen converts, incompatible units and ambiguous amounts stay separate', async () => {
  const { json } = fixture();
  const recipe = await json('/api/recipes', 'POST', { name: 'Brunch', defaultServings: 4, ingredients: [
    { name: ' Eggs ', quantity: 1, unit: 'dozen' }, { name: 'spinach', quantity: 2, unit: 'cups' },
    { name: 'Spinach', quantity: 1, unit: 'lb' }, { name: 'salt', qualifier: 'to taste' },
    { name: 'bread', quantity: 1, unit: 'package' },
  ] });
  await json('/api/meals', 'POST', { date: dates.from, slot: 'breakfast', recipeId: recipe.id, servings: 6 });
  const other = await json('/api/recipes', 'POST', { name: 'Eggs', defaultServings: 2, ingredients: [{ name: 'eggs', quantity: 6 }] });
  await json('/api/meals', 'POST', { date: '2026-10-07', slot: 'breakfast', recipeId: other.id });
  await json('/api/meals', 'POST', { date: dates.from, slot: 'lunch', mealKind: 'dining_out' });
  const { items } = await json(`/api/meals/projection?${range}`);
  const eggs = items.find((i: any) => i.normalizedName === 'eggs');
  assert.equal(eggs.quantity, 24); assert.equal(eggs.unit, null); assert.equal(eggs.sources.length, 2);
  assert.deepEqual(eggs.sources.map((s: any) => s.date), [dates.from, '2026-10-07']);
  assert.equal(items.filter((i: any) => i.normalizedName === 'spinach').length, 2);
  assert.equal(items.find((i: any) => i.name === 'bread').quantity, 1);
  assert.equal(items.find((i: any) => i.name === 'bread').scalable, false);
  assert.equal(items.find((i: any) => i.name === 'salt').quantity, null);
});

test('meals: applying projections is explicit, overlapping/concurrent calls are idempotent and preserve manual groceries', async () => {
  const { db, json } = fixture();
  const list = await json('/api/lists', 'POST', { name: 'Shopping', kind: 'shopping' });
  await json(`/api/lists/${list.id}/items`, 'POST', { title: 'Tomatoes', quantity: 'already have 1' });
  const recipe = await json('/api/recipes', 'POST', { name: 'Tacos', defaultServings: 4, ingredients: [{ name: 'Tomatoes', quantity: 2 }, { name: 'salt', qualifier: 'to taste' }] });
  const meal = await json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', recipeId: recipe.id, servings: 6 });
  const second = await json('/api/meals', 'POST', { date: '2026-10-07', slot: 'dinner', recipeId: recipe.id });
  const before = await json(`/api/meals/projection?${range}&listId=${list.id}`);
  assert.equal(before.items.find((i: any) => i.name === 'Tomatoes').matches.length, 1);
  assert.equal((await json(`/api/lists/${list.id}`)).items.length, 1);
  const small = await shoppingProjection(db, dates.from, dates.from, list.id);
  const omitKeys = small.items.filter((i) => i.name === 'salt').map((i) => i.key);
  const concurrent = await Promise.all([applyProjection(db, small, list.id, omitKeys, true), applyProjection(db, small, list.id, omitKeys, true)]);
  assert.equal(concurrent.flat().length, 1);
  const applied = await json('/api/meals/projection/apply', 'POST', { ...dates, listId: list.id, includeNotes: true, omitKeys: before.items.filter((i: any) => i.name === 'salt').map((i: any) => i.key) });
  assert.equal(applied.added, 1);
  const repeat = await json('/api/meals/projection/apply', 'POST', { ...dates, listId: list.id, omitKeys: before.items.filter((i: any) => i.name === 'salt').map((i: any) => i.key) });
  assert.equal(repeat.added, 0);
  const groceries = (await json(`/api/lists/${list.id}`)).items;
  assert.equal(groceries.length, 3);
  assert.deepEqual(groceries.map((i: any) => i.quantity), ['already have 1', '3', '2']);
  assert.match(groceries[1].notes, /2026-10-05 · dinner · Tacos/);
  assert.doesNotMatch(groceries[1].notes, /\(Tacos\)/, 'no recipe name in parentheses when the title is the recipe');
  await json(`/api/meals/${meal.id}`, 'PATCH', { servings: 8 });
  const changed = await json(`/api/meals/projection?${range}&listId=${list.id}`);
  assert.equal(changed.items.find((i: any) => i.name === 'Tomatoes').changedSinceApplied, true);
  assert.equal(changed.items.find((i: any) => i.name === 'Tomatoes').applied, true);
  await json(`/api/lists/${list.id}/items/${groceries[2].id}`, 'DELETE');
  const fresh = await json(`/api/meals/projection?from=2026-10-07&to=2026-10-07&listId=${list.id}`);
  assert.equal(fresh.items.find((i: any) => i.name === 'Tomatoes').sources[0].mealId, second.id);
  assert.equal(fresh.items.find((i: any) => i.name === 'Tomatoes').applied, false);
});

test('meals: admin boundary and assigned-device notes/status are enforced', async () => {
  const { db, json, request } = fixture();
  const member = await json('/api/members', 'POST', { name: 'Ada', color: '#112233' });
  const owner = await createApiKey(db, 'Ada phone', 'display', { owner: member.id });
  const shared = await createApiKey(db, 'Wall', 'display', { owner: 'shared' });
  const meal = await json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', title: 'Picnic', assigneeMemberId: member.id });
  assert.equal((await json(`/api/meals?${range}`, 'GET', undefined, shared.key))[0].id, meal.id);
  assert.equal((await request('/api/recipes', 'POST', { name: 'X' }, owner.key)).status, 403);
  assert.equal((await request(`/api/meals/${meal.id}`, 'PATCH', { title: 'X' }, owner.key)).status, 403);
  assert.equal((await request(`/api/meals/${meal.id}`, 'PATCH', { notes: 'X' }, shared.key)).status, 403);
  assert.equal((await request(`/api/meals/${meal.id}`, 'DELETE', undefined, owner.key)).status, 403);
  assert.equal((await json(`/api/meals/${meal.id}`, 'PATCH', { notes: 'Done', status: 'handled' }, owner.key)).status, 'handled');
});

test('meals: invalid dates, ranges, servings, URLs and references are rejected before writes', async () => {
  const { json, request } = fixture();
  for (const patch of [{ date: '2026-02-30' }, { servings: 0 }, { servings: -1 }, { plannedTime: '25:01' }, { assigneeMemberId: 'missing' }, { recipeId: 'missing' }, { sourceUrl: 'javascript:alert(1)' }]) {
    assert.equal((await request('/api/meals', 'POST', { date: dates.from, slot: 'dinner', title: 'Test', ...patch })).status, 400, JSON.stringify(patch));
  }
  for (const q of ['from=2026-10-08&to=2026-10-01', 'from=2026-01-01&to=2030-01-01', 'from=2026-02-30&to=2026-03-01']) assert.equal((await request(`/api/meals?${q}`)).status, 400);
  assert.equal((await request('/api/recipes', 'POST', { name: 'Bad', defaultServings: 0 })).status, 400);
  assert.deepEqual(await json(`/api/meals?${range}`), []);
});

test('meals: local calendar creation uses household time, is repeatable, links read-only events, and never writes externally', async () => {
  const { json, request } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const meal = await json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', title: 'Tacos', plannedTime: '18:00' });
  const linked = await json(`/api/meals/${meal.id}/calendar-event`, 'POST', {});
  const event = await json(`/api/events/${linked.calendarEventId}`);
  assert.equal(event.start, '2026-10-05T22:00:00.000Z'); assert.equal(event.title, 'Dinner · Tacos');
  assert.equal((await json(`/api/meals/${meal.id}/calendar-event`, 'POST', {})).calendarEventId, event.id);
  await json(`/api/meals/${meal.id}/calendar-link`, 'DELETE');
  assert.equal((await json(`/api/events/${event.id}`)).id, event.id);
  await json(`/api/meals/${meal.id}/calendar-link`, 'POST', { eventId: event.id });
  const allDay = await json('/api/meals', 'POST', { date: '2026-12-31', slot: 'lunch', mealKind: 'dining_out' });
  const dayLink = await json(`/api/meals/${allDay.id}/calendar-event`, 'POST', {});
  const dayEvent = await json(`/api/events/${dayLink.calendarEventId}`);
  assert.equal(dayEvent.allDay, true); assert.equal(dayEvent.end, '2027-01-01');
  const remote = await json('/api/calendars', 'POST', { kind: 'ics', name: 'Read only', url: 'https://example.com/events.ics' });
  await json(`/api/meals/${allDay.id}/calendar-link`, 'DELETE');
  assert.equal((await request(`/api/meals/${allDay.id}/calendar-event`, 'POST', { calendarId: remote.id })).status, 400);
});

test('meals: generated calendar links clear when deleted and follow canonical meal edits', async () => {
  const { json } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const meal = await json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', title: 'Tacos', plannedTime: '18:00', notes: 'Old note' });
  const linked = await json(`/api/meals/${meal.id}/calendar-event`, 'POST', {});
  assert.equal((await json(`/api/events/${linked.calendarEventId}`)).description, 'Old note', 'set once, at creation');
  await json(`/api/events/${linked.calendarEventId}`, 'PATCH', { description: 'Bring napkins' });
  await json(`/api/meals/${meal.id}`, 'PATCH', { title: 'Pasta', plannedTime: '19:00', notes: 'New note' });
  const updated = await json(`/api/events/${linked.calendarEventId}`);
  assert.equal(updated.title, 'Dinner · Pasta');
  assert.equal(updated.start, '2026-10-05T23:00:00.000Z');
  assert.equal(updated.description, 'Bring napkins', 'a note typed on the event survives meal edits');
  await json(`/api/events/${linked.calendarEventId}`, 'DELETE');
  assert.equal((await json(`/api/meals/${meal.id}`)).calendarEventId, null);
  const recreated = await json(`/api/meals/${meal.id}/calendar-event`, 'POST', {});
  assert.equal(recreated.calendarEventId, linked.calendarEventId);
  assert.equal((await json(`/api/events/${linked.calendarEventId}`)).title, 'Dinner · Pasta');
});

test('meals: deleting a meal removes the event Kinwall created and keeps a linked event of your own', async () => {
  const { json, request } = fixture();
  const made = await json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', title: 'Tacos', plannedTime: '18:00' });
  const eventId = (await json(`/api/meals/${made.id}/calendar-event`, 'POST', {})).calendarEventId;
  const calendarId = (await json(`/api/events/${eventId}`)).calendarId;
  const own = await json('/api/events', 'POST', { calendarId, title: 'Grandma visits', start: '2026-10-06T18:00:00Z', end: '2026-10-06T20:00:00Z', allDay: false });
  const linked = await json('/api/meals', 'POST', { date: '2026-10-06', slot: 'dinner', title: 'Roast' });
  await json(`/api/meals/${linked.id}/calendar-link`, 'POST', { eventId: own.id });

  await json(`/api/meals/${made.id}`, 'DELETE');
  assert.equal((await request(`/api/events/${eventId}`)).status, 404);
  await json(`/api/meals/${linked.id}`, 'DELETE');
  assert.equal((await json(`/api/events/${own.id}`)).title, 'Grandma visits');
  assert.equal((await request(`/api/meals/${made.id}`, 'DELETE')).status, 404);
});

test('meals: export/import preserves snapshots and source claims; older exports remain valid', async () => {
  const source = fixture(); const target = fixture();
  const recipe = await source.json('/api/recipes', 'POST', { name: 'Tacos', ingredients: [{ name: 'Tomatoes', quantity: 2 }] });
  const meal = await source.json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', recipeId: recipe.id });
  const list = await source.json('/api/lists', 'POST', { name: 'Groceries', kind: 'shopping' });
  await source.json('/api/meals/projection/apply', 'POST', { ...dates, listId: list.id });
  const file = await source.json('/api/export');
  assert.equal(file.mealShoppingSources.length, 1);
  for (let i = 0; i < 2; i++) {
    await target.json('/api/import', 'POST', file);
    assert.deepEqual(await target.json(`/api/meals/${meal.id}`), meal);
    assert.equal((await target.json('/api/meals/projection/apply', 'POST', { ...dates, listId: list.id })).added, 0);
  }
  const restored = await target.json('/api/export');
  assert.deepEqual(restored.recipes, file.recipes);
  assert.deepEqual(restored.mealShoppingSources, file.mealShoppingSources);
  delete file.recipes; delete file.meals; delete file.mealShoppingSources;
  assert.equal((await target.request('/api/import', 'POST', file)).status, 200);
});

test('meals: board and personal snapshots use household-local dates and include tomorrow separately', async () => {
  const { json } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'Pacific/Auckland' });
  const member = await json('/api/members', 'POST', { name: 'Ada', color: '#112233' });
  const initial = await json('/api/board?days=1');
  const tomorrow = new Date(Date.parse(initial.today) + 86400000).toISOString().slice(0, 10);
  const todayMeal = await json('/api/meals', 'POST', { date: initial.today, slot: 'dinner', title: 'Tacos' });
  const nextMeal = await json('/api/meals', 'POST', { date: tomorrow, slot: 'lunch', mealKind: 'dining_out', title: 'School cafeteria' });
  const board = await json('/api/board?days=1');
  assert.deepEqual(board.meals.map((m: any) => m.id), [todayMeal.id]);
  const snapshot = await json(`/api/snapshot?member=${member.id}`);
  assert.deepEqual(snapshot.meals.map((m: any) => m.id), [todayMeal.id]);
  assert.deepEqual(snapshot.tomorrow.meals.map((m: any) => m.id), [nextMeal.id]);
});

test('meals: daily summary includes the local day meal plan, including dining out', async () => {
  const { runNotifications } = await import('../src/notify.ts');
  const { env, json } = fixture();
  await json('/api/settings', 'PATCH', { timezone: 'Pacific/Auckland' });
  await json('/api/meals', 'POST', { date: '2030-03-04', slot: 'dinner', title: 'Pizza place', mealKind: 'dining_out' });
  await json('/api/meals', 'POST', { date: '2030-03-03', slot: 'dinner', title: 'Yesterday' });
  await runNotifications(env, new Date('2030-03-03T18:30:00Z')); // March 4, 07:30 NZDT
  const feed = await json('/api/notifications');
  const summary = feed.find((n: any) => n.kind === 'summary');
  assert.match(summary.body, /Meals: Dinner · Pizza place/);
  assert.doesNotMatch(summary.body, /Yesterday/);
});

test('meals: large projections apply all ingredients with a bounded SQL batch', async () => {
  const { db, json } = fixture();
  const list = await json('/api/lists', 'POST', { name: 'Groceries', kind: 'shopping' });
  const recipe = await json('/api/recipes', 'POST', { name: 'Big recipe', ingredients: Array.from({ length: 125 }, (_, i) => ({ name: `Ingredient ${i}`, quantity: i + 1 })) });
  await json('/api/meals', 'POST', { date: dates.from, slot: 'dinner', recipeId: recipe.id });
  const projection = await shoppingProjection(db, dates.from, dates.to, list.id);
  const boundedDb = { prepare: db.prepare.bind(db), batch: <T = unknown>(statements: Parameters<typeof db.batch>[0]) => {
    assert.equal(statements.length, 4); return db.batch<T>(statements); // items, their names, their sources, the read-back
  } };
  const added = await applyProjection(boundedDb, projection, list.id, [], true);
  assert.equal(added.length, 125);
  assert.equal((await json(`/api/lists/${list.id}`)).items.length, 125);
});
