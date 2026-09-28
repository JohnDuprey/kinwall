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
    'add_note',
    'add_tracker_entry',
    'apply_meal_projection',
    'approve_chore',
    'approve_reward',
    'complete_chore',
    'create_chore',
    'create_event',
    'create_list',
    'create_meal',
    'create_recipe',
    'create_reward',
    'decline_reward',
    'delete_chore',
    'delete_color_scheme',
    'delete_event',
    'delete_list',
    'delete_list_item',
    'delete_list_step',
    'delete_meal',
    'delete_note',
    'delete_recipe',
    'delete_reward',
    'delete_tracker_entry',
    'get_board',
    'get_event',
    'get_event_items',
    'get_household',
    'get_leaderboard',
    'get_list',
    'get_meal_projection',
    'get_points',
    'get_recipe',
    'get_snapshot',
    'import_recipe',
    'import_recipe_from_url',
    'list_categories',
    'list_chores',
    'list_color_schemes',
    'list_events',
    'list_lists',
    'list_meals',
    'list_notes',
    'list_notifications',
    'list_pending_approvals',
    'list_recipes',
    'list_reward_requests',
    'list_rewards',
    'list_tracker_entries',
    'mark_reward_given',
    'rate_recipe',
    'redeem_reward',
    'reject_chore',
    'save_color_scheme',
    'send_notification',
    'set_color_scheme',
    'set_event_category',
    'set_list_item_done',
    'set_step_done',
    'set_store_aisle_order',
    'uncomplete_chore',
    'update_category',
    'update_chore',
    'update_event',
    'update_list',
    'update_list_item',
    'update_meal',
    'update_member',
    'update_note',
    'update_recipe',
    'update_reward',
    'update_tracker_entry',
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

  // ...and it lands in the in-app feed, tagged as coming from MCP, readable via list_notifications.
  const feed = await (await mcp('tools/call', { name: 'list_notifications', arguments: {} })).json() as any;
  assert.equal(feed.result.isError, undefined);
  const [n] = feed.result.structuredContent.notifications;
  assert.equal(n.kind, 'message');
  assert.equal(n.source, 'mcp');
  assert.deepEqual(n.memberIds, [member.id]);
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

test('mcp: get_event returns a single event by id', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const cal = await (await rest('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json() as any;
  const created = await (await rest('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: cal.id, title: 'Dentist', start: '2026-06-01T15:00:00.000Z', end: '2026-06-01T16:00:00.000Z', allDay: false }),
  })).json() as any;

  const res = await (await mcp('tools/call', { name: 'get_event', arguments: { id: created.id } })).json() as any;
  assert.equal(res.result.isError, undefined);
  assert.equal(res.result.structuredContent.event.title, 'Dentist');

  const missing = await (await mcp('tools/call', { name: 'get_event', arguments: { id: 'nope' } })).json() as any;
  assert.equal(missing.result.isError, true);
});

