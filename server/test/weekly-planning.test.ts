import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import type { Env } from '../src/env.ts';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', PUBLIC_URL: 'http://localhost' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown, key = 'test-admin') => app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown): Promise<any> => {
    const response = await request(path, method, body); const result = await response.json();
    assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(result)}`); return result;
  };
  return { db, env, app, request, json };
}
const empty = () => ({ dinners: [], prep: [] });
const applyBody = (plan: any, draft: unknown, requestId = crypto.randomUUID()) => ({ revision: plan.revision, sourceVersion: plan.sourceVersion, requestId, draft });

async function seed(f: ReturnType<typeof fixture>) {
  const plan = await f.json('/api/weekly-plan');
  const calendar = await f.json('/api/calendars', 'POST', { name: 'Our Family', kind: 'local', color: '#123857' });
  const event = await f.json('/api/events', 'POST', { calendarId: calendar.id, title: 'Library', allDay: false, start: `${plan.dates[2]}T20:00:00Z`, end: `${plan.dates[2]}T21:00:00Z`, memberIds: [] });
  const list = await f.json('/api/lists', 'POST', { name: 'This week', kind: 'todo' });
  return { plan: await f.json('/api/weekly-plan'), event, list };
}

test('weekly planning reads the next full family week and omits hidden calendar events', async () => {
  const f = fixture(); const { event, plan } = await seed(f);
  assert.equal(plan.dates.length, 7);
  assert.equal(plan.weekStart, plan.dates[0]);
  assert.equal(plan.events[0].id, event.id);
  assert.deepEqual(plan.draft, empty());
  await f.json(`/api/events/${event.id}/hidden`, 'PUT', { scope: 'occurrence' });
  assert.equal((await f.json('/api/weekly-plan')).events.length, 0);
});

test('weekly planning rejects wall screens and children on every route', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const display = await createApiKey(f.db, 'Test wall', 'display');
  const child = await f.json('/api/members', 'POST', { name: 'Maya', color: '#123857', grownUp: false });
  const childKey = await createApiKey(f.db, 'Maya’s device', 'display', { owner: child.id });
  for (const key of [display.key, childKey.key]) for (const [path, method, body] of [
    ['/api/weekly-plan', 'GET', undefined],
    [`/api/weekly-plan/${plan.weekStart}`, 'PUT', { revision: 0, draft: empty() }],
    [`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(plan, empty())],
  ] as const) assert.equal((await f.request(path, method, body, key)).status, 403);
});

