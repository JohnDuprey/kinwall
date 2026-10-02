// A default list per shopping type (lists.is_default, migration 0088): the one barcode scans, meal
// ingredients, widgets, Siri and tiles use for Groceries or for Shopping. At most one per type.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: 'fc_test_admin_key', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = 'fc_test_admin_key') => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { send };
}

test('default lists: one per shopping type; picking another moves it; other types are untouched', async () => {
  const { send } = setup();
  const big = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping', catalog: 'groceries' })).body;
  const costco = (await send('POST', '/api/lists', { name: 'Costco', kind: 'shopping', catalog: 'groceries' })).body;
  const hardware = (await send('POST', '/api/lists', { name: 'Hardware store', kind: 'shopping', catalog: 'shopping' })).body;
  const todo = (await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' })).body;
  assert.equal(big.isDefault, false, 'nothing is the default until picked');

  assert.equal((await send('PATCH', `/api/lists/${costco.id}`, { isDefault: true })).body.isDefault, true);
  await send('PATCH', `/api/lists/${hardware.id}`, { isDefault: true });
  await send('PATCH', `/api/lists/${big.id}`, { isDefault: true });
  const byId = Object.fromEntries((await send('GET', '/api/lists')).body.map((l: any) => [l.id, l.isDefault]));
  assert.deepEqual(byId, { [big.id]: true, [costco.id]: false, [hardware.id]: true, [todo.id]: false }, 'Groceries moved to big; Shopping kept hardware');

  assert.equal((await send('PATCH', `/api/lists/${todo.id}`, { isDefault: true })).status, 400, 'only shopping lists');
  assert.equal((await send('PATCH', `/api/lists/${big.id}`, { catalog: 'shopping' })).body.isDefault, false, 'a list that changes type stops being the default');
  assert.equal((await send('PATCH', `/api/lists/${hardware.id}`, { isDefault: false })).body.isDefault, false);
});

test("default lists: wall screens and kids' devices can't change it; the export keeps it", async () => {
  const { send } = setup();
  const list = (await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' })).body;
  const wall = (await send('POST', '/api/keys', { name: 'Kitchen', scope: 'display' })).body;
  assert.equal((await send('PATCH', `/api/lists/${list.id}`, { isDefault: true }, wall.key)).status, 403);
  await send('PATCH', `/api/lists/${list.id}`, { isDefault: true });
  const exported = (await send('GET', '/api/export')).body;
  assert.equal(exported.lists.find((l: any) => l.id === list.id).isDefault, true);
  await send('PATCH', `/api/lists/${list.id}`, { isDefault: false });
  assert.ok((await send('POST', '/api/import', exported)).status < 300);
  assert.equal((await send('GET', '/api/lists')).body.find((l: any) => l.id === list.id).isDefault, true, 'restored from the export');
});