test('mcp: update_chore resolves member by name, unassigns with null, and edits recurrence', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const june = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'June', color: '#ff0000' }) })).json() as any;
  const chore = await (await rest('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Dishes', dueDate: '2026-05-01' }) })).json() as any;

  const a = await (await mcp('tools/call', { name: 'update_chore', arguments: { choreId: chore.id, member: 'june', points: 5, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231' } })).json() as any;
  assert.equal(a.result.isError, undefined, JSON.stringify(a));
  assert.equal(a.result.structuredContent.chore.memberId, june.id);
  assert.equal(a.result.structuredContent.chore.points, 5);
  assert.equal(a.result.structuredContent.chore.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261231');

  const b = await (await mcp('tools/call', { name: 'update_chore', arguments: { choreId: chore.id, member: null } })).json() as any;
  assert.equal(b.result.structuredContent.chore.memberId, null);
});

test('mcp: update_member resolves by name and edits fields', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const member = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Max', color: '#ff0000' }) })).json() as any;

  const res = await (await mcp('tools/call', { name: 'update_member', arguments: { member: 'max', name: 'Maxwell', color: '#00ff00', avatar: '🐶' } })).json() as any;
  assert.equal(res.result.isError, undefined, JSON.stringify(res));
  assert.equal(res.result.structuredContent.member.id, member.id);
  assert.equal(res.result.structuredContent.member.name, 'Maxwell');
  assert.equal(res.result.structuredContent.member.color, '#00ff00');

  const missing = await (await mcp('tools/call', { name: 'update_member', arguments: { member: 'nobody', name: 'x' } })).json() as any;
  assert.equal(missing.result.isError, true);
});

test('mcp: update_category resolves by name and edits keywords', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const category = await (await rest('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'School', color: '#3366ff' }) })).json() as any;

  const res = await (await mcp('tools/call', { name: 'update_category', arguments: { category: 'school', color: '#ff3366', keywords: ['homework', 'class'] } })).json() as any;
  assert.equal(res.result.isError, undefined, JSON.stringify(res));
  assert.equal(res.result.structuredContent.category.id, category.id);
  assert.equal(res.result.structuredContent.category.color, '#ff3366');
  assert.deepEqual(res.result.structuredContent.category.keywords, ['homework', 'class']);

  // Arrays sent as JSON text are accepted here too (same jsonList() convention as create_event).
  const viaText = await (await mcp('tools/call', { name: 'update_category', arguments: { category: 'school', keywords: '["test"]' } })).json() as any;
  assert.deepEqual(viaText.result.structuredContent.category.keywords, ['test']);
});

// DISPLAY_ALLOWED (auth.ts) permits a display key to PATCH /api/chores/:id, /api/members/:id and
// /api/categories/:id directly (the wall iPad edits its own member/category tiles in place) - MCP
// tools call those same REST routes with the caller's own Authorization header, so they inherit
// that access rather than re-deciding scope. This asserts the new tools stay consistent with that,
// rather than accidentally being more permissive or more restrictive than the REST API itself.
test('mcp: update_chore/update_member/update_category match their REST routes\' display-scope access', async () => {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const displayKey = await (await rest('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) })).json() as any;
  const member = await (await rest('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Max', color: '#ff0000' }) })).json() as any;
  const category = await (await rest('/api/categories', { method: 'POST', body: JSON.stringify({ name: 'School', color: '#3366ff' }) })).json() as any;
  const chore = await (await rest('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Dishes', dueDate: '2026-05-01' }) })).json() as any;

  // Chores are ticked off on devices; editing them is for parents.
  const choreRes = await (await mcp('tools/call', { name: 'update_chore', arguments: { choreId: chore.id, points: 3 } }, displayKey.key)).json() as any;
  assert.equal(choreRes.result.isError, true, JSON.stringify(choreRes));

  // Members are admin-only for displays: the wall can't rename people or change their colors.
  const memberRes = await (await mcp('tools/call', { name: 'update_member', arguments: { member: member.id, color: '#00ff00' } }, displayKey.key)).json() as any;
  assert.equal(memberRes.result.isError, true, JSON.stringify(memberRes));

  const categoryRes = await (await mcp('tools/call', { name: 'update_category', arguments: { category: category.id, color: '#00ff00' } }, displayKey.key)).json() as any;
  assert.equal(categoryRes.result.isError, undefined, JSON.stringify(categoryRes));

  // add_member (POST /api/members) is admin-only too - display can edit an existing category in
  // place, but never members or chores, and never create new ones.
  const addRes = await (await mcp('tools/call', { name: 'add_member', arguments: { name: 'Nope', color: '#000000' } }, displayKey.key)).json() as any;
  assert.equal(addRes.result.isError, true);

  // Trackers: a display key logs books, but health is refused by the route (and left out of lists).
  const book = await (await mcp('tools/call', { name: 'add_tracker_entry', arguments: { kind: 'reading', title: 'Dog Man' } }, displayKey.key)).json() as any;
  assert.notEqual(book.result.isError, true);
  const visit = await (await mcp('tools/call', { name: 'add_tracker_entry', arguments: { kind: 'health', data: { type: 'dentist' } } }, displayKey.key)).json() as any;
  assert.equal(visit.result.isError, true);
  assert.match(visit.result.content[0].text, /never on a wall display/);
  const health = await (await mcp('tools/call', { name: 'list_tracker_entries', arguments: { kind: 'health' } }, displayKey.key)).json() as any;
  assert.equal(health.result.isError, true);
});

