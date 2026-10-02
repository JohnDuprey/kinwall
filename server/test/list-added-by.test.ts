// Who added and who checked off list items and steps (addedBy / checkedBy), and a reusable list's
// "Last done" (lastDoneAt / lastDoneBy). Written by the statements that already run - no extra writes
// on add or tick; a reset writes the list row once.
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
    return {
      alex, leo,
      leoKey: await device('Leo\'s tablet', 'display', 'kid', leo.id),
      wallKey: await device('Kitchen wall', 'display', 'wall'),
      alexKey: await device('Alex\'s phone', 'admin', 'grownup', alex.id),
    };
  };
  return { raw, send, tool, writes, db, family };
}

test('added by: each kind of device is recorded on add, tick and untick', async () => {
  const { send, tool, family } = makeApp();
  const { alex, leo, leoKey, wallKey, alexKey } = await family();
  const list = await send('POST', '/api/lists', { name: 'Groceries', kind: 'shopping' });
  const add = async (title: string, key?: string) => (await send('POST', `/api/lists/${list.id}/items`, { title }, key))[0];
  const tick = (id: string, done: boolean, key?: string) => send('PATCH', `/api/lists/${list.id}/items/${id}`, { done }, key);

  const chips = await add('Chips', leoKey);
  const milk = await add('Milk', wallKey);
  const eggs = await add('Eggs', alexKey);
  const bread = await add('Bread'); // the server's own admin key: nobody in particular
  assert.deepEqual([chips.addedBy, milk.addedBy, eggs.addedBy, bread.addedBy], [{ memberId: leo.id }, { label: 'Kitchen wall' }, { memberId: alex.id }, null]);
  assert.deepEqual([chips.checkedBy, chips.doneBy], [null, null]);

  const t1 = await tick(chips.id, true, alexKey);
  assert.deepEqual([t1.checkedBy, t1.doneBy, t1.addedBy], [{ memberId: alex.id }, alex.id, { memberId: leo.id }]);
  const t2 = await tick(milk.id, true, wallKey);
  assert.deepEqual([t2.checkedBy, t2.doneBy], [{ label: 'Kitchen wall' }, null]);
  const t3 = await tick(chips.id, false, leoKey);
  assert.deepEqual([t3.checkedBy, t3.doneBy, t3.doneAt], [null, null, null]);
  // A save that doesn't touch done keeps who checked it off.
  const t4 = await send('PATCH', `/api/lists/${list.id}/items/${milk.id}`, { notes: '2%' }, alexKey);
  assert.deepEqual(t4.checkedBy, { label: 'Kitchen wall' });

  // An AI connector (MCP) is the Assistant, adding and ticking alike; get_list shows it.
  const added = await tool('add_list_items', { listId: list.id, items: ['Apples'] });
  assert.ok(!added.isError, JSON.stringify(added));
  const detail = await send('GET', `/api/lists/${list.id}`);
  const apples = detail.items.find((i: any) => i.title === 'Apples');
  assert.deepEqual(apples.addedBy, { label: 'Assistant' });
  assert.ok(!(await tool('set_list_item_done', { listId: list.id, itemId: apples.id, done: true })).isError);
  const got = await tool('get_list', { list: list.id });
  const viaMcp = got.structuredContent.items.find((i: any) => i.title === 'Apples');
  assert.deepEqual([viaMcp.addedBy, viaMcp.checkedBy], [{ label: 'Assistant' }, { label: 'Assistant' }]);
  assert.deepEqual(got.structuredContent.items.find((i: any) => i.title === 'Chips').addedBy, { memberId: leo.id });
});