test('weekly draft persists open dinners without creating meals or tasks and refuses stale edits', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const draft = { ...empty(), dinners: [{ date: plan.dates[1], kind: 'open' }] };
  const saved = await f.json(`/api/weekly-plan/${plan.weekStart}`, 'PUT', { revision: 0, draft });
  assert.equal(saved.revision, 1);
  assert.deepEqual((await f.json('/api/weekly-plan')).draft, draft);
  assert.deepEqual(await f.json(`/api/meals?from=${plan.dates[0]}&to=${plan.dates[6]}`), []);
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}`, 'PUT', { revision: 0, draft: empty() })).status, 409);
});

test('apply atomically adds ordinary meals and linked tasks; retrying does not duplicate or overwrite them', async () => {
  const f = fixture(); const { plan, list, event } = await seed(f);
  const draft = { dinners: [{ date: plan.dates[1], kind: 'meal', title: 'Spinach pasta' }], prep: [{ id: crypto.randomUUID(), eventId: event.id, occurrenceStart: null, title: 'Pack library books', dueDate: plan.dates[1], listId: list.id }] };
  const input = applyBody(plan, draft);
  const result = await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', input);
  assert.equal(result.meals[0].title, 'Spinach pasta');
  const items = (await f.json(`/api/lists/${list.id}`)).items;
  assert.equal(items.length, 1); assert.equal(items[0].eventId, event.id); assert.equal(items[0].dueDate, plan.dates[1]);
  assert.equal(result.applied.prep[draft.prep[0].id].id, items[0].id);
  await f.json(`/api/meals/${result.meals[0].id}`, 'PATCH', { title: 'Pasta with peas' });
  const beforeRetry = f.db.prepare('SELECT total_changes() AS n').first<{ n: number }>()!.n;
  const retry = await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', input);
  assert.equal(f.db.prepare('SELECT total_changes() AS n').first<{ n: number }>()!.n, beforeRetry, 'replays do not emit changes or write revision metadata');
  assert.equal(retry.meals.length, 1); assert.equal(retry.meals[0].title, 'Pasta with peas');
  assert.equal((await f.json(`/api/lists/${list.id}`)).items.length, 1);
  const changedRetry = await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', { ...input, draft: empty() });
  assert.equal(changedRetry.status, 409);
});

test('changes after review require a new review, even when a write bypasses the event bus', async () => {
  const f = fixture(); const { plan, event } = await seed(f);
  await f.db.prepare('UPDATE events SET title = ? WHERE id = ?').bind('Library changed', event.id).run();
  const response = await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(plan, { ...empty(), dinners: [{ date: plan.dates[1], kind: 'meal', title: 'Pasta' }] }));
  assert.equal(response.status, 409);
  assert.equal((await f.json('/api/weekly-plan')).meals.length, 0);
});

test('a concurrent plan edit cannot add meals and an invalid task cannot partially add dinner', async () => {
  const f = fixture(); const { plan, list } = await seed(f);
  const dinner = { date: plan.dates[1], kind: 'meal', title: 'Pasta' };
  await f.json(`/api/weekly-plan/${plan.weekStart}`, 'PUT', { revision: plan.revision, draft: empty() });
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(plan, { dinners: [dinner], prep: [] }))).status, 409);
  const current = await f.json('/api/weekly-plan');
  const bad = { dinners: [dinner], prep: [{ id: crypto.randomUUID(), eventId: 'gone', occurrenceStart: null, title: 'Books', dueDate: plan.dates[1], listId: list.id }] };
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, bad))).status, 400);
  assert.equal((await f.json('/api/weekly-plan')).meals.length, 0);
});

test('existing dinners, disabled features, duplicate dates and invalid dates are refused', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  await f.json('/api/meals', 'POST', { date: plan.dates[1], slot: 'dinner', title: 'Tacos', mealKind: 'freeform' });
  const current = await f.json('/api/weekly-plan');
  const dinner = { date: plan.dates[1], kind: 'meal', title: 'Pasta' };
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, { dinners: [dinner], prep: [] }))).status, 409);
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}`, 'PUT', { revision: 0, draft: { dinners: [dinner, dinner], prep: [] } })).status, 400);
  assert.equal((await f.request('/api/weekly-plan?weekStart=2026-02-30')).status, 400);
  await f.db.prepare("INSERT INTO settings (key,value) VALUES ('features',?)").bind(JSON.stringify({ meals: false, lists: false, upkeep: false })).run();
  const off = await f.json('/api/weekly-plan');
  assert.deepEqual(off.meals, []); assert.deepEqual(off.lists, []); assert.deepEqual(off.suggestions, []);
  assert.equal((await f.request(`/api/weekly-plan/${off.weekStart}/apply`, 'POST', applyBody(off, { dinners: [{ ...dinner, date: off.dates[2] }], prep: [] }))).status, 400);
});

test('concurrent apply attempts use a transaction guard so exactly one wins', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const input = applyBody(plan, { dinners: [{ date: plan.dates[1], kind: 'meal', title: 'Pasta' }], prep: [] });
  const responses = await Promise.all([f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', input), f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', { ...input, requestId: crypto.randomUUID() })]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await f.json('/api/weekly-plan')).meals.length, 1);
});