test('mcp: every tool declares permission hints, and the server advertises its icon', async () => {
  const env = makeEnv();
  const { mcp } = makeApp(env);
  const tools = (await (await mcp('tools/list', {})).json() as any).result.tools as any[];
  for (const t of tools) assert.equal(typeof t.annotations?.readOnlyHint, 'boolean', `${t.name} has no hints`);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
  assert.equal(byName.list_events.readOnlyHint, true);
  assert.equal(byName.list_notifications.readOnlyHint, true);
  assert.equal(byName.create_list.readOnlyHint, false);
  assert.equal(byName.delete_event.destructiveHint, true);
  for (const t of tools.filter((x) => x.name.startsWith('delete_'))) assert.equal(t.annotations.destructiveHint, true, t.name);
  for (const name of ['list_recipes', 'get_recipe', 'list_meals', 'get_meal_projection']) {
    assert.equal(byName[name].readOnlyHint, true, name);
    assert.equal(byName[name].idempotentHint, true, name);
    assert.equal(byName[name].openWorldHint, false, name);
  }
  for (const name of ['create_recipe', 'update_recipe', 'create_meal', 'update_meal', 'apply_meal_projection']) {
    assert.equal(byName[name].readOnlyHint, false, name);
    assert.equal(byName[name].idempotentHint, !name.startsWith('create_'), name);
    assert.equal(byName[name].openWorldHint, false, name);
  }

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
  await call('get_event', { id: ev.id });
  await call('update_event', { id: ev.id, title: 'School play!' });
  await call('set_event_category', { id: ev.id, category: 'school' });
  await call('list_categories');
  await call('update_category', { category: 'school', color: '#3366ff' });
  const chore = (await call('create_chore', { title: 'Feed cat', emoji: '🐱', member: 'ava', rrule: 'FREQ=DAILY', points: 2 })).chore;
  await call('update_chore', { choreId: chore.id, points: 3 });
  await call('complete_chore', { choreId: chore.id, date: today });
  await call('list_chores', { date: today });
  await call('uncomplete_chore', { choreId: chore.id, date: today });
  await call('get_leaderboard', { period: 'week' });
  await call('complete_chore', { choreId: chore.id, date: today });
  const points = await call('get_points', { member: 'ava' });
  assert.deepEqual([points.balance, points.earnedTotal, points.spentTotal, points.entries], [3, 3, 0, []]);
  await call('add_member', { name: 'Bo', color: '#00aa00', avatar: '🦖' });
  await call('update_member', { member: 'Bo', color: '#00bb00' });
  assert.equal((await call('update_member', { member: 'Bo', birthday: '--07-04' })).member.birthday, '--07-04');
  const snap = await call('get_snapshot', { member: 'ava' });
  assert.match(snap.greeting, /Ava/);
  assert.equal((await call('get_snapshot', { member: 'ava', range: 'week' })).tomorrow, null);
  assert.match((await call('get_board', {})).board.today, /^\d{4}-\d{2}-\d{2}$/);
  await call('get_board', { days: 3 });
  // Color schemes: pick a built-in by the name people see, save one of the family's own, delete it.
  assert.equal((await call('set_color_scheme', { scheme: 'Meadow' })).settings.colorScheme, 'field');
  const palette = { light: { bg: '#FFF8EE', card: '#FFFFFF', text: '#2B2118', accent: '#1F7A8C' }, dark: { bg: '#10181B', card: '#18242A', text: '#EAF2F4', accent: '#1F7A8C' } };
  const saved = await call('save_color_scheme', { name: 'Beach house', emoji: '🏖️', ...palette, use: true });
  assert.match(saved.scheme.id, /^custom-/);
  assert.equal(saved.settings.colorScheme, saved.scheme.id);
  const listed = await call('list_color_schemes');
  assert.equal(listed.current, saved.scheme.id);
  assert.ok(listed.schemes.some((x: any) => x.name === 'Peach' && x.id === 'meadow'));
  assert.equal((await call('delete_color_scheme', { scheme: 'beach house' })).settings.colorScheme, 'meadow');
  const list = (await call('create_list', { name: 'Groceries', kind: 'shopping', emoji: '🛒' })).list;
  const [item] = (await call('add_list_items', { listName: 'groceries', items: [{ title: 'Milk', store: 'Costco', category: 'Dairy', quantity: '2', eventId: ev.id }] })).items;
  assert.equal(item.eventId, ev.id);
  await call('update_list_item', { list: list.id, itemId: item.id, member: 'ava', eventId: ev.id });
  const linked = (await call('get_event_items', { id: ev.id })).items;
  assert.deepEqual(linked.map((i: any) => [i.title, i.listName]), [['Milk', 'Groceries']]);
  await call('set_list_item_done', { listId: list.id, itemId: item.id, done: true });
  const [chore2] = (await call('add_list_items', { listName: 'groceries', items: [{ title: 'Tidy', priority: 'high', steps: ['Toys', 'Cushions'] }] })).items;
  assert.deepEqual([chore2.priority, chore2.stepsTotal, chore2.steps.map((st: any) => st.title)], ['high', 2, ['Toys', 'Cushions']]);
  await call('update_list_item', { list: list.id, itemId: chore2.id, priority: 'normal' });
  await call('set_step_done', { list: 'groceries', itemId: chore2.id, stepId: chore2.steps[0].id, done: true });
  const finished = (await call('set_step_done', { list: list.id, itemId: chore2.id, stepId: chore2.steps[1].id, done: true })).item;
  assert.equal(finished.done, true, 'last step completes the item');
  await call('update_list', { list: 'groceries', emoji: '🥛' });
  assert.equal((await call('update_list', { list: 'groceries', sortBy: 'alpha' })).list.sortBy, 'alpha');
  const [urgent] = (await call('add_list_items', { listName: 'groceries', items: [{ title: 'Zucchini', priority: 'urgent' }] })).items;
  assert.equal(urgent.priority, 'urgent');
  await call('update_list_item', { list: list.id, itemId: urgent.id, priority: 'low' });
  await call('get_list', { list: 'groceries' });
  await call('list_lists');
  await call('send_notification', { title: 'Hi', body: 'Dinner' });
  await call('list_notifications');
  const note = (await call('add_note', { target: `event:${ev.id}`, body: 'Bring flowers', member: 'ava' })).note;
  assert.equal(note.body, 'Bring flowers');
  await call('add_note', { target: `list_item:${item.id}`, body: 'Oat, please' });
  assert.equal((await call('update_note', { noteId: note.id, body: 'Bring roses' })).note.body, 'Bring roses');
  assert.deepEqual((await call('list_notes', { target: `event:${ev.id}` })).notes.map((n: any) => n.body), ['Bring roses']);
  const book = (await call('add_tracker_entry', { kind: 'reading', member: 'ava', title: 'Matilda', data: { totalPages: 240 } })).entry;
  assert.equal((await call('update_tracker_entry', { entryId: book.id, data: { pagesRead: 60, rating: 4 } })).entry.data.pagesRead, 60);
  await call('add_tracker_entry', { kind: 'health', member: 'ava', title: 'Checkup', data: { type: 'checkup', weight: { value: 50, unit: 'lb' } } });
  assert.deepEqual((await call('list_tracker_entries', { member: 'ava' })).entries.map((e: any) => e.kind).sort(), ['health', 'reading']);
  await call('delete_event', { id: ev.id });
});