test('added by: steps record who added and ticked them; the last step ticks the item for that person', async () => {
  const { send, family } = makeApp();
  const { leo, leoKey, wallKey } = await family();
  const list = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  const [item] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Clean room', steps: ['Bed'] }, wallKey);
  assert.deepEqual(item.steps[0].addedBy, { label: 'Kitchen wall' });
  const withStep = await send('POST', `/api/lists/${list.id}/items/${item.id}/steps`, { title: 'Toys' }, leoKey);
  const toys = withStep.steps.find((s: any) => s.title === 'Toys');
  assert.deepEqual([toys.addedBy, toys.checkedBy], [{ memberId: leo.id }, null]);

  await send('PATCH', `/api/lists/${list.id}/items/${item.id}/steps/${item.steps[0].id}`, { done: true }, wallKey);
  const done = await send('PATCH', `/api/lists/${list.id}/items/${item.id}/steps/${toys.id}`, { done: true }, leoKey);
  assert.deepEqual(done.steps.map((s: any) => s.checkedBy), [{ label: 'Kitchen wall' }, { memberId: leo.id }]);
  assert.deepEqual([done.done, done.checkedBy], [true, { memberId: leo.id }], 'the last step done: the item is done, by whoever ticked it');

  const undone = await send('PATCH', `/api/lists/${list.id}/items/${item.id}/steps/${toys.id}`, { done: false }, wallKey);
  assert.deepEqual([undone.done, undone.checkedBy, undone.steps[1].checkedBy], [false, null, null]);
  assert.deepEqual(undone.steps[0].checkedBy, { label: 'Kitchen wall' }, 'the other step keeps its own');

  // Ticking the item ticks every step, for whoever ticked it.
  const all = await send('PATCH', `/api/lists/${list.id}/items/${item.id}`, { done: true }, leoKey);
  assert.deepEqual(all.steps.map((s: any) => s.checkedBy), [{ label: 'Kitchen wall' }, { memberId: leo.id }]);
});

test('added by: reset clears who checked off, and a reusable list remembers when it was last done and by whom', async () => {
  const { send, writes, family } = makeApp();
  const { leo, leoKey, wallKey } = await family();
  const list = await send('POST', '/api/lists', { name: 'Bedtime', kind: 'reusable' });
  const [teeth] = await send('POST', `/api/lists/${list.id}/items`, [{ title: 'Teeth', steps: ['Brush', 'Floss'] }, { title: 'Pajamas' }], wallKey);
  await send('PATCH', `/api/lists/${list.id}/items/${teeth.id}`, { done: true }, leoKey);
  assert.equal((await send('GET', '/api/lists')).find((l: any) => l.id === list.id).lastDoneAt, null);

  writes.length = 0;
  assert.deepEqual(await send('POST', `/api/lists/${list.id}/reset`, undefined, leoKey), { reset: 1 });
  assert.equal(writes.length, 3, `items, steps and the list's last done: ${writes.join('\n')}`);
  const detail = await send('GET', `/api/lists/${list.id}`);
  const after = detail.items.find((i: any) => i.title === 'Teeth');
  assert.deepEqual([after.done, after.checkedBy, after.doneBy, after.steps.map((s: any) => s.checkedBy), after.addedBy], [false, null, null, [null, null], { label: 'Kitchen wall' }]);
  assert.deepEqual(detail.list.lastDoneBy, { memberId: leo.id });
  assert.ok(Date.now() - Date.parse(detail.list.lastDoneAt) < 60_000);
  assert.deepEqual((await send('GET', '/api/lists')).find((l: any) => l.id === list.id).lastDoneBy, { memberId: leo.id });

  // Nothing ticked: a reset isn't a "done".
  const before = detail.list.lastDoneAt;
  await send('POST', `/api/lists/${list.id}/reset`, undefined, wallKey);
  assert.deepEqual([(await send('GET', `/api/lists/${list.id}`)).list.lastDoneBy, (await send('GET', `/api/lists/${list.id}`)).list.lastDoneAt], [{ memberId: leo.id }, before]);
});

