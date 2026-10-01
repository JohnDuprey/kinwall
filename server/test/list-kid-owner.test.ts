// A kid's own device follows the chores rule on lists: it changes only items that are theirs, nobody's,
// or on a list that's theirs. Adding stays open; wall screens, parents' devices and MCP are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  // Every INSERT/UPDATE/DELETE prepared on the list tables.
  const writes: string[] = [];
  const counted = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => { if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql) && /\b(list_items|list_item_steps|lists)\b/.test(sql)) writes.push(sql); return target.prepare(sql); };
      const v = (target as any)[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const env: Env = { DB: counted as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (method: string, p: string, body?: unknown, key = ADMIN_KEY) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  const send = async (method: string, p: string, body?: unknown, key?: string) => (await (await raw(method, p, body, key)).json()) as any;
  let rpc = 1;
  const tool = async (name: string, args: unknown) => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } }),
    }, env);
    return ((await res.json()) as any).result;
  };
  // A key for a device: a kid's (display, owned by a kid), a wall screen (display, shared) or a grown-up's phone (admin, owned).
  const device = async (name: string, scope: 'admin' | 'display', kind: 'kid' | 'wall' | 'grownup', owner?: string) => {
    const k = await send('POST', '/api/keys', { name, scope });
    const res = await raw('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' });
    assert.equal(res.status, 200, await res.text());
    return k.key as string;
  };
  const family = async () => {
    const alex = await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true });
    const leo = await send('POST', '/api/members', { name: 'Leo', color: '#993366' });
    const maya = await send('POST', '/api/members', { name: 'Maya', color: '#339966' });
    return {
      alex, leo, maya,
      leoKey: await device('Leo\'s tablet', 'display', 'kid', leo.id),
      wallKey: await device('Kitchen wall', 'display', 'wall'),
      alexKey: await device('Alex\'s phone', 'admin', 'grownup', alex.id),
    };
  };
  return { raw, send, tool, writes, db, family };
}


async function setup() {
  const app = makeApp();
  const fam = await app.family();
  const { send } = app;
  const family = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  const leos = await send('POST', '/api/lists', { name: 'Leo\'s room', kind: 'reusable', memberIds: [fam.leo.id] });
  const [mine, anyone, hers] = await send('POST', `/api/lists/${family.id}/items`, [
    { title: 'Feed the cat', memberId: fam.leo.id }, { title: 'Water plants' }, { title: 'Practice piano', memberId: fam.maya.id, steps: ['Scales'] },
  ]);
  const [hersOnLeos] = await send('POST', `/api/lists/${leos.id}/items`, { title: 'Lend Maya a book', memberId: fam.maya.id });
  return { ...app, ...fam, family, leos, mine, anyone, hers, hersOnLeos };
}
const NOT_YOURS = { error: 'This device can only do that for Leo.' };

test('kid device: ticks their own, unassigned and their own list\'s items; not someone else\'s', async () => {
  const { raw, family, leos, mine, anyone, hers, hersOnLeos, leoKey } = await setup();
  const tick = (list: string, id: string) => raw('PATCH', `/api/lists/${list}/items/${id}`, { done: true }, leoKey);
  assert.equal((await tick(family.id, mine.id)).status, 200);
  assert.equal((await tick(family.id, anyone.id)).status, 200);
  assert.equal((await tick(leos.id, hersOnLeos.id)).status, 200, 'on a list that is theirs');
  const res = await tick(family.id, hers.id);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), NOT_YOURS);
});

test('kid device: no editing, deleting, moving or step ticks on someone else\'s item; adding stays open', async () => {
  const { raw, send, family, hers, maya, leoKey } = await setup();
  const other = await send('POST', '/api/lists', { name: 'Weekend', kind: 'todo' });
  const base = `/api/lists/${family.id}/items/${hers.id}`;
  for (const [method, p, body] of [
    ['PATCH', base, { notes: 'mine now' }],
    ['DELETE', base, undefined],
    ['POST', `/api/lists/${family.id}/items/move`, { itemIds: [hers.id], toListId: other.id }],
    ['PATCH', `${base}/steps/${hers.steps[0].id}`, { done: true }],
    ['POST', `${base}/steps`, { title: 'Arpeggios' }],
    ['DELETE', `${base}/steps/${hers.steps[0].id}`, undefined],
  ] as const) {
    const res = await raw(method, p, body, leoKey);
    assert.equal(res.status, 403, `${method} ${p}`);
  }
  const still = (await send('GET', `/api/lists/${family.id}`)).items.find((i: any) => i.id === hers.id);
  assert.deepEqual([still.notes, still.steps.length, still.steps[0].done], [null, 1, false]);
  const added = await raw('POST', `/api/lists/${family.id}/items`, { title: 'Cereal', memberId: maya.id }, leoKey);
  assert.equal(added.status, 201, 'adding, even for someone else, stays open');
});

test('kid device: Reset and Checkout sweep only what they may touch; picked items must all be theirs', async () => {
  const { raw, send, family, leos, mine, anyone, hers, hersOnLeos, leoKey } = await setup();
  for (const [l, i] of [[family.id, mine.id], [family.id, anyone.id], [family.id, hers.id], [leos.id, hersOnLeos.id]]) await send('PATCH', `/api/lists/${l}/items/${i}`, { done: true });

  const picked = await raw('POST', `/api/lists/${family.id}/reset`, { itemIds: [mine.id, hers.id] }, leoKey);
  assert.equal(picked.status, 403);
  assert.equal((await raw('POST', `/api/lists/${family.id}/clear-completed`, { itemIds: [hers.id] }, leoKey)).status, 403);

  assert.deepEqual(await send('POST', `/api/lists/${family.id}/reset`, undefined, leoKey), { reset: 2 });
  const after = (await send('GET', `/api/lists/${family.id}`)).items;
  assert.deepEqual(after.filter((i: any) => i.done).map((i: any) => i.title), ['Practice piano'], 'Maya\'s stays ticked');

  await send('PATCH', `/api/lists/${family.id}/items/${mine.id}`, { done: true });
  assert.deepEqual(await send('POST', `/api/lists/${family.id}/clear-completed`, undefined, leoKey), { deleted: 1 });
  assert.deepEqual((await send('GET', `/api/lists/${family.id}`)).items.map((i: any) => i.title).sort(), ['Practice piano', 'Water plants']);

  // Their own list: everything on it.
  assert.deepEqual(await send('POST', `/api/lists/${leos.id}/reset`, undefined, leoKey), { reset: 1 });
});

test('kid device rule: wall screens, parents\' devices and MCP are unchanged', async () => {
  const { raw, tool, family, hers, anyone, wallKey, alexKey } = await setup();
  assert.equal((await raw('PATCH', `/api/lists/${family.id}/items/${hers.id}`, { done: true }, wallKey)).status, 200);
  assert.equal((await raw('PATCH', `/api/lists/${family.id}/items/${hers.id}`, { done: false }, alexKey)).status, 200);
  assert.equal((await raw('PATCH', `/api/lists/${family.id}/items/${hers.id}`, { notes: 'Ok' })).status, 200);
  assert.ok(!(await tool('set_list_item_done', { listId: family.id, itemId: anyone.id, done: true })).isError);
  assert.equal((await raw('POST', `/api/lists/${family.id}/reset`, { itemIds: [hers.id] }, wallKey)).status, 200);
});