test('mcp: save_color_scheme refuses a scheme that fails contrast, and names the pair', async () => {
  const env = makeEnv();
  const { mcp } = makeApp(env);
  const body = await (await mcp('tools/call', { name: 'save_color_scheme', arguments: {
    name: 'Murky', light: { bg: '#FFFFFF', card: '#FFFFFF', text: '#BBBBBB', accent: '#1F7A8C' }, dark: { bg: '#111111', card: '#1A1A1A', text: '#EEEEEE', accent: '#1F7A8C' },
  } })).json() as any;
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /Murky \(light mode\): Text on background is/);
});

test('mcp: meal planning recipes, weekly retrieval, assignment, and reviewed shopping application', async () => {
  const { rest, mcp } = makeApp(makeEnv());
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const body = await (await mcp('tools/call', { name, arguments: args })).json() as any;
    assert.equal(body.error, undefined, `${name}: ${JSON.stringify(body.error)}`);
    assert.notEqual(body.result.isError, true, `${name}: ${JSON.stringify(body.result.content)}`);
    return body.result.structuredContent;
  };
  const member = (await call('add_member', { name: 'Ava', color: '#ff0000' })).member;
  const list = (await call('create_list', { name: 'Groceries', kind: 'shopping' })).list;
  const existing = (await call('add_list_items', { listId: list.id, items: [{ title: 'Rice', quantity: '1 bag' }] })).items[0];
  const recipe = (await call('create_recipe', {
    name: 'Rice bowl', defaultServings: 2, sourceUrl: 'https://example.com/rice',
    ingredients: JSON.stringify([{ name: 'Rice', quantity: 1, unit: 'cup', category: 'Grains' }, { name: 'Salt', qualifier: 'to taste' }]),
  })).recipe;
  assert.equal((await call('get_recipe', { id: recipe.id })).recipe.sourceUrl, 'https://example.com/rice');
  const imported = await call('import_recipe', { source: 'kit', externalId: 'k1', name: 'Kit curry', servings: 2, ingredients: JSON.stringify([{ text: '1.5 tablespoon Curry Paste', pantry: false }, 'Salt']), steps: ['Simmer.'], plan: { date: '2026-09-22', slot: 'dinner' } });
  assert.equal(imported.created, true); assert.equal(imported.planned, true);
  assert.equal((await call('import_recipe', { source: 'kit', externalId: 'k1', name: 'Kit curry', ingredients: [] })).recipeId, imported.recipeId);
  await call('delete_meal', { mealId: imported.mealId }); await call('delete_recipe', { recipe: imported.recipeId });
  assert.deepEqual((await call('list_recipes', { search: 'RICE', category: 'grains' })).recipes.map((r: any) => r.id), [recipe.id]);
  assert.deepEqual((await call('list_recipes', { category: 'Dairy' })).recipes, []);
  const meal = (await call('create_meal', { date: '2026-09-21', slot: 'dinner', recipeId: recipe.id, servings: 4, member: 'aV' })).meal;
  assert.equal(meal.assigneeMemberId, member.id);
  assert.equal(meal.calendarEventId, null);
  const lastDay = (await call('create_meal', { date: '2026-09-27', slot: 'lunch', mealKind: 'dining_out' })).meal;
  await call('create_meal', { date: '2026-09-28', slot: 'dinner', title: 'Leftovers', mealKind: 'freeform' });
  assert.deepEqual((await call('list_meals', { from: '2026-09-21' })).meals.map((m: any) => m.id), [meal.id, lastDay.id]);
  assert.deepEqual((await call('list_meals', { from: '2026-09-27', to: '2026-09-27' })).meals.map((m: any) => m.id), [lastDay.id]);
  await call('update_recipe', { id: recipe.id, ingredients: [{ name: 'Rice', quantity: 2, unit: 'cup' }, { name: 'Salt', qualifier: 'to taste' }] });
  assert.equal((await call('update_meal', { id: meal.id, notes: 'Batch cook' })).meal.recipeSnapshot.ingredients[0].quantity, 1);
  assert.equal((await call('update_meal', { id: meal.id, refreshRecipe: true, member: null })).meal.assigneeMemberId, null);
  assert.equal((await call('update_meal', { id: meal.id, member: member.id })).meal.assigneeMemberId, member.id);

  const range = { from: '2026-09-21', to: '2026-09-27' };
  assert.equal((await call('get_meal_projection', range)).listId, null);
  const preview = await call('get_meal_projection', { ...range, listName: 'gROC' });
  assert.equal(preview.listId, list.id);
  const rice = preview.items.find((i: any) => i.name === 'Rice');
  const salt = preview.items.find((i: any) => i.name === 'Salt');
  assert.equal(rice.quantity, 4);
  assert.equal(rice.sources[0].mealId, meal.id);
  assert.equal(rice.sources[0].date, meal.date);
  assert.equal(rice.matches[0].id, existing.id);
  assert.equal(salt.scalable, false);
  const applied = await call('apply_meal_projection', { ...range, listName: 'GROCERIES', omitKeys: JSON.stringify([salt.key]), includeNotes: true });
  assert.equal(applied.added, 1);
  assert.equal(applied.itemIds.length, 1);
  assert.equal(applied.projection.items.find((i: any) => i.name === 'Rice').applied, true);
  assert.equal(applied.projection.items.find((i: any) => i.name === 'Salt').applied, false);
  const items = (await call('get_list', { list: list.id })).items;
  assert.equal(items.length, 2);
  assert.equal(items.find((i: any) => i.id === existing.id).quantity, '1 bag');
  const added = items.find((i: any) => i.id === applied.itemIds[0]);
  assert.equal(added.quantity, '4 cup');
  assert.match(added.notes, /2026-09-21.*dinner.*Rice bowl/);
  assert.equal((await call('apply_meal_projection', { ...range, listId: list.id, omitKeys: [salt.key], includeNotes: true })).added, 0);
  assert.equal((await call('apply_meal_projection', { from: '2026-09-20', to: '2026-09-28', listId: list.id, omitKeys: [salt.key] })).added, 0);
  await call('update_meal', { id: meal.id, servings: 6 });
  assert.equal((await call('get_meal_projection', { ...range, listId: list.id })).items.find((i: any) => i.name === 'Rice').changedSinceApplied, true);
  assert.equal((await call('apply_meal_projection', { ...range, listId: list.id, omitKeys: [salt.key] })).added, 0);
  const remainder = await call('apply_meal_projection', { ...range, listId: list.id, includeNotes: false });
  assert.equal(remainder.added, 1);
  assert.equal((await call('get_list', { list: list.id })).items.find((i: any) => i.id === remainder.itemIds[0]).notes, null);
  const other = (await call('create_list', { name: 'Weekend groceries', kind: 'shopping' })).list;
  assert.equal((await call('apply_meal_projection', { ...range, listId: other.id })).added, 2, 'claims are per list');
  assert.equal((await call('update_recipe', { id: recipe.id, archived: true })).recipe.archived, true);
  assert.deepEqual((await call('list_recipes')).recipes, []);
  assert.equal((await call('list_recipes', { archived: true })).recipes[0].id, recipe.id);
  assert.equal((await call('get_recipe', { id: recipe.id })).recipe.archived, true);
  assert.equal((await call('list_meals', range)).meals[0].recipeSnapshot.name, 'Rice bowl');
  assert.equal((await call('update_recipe', { id: recipe.id, archived: false })).recipe.archived, false);
  assert.deepEqual(await (await rest('/api/events?from=2026-09-20&to=2026-09-29')).json(), []);
});

