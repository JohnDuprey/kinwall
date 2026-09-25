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

function makeApp(env: Env) {
  const app = createApp();
  const rest = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${ADMIN_KEY}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
  let nextId = 1;
  const mcp = async (method: string, params: unknown, key = ADMIN_KEY) => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    });
    if (key) headers.set('Authorization', `Bearer ${key}`);
    const res = await app.request(
      '/mcp',
      { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) },
      env,
    );
    return res;
  };
  return { rest, mcp };
}

test('mcp: 401 without a key, with WWW-Authenticate: Bearer', async () => {
  const env = makeEnv();
  const { mcp } = makeApp(env);
  const res = await mcp('tools/list', {}, '');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('WWW-Authenticate') ?? '', /^Bearer resource_metadata="http[^"]+\/\.well-known\/oauth-protected-resource"$/);
});

test('mcp: initialize handshake', async () => {
  const env = makeEnv();
  const { mcp } = makeApp(env);
  const res = await mcp('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0' },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.result.serverInfo.name, 'kinwall');
});

test('mcp: tools/list returns the tools', async () => {
  const env = makeEnv();
  const { mcp } = makeApp(env);
  const res = await mcp('tools/list', {});
  const body = await res.json() as any;
  const names = body.result.tools.map((t: any) => t.name).sort();
  assert.deepEqual(names, [
    'add_list_items',
    'add_member',
    'complete_chore',
    'create_chore',
    'create_event',
    'create_list',
    'delete_event',
    'get_household',
    'get_leaderboard',
    'get_list',
    'list_categories',
    'list_chores',
    'list_events',
    'list_lists',
    'send_notification',
    'set_event_category',
    'set_list_item_done',
    'uncomplete_chore',
    'update_event',
    'update_list',
    'update_list_item',
  ]);
});

test('mcp: list_events and complete_chore round-trip against the sqlite adapter', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);

  const member = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Max', color: '#ff0000' }) })).json() as any;
  const cal = await (await rest('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json() as any;
  await rest('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: cal.id, title: 'Soccer', start: '2026-05-01T17:00:00.000Z', end: '2026-05-01T18:00:00.000Z', allDay: false, memberIds: [member.id] }),
  });
  const chore = await (await rest('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Make bed', memberId: member.id, dueDate: '2026-05-01' }) })).json() as any;

  const listRes = await mcp('tools/call', { name: 'list_events', arguments: { from: '2026-05-01', to: '2026-05-02' } });
  const listBody = await listRes.json() as any;
  assert.equal(listBody.result.isError, undefined);
  assert.equal(listBody.result.structuredContent.events.length, 1);
  assert.equal(listBody.result.structuredContent.events[0].title, 'Soccer');

  const completeRes = await mcp('tools/call', { name: 'complete_chore', arguments: { choreId: chore.id, date: '2026-05-01', member: 'max' } });
  const completeBody = await completeRes.json() as any;
  assert.equal(completeBody.result.isError, undefined);

  const day = await (await rest('/api/chores/day?date=2026-05-01')).json() as any;
  assert.equal(day[0].completed, true);
  assert.equal(day[0].completedBy, member.id);
});

test('mcp: member name resolution - exact, ambiguous, and not found', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Emma', color: '#111111' }) });
  await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Emmanuel', color: '#222222' }) });

  const chore = await (await rest('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Dishes' }) })).json() as any;

  const ambiguous = await mcp('tools/call', { name: 'complete_chore', arguments: { choreId: chore.id, date: '2026-05-01', member: 'em' } });
  const ambiguousBody = await ambiguous.json() as any;
  assert.equal(ambiguousBody.result.isError, true);
  assert.match(ambiguousBody.result.content[0].text, /multiple members/);

  const notFound = await mcp('tools/call', { name: 'complete_chore', arguments: { choreId: chore.id, date: '2026-05-01', member: 'nobody' } });
  const notFoundBody = await notFound.json() as any;
  assert.equal(notFoundBody.result.isError, true);
  assert.match(notFoundBody.result.content[0].text, /no member found/);

  const exact = await mcp('tools/call', { name: 'complete_chore', arguments: { choreId: chore.id, date: '2026-05-01', member: 'Emma' } });
  const exactBody = await exact.json() as any;
  assert.equal(exactBody.result.isError, undefined);
});

