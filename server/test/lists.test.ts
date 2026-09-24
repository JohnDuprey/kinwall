import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env, defaultKey = ADMIN_KEY) {
  const app = createApp();
  return (p: string, init: RequestInit = {}, key = defaultKey): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !p.includes('key=')) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return Promise.resolve(app.request(p, { ...init, headers }, env));
  };
}

async function json(res: Response): Promise<any> {
  return res.json();
}

test('lists: create/list, and computed itemCount/openCount', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) }));
  assert.equal(list.name, 'Groceries');
  assert.equal(list.kind, 'shopping');
  assert.equal(list.itemCount, 0);
  assert.equal(list.openCount, 0);
  assert.deepEqual(list.memberIds, []);
  assert.equal(list.archived, false);

  await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify([{ title: 'Milk' }, { title: 'Eggs' }]) });
  const patched = await json(await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Bread' }) }));
  assert.equal(patched.length, 1);
  await request(`/api/lists/${list.id}/items/${patched[0].id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });

  const all = await json(await request('/api/lists'));
  const found = all.find((l: any) => l.id === list.id);
  assert.equal(found.itemCount, 3);
  assert.equal(found.openCount, 2);
});

test('lists: shopping defaults to groupBy category, others to none; explicit groupBy wins', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const shopping = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Costco', kind: 'shopping' }) }));
  assert.equal(shopping.groupBy, 'category');

  const todo = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Chores', kind: 'todo' }) }));
  assert.equal(todo.groupBy, 'none');

  const reusable = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Packing', kind: 'reusable' }) }));
  assert.equal(reusable.groupBy, 'none');

  const overridden = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Target', kind: 'shopping', groupBy: 'store' }) }));
  assert.equal(overridden.groupBy, 'store');
});

test('lists: item bulk add always returns an array, single or multiple', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) }));

  const single = await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk' }) });
  assert.equal(single.status, 201);
  const singleBody = await json(single);
  assert.ok(Array.isArray(singleBody));
  assert.equal(singleBody.length, 1);

  const multi = await json(await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify([{ title: 'Eggs' }, { title: 'Bread' }]) }));
  assert.ok(Array.isArray(multi));
  assert.equal(multi.length, 2);
  // sort assigned in request order, continuing from the existing max.
  assert.equal(multi[0].sort, 1);
  assert.equal(multi[1].sort, 2);
});

test('lists: "remembers where things go" - omitted store/category fill from the most recent matching title; explicit null does not', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const a = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'List A', kind: 'shopping' }) }));
  const b = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'List B', kind: 'shopping' }) }));

  await request(`/api/lists/${a.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk', store: 'Costco', category: 'Dairy' }) });

  // Omitted store/category on a different list, same (trimmed/cased) title -> remembered.
  const remembered = await json(await request(`/api/lists/${b.id}/items`, { method: 'POST', body: JSON.stringify({ title: '  milk  ' }) }));
  assert.equal(remembered[0].store, 'Costco');
  assert.equal(remembered[0].category, 'Dairy');
  assert.equal(remembered[0].title, 'milk'); // trimmed

  // Explicit null means "none" - must not be filled from memory.
  const explicit = await json(await request(`/api/lists/${a.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk', store: null, category: null }) }));
  assert.equal(explicit[0].store, null);
  assert.equal(explicit[0].category, null);
});

test('lists: done/doneAt/doneBy set and cleared, updatedAt always bumped', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const member = await json(await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Sam', color: '#123456' }) }));
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) }));
  const [item] = await json(await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk' }) }));
  assert.equal(item.done, false);
  assert.equal(item.doneAt, null);

  await new Promise((r) => setTimeout(r, 2));
  const done = await json(await request(`/api/lists/${list.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ done: true, doneBy: member.id }) }));
  assert.equal(done.done, true);
  assert.ok(done.doneAt);
  assert.equal(done.doneBy, member.id);
  assert.notEqual(done.updatedAt, item.updatedAt);

  const undone = await json(await request(`/api/lists/${list.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ done: false }) }));
  assert.equal(undone.done, false);
  assert.equal(undone.doneAt, null);
  assert.equal(undone.doneBy, null);
});

test('lists: clear-completed deletes only done items; reset unchecks everything', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Packing', kind: 'reusable' }) }));
  const items = await json(await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify([{ title: 'Socks' }, { title: 'Shirts' }, { title: 'Passport' }]) }));
  await request(`/api/lists/${list.id}/items/${items[0].id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
  await request(`/api/lists/${list.id}/items/${items[1].id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });

  const cleared = await json(await request(`/api/lists/${list.id}/clear-completed`, { method: 'POST' }));
  assert.equal(cleared.deleted, 2);
  const afterClear = (await json(await request(`/api/lists/${list.id}`))).items;
  assert.equal(afterClear.length, 1);
  assert.equal(afterClear[0].title, 'Passport');

  await request(`/api/lists/${list.id}/items/${items[2].id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
  const reset = await json(await request(`/api/lists/${list.id}/reset`, { method: 'POST' }));
  assert.equal(reset.reset, 1);
  const afterReset = (await json(await request(`/api/lists/${list.id}`))).items;
  assert.equal(afterReset[0].done, false);
  assert.equal(afterReset[0].doneAt, null);
});

test('lists: reorder sets sort = index in the given order', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) }));
  const items = await json(await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify([{ title: 'A' }, { title: 'B' }, { title: 'C' }]) }));

  const res = await request(`/api/lists/${list.id}/reorder`, { method: 'POST', body: JSON.stringify({ itemIds: [items[2].id, items[0].id, items[1].id] }) });
  assert.equal(res.status, 200);
  const detail = await json(await request(`/api/lists/${list.id}`));
  assert.deepEqual(detail.items.map((i: any) => i.id), [items[2].id, items[0].id, items[1].id]);
  assert.deepEqual(detail.items.map((i: any) => i.sort), [0, 1, 2]);
});