test('recipe dinners reuse recipe snapshots and expired pantry food is not suggested for next week', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const recipe = await f.json('/api/recipes', 'POST', { name: 'Spinach pasta', defaultServings: 4, totalMinutes: 20, ingredients: [{ name: 'Spinach', quantity: 1, unit: 'bag' }] });
  const pantry = await f.json('/api/lists', 'POST', { name: 'Food at home', kind: 'todo', purpose: 'pantry' });
  await f.json(`/api/lists/${pantry.id}/items`, 'POST', [{ title: 'Spinach', dueDate: '2000-01-01' }]);
  assert.deepEqual((await f.json('/api/weekly-plan')).suggestions, []);
  await f.json(`/api/lists/${pantry.id}/items`, 'POST', [{ title: 'Spinach', dueDate: plan.dates[3] }]);
  const current = await f.json('/api/weekly-plan');
  assert.equal(current.suggestions[0].id, recipe.id);
  const applied = await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, { dinners: [{ date: plan.dates[1], kind: 'meal', title: recipe.name, recipeId: recipe.id }], prep: [] }));
  const meal = await f.json(`/api/meals/${applied.meals[0].id}`);
  assert.equal(meal.recipeId, recipe.id); assert.equal(meal.recipeSnapshot.ingredients[0].name, 'Spinach');
});

test('the source guard catches a write between validation and the atomic batch', async () => {
  const f = fixture(); const { plan, event } = await seed(f);
  const original = f.db.batch.bind(f.db);
  // Inject a source change just before the first write transaction, after all source reads.
  let injected = false;
  // A statement wrapper makes the exact guarded transaction observable without inspecting SQL internals.
  const prepare = f.db.prepare.bind(f.db);
  const guards = new WeakSet<object>();
  f.db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.startsWith('INSERT OR IGNORE INTO weekly_plans')) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => { const bound = bind(...values); guards.add(bound); return bound };
    return statement;
  };
  f.db.batch = <T = unknown>(statements: Parameters<typeof f.db.batch>[0]) => {
    if (!injected && guards.has(statements[0])) { injected = true; prepare('UPDATE events SET title = ? WHERE id = ?').bind('Changed after review', event.id).run(); }
    return original<T>(statements);
  };
  const response = await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(plan, { dinners: [{ date: plan.dates[1], kind: 'meal', title: 'Pasta' }], prep: [] }));
  assert.equal(response.status, 409); assert.equal(injected, true);
  assert.equal((await f.json('/api/weekly-plan')).meals.length, 0);
});

test('weekly drafts and applied links survive a JSON export and import; old exports remain accepted', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const draft = { dinners: [{ date: plan.dates[1], kind: 'open' }], prep: [] };
  await f.json(`/api/weekly-plan/${plan.weekStart}`, 'PUT', { revision: 0, draft });
  const exported = await f.json('/api/export');
  assert.deepEqual(exported.weeklyPlans[0].draft, draft);
  const other = fixture();
  await other.json('/api/import', 'POST', exported);
  assert.deepEqual((await other.json('/api/weekly-plan')).draft, draft);
  delete exported.weeklyPlans;
  await other.json('/api/import', 'POST', exported);
});

test('MCP planning tools use the parent-only routes and expose structured review and draft saving', async () => {
  const f = fixture();
  const call = async (method: string, params: unknown, key = 'test-admin') => {
    const response = await f.app.request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, f.env);
    return await response.json() as any;
  };
  const tools = (await call('tools/list', {})).result.tools;
  for (const name of ['get_weekly_plan', 'save_weekly_plan_draft', 'apply_weekly_plan']) assert.ok(tools.some((tool: any) => tool.name === name), name);
  const get = (await call('tools/call', { name: 'get_weekly_plan', arguments: {} })).result;
  assert.equal(get.isError, undefined);
  const plan = get.structuredContent;
  assert.equal(plan.dates.length, 7);
  const saved = (await call('tools/call', { name: 'save_weekly_plan_draft', arguments: { weekStart: plan.weekStart, revision: 0, draft: empty() } })).result;
  assert.equal(saved.structuredContent.revision, 1);
  const display = await createApiKey(f.db, 'Wall', 'display');
  assert.equal((await call('tools/call', { name: 'get_weekly_plan', arguments: {} }, display.key)).result.isError, true);
});

