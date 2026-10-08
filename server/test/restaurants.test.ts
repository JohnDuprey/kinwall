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

test('restaurants: the binder keeps menus in order, and menu edits keep items and their stars', async () => {
  const { json, request } = fixture();
  const place = await json('/api/restaurants', 'POST', { name: 'Corner Slice', cuisine: 'Pizza', phone: '555-0100', orderUrl: 'https://example.com/order', menu: [
    { section: 'Pizza', name: 'Large cheese', priceCents: 1499, favorite: true }, { section: 'Sides', name: 'Garlic knots', priceCents: 550 },
  ] });
  assert.equal(place.menu.length, 2);
  assert.deepEqual(place.menu.map((i: any) => [i.section, i.name, i.favorite, i.sort]), [['Pizza', 'Large cheese', true, 0], ['Sides', 'Garlic knots', false, 1]]);
  const [cheese, knots] = place.menu;
  // Unstar the cheese, star the knots, add one: ids survive; an id from somewhere else doesn't.
  const edited = await json(`/api/restaurants/${place.id}`, 'PATCH', { menu: [{ ...cheese, favorite: false }, { ...knots, favorite: true }, { id: 'not-mine', name: 'Salad' }] });
  assert.deepEqual(edited.menu.map((i: any) => i.id).slice(0, 2), [cheese.id, knots.id]);
  assert.notEqual(edited.menu[2].id, 'not-mine');
  assert.deepEqual(edited.menu.map((i: any) => i.favorite), [false, true, false]);
  // Leaving the menu out leaves it alone.
  assert.equal((await json(`/api/restaurants/${place.id}`, 'PATCH', { notes: 'Cash only' })).menu.length, 3);
  await json('/api/restaurants', 'POST', { name: 'Golden Bowl', cuisine: 'Chinese', menu: [{ name: 'Lo mein' }] });
  assert.deepEqual((await json('/api/restaurants')).map((r: any) => r.name), ['Corner Slice', 'Golden Bowl']);
  assert.deepEqual((await json('/api/restaurants?search=lo%20mein')).map((r: any) => r.name), ['Golden Bowl']);
  assert.deepEqual((await json('/api/restaurants?search=100%25')).map((r: any) => r.name), []);
  await json(`/api/restaurants/${place.id}`, 'PATCH', { archived: true });
  assert.deepEqual((await json('/api/restaurants')).map((r: any) => r.name), ['Golden Bowl']);
  assert.equal((await json('/api/restaurants?archived=true')).length, 2);
  await json(`/api/restaurants/${place.id}`, 'DELETE');
  assert.equal((await request(`/api/restaurants/${place.id}`)).status, 404);
  assert.equal((await request('/api/restaurants', 'POST', { name: ' ' })).status, 400);
  assert.equal((await request('/api/restaurants', 'POST', { name: 'X', website: 'javascript:alert(1)' })).status, 400);
});

test('restaurants: pasted menu text is read for review, not saved', async () => {
  const { json } = fixture();
  const { items } = await json('/api/restaurants/parse-menu', 'POST', { text: 'Pizza\nCheese 12.99\nPepperoni $14\nPepperoni, basil' });
  assert.deepEqual(items, [{ section: 'Pizza', name: 'Cheese', priceCents: 1299, description: null }, { section: 'Pizza', name: 'Pepperoni', priceCents: 1400, description: 'Pepperoni, basil' }]);
  assert.deepEqual(await json('/api/restaurants'), []);
});

test('restaurants: walls and kids read the binder; only parents change it', async () => {
  const { db, json, request } = fixture();
  const leo = await json('/api/members', 'POST', { name: 'Leo', color: '#2563eb' });
  const wall = await createApiKey(db, 'Wall', 'display', { owner: 'shared' });
  const kid = await createApiKey(db, 'Leo tablet', 'display', { owner: leo.id });
  const place = await json('/api/restaurants', 'POST', { name: 'Corner Slice', menu: [{ name: 'Cheese' }] });
  for (const key of [wall.key, kid.key]) {
    assert.equal((await json('/api/restaurants', 'GET', undefined, key)).length, 1);
    assert.equal((await json(`/api/restaurants/${place.id}`, 'GET', undefined, key)).menu.length, 1);
    assert.equal((await request('/api/restaurants', 'POST', { name: 'X' }, key)).status, 403);
    assert.equal((await request(`/api/restaurants/${place.id}`, 'PATCH', { menu: [] }, key)).status, 403);
    assert.equal((await request(`/api/restaurants/${place.id}`, 'DELETE', undefined, key)).status, 403);
    assert.equal((await request('/api/restaurants/parse-menu', 'POST', { text: 'A $1' }, key)).status, 403);
  }
});

test('restaurants: export and import bring the binder back', async () => {
  const from = fixture();
  await from.json('/api/restaurants', 'POST', { name: 'Golden Bowl', cuisine: 'Chinese', notes: 'Ask for extra sauce', menu: [{ section: 'Noodles', name: 'Lo mein', priceCents: 1095, favorite: true }] });
  const backup = await from.json('/api/export');
  assert.equal(backup.restaurants.length, 1);
  const to = fixture();
  const result = await to.json('/api/import', 'POST', backup);
  assert.equal(result.imported.restaurants, 1);
  const [place] = await to.json('/api/restaurants');
  assert.equal(place.notes, 'Ask for extra sauce');
  assert.deepEqual(place.menu.map((i: any) => [i.id, i.name, i.favorite]), backup.restaurants[0].menu.map((i: any) => [i.id, i.name, true]));
  // Importing again changes nothing.
  await to.json('/api/import', 'POST', backup);
  assert.equal((await to.json('/api/restaurants'))[0].menu.length, 1);
});
