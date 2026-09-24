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
  assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer');
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
    'delete_event',
    'get_household',
    'get_leaderboard',
    'get_list',
    'list_categories',
    'list_chores',
    'list_events',
    'list_lists',
    'set_event_category',
    'set_list_item_done',
    'uncomplete_chore',
    'update_event',
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