test('planning review tokens ignore idle calendar sync bookkeeping and event reminder changes', async () => {
  const f = fixture(); const { event, plan } = await seed(f);
  await f.db.prepare('UPDATE calendars SET last_synced_at = ?, sync_cursor = ? WHERE id = ?').bind(new Date().toISOString(), 'fake-cursor', event.calendarId).run();
  await f.db.prepare('UPDATE events SET reminders = ? WHERE id = ?').bind('[15]', event.id).run();
  assert.equal((await f.json('/api/weekly-plan')).sourceVersion, plan.sourceVersion);
});

test('reviewed dinner swaps update the selected meal in place and can be saved, retried and swapped again', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const old = await f.json('/api/meals', 'POST', { date: plan.dates[1], slot: 'dinner', title: 'Tacos', mealKind: 'freeform', servings: 6, notes: 'Eat together', plannedTime: '18:30' });
  const recipe = await f.json('/api/recipes', 'POST', { name: 'Spinach pasta', defaultServings: 4, ingredients: [{ name: 'Spinach', quantity: 1, unit: 'bag' }] });
  let current = await f.json('/api/weekly-plan');
  assert.equal(current.meals[0].canSwap, true);
  const draft = { dinners: [{ date: old.date, kind: 'meal', title: recipe.name, recipeId: recipe.id, replaceMealId: old.id }], prep: [] };
  current = await f.json(`/api/weekly-plan/${plan.weekStart}`, 'PUT', { revision: current.revision, draft });
  assert.equal((await f.json(`/api/meals/${old.id}`)).title, 'Tacos', 'saving a swap draft must not change the meal');
  const input = applyBody(current, draft);
  current = await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', input);
  let meal = await f.json(`/api/meals/${old.id}`);
  assert.equal(current.meals.length, 1); assert.equal(current.meals[0].id, old.id);
  assert.equal(meal.title, recipe.name); assert.equal(meal.recipeSnapshot.ingredients[0].name, 'Spinach');
  assert.equal(meal.servings, 6); assert.equal(meal.notes, old.notes); assert.equal(meal.plannedTime, old.plannedTime); assert.equal(meal.createdAt, old.createdAt);
  const before = f.db.prepare('SELECT total_changes() AS n').first<{ n: number }>()!.n;
  await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', input);
  assert.equal(f.db.prepare('SELECT total_changes() AS n').first<{ n: number }>()!.n, before);
  // A later apply of the same draft must not overwrite ordinary Meals edits.
  await f.json(`/api/meals/${old.id}`, 'PATCH', { title: 'Pasta with peas' });
  current = await f.json('/api/weekly-plan');
  await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, draft));
  assert.equal((await f.json(`/api/meals/${old.id}`)).title, 'Pasta with peas');
  current = await f.json('/api/weekly-plan');
  const again = { dinners: [{ date: old.date, kind: 'meal', title: 'Soup', replaceMealId: old.id }], prep: [] };
  await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, again));
  meal = await f.json(`/api/meals/${old.id}`);
  assert.equal(meal.title, 'Soup'); assert.equal(meal.recipeId, null); assert.equal(meal.recipeSnapshot, null);
  await f.json(`/api/meals/${old.id}`, 'DELETE');
  current = await f.json('/api/weekly-plan');
  await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, again));
  assert.equal((await f.json('/api/weekly-plan')).meals.length, 0, 'an acknowledged swap must never recreate a deleted meal');
});