test('mcp: add_list_items resolves a list by name and a member by name, and returns the created items', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const member = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Max', color: '#ff0000' }) })).json() as any;
  const list = await (await rest('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) })).json() as any;

  const res = await mcp('tools/call', {
    name: 'add_list_items',
    arguments: { listName: 'groceries', items: ['Milk', { title: 'Eggs', quantity: '1 dozen', member: 'max' }] },
  });
  const body = await res.json() as any;
  assert.equal(body.result.isError, undefined);
  const items = body.result.structuredContent.items;
  assert.equal(items.length, 2);
  assert.equal(items[0].listId, list.id);
  assert.equal(items[1].memberId, member.id);
});

test('mcp: create_list makes a list that add_list_items can then use by name', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const member = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Max', color: '#ff0000' }) })).json() as any;

  const created = await (await mcp('tools/call', { name: 'create_list', arguments: { name: 'Costco run', kind: 'shopping', emoji: '🛒', members: ['max'] } })).json() as any;
  assert.equal(created.result.isError, undefined);
  assert.equal(created.result.structuredContent.list.kind, 'shopping');
  assert.deepEqual(created.result.structuredContent.list.memberIds, [member.id]);

  const added = await (await mcp('tools/call', { name: 'add_list_items', arguments: { listName: 'costco run', items: ['Milk'] } })).json() as any;
  assert.equal(added.result.structuredContent.items.length, 1);

  const bad = await (await mcp('tools/call', { name: 'create_list', arguments: { name: 'X', members: ['nobody'] } })).json() as any;
  assert.equal(bad.result.isError, true);
});

test('mcp: a display key calling an admin-only action gets isError, not a thrown error', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const displayKey = await (await rest('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) })).json() as any;

  // add_member -> POST /api/members, which is admin-only (not in the display allow-list).
  const res = await mcp('tools/call', { name: 'add_member', arguments: { name: 'Nope', color: '#000000' } }, displayKey.key);
  const body = await res.json() as any;
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /display key cannot access/);
});

test('mcp: send_notification resolves member names and wraps POST /api/notify', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const member = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#e57' }) })).json() as any;

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 201 })) as typeof fetch;
  let res: Response;
  try {
    res = await mcp('tools/call', { name: 'send_notification', arguments: { title: 'Hi', body: 'There', members: ['Ava'] } });
  } finally {
    globalThis.fetch = realFetch;
  }
  const body = await res.json() as any;
  assert.equal(body.result.isError, undefined);
  assert.match(body.result.content[0].text, /Sent to 0 device/); // no subscriptions registered - still a valid, non-erroring call
  void member;
});

test('mcp: array arguments sent as JSON text are accepted, and still advertised as arrays', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const cal = await (await rest('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Fam' }) })).json() as any;
  await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Max', color: '#ff0000' }) });

  const res = await (await mcp('tools/call', {
    name: 'create_event',
    arguments: { calendarId: cal.id, title: 't', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z', reminders: '[15]', members: '["max"]' },
  })).json() as any;
  assert.equal(res.result.isError, undefined, JSON.stringify(res));
  assert.deepEqual(res.result.structuredContent.event.reminders, [15]);
  assert.equal(res.result.structuredContent.event.memberIds.length, 1);

  const list = await (await mcp('tools/list', {})).json() as any;
  const schema = list.result.tools.find((t: any) => t.name === 'create_event').inputSchema;
  assert.equal(schema.properties.reminders.type === 'array' || schema.properties.reminders.anyOf?.some((s: any) => s.type === 'array'), true, JSON.stringify(schema.properties.reminders));
  assert.equal(schema.properties.members.type, 'array', JSON.stringify(schema.properties.members));
});