test('lists: groups PUT replaces ordering, sort = index within kind', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) }));

  const groups = await json(
    await request(`/api/lists/${list.id}/groups`, {
      method: 'PUT',
      body: JSON.stringify({
        groups: [
          { kind: 'category', name: 'Produce' },
          { kind: 'store', name: 'Costco' },
          { kind: 'category', name: 'Dairy' },
          { kind: 'store', name: 'Target' },
        ],
      }),
    }),
  );
  assert.deepEqual(
    groups.map((g: any) => [g.kind, g.name, g.sort]),
    [
      ['category', 'Produce', 0],
      ['store', 'Costco', 0],
      ['category', 'Dairy', 1],
      ['store', 'Target', 1],
    ],
  );

  // A second PUT fully replaces the previous ordering.
  const replaced = await json(await request(`/api/lists/${list.id}/groups`, { method: 'PUT', body: JSON.stringify({ groups: [{ kind: 'category', name: 'Only' }] }) }));
  assert.equal(replaced.length, 1);
  const detail = await json(await request(`/api/lists/${list.id}`));
  assert.equal(detail.groups.length, 1);
  assert.equal(detail.groups[0].name, 'Only');
});

test('lists: 404 for unknown list and for an item that belongs to another list', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const a = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'A', kind: 'todo' }) }));
  const b = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'B', kind: 'todo' }) }));
  const [itemInA] = await json(await request(`/api/lists/${a.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Only in A' }) }));

  assert.equal((await request('/api/lists/nope')).status, 404);
  assert.equal((await request('/api/lists/nope', { method: 'PATCH', body: JSON.stringify({ name: 'x' }) })).status, 404);
  assert.equal((await request('/api/lists/nope', { method: 'DELETE' })).status, 404);
  assert.equal((await request(`/api/lists/${b.id}/items/${itemInA.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })).status, 404);
  assert.equal((await request(`/api/lists/${b.id}/items/${itemInA.id}`, { method: 'DELETE' })).status, 404);
  // Still reachable through its own list.
  assert.equal((await request(`/api/lists/${a.id}/items/${itemInA.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })).status, 200);
});

test('lists: a display key can use lists but still cannot create members', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const displayKey = await json(await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) }));
  const display = (p: string, init: RequestInit = {}) => request(p, init, displayKey.key);

  const created = await display('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) });
  assert.equal(created.status, 201);
  const list = await json(created);

  assert.equal((await display('/api/lists')).status, 200);
  assert.equal((await display(`/api/lists/${list.id}`)).status, 200);
  const itemsRes = await display(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk' }) });
  assert.equal(itemsRes.status, 201);
  const [item] = await json(itemsRes);
  assert.equal((await display(`/api/lists/${list.id}/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) })).status, 200);
  assert.equal((await display(`/api/lists/${list.id}/clear-completed`, { method: 'POST' })).status, 200);
  assert.equal((await display(`/api/lists/${list.id}/reset`, { method: 'POST' })).status, 200);
  assert.equal((await display(`/api/lists/${list.id}/reorder`, { method: 'POST', body: JSON.stringify({ itemIds: [] }) })).status, 200);
  assert.equal((await display(`/api/lists/${list.id}/groups`, { method: 'PUT', body: JSON.stringify({ groups: [] }) })).status, 200);

  // Still can't touch admin-only resources.
  assert.equal((await display('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Nope', color: '#000000' }) })).status, 403);
});

test('lists: deleting a list cascades its items and groups', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) }));
  const [item] = await json(await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk' }) }));
  await request(`/api/lists/${list.id}/groups`, { method: 'PUT', body: JSON.stringify({ groups: [{ kind: 'category', name: 'Dairy' }] }) });

  assert.equal((await request(`/api/lists/${list.id}`, { method: 'DELETE' })).status, 200);

  const itemRow = await env.DB.prepare('SELECT id FROM list_items WHERE id = ?').bind(item.id).first();
  assert.equal(itemRow, null);
  const groupRows = await env.DB.prepare('SELECT * FROM list_groups WHERE list_id = ?').bind(list.id).all();
  assert.equal((groupRows as any).results.length, 0);
});

test('lists: an unknown or invalid memberId is dropped, not stored', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const list = await json(await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping', memberIds: ['ghost'] }) }));
  assert.deepEqual(list.memberIds, []);

  const [item] = await json(await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk', memberId: 'ghost' }) }));
  assert.equal(item.memberId, null);
});