test('swaps reject stale, missing, moved or ineligible targets without partial writes', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const old = await f.json('/api/meals', 'POST', { date: plan.dates[1], slot: 'dinner', title: 'Tacos', mealKind: 'freeform' });
  const draft = { dinners: [{ date: old.date, kind: 'meal', title: 'Soup', replaceMealId: old.id }, { date: plan.dates[2], kind: 'meal', title: 'Pasta' }], prep: [] };
  const current = await f.json('/api/weekly-plan');
  await f.json(`/api/meals/${old.id}`, 'PATCH', { title: 'New tacos' });
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, draft))).status, 409);
  for (const patch of [{ status: 'prepared' }, { status: 'planned', mealKind: 'dining_out' }, { mealKind: 'freeform', slot: 'lunch' }, { slot: 'dinner', date: plan.dates[3] }]) {
    await f.json(`/api/meals/${old.id}`, 'PATCH', patch);
    const next = await f.json('/api/weekly-plan');
    assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(next, draft))).status, 409);
    assert.equal((await f.json('/api/weekly-plan')).meals.length, 1);
  }
  await f.json(`/api/meals/${old.id}`, 'DELETE');
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(await f.json('/api/weekly-plan'), draft))).status, 409);
  assert.equal((await f.json('/api/weekly-plan')).meals.length, 0);
});

test('calendar-managed dinners stay in Meals so a planning swap cannot bypass event synchronization', async () => {
  const f = fixture(); const { plan, event } = await seed(f);
  const old = await f.json('/api/meals', 'POST', { date: plan.dates[1], slot: 'dinner', title: 'Tacos', mealKind: 'freeform' });
  await f.db.prepare('UPDATE meals SET calendar_event_id = ?, calendar_event_start = ? WHERE id = ?').bind(event.id, 'meal', old.id).run();
  const current = await f.json('/api/weekly-plan');
  assert.equal(current.meals[0].canSwap, false);
  const draft = { dinners: [{ date: old.date, kind: 'meal', title: 'Soup', replaceMealId: old.id }], prep: [] };
  assert.equal((await f.request(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(current, draft))).status, 409);
  assert.equal((await f.json(`/api/meals/${old.id}`)).title, 'Tacos');
});


test('a swap changes only the explicitly selected dinner when a date has more than one meal', async () => {
  const f = fixture(); const plan = await f.json('/api/weekly-plan');
  const first = await f.json('/api/meals', 'POST', { date: plan.dates[1], slot: 'dinner', title: 'Tacos', mealKind: 'freeform' });
  const other = await f.json('/api/meals', 'POST', { date: plan.dates[1], slot: 'dinner', title: 'Leftovers', mealKind: 'freeform' });
  const draft = { dinners: [{ date: first.date, kind: 'meal', title: 'Soup', replaceMealId: first.id }], prep: [] };
  await f.json(`/api/weekly-plan/${plan.weekStart}/apply`, 'POST', applyBody(await f.json('/api/weekly-plan'), draft));
  const meals = (await f.json('/api/weekly-plan')).meals;
  assert.equal(meals.length, 2); assert.equal(meals.find((m: any) => m.id === first.id).title, 'Soup');
  assert.equal(meals.find((m: any) => m.id === other.id).title, 'Leftovers');
});

test('weekly recipe choices include browsing metadata and cooking history outside the planning week', async () => {
  const f = fixture();
  const recipe = await f.json('/api/recipes', 'POST', { name: 'Soup', ingredients: [{ name: 'Carrot' }] });
  await f.json('/api/meals', 'POST', { date: '2025-01-01', slot: 'dinner', mealKind: 'recipe', recipeId: recipe.id, status: 'prepared' });
  const choice = (await f.json('/api/weekly-plan')).recipes.find((r: any) => r.id === recipe.id);
  assert.equal(choice.createdAt, recipe.createdAt);
  assert.equal(choice.cookedCount, 1);
  assert.equal(choice.lastCookedDate, '2025-01-01');
  assert.deepEqual(choice.ingredients, [{ name: 'Carrot' }]);
});
