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
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown, key = 'test-admin') => app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown, key = 'test-admin'): Promise<any> => {
    const res = await request(path, method, body, key); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  return { db, env, request, json };
}

async function orderNight(f: ReturnType<typeof fixture>) {
  const sam = await f.json('/api/members', 'POST', { name: 'Sam', color: '#16a34a' });
  const leo = await f.json('/api/members', 'POST', { name: 'Leo', color: '#2563eb' });
  const place = await f.json('/api/restaurants', 'POST', { name: 'Corner Slice', menu: [{ section: 'Pizza', name: 'Cheese slice', priceCents: 350 }, { name: 'Garlic knots' }] });
  const meal = await f.json('/api/meals', 'POST', { date: '2099-10-09', slot: 'dinner', mealKind: 'dining_out', restaurantId: place.id, orderType: 'pickup', eaterIds: [sam.id, leo.id] });
  return { sam, leo, place, meal };
}

test('meal orders: a dining-out night from the binder takes its name, and leaving dining out clears it', async () => {
  const f = fixture();
  const { place, meal } = await orderNight(f);
  assert.equal(meal.title, 'Corner Slice');
  assert.equal(meal.restaurantId, place.id); assert.equal(meal.orderType, 'pickup'); assert.deepEqual(meal.orders, []);
  assert.equal((await f.request('/api/meals', 'POST', { date: '2099-10-09', slot: 'lunch', mealKind: 'dining_out', restaurantId: 'nope' })).status, 400);
  const own = await f.json('/api/meals', 'POST', { date: '2099-10-10', slot: 'dinner', mealKind: 'dining_out', title: 'Pizza party', restaurantId: place.id });
  assert.equal(own.title, 'Pizza party');
  const freeform = await f.json(`/api/meals/${meal.id}`, 'PATCH', { mealKind: 'freeform' });
  assert.equal(freeform.restaurantId, null); assert.equal(freeform.orderType, null);
  // Deleting the restaurant keeps the night, unlinked.
  await f.json(`/api/restaurants/${place.id}`, 'DELETE');
  assert.equal((await f.json(`/api/meals/${own.id}`)).restaurantId, null);
});

test('meal orders: anyone orders on the wall, a kid only for themselves, and marking it ordered locks it for kids', async () => {
  const f = fixture();
  const { sam, leo, place, meal } = await orderNight(f);
  const wall = await createApiKey(f.db, 'Wall', 'display', { owner: 'shared' });
  const leoTablet = await createApiKey(f.db, 'Leo tablet', 'display', { owner: leo.id });
  const [slice] = place.menu;
  // The wall enters Sam's order; a menu item from somewhere else loses its id, never its name.
  let saved = await f.json(`/api/meals/${meal.id}/orders/${sam.id}`, 'PUT', { items: [{ menuItemId: slice.id, name: 'Cheese slice', qty: 2 }, { menuItemId: 'elsewhere', name: 'Soda' }], note: 'Extra napkins' }, wall.key);
  assert.deepEqual(saved.orders[0].items, [{ menuItemId: slice.id, name: 'Cheese slice', qty: 2, note: null }, { menuItemId: null, name: 'Soda', qty: 1, note: null }]);
  assert.equal(saved.orders[0].note, 'Extra napkins');
  // Leo's tablet: Leo's order yes, Sam's no.
  await f.json(`/api/meals/${meal.id}/orders/${leo.id}`, 'PUT', { items: [{ name: 'Garlic knots' }] }, leoTablet.key);
  assert.equal((await f.request(`/api/meals/${meal.id}/orders/${sam.id}`, 'PUT', { items: [] }, leoTablet.key)).status, 403);
  assert.equal((await f.request(`/api/meals/${meal.id}/orders/${sam.id}`, 'DELETE', undefined, leoTablet.key)).status, 403);
  // Only parents mark it ordered or ask for orders.
  for (const key of [wall.key, leoTablet.key]) {
    assert.equal((await f.request(`/api/meals/${meal.id}`, 'PATCH', { status: 'prepared' }, key)).status, 403);
    assert.equal((await f.request(`/api/meals/${meal.id}/ask-orders`, 'POST', undefined, key)).status, 403);
  }
  await f.json(`/api/meals/${meal.id}`, 'PATCH', { status: 'prepared' });
  for (const key of [wall.key, leoTablet.key]) assert.equal((await f.request(`/api/meals/${meal.id}/orders/${leo.id}`, 'PUT', { items: [{ name: 'Fries' }] }, key)).status, 403);
  saved = await f.json(`/api/meals/${meal.id}/orders/${leo.id}`, 'PUT', { items: [{ name: 'Fries' }] });
  assert.equal(saved.orders.find((o: any) => o.memberId === leo.id).items[0].name, 'Fries');
  // No items and no note clears an order.
  saved = await f.json(`/api/meals/${meal.id}/orders/${leo.id}`, 'PUT', { items: [], note: null });
  assert.deepEqual(saved.orders.map((o: any) => o.memberId), [sam.id]);
  // Orders are for dining out only, and for real members.
  const dinner = await f.json('/api/meals', 'POST', { date: '2099-10-11', slot: 'dinner', title: 'Soup' });
  assert.equal((await f.request(`/api/meals/${dinner.id}/orders/${sam.id}`, 'PUT', { items: [{ name: 'X' }] })).status, 400);
  assert.equal((await f.request(`/api/meals/${meal.id}/orders/nobody`, 'PUT', { items: [{ name: 'X' }] })).status, 404);
});