test('mcp: meal planning preserves route authorization and returns resolution/validation errors', async () => {
  const { rest, mcp } = makeApp(makeEnv());
  const call = async (name: string, args: Record<string, unknown>, key = ADMIN_KEY) => {
    const body = await (await mcp('tools/call', { name, arguments: args }, key)).json() as any;
    assert.equal(body.error, undefined, JSON.stringify(body.error));
    return body.result;
  };
  const fail = async (name: string, args: Record<string, unknown>, pattern: RegExp, key = ADMIN_KEY) => {
    const result = await call(name, args, key);
    assert.equal(result.isError, true, `${name}: ${JSON.stringify(result)}`);
    assert.match(result.content[0].text, pattern);
  };
  const emma = (await call('add_member', { name: 'Emma', color: '#111111' })).structuredContent.member;
  await call('add_member', { name: 'Emmanuel', color: '#222222' });
  const mealInput = { date: '2026-09-21', slot: 'dinner', title: 'Pasta' };
  await fail('create_meal', { ...mealInput, member: 'Em' }, /multiple members/);
  await fail('create_meal', { ...mealInput, member: 'Nobody' }, /no member found/);
  const meal = (await call('create_meal', { ...mealInput, member: 'EMMA' })).structuredContent.meal;
  await fail('update_meal', { id: meal.id, member: 'Nobody' }, /no member found/);
  const recipe = (await call('create_recipe', { name: 'Pasta' })).structuredContent.recipe;
  const list = (await call('create_list', { name: 'Groceries', kind: 'shopping' })).structuredContent.list;
  await call('create_list', { name: 'Groceries weekend', kind: 'shopping' });
  await call('create_list', { name: 'Tasks', kind: 'todo' });
  const range = { from: '2026-09-21', to: '2026-09-27' };
  for (const name of ['get_meal_projection', 'apply_meal_projection']) {
    await fail(name, { ...range, listName: 'groc' }, /multiple lists/);
    await fail(name, { ...range, listName: 'Missing' }, /no list found/);
    await fail(name, { ...range, listName: 'Tasks' }, /active shopping list not found/);
  }
  await fail('apply_meal_projection', range, /listId or listName is required/);
  await fail('get_recipe', { id: 'missing' }, /recipe not found/);
  await fail('list_meals', { from: '2026-09-28', to: '2026-09-21' }, /range must be ordered/);
  await fail('create_meal', { ...mealInput, date: '2026-02-30' }, /real YYYY-MM-DD date/);
  const display = await (await rest('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Emma device', scope: 'display' }) })).json() as any;
  for (const [name, args] of [
    ['create_recipe', { name: 'Denied' }], ['update_recipe', { id: recipe.id, archived: true }],
    ['create_meal', mealInput], ['get_meal_projection', { ...range, listId: list.id }], ['apply_meal_projection', { ...range, listName: 'Groceries' }],
  ] as const) await fail(name, args, /display key cannot access/, display.key);
  await fail('update_meal', { id: meal.id, notes: 'Denied' }, /Only admins/, display.key);
  assert.equal((await rest(`/api/keys/${display.id}`, { method: 'PATCH', body: JSON.stringify({ owner: emma.id }) })).status, 200);
  const updated = await call('update_meal', { id: meal.id, notes: 'Ready', status: 'prepared' }, display.key);
  assert.notEqual(updated.isError, true, JSON.stringify(updated));
  assert.equal(updated.structuredContent.meal.notes, 'Ready');
  await fail('update_meal', { id: meal.id, member: null }, /Only admins/, display.key);
  await fail('update_meal', { id: meal.id, title: 'Denied' }, /Only admins/, display.key);
  for (const [name, args] of [
    ['list_recipes', {}], ['get_recipe', { id: recipe.id }], ['list_meals', range],
  ] as const) assert.notEqual((await call(name, args, display.key)).isError, true, name);
  assert.equal((await call('get_recipe', { id: recipe.id })).structuredContent.recipe.archived, false);
  assert.equal((await call('get_list', { list: list.id })).structuredContent.items.length, 0);
});