test('added by: a chore\'s reusable checklist resets as done by whoever did the chore', async () => {
  const { send, family } = makeApp();
  const { leo, wallKey } = await family();
  const list = await send('POST', '/api/lists', { name: 'Clean room', kind: 'reusable' });
  const [bed] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Make bed' });
  await send('PATCH', `/api/lists/${list.id}/items/${bed.id}`, { done: true }, wallKey);
  const today = new Date().toISOString().slice(0, 10);
  const chore = await send('POST', '/api/chores', { title: 'Clean room', dueDate: today, points: 5, memberId: leo.id, listId: list.id });
  const res = await send('POST', `/api/chores/${chore.id}/complete`, { date: today }, wallKey);
  assert.ok(!res.error, JSON.stringify(res));
  const detail = await send('GET', `/api/lists/${list.id}`);
  assert.deepEqual([detail.items[0].done, detail.items[0].checkedBy, detail.list.lastDoneBy], [false, null, { memberId: leo.id }]);
});

test('added by: no extra writes on add or tick', async () => {
  const { send, writes, family } = makeApp();
  const { leoKey } = await family();
  const list = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  writes.length = 0;
  const [item] = await send('POST', `/api/lists/${list.id}/items`, { title: 'Feed the cat' }, leoKey);
  assert.equal(writes.length, 1, writes.join('\n'));
  writes.length = 0;
  await send('PATCH', `/api/lists/${list.id}/items/${item.id}`, { done: true }, leoKey);
  assert.equal(writes.length, 2, `the item and its steps, as before: ${writes.join('\n')}`);
});

test('added by: moving keeps it; removing the person clears it; export and import carry it', async () => {
  const { send, family } = makeApp();
  const { leo, alex, leoKey, wallKey } = await family();
  const a = await send('POST', '/api/lists', { name: 'Chores', kind: 'todo' });
  const b = await send('POST', '/api/lists', { name: 'Weekend', kind: 'todo' });
  const [item] = await send('POST', `/api/lists/${a.id}/items`, { title: 'Rake leaves', steps: ['Front'] }, leoKey);
  const [wall] = await send('POST', `/api/lists/${a.id}/items`, { title: 'Sweep' }, wallKey);
  await send('PATCH', `/api/lists/${a.id}/items/${item.id}`, { done: true }, leoKey);
  const [moved] = await send('POST', `/api/lists/${a.id}/items/move`, { itemIds: [item.id], toListId: b.id });
  assert.deepEqual([moved.addedBy, moved.checkedBy], [{ memberId: leo.id }, { memberId: leo.id }]);

  const file = await send('GET', '/api/export');
  const exported = file.lists.find((l: any) => l.id === b.id).items[0];
  assert.deepEqual([exported.addedBy, exported.checkedBy, exported.steps[0].addedBy, exported.steps[0].checkedBy], [{ memberId: leo.id }, { memberId: leo.id }, { memberId: leo.id }, { memberId: leo.id }]);

  const fresh = makeApp();
  const res = await fresh.raw('POST', '/api/import', file);
  assert.equal(res.status, 200, await res.text());
  const back = await fresh.send('GET', `/api/lists/${b.id}`);
  assert.deepEqual([back.items[0].addedBy, back.items[0].checkedBy, back.items[0].doneBy, back.items[0].steps[0].checkedBy], [{ memberId: leo.id }, { memberId: leo.id }, leo.id, { memberId: leo.id }]);
  assert.deepEqual((await fresh.send('GET', `/api/lists/${a.id}`)).items[0].addedBy, { label: 'Kitchen wall' });

  assert.equal((await send('DELETE', `/api/members/${leo.id}`)).ok, true);
  const gone = (await send('GET', `/api/lists/${b.id}`)).items[0];
  assert.deepEqual([gone.addedBy, gone.checkedBy, gone.doneBy, gone.steps[0].addedBy, gone.steps[0].checkedBy], [null, null, null, null, null]);
  assert.deepEqual((await send('GET', `/api/lists/${a.id}`)).items.find((i: any) => i.id === wall.id).addedBy, { label: 'Kitchen wall' });
  void alex;
});