test("meal orders: asking for orders notifies who's eating, and the event page finds the meal", async () => {
  const f = fixture();
  const { sam, leo, meal } = await orderNight(f);
  const sent = await f.json(`/api/meals/${meal.id}/ask-orders`, 'POST');
  assert.equal(sent.ok, true);
  const [note] = await f.json('/api/notifications');
  assert.equal(note.kind, 'meal');
  assert.match(note.title, /^Corner Slice, \w+day dinner: what do you want\?$/);
  assert.equal(note.body, 'Pickup. Tap to add your order.');
  assert.equal(note.url, `/#/meals?meal=${meal.id}&orders=1`);
  assert.deepEqual(note.memberIds, [sam.id, leo.id]);
  await f.json(`/api/meals/${meal.id}/calendar-event`, 'POST', {});
  const { calendarEventId } = await f.json(`/api/meals/${meal.id}`);
  const wall = await createApiKey(f.db, 'Wall', 'display', { owner: 'shared' });
  assert.equal((await f.json(`/api/events/${calendarEventId}/meal`, 'GET', undefined, wall.key)).meal.id, meal.id);
  assert.equal((await f.json('/api/events/other/meal')).meal, null);
  // Meals off: no asking.
  const settings = await f.json('/api/settings');
  await f.json('/api/settings', 'PATCH', { features: { ...settings.features, meals: false } });
  assert.equal((await f.request(`/api/meals/${meal.id}/ask-orders`, 'POST')).status, 403);
});

test("meal orders: a restaurant shows nights coming up and each person's usual; export and import keep orders", async () => {
  const f = fixture();
  const { sam, leo, place, meal } = await orderNight(f);
  await f.json(`/api/meals/${meal.id}/orders/${sam.id}`, 'PUT', { items: [{ name: 'Cheese slice', qty: 2 }] });
  let read = await f.json(`/api/restaurants/${place.id}`);
  assert.deepEqual(read.upcoming.map((u: any) => [u.mealId, u.orderType, u.orderCount, u.eaterIds.length]), [[meal.id, 'pickup', 1, 2]]);
  assert.deepEqual(read.lastOrders, []); // not ordered yet: no usual
  const past = await f.json('/api/meals', 'POST', { date: '2020-01-03', slot: 'dinner', mealKind: 'dining_out', restaurantId: place.id });
  await f.json(`/api/meals/${past.id}/orders/${leo.id}`, 'PUT', { items: [{ name: 'Garlic knots' }] });
  await f.json(`/api/meals/${past.id}`, 'PATCH', { status: 'prepared' });
  read = await f.json(`/api/restaurants/${place.id}`);
  assert.deepEqual(read.lastOrders.map((o: any) => [o.memberId, o.mealId, o.items[0].name]), [[leo.id, past.id, 'Garlic knots']]);
  assert.equal(read.upcoming.length, 1); // 2020 is long gone
  const backup = await f.json('/api/export');
  const to = fixture();
  await to.json('/api/import', 'POST', backup);
  const again = await to.json(`/api/meals/${meal.id}`);
  assert.equal(again.restaurantId, place.id); assert.equal(again.orderType, 'pickup');
  assert.deepEqual(again.orders.map((o: any) => [o.memberId, o.items[0].qty]), [[sam.id, 2]]);
});

test('meal orders: asking for orders is limited to 10 times an hour per family', async () => {
  const f = fixture();
  const { meal } = await orderNight(f);
  for (let i = 0; i < 10; i++) assert.equal((await f.request(`/api/meals/${meal.id}/ask-orders`, 'POST')).status, 200);
  const refused = await f.request(`/api/meals/${meal.id}/ask-orders`, 'POST');
  assert.equal(refused.status, 429);
  assert.match(((await refused.json()) as any).error, /asked for their orders 10 times this hour/);
});
