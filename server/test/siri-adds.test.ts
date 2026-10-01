// The phone app's Siri adds: POST /api/lists/{id}/items?skipExisting=1 never doubles an item already
// on the list (an open one is left, a ticked one unticked).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  return async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
}

test('skipExisting: an open item stays, a ticked one is unticked, a new one is added; without it, a second copy', async () => {
  const send = makeApp();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).json;
  const [garlic, milk] = (await send('POST', `/api/lists/${list.id}/items`, [{ title: 'Garlic' }, { title: 'Milk' }])).json;
  await send('PATCH', `/api/lists/${list.id}/items/${milk.id}`, { done: true });

  const res = await send('POST', `/api/lists/${list.id}/items?skipExisting=1`, [{ title: 'water' }, { title: 'garlic ' }, { title: 'MILK' }]);
  assert.equal(res.status, 201);
  const [water, g, m] = res.json;
  assert.equal(water.title, 'water');
  assert.equal(water.existing, undefined);
  assert.equal(g.id, garlic.id);
  assert.equal(g.existing, 'open');
  assert.equal(m.id, milk.id);
  assert.equal(m.existing, 'reopened');
  assert.equal(m.done, false);
  const items = (await send('GET', `/api/lists/${list.id}`)).json.items;
  assert.equal(items.length, 3);

  const plain = (await send('POST', `/api/lists/${list.id}/items`, { title: 'Garlic' })).json;
  assert.notEqual(plain[0].id, garlic.id);
  assert.equal(plain[0].existing, undefined);
});

test('skipExisting: a reopened item with steps has its steps unticked too, so it stays open', async () => {
  const send = makeApp();
  const list = (await send('POST', '/api/lists', { name: 'Packing', kind: 'todo' })).json;
  const [bag] = (await send('POST', `/api/lists/${list.id}/items`, [{ title: 'Pack bag', steps: ['Socks', 'Shirt'] }])).json;
  await send('PATCH', `/api/lists/${list.id}/items/${bag.id}`, { done: true });

  const [again] = (await send('POST', `/api/lists/${list.id}/items?skipExisting=1`, [{ title: 'pack bag' }])).json;
  assert.equal(again.existing, 'reopened');
  assert.equal(again.done, false);
  assert.equal(again.stepsDone, 0);
  // A later step edit doesn't close it again.
  const after = (await send('PATCH', `/api/lists/${list.id}/items/${bag.id}/steps/${again.steps[0].id}`, { title: 'Warm socks' })).json;
  assert.equal(after.done, false);
});
