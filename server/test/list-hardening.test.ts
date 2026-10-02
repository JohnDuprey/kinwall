// Lists from a kid's device: a bad checkout body deletes nothing, a device can't hand its items to
// someone else, and request sizes are bounded.
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
  const raw = (method: string, p: string, body?: unknown, key = ADMIN_KEY, headers: Record<string, string> = {}) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }, env));
  const send = async (method: string, p: string, body?: unknown, key?: string) => (await (await raw(method, p, body, key)).json()) as any;
  const device = async (name: string, scope: 'admin' | 'display', kind: 'kid' | 'wall', owner?: string) => {
    const k = await send('POST', '/api/keys', { name, scope });
    assert.equal((await raw('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  const leo = await send('POST', '/api/members', { name: 'Leo', color: '#993366' });
  const maya = await send('POST', '/api/members', { name: 'Maya', color: '#339966' });
  const mayaKey = await device('Maya\'s tablet', 'display', 'kid', maya.id);
  const wallKey = await device('Kitchen wall', 'display', 'wall');
  const list = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  const items = await send('POST', `/api/lists/${list.id}/items`, [{ title: 'Feed the cat' }, { title: 'Water plants' }, { title: 'Sort socks' }]);
  const get = async () => (await send('GET', `/api/lists/${list.id}`)).items as any[];
  return { app, env, raw, send, leo, maya, mayaKey, wallKey, list, items, get };
}

test('clear-completed / reset: a present but invalid body is a 400 and deletes nothing', async () => {
  const { raw, send, list, items, get } = await setup();
  for (const i of items) await send('PATCH', `/api/lists/${list.id}/items/${i.id}`, { done: true });
  const tooMany = { itemIds: Array.from({ length: 1001 }, (_, n) => `id${n}`) };
  for (const op of ['clear-completed', 'reset']) {
    for (const body of [{ itemIds: 'abc' }, tooMany, '{not json']) {
      const res = await raw('POST', `/api/lists/${list.id}/${op}`, body);
      assert.equal(res.status, 400, `${op} ${JSON.stringify(body).slice(0, 30)}`);
      assert.equal(typeof ((await res.json()) as any).error, 'string');
    }
  }
  assert.equal((await get()).filter((i) => i.done).length, 3, 'nothing was deleted or reset');
  // The legitimate "all" calls: no body, an empty object, a store only.
  assert.deepEqual(await send('POST', `/api/lists/${list.id}/reset`), { reset: 3 });
  for (const i of items) await send('PATCH', `/api/lists/${list.id}/items/${i.id}`, { done: true });
  assert.deepEqual(await send('POST', `/api/lists/${list.id}/clear-completed`, {}), { deleted: 3 });
});

test('kid device: can\'t reassign an item to someone else or tick it as someone else', async () => {
  const { raw, send, list, items, leo, maya, mayaKey, wallKey, get } = await setup();
  const patch = (body: unknown, key = mayaKey) => raw('PATCH', `/api/lists/${list.id}/items/${items[0].id}`, body, key);
  const res = await patch({ memberId: leo.id, done: true, doneBy: leo.id });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'This device can only do that for Maya.' });
  assert.equal((await patch({ memberId: leo.id })).status, 403);
  assert.equal((await patch({ done: true, doneBy: leo.id })).status, 403);
  const still = (await get())[0];
  assert.deepEqual([still.memberId, still.done, still.doneBy], [null, false, null]);
  // Themselves, and unassigning, stay fine.
  assert.equal((await patch({ memberId: maya.id, done: true, doneBy: maya.id })).status, 200);
  assert.equal((await patch({ memberId: null })).status, 200);
  // Wall screens and parents are unchanged.
  assert.equal((await patch({ memberId: leo.id, done: true, doneBy: leo.id }, wallKey)).status, 200);
  assert.equal((await send('PATCH', `/api/lists/${list.id}/items/${items[0].id}`, { memberId: maya.id, doneBy: maya.id })).memberId, maya.id);
});

test('request bodies over the default limit are a 413 { error }, chunked or not', async () => {
  const { app, env, raw, mayaKey, list } = await setup();
  const big = JSON.stringify({ title: 'x'.repeat(3 * 1024 * 1024) });
  const res = await raw('POST', `/api/lists/${list.id}/items`, big, mayaKey);
  assert.equal(res.status, 413);
  assert.equal(typeof ((await res.json()) as any).error, 'string');
  // No Content-Length: a stream.
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const chunked = await Promise.resolve(app.request(`/api/lists/${list.id}/items`, { method: 'POST', headers: { Authorization: `Bearer ${mayaKey}`, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit, env));
  assert.equal(chunked.status, 413);
  assert.equal((await raw('POST', '/mcp', big)).status, 413);
});

test('list fields a display key writes are bounded', async () => {
  const { raw, send, list, items, mayaKey } = await setup();
  const base = `/api/lists/${list.id}`;
  const long = (n: number) => 'x'.repeat(n);
  for (const body of [{ title: long(501) }, { title: 'a', notes: long(5001) }, { title: 'a', quantity: long(201) }, { title: 'a', store: long(201) }, { title: 'a', category: long(201) }, { title: 'a', steps: [long(501)] }]) {
    assert.equal((await raw('POST', `${base}/items`, body, mayaKey)).status, 400, JSON.stringify(body).slice(0, 40));
  }
  assert.equal((await raw('POST', `${base}/items`, Array.from({ length: 1001 }, () => ({ title: 'a' })), mayaKey)).status, 400);
  assert.equal((await raw('PATCH', `${base}/items/${items[0].id}`, { notes: long(5001) }, mayaKey)).status, 400);
  assert.equal((await raw('POST', `${base}/items/${items[0].id}/steps`, { title: long(501) }, mayaKey)).status, 400);
  assert.equal((await raw('PATCH', base, { name: long(201) })).status, 400);
  assert.equal((await raw('POST', '/api/lists', { name: long(201), kind: 'todo' })).status, 400);
  assert.equal((await raw('PATCH', base, { color: long(51) })).status, 400);
  assert.equal((await raw('POST', `${base}/reorder`, { itemIds: Array.from({ length: 1001 }, (_, n) => `i${n}`) })).status, 400);
  assert.equal((await raw('POST', `${base}/items/${items[0].id}/steps/reorder`, { stepIds: Array.from({ length: 501 }, (_, n) => `s${n}`) })).status, 400);
  assert.equal((await raw('PUT', `${base}/groups`, { groups: Array.from({ length: 501 }, (_, n) => ({ kind: 'store', name: `s${n}` })) })).status, 400);
  // Generous values still work.
  assert.equal((await raw('POST', `${base}/items`, { title: long(500), notes: long(5000), quantity: long(200), store: long(200), category: long(200), steps: [long(500)] }, mayaKey)).status, 201);
  assert.equal((await send('GET', base)).items.length, 4);
});
