// A list's settings are for grown-ups' devices: kids' devices and wall screens (every display key) may
// change only how a list is viewed (sort, group, keep checked), not rename, archive, delete, reassign
// or reorder lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (method: string, p: string, body?: unknown, key = ADMIN_KEY) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  const send = async (method: string, p: string, body?: unknown, key?: string) => (await (await raw(method, p, body, key)).json()) as any;
  const device = async (name: string, kind: 'kid' | 'wall', owner = 'shared') => {
    const k = await send('POST', '/api/keys', { name, scope: 'display' });
    assert.equal((await raw('PATCH', `/api/keys/${k.id}`, { kind, owner })).status, 200);
    return k.key as string;
  };
  const leo = await send('POST', '/api/members', { name: 'Leo', color: '#993366' });
  const sam = await send('POST', '/api/members', { name: 'Sam', color: '#339966' });
  return { raw, send, leo, sam, displays: { kid: await device("Leo's tablet", 'kid', leo.id), wall: await device('Kitchen wall', 'wall') } };
}

for (const who of ['kid', 'wall'] as const) {
  test(`lists: a ${who} display changes only how a list is viewed`, async () => {
    const { raw, send, leo, sam, displays } = await setup();
    const key = displays[who];
    const list = await send('POST', '/api/lists', { name: "Sam's chores", kind: 'todo', memberIds: [sam.id] });
    const other = await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' });

    for (const body of [{ name: 'Mine' }, { emoji: '🙂' }, { archived: true }, { memberIds: [leo.id] }, { kind: 'shopping' }, { sortBy: 'alpha', name: 'Mine' }]) {
      const res = await raw('PATCH', `/api/lists/${list.id}`, body, key);
      assert.equal(res.status, 403, JSON.stringify(body));
      assert.equal(((await res.json()) as any).error, 'Ask a grown-up to change this list.');
    }
    assert.equal((await raw('DELETE', `/api/lists/${list.id}`, undefined, key)).status, 403);
    assert.equal((await raw('PUT', '/api/lists/order', { ids: [other.id, list.id] }, key)).status, 403);

    const viewed = await raw('PATCH', `/api/lists/${list.id}`, { sortBy: 'alpha', groupBy: 'none', keepChecked: true }, key);
    assert.equal(viewed.status, 200, await viewed.clone().text());
    const after = (await send('GET', `/api/lists/${list.id}`)).list;
    assert.equal(after.name, "Sam's chores");
    assert.deepEqual(after.memberIds, [sam.id]);
    assert.equal(after.sortBy, 'alpha');

    // Creating a list stays open to displays.
    assert.equal((await raw('POST', '/api/lists', { name: 'Fort plans', kind: 'todo' }, key)).status, 201);
  });
}

test('lists: a parent device still changes everything', async () => {
  const { raw, send, leo } = await setup();
  const list = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  const res = await raw('PATCH', `/api/lists/${list.id}`, { name: 'House jobs', memberIds: [leo.id], archived: true });
  assert.equal(res.status, 200);
  assert.equal((await raw('PUT', '/api/lists/order', { ids: [list.id] })).status, 200);
  assert.equal((await raw('DELETE', `/api/lists/${list.id}`)).status, 200);
});