test('mcp: meal planning tools use REST permissions, snapshots, and idempotent projection application', async () => {
  const { rest, mcp } = makeApp(makeEnv());
  const call = async (name: string, args: unknown) => {
    const body = await (await mcp('tools/call', { name, arguments: args })).json() as any;
    assert.equal(body.result.isError, undefined, JSON.stringify(body));
    return body.result.structuredContent;
  };
  const { recipe } = await call('create_recipe', { name: 'Soup', defaultServings: 2, ingredients: [{ name: 'Carrots', quantity: 3 }] });
  assert.equal((await call('get_recipe', { id: recipe.id })).recipe.name, 'Soup');
  assert.equal((await call('list_recipes', { search: 'soup' })).recipes.length, 1);
  const { meal } = await call('create_meal', { date: '2026-10-05', slot: 'dinner', recipeId: recipe.id, servings: 4 });
  await call('update_recipe', { id: recipe.id, defaultServings: 8 });
  assert.equal((await call('update_meal', { id: meal.id, notes: 'Cook early' })).meal.recipeSnapshot.defaultServings, 2);
  const range = { from: '2026-10-05', to: '2026-10-11' };
  assert.equal((await call('list_meals', range)).meals.length, 1);
  const list = await (await rest('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) })).json() as any;
  assert.equal((await call('get_meal_projection', { ...range, listId: list.id })).items[0].quantity, 6);
  assert.equal((await call('apply_meal_projection', { ...range, listId: list.id })).added, 1);
  assert.equal((await call('apply_meal_projection', { ...range, listId: list.id })).added, 0);
});

// Delete tools: each is a thin wrapper on the REST DELETE, so a display key gets exactly the REST
// route's answer (lists, items, steps and notes are allowed; the rest need full access).
async function deleteSetup() {
  const env = makeEnv();
  const { rest, mcp } = makeApp(env);
  const displayKey = (await (await rest('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) })).json() as any).key as string;
  const call = async (name: string, args: Record<string, unknown>, key = ADMIN_KEY) => ((await (await mcp('tools/call', { name, arguments: args }, key)).json()) as any).result;
  const ok = async (name: string, args: Record<string, unknown>, key = ADMIN_KEY) => {
    const r = await call(name, args, key);
    assert.notEqual(r.isError, true, `${name}: ${JSON.stringify(r.content)}`);
    return r.structuredContent;
  };
  return { rest, call, ok, displayKey };
}

test('mcp: delete_list removes a list by exact name only; display keys may (as REST allows)', async () => {
  const { call, ok, displayKey } = await deleteSetup();
  await ok('create_list', { name: 'Fish tacos' });
  await ok('create_list', { name: 'Old chores' });
  const partial = await call('delete_list', { list: 'tacos' });
  assert.equal(partial.isError, true);
  assert.match(partial.content[0].text, /exact name/);
  assert.match((await call('delete_list', { list: 'OLD CHORES' }, displayKey)).content[0].text, /Deleted list "Old chores"/);
  await ok('delete_list', { list: 'fish tacos' });
  assert.deepEqual((await ok('list_lists', {})).lists, []);
});

test('mcp: delete_list_item removes an item; display keys may', async () => {
  const { ok, displayKey } = await deleteSetup();
  await ok('create_list', { name: 'Routine' });
  const [a, b] = (await ok('add_list_items', { listName: 'routine', items: ['Brush teeth', 'Pajamas'] })).items;
  await ok('delete_list_item', { list: 'routine', itemId: a.id });
  await ok('delete_list_item', { list: 'routine', itemId: b.id }, displayKey);
  assert.deepEqual((await ok('get_list', { list: 'routine' })).items, []);
});

test('mcp: delete_list_step removes a step and returns the item; display keys may', async () => {
  const { ok, displayKey } = await deleteSetup();
  await ok('create_list', { name: 'Routine' });
  const [item] = (await ok('add_list_items', { listName: 'routine', items: [{ title: 'Bedtime', steps: ['Bath', 'Book', 'Lights'] }] })).items;
  await ok('set_step_done', { list: 'routine', itemId: item.id, stepId: item.steps[0].id, done: true });
  await ok('set_step_done', { list: 'routine', itemId: item.id, stepId: item.steps[1].id, done: true });
  const after = (await ok('delete_list_step', { list: 'routine', itemId: item.id, stepId: item.steps[2].id }, displayKey)).item;
  assert.deepEqual([after.stepsTotal, after.done], [2, true], 'remaining steps all done completes the item');
});

test('mcp: delete_note removes a note; display keys may', async () => {
  const { ok, displayKey } = await deleteSetup();
  await ok('create_list', { name: 'Todo' });
  const [item] = (await ok('add_list_items', { listName: 'todo', items: ['Call grandma'] })).items;
  const n1 = (await ok('add_note', { target: `list_item:${item.id}`, body: 'Sunday' })).note;
  const n2 = (await ok('add_note', { target: `list_item:${item.id}`, body: 'After lunch' })).note;
  await ok('delete_note', { noteId: n1.id });
  await ok('delete_note', { noteId: n2.id }, displayKey);
  assert.deepEqual((await ok('list_notes', { target: `list_item:${item.id}` })).notes, []);
});

test('mcp: delete_chore needs full access and removes the chore from the list', async () => {
  const { rest, call, ok, displayKey } = await deleteSetup();
  const chore = (await ok('create_chore', { title: 'Dishes', dueDate: '2026-05-01' })).chore;
  await ok('complete_chore', { choreId: chore.id, date: '2026-05-01' });
  assert.equal((await call('delete_chore', { choreId: chore.id }, displayKey)).isError, true);
  await ok('delete_chore', { choreId: chore.id });
  assert.deepEqual(await (await rest('/api/chores')).json(), []);
});

test('mcp: delete_tracker_entry needs full access', async () => {
  const { call, ok, displayKey } = await deleteSetup();
  const book = (await ok('add_tracker_entry', { kind: 'reading', title: 'Matilda' })).entry;
  assert.equal((await call('delete_tracker_entry', { entryId: book.id }, displayKey)).isError, true);
  await ok('delete_tracker_entry', { entryId: book.id });
  assert.deepEqual((await ok('list_tracker_entries', {})).entries, []);
});

test('mcp: delete_meal needs full access', async () => {
  const { call, ok, displayKey } = await deleteSetup();
  const meal = (await ok('create_meal', { date: '2026-09-28', slot: 'dinner', title: 'Leftovers', mealKind: 'freeform' })).meal;
  assert.equal((await call('delete_meal', { mealId: meal.id }, displayKey)).isError, true);
  await ok('delete_meal', { mealId: meal.id });
  assert.deepEqual((await ok('list_meals', { from: '2026-09-28' })).meals, []);
});

test('mcp: delete_recipe needs full access and an id or exact name', async () => {
  const { call, ok, displayKey } = await deleteSetup();
  const recipe = (await ok('create_recipe', { name: 'Fish tacos', ingredients: [{ name: 'Fish' }] })).recipe;
  assert.equal((await call('delete_recipe', { recipe: 'tacos' })).isError, true);
  assert.equal((await call('delete_recipe', { recipe: recipe.id }, displayKey)).isError, true);
  await ok('delete_recipe', { recipe: 'FISH TACOS' });
  assert.deepEqual((await ok('list_recipes', { archived: true })).recipes, []);
});

test('mcp: delete_reward needs full access', async () => {
  const { call, ok, displayKey } = await deleteSetup();
  const reward = (await ok('create_reward', { title: 'Movie night', cost: 100 })).reward;
  assert.equal((await call('delete_reward', { reward: 'movie night' }, displayKey)).isError, true);
  await ok('delete_reward', { reward: reward.id });
  assert.deepEqual((await ok('list_rewards', { archived: true })).rewards, []);
});

test('mcp: booleans sent as text ("true"/"false") are accepted, and still advertised as booleans', async () => {
  const { ok } = await deleteSetup();
  const chore = (await ok('create_chore', { title: 'Feed cat', dueDate: '2026-05-01', needsApproval: 'true', approveTimedPlay: 'false' })).chore;
  assert.equal(chore.needsApproval, true);
  assert.equal((await ok('update_chore', { choreId: chore.id, needsApproval: 'false' })).chore.needsApproval, false);
  assert.equal((await ok('update_chore', { choreId: chore.id, title: 'true' })).chore.title, 'true', 'string arguments are left alone');

  const { mcp } = makeApp(makeEnv());
  const tools = ((await (await mcp('tools/list', {})).json()) as any).result.tools;
  const props = tools.find((t: any) => t.name === 'update_chore').inputSchema.properties;
  assert.deepEqual(props.needsApproval.type, ['boolean', 'null'], JSON.stringify(props.needsApproval));
  assert.equal(props.approveTimedPlay.type, 'boolean');
});