test('mcp: update_list switches kind; update_list_item assigns by member name and unassigns with null', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const june = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'June', color: '#ff0000' }) })).json() as any;
  const list = await (await rest('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Living room reset', kind: 'todo' }) })).json() as any;
  const [item] = await (await rest(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Socks' }) })).json() as any[];

  const upd = await (await mcp('tools/call', { name: 'update_list', arguments: { list: 'living room reset', kind: 'reusable' } })).json() as any;
  assert.equal(upd.result.structuredContent.list.kind, 'reusable');

  const a = await (await mcp('tools/call', { name: 'update_list_item', arguments: { list: list.id, itemId: item.id, member: 'june' } })).json() as any;
  assert.equal(a.result.structuredContent.item.memberId, june.id);
  const b = await (await mcp('tools/call', { name: 'update_list_item', arguments: { list: list.id, itemId: item.id, member: null } })).json() as any;
  assert.equal(b.result.structuredContent.item.memberId, null);
});

test('mcp: every tool declares permission hints, and the server advertises its icon', async () => {
  const env = makeEnv();
  const { mcp } = makeApp(env);
  const tools = (await (await mcp('tools/list', {})).json() as any).result.tools as any[];
  for (const t of tools) assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name} has no hints`);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  assert.equal(byName.list_events.readOnlyHint, true);
  assert.equal(byName.create_list.readOnlyHint, false);
  assert.equal(byName.delete_event.destructiveHint, true);

  const init = await (await mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json() as any;
  assert.match(init.result.serverInfo.icons[0].src, /\/icon-512\.png$/);
  assert.equal(init.result.serverInfo.title, 'Kinwall');
});

test('mcp: every tool declares an output schema, and real results pass it', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const tools = (await (await mcp('tools/list', {})).json() as any).result.tools as any[];
  for (const t of tools) assert.equal(t.outputSchema?.type, 'object', `${t.name} has no output schema`);

  // A small but realistic household, then every tool once.
  await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#ff0000', avatar: '🦄' }) });
  await rest('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'School', emoji: '🏫', color: '#3366ff', keywords: ['school'] }) });
  const cal = await (await rest('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json() as any;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const body = await (await mcp('tools/call', { name, arguments: args })).json() as any;
    assert.equal(body.error, undefined, `${name}: ${JSON.stringify(body.error)}`);
    assert.notEqual(body.result.isError, true, `${name}: ${JSON.stringify(body.result.content)}`);
    return body.result.structuredContent;
  };
  const today = new Date().toISOString().slice(0, 10);
  const ev = (await call('create_event', { calendarId: cal.id, title: 'School play', start: `${today}T18:00:00Z`, end: `${today}T19:00:00Z`, members: ['ava'], reminders: [30] })).event;
  await call('get_household');
  await call('list_events', { from: today });
  await call('update_event', { id: ev.id, title: 'School play!' });
  await call('set_event_category', { id: ev.id, category: 'school' });
  await call('list_categories');
  const chore = (await call('create_chore', { title: 'Feed cat', emoji: '🐱', member: 'ava', rrule: 'FREQ=DAILY', points: 2 })).chore;
  await call('complete_chore', { choreId: chore.id, date: today });
  await call('list_chores', { date: today });
  await call('uncomplete_chore', { choreId: chore.id, date: today });
  await call('get_leaderboard', { period: 'week' });
  await call('add_member', { name: 'Bo', color: '#00aa00', avatar: '🦖' });
  const list = (await call('create_list', { name: 'Groceries', kind: 'shopping', emoji: '🛒' })).list;
  const [item] = (await call('add_list_items', { listName: 'groceries', items: [{ title: 'Milk', store: 'Costco', category: 'Dairy', quantity: '2' }] })).items;
  await call('update_list_item', { list: list.id, itemId: item.id, member: 'ava' });
  await call('set_list_item_done', { listId: list.id, itemId: item.id, done: true });
  await call('update_list', { list: 'groceries', emoji: '🥛' });
  await call('get_list', { list: 'groceries' });
  await call('list_lists');
  await call('send_notification', { title: 'Hi', body: 'Dinner' });
  await call('delete_event', { id: ev.id });
});
