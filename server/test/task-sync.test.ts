// To-do lists synced with Todoist, Google Tasks and Microsoft To Do (routes/tasks.ts, tasks/sync.ts),
// against small in-memory stand-ins for the three APIs (fetch is mocked: no network, no real tokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { encryptConfig } from '../src/crypto.ts';
import { syncDue } from '../src/sync.ts';
import { runNotifications } from '../src/notify.ts';
import { syncTaskLink, taskSyncsPending, taskSyncTiming } from '../src/tasks/sync.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_tasks_admin';
const GOOD = 'fake-todoist-token-1234';
taskSyncTiming.debounceMs = 1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Until the syncs a change queued (and their own background work) are done. */
async function settle() {
  for (let quiet = 0, i = 0; quiet < 3 && i < 500; i++) { await sleep(5); quiet = taskSyncsPending() ? 0 : quiet + 1; }
}

type Fake = Record<string, any>;

/** Todoist API v1: projects, tasks (open ones listed; done and deleted ones by id), paged two at a time. */
function fakeTodoist() {
  const projects: Fake[] = [{ id: 'p1', name: 'Chores' }];
  const tasks = new Map<string, Fake>();
  let n = 0, clock = Date.parse('2026-10-10T12:00:00Z');
  const state = { token: GOOD, limited: 0, calls: [] as string[] };
  const stamp = () => new Date((clock += 1000)).toISOString();
  const add = (t: Fake) => { const id = `t${++n}`; tasks.set(id, { id, project_id: 'p1', description: '', priority: 1, due: null, checked: false, is_deleted: false, parent_id: null, child_order: n, updated_at: stamp(), ...t }); return id; };
  const page = (items: Fake[], cursor: string | null) => { const at = Number(cursor ?? 0); return { results: items.slice(at, at + 2), next_cursor: at + 2 < items.length ? String(at + 2) : null }; };
  const handle = async (url: URL, init: RequestInit) => {
    const method = init.method ?? 'GET';
    state.calls.push(`${method} ${url.pathname}`);
    if ((init.headers as Record<string, string>).authorization !== `Bearer ${state.token}`) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (state.limited > 0) { state.limited--; return Response.json({ error: 'Too many requests' }, { status: 429, headers: { 'retry-after': '30' } }); }
    const p = url.pathname.replace('/api/v1', '');
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (p === '/user') return Response.json({ email: 'sam@example.com', full_name: 'Sam' });
    if (p === '/projects' && method === 'GET') return Response.json(page(projects, url.searchParams.get('cursor')));
    if (p === '/projects') { const pr = { id: `p${projects.length + 1}`, name: body.name }; projects.push(pr); return Response.json(pr); }
    if (p === '/tasks' && method === 'GET') return Response.json(page([...tasks.values()].filter((t) => t.project_id === url.searchParams.get('project_id') && !t.checked && !t.is_deleted), url.searchParams.get('cursor')));
    if (p === '/tasks') { const id = add({ content: body.content, description: body.description ?? '', priority: body.priority ?? 1, project_id: body.project_id, parent_id: body.parent_id ?? null, due: body.due_date ? { date: body.due_date, string: body.due_date, is_recurring: false } : null }); return Response.json(tasks.get(id)); }
    const m = /^\/tasks\/([^/]+)(?:\/(close|reopen))?$/.exec(p);
    const t = m && tasks.get(m[1]);
    if (!t || t.is_deleted) return Response.json({ error: 'not found' }, { status: 404 });
    if (method === 'GET') return Response.json(t);
    if (method === 'DELETE') { t.is_deleted = true; for (const x of tasks.values()) if (x.parent_id === t.id) x.is_deleted = true; return new Response(null, { status: 204 }); }
    if (m![2]) { t.checked = m![2] === 'close'; t.updated_at = stamp(); return new Response(null, { status: 204 }); }
    if (body.content !== undefined) t.content = body.content;
    if (body.description !== undefined) t.description = body.description;
    if (body.priority !== undefined) t.priority = body.priority;
    if (body.child_order !== undefined) t.child_order = body.child_order;
    if (body.due_date !== undefined) t.due = { date: body.due_date, string: body.due_date, is_recurring: false };
    if (body.due_string === 'no date') t.due = null;
    t.updated_at = stamp();
    return Response.json(t);
  };
  const edit = (id: string, patch: Fake) => Object.assign(tasks.get(id)!, patch, { updated_at: stamp() });
  const byTitle = (title: string) => [...tasks.values()].find((t) => t.content === title && !t.is_deleted);
  return { projects, tasks, state, add, edit, byTitle, handle };
}

/** Google Tasks API v1 (and its token endpoint): every task listed, done ones too; deleted ones gone. */
function fakeGoogle() {
  const tasks = new Map<string, Fake>();
  let n = 0;
  const state = { revoked: 0, refreshRefused: false, calls: [] as string[], moves: 0 };
  const renumber = (parent: string | null) => [...tasks.values()].filter((x) => (x.parent ?? null) === parent).sort((a, b) => a.ord - b.ord)
    .forEach((x, i) => { x.ord = i; x.position = String(i).padStart(8, '0'); });
  /** A task already in Google Tasks: subtasks under `parent`, in the order added. */
  const add = (t: Fake) => { const id = t.id ?? `g${++n}`; tasks.set(id, { id, status: 'needsAction', updated: '2026-10-01T00:00:00.000Z', ord: 1e6, ...t }); renumber(t.parent ?? null); return id; };
  const handle = async (url: URL, init: RequestInit) => {
    const method = init.method ?? 'GET';
    if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/revoke') { state.revoked++; return new Response('', { status: 200 }); }
    if (url.hostname === 'oauth2.googleapis.com') return state.refreshRefused ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'g-access', expires_in: 3600 });
    state.calls.push(`${method} ${url.pathname}`);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/tasks/v1/users/@me/lists') return Response.json({ items: [{ id: 'gl1', title: 'Family' }] });
    const m = /^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+))?(\/move)?$/.exec(url.pathname)!;
    if (!m[2] && method === 'GET') return Response.json({ items: [...tasks.values()] });
    // Subtasks: ?parent=, after ?previous= (or first); positions renumbered like Google's strings.
    const place = (t: Fake) => {
      const parent = url.searchParams.get('parent'), prev = url.searchParams.get('previous');
      t.parent = parent ?? undefined;
      t.ord = prev ? tasks.get(prev)!.ord + 0.5 : -0.5;
      renumber(parent);
    };
    if (!m[2]) { const id = `g${++n}`; const t = { id, status: 'needsAction', updated: new Date().toISOString(), ...body }; tasks.set(id, t); place(t); return Response.json(t); }
    const t = tasks.get(m[2]);
    if (!t) return Response.json({ error: { code: 404 } }, { status: 404 });
    if (m[3]) { state.moves++; place(t); return Response.json(t); }
    if (method === 'DELETE') { tasks.delete(m[2]); for (const x of [...tasks.values()]) if (x.parent === m[2]) tasks.delete(x.id); return new Response(null, { status: 204 }); }
    // Like Google: a subtask of a completed task stays completed (reopen the task first).
    if (body.status === 'needsAction' && t.parent && tasks.get(t.parent)?.status === 'completed') { const { status: _s, completed: _c, ...rest } = body; Object.assign(t, rest, { updated: new Date().toISOString() }); return Response.json(t); }
    Object.assign(t, body, { updated: new Date().toISOString() });
    return Response.json(t);
  };
  return { tasks, state, handle, add, renumber };
}

/** Microsoft Graph To Do (and the Microsoft token endpoint). */
function fakeMicrosoft() {
  const tasks = new Map<string, Fake>();
  let n = 0;
  const state = { calls: [] as string[], bodies: [] as Fake[], scopes: [] as string[], expand: null as string | null };
  const handle = async (url: URL, init: RequestInit) => {
    const method = init.method ?? 'GET';
    if (url.hostname === 'login.microsoftonline.com') { state.scopes.push(new URLSearchParams(String(init.body)).get('scope') ?? ''); return Response.json({ access_token: 'm-access', expires_in: 3600 }); }
    state.calls.push(`${method} ${url.pathname}`);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (init.body) state.bodies.push(body);
    if (url.pathname === '/v1.0/me/todo/lists') return Response.json({ value: [{ id: 'ml1', displayName: 'Tasks' }] });
    const c = /^\/v1\.0\/me\/todo\/lists\/[^/]+\/tasks\/([^/]+)\/checklistItems(?:\/([^/]+))?$/.exec(url.pathname);
    if (c) {
      const list = tasks.get(c[1])!.checklistItems as Fake[];
      if (!c[2]) { const item = { id: `c${++n}`, isChecked: false, ...body }; list.push(item); return Response.json(item); }
      const i = list.findIndex((x) => x.id === c[2]);
      if (method === 'DELETE') { list.splice(i, 1); return new Response(null, { status: 204 }); }
      Object.assign(list[i], body);
      return Response.json(list[i]);
    }
    const m = /^\/v1\.0\/me\/todo\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/.exec(url.pathname)!;
    if (!m[2] && method === 'GET') { state.expand = url.searchParams.get('$expand'); return Response.json({ value: [...tasks.values()] }); }
    if (!m[2]) { const id = `m${++n}`; tasks.set(id, { id, status: 'notStarted', importance: 'normal', checklistItems: [], lastModifiedDateTime: new Date().toISOString(), ...body }); return Response.json(tasks.get(id)); }
    const t = tasks.get(m[2])!;
    if (method === 'DELETE') { tasks.delete(m[2]); return new Response(null, { status: 204 }); }
    Object.assign(t, body, { lastModifiedDateTime: new Date().toISOString() });
    return Response.json(t);
  };
  return { tasks, state, handle };
}

async function setup(tz = 'America/New_York') {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  await db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', ?)").bind(tz).run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'https://kinwall.example', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', GOOGLE_CLIENT_ID: 'fake.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fake', MS_CLIENT_ID: 'fake-ms', MS_CLIENT_SECRET: 'fake' } as unknown as Env;
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  const todoist = fakeTodoist(), google = fakeGoogle(), ms = fakeMicrosoft();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'api.todoist.com') return todoist.handle(url, init);
    if (url.hostname.endsWith('googleapis.com')) return google.handle(url, init);
    if (url.hostname === 'graph.microsoft.com' || url.hostname === 'login.microsoftonline.com') return ms.handle(url, init);
    return new Response('', { status: 404 });
  }) as typeof fetch;
  const restore = () => { globalThis.fetch = realFetch; };
  const list = async (name = 'Chores') => (await req('/api/lists', 'POST', { name, kind: 'todo' })).json;
  const items = async (listId: string) => ((await req(`/api/lists/${listId}`)).json.items as any[]).sort((a, b) => a.title.localeCompare(b.title));
  const addOAuthAccount = async (kind: 'google' | 'microsoft', name: string, expired = false) => {
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO task_accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
      .bind(id, kind, name, await encryptConfig(env, id, { access_token: 'x', refresh_token: 'r', expires_at: expired ? 0 : Date.now() + 3_600_000 }), '2026-10-01').run();
    return id;
  };
  return { db, env, req, todoist, google, ms, restore, list, items, addOAuthAccount };
}

test('tasks: connect Todoist with a token, kept encrypted, never returned', async () => {
  const t = await setup();
  try {
    const bad = await t.req('/api/tasks/accounts/todoist', 'POST', { token: 'wrong-token-123' });
    assert.equal(bad.status, 400);
    assert.match(bad.json.error, /didn't accept that token/);
    const ok = await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.kind, 'todoist');
    assert.equal(ok.json.name, 'sam@example.com');
    const listed = await t.req('/api/tasks/accounts');
    assert.equal(listed.json.length, 1);
    assert.ok(!JSON.stringify(listed.json).includes(GOOD));
    const raw = await t.db.prepare('SELECT config FROM task_accounts').first<{ config: string }>();
    assert.ok(!raw!.config.includes(GOOD), 'the token is encrypted at rest');
    // The same account again replaces its token instead of adding a second.
    assert.equal((await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json.id, ok.json.id);
    // Its projects, across pages.
    t.todoist.projects.push({ id: 'p2', name: 'Errands' }, { id: 'p3', name: 'School' });
    assert.deepEqual((await t.req(`/api/tasks/accounts/${ok.json.id}/lists`)).json.map((l: any) => l.name), ['Chores', 'Errands', 'School']);
  } finally { t.restore(); }
});

test('tasks: parent devices connect and link; every screen may read the links', async () => {
  const t = await setup();
  try {
    const wall = (await t.req('/api/keys', 'POST', { name: 'wall', scope: 'display' })).json.key;
    assert.equal((await t.req('/api/tasks/links', 'GET', undefined, wall)).status, 200);
    assert.equal((await t.req('/api/tasks/accounts', 'GET', undefined, wall)).status, 403);
    assert.equal((await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD }, wall)).status, 403);
    const l = await t.list();
    assert.equal((await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: 'x', remoteId: 'p1' }, wall)).status, 403);
  } finally { t.restore(); }
});

test('tasks: the first sync pairs same titles, copies open items both ways, and a re-sync adds nothing', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    await t.req(`/api/lists/${l.id}/items`, 'POST', [
      { title: 'Milk' },
      { title: 'Call the vet', priority: 'urgent', dueDate: '2026-10-20', notes: 'Ask about shots' },
      { title: 'Old thing' },
    ]);
    const old = (await t.items(l.id)).find((i) => i.title === 'Old thing');
    await t.req(`/api/lists/${l.id}/items/${old.id}`, 'PATCH', { done: true });
    t.todoist.add({ content: 'Milk', description: '2%' });
    const rake = t.todoist.add({ content: 'Rake leaves', priority: 3, due: { date: '2026-10-21', string: 'Oct 21', is_recurring: false } });
    t.todoist.add({ content: 'Bag the leaves', parent_id: rake }); // a subtask stays in Todoist
    t.todoist.add({ content: 'Long done', checked: true });

    const link = await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    assert.equal(link.status, 200);
    assert.equal(link.json.remoteName, 'Chores');
    assert.equal(link.json.lastError, null);
    assert.ok(link.json.lastSyncedAt);

    const mine = await t.items(l.id);
    assert.deepEqual(mine.map((i) => i.title), ['Call the vet', 'Milk', 'Old thing', 'Rake leaves']);
    const imported = mine.find((i) => i.title === 'Rake leaves');
    assert.equal(imported.priority, 'high'); // Todoist 3 = P2
    assert.equal(imported.dueDate, '2026-10-21');
    assert.deepEqual(imported.addedBy, { label: 'Todoist' });
    assert.equal(mine.find((i) => i.title === 'Milk').notes, '2%');

    const vet = t.todoist.byTitle('Call the vet')!;
    assert.equal(vet.priority, 4); // urgent = P1
    assert.equal(vet.due.date, '2026-10-20');
    assert.equal(vet.description, 'Ask about shots');
    assert.equal(t.todoist.byTitle('Old thing'), undefined, 'a done item that never synced stays in Kinwall');
    assert.equal([...t.todoist.tasks.values()].filter((x) => x.content === 'Milk').length, 1);

    // Again: nothing new on either side.
    const before = t.todoist.tasks.size;
    assert.deepEqual(await syncTaskLink(t.env, l.id), { ok: true, pulled: 0, pushed: 0 });
    assert.equal(t.todoist.tasks.size, before);
    assert.equal((await t.items(l.id)).length, 4);
    await settle();
  } finally { t.restore(); }
});

test('tasks: changes go both ways, a change in Kinwall syncs on its own, and deletes follow', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    const milk = t.todoist.add({ content: 'Milk' });
    const rake = t.todoist.add({ content: 'Rake leaves' });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    let mine = await t.items(l.id);
    const kMilk = mine.find((i) => i.title === 'Milk'), kRake = mine.find((i) => i.title === 'Rake leaves');
    await t.req(`/api/lists/${l.id}/items/${kRake.id}/steps`, 'POST', { title: 'Find the rake' });

    // In Todoist: Milk is finished (it leaves the open list), Rake leaves is renamed and gets a time.
    t.todoist.edit(milk, { checked: true });
    t.todoist.edit(rake, { content: 'Rake the leaves', due: { date: '2026-10-22T15:00:00', string: 'Oct 22 3pm', is_recurring: false } });
    await syncTaskLink(t.env, l.id);
    mine = await t.items(l.id);
    assert.equal(mine.find((i) => i.id === kMilk.id).done, true);
    assert.deepEqual(mine.find((i) => i.id === kMilk.id).checkedBy, { label: 'Todoist' });
    const r = mine.find((i) => i.id === kRake.id);
    assert.equal(r.title, 'Rake the leaves');
    assert.equal(r.dueDate, '2026-10-22');
    assert.equal(r.steps.length, 1, 'its step (now a Todoist subtask) is kept');

    // In Kinwall (the debounced sync runs on its own): priority, no due date, reopened, a new item.
    await t.req(`/api/lists/${l.id}/items/${kRake.id}`, 'PATCH', { priority: 'low', dueDate: null });
    await t.req(`/api/lists/${l.id}/items/${kMilk.id}`, 'PATCH', { done: false });
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Buy pumpkins' });
    await settle();
    assert.equal(t.todoist.tasks.get(rake)!.priority, 2); // low = P3
    assert.equal(t.todoist.tasks.get(rake)!.due, null);
    assert.equal(t.todoist.tasks.get(milk)!.checked, false);
    assert.ok(t.todoist.byTitle('Buy pumpkins'));

    // Deleted in Kinwall: deleted in Todoist. Deleted in Todoist: deleted in Kinwall.
    await t.req(`/api/lists/${l.id}/items/${kMilk.id}`, 'DELETE');
    await settle();
    assert.equal(t.todoist.tasks.get(milk)!.is_deleted, true);
    t.todoist.edit(rake, { is_deleted: true }); for (const x of t.todoist.tasks.values()) if (x.parent_id === rake) x.is_deleted = true; // Todoist deletes its subtasks with it
    await syncTaskLink(t.env, l.id);
    assert.deepEqual((await t.items(l.id)).map((i) => i.title), ['Buy pumpkins']);
    assert.equal((await t.db.prepare('SELECT count(*) AS n FROM task_link_items').first<{ n: number }>())!.n, 1);
  } finally { t.restore(); }
});

test('tasks: a field changed on both sides goes to the side changed last', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    const id = t.todoist.add({ content: 'Rake leaves' });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    const item = (await t.items(l.id))[0];

    // Kinwall first, Todoist later: Todoist's title wins, Kinwall's notes (changed only there) stay.
    await t.db.prepare("UPDATE list_items SET title = 'Kinwall title', notes = 'gloves', updated_at = '2026-10-01T00:00:00.000Z' WHERE id = ?").bind(item.id).run();
    t.todoist.edit(id, { content: 'Todoist title' });
    await syncTaskLink(t.env, l.id);
    let got = (await t.items(l.id))[0];
    assert.equal(got.title, 'Todoist title');
    assert.equal(got.notes, 'gloves');
    assert.equal(t.todoist.tasks.get(id)!.description, 'gloves');

    // Todoist first, Kinwall later: Kinwall's wins.
    t.todoist.edit(id, { content: 'Todoist again', updated_at: '2026-10-01T00:00:00.000Z' });
    await t.db.prepare("UPDATE list_items SET title = 'Kinwall again', updated_at = '2026-10-15T00:00:00.000Z' WHERE id = ?").bind(item.id).run();
    t.todoist.tasks.get(id)!.updated_at = '2026-10-01T00:00:00.000Z';
    await syncTaskLink(t.env, l.id);
    got = (await t.items(l.id))[0];
    assert.equal(got.title, 'Kinwall again');
    assert.equal(t.todoist.tasks.get(id)!.content, 'Kinwall again');
  } finally { t.restore(); }
});

test('tasks: a reset Todoist token says Reconnect; connecting it again clears it', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    t.todoist.state.token = 'fake-new-token-5678';
    const res = await syncTaskLink(t.env, l.id);
    assert.equal(res.ok, false);
    let link = (await t.req('/api/tasks/links')).json[0];
    assert.equal(link.lastErrorCode, 'revoked');
    assert.match(link.lastError, /^Todoist stopped letting Kinwall see this list\. Reconnect sam@example\.com/);
    assert.equal(link.syncFailures, 1);
    await t.req('/api/tasks/accounts/todoist', 'POST', { token: 'fake-new-token-5678' }); // syncs its lists in the background
    await syncTaskLink(t.env, l.id);
    link = (await t.req('/api/tasks/links')).json[0];
    assert.equal(link.lastErrorCode, null);
    assert.equal(link.syncFailures, 0);
  } finally { t.restore(); }
});

test('tasks: a 429 waits out Retry-After (longer each time), and the schedule skips it meanwhile', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    t.todoist.state.limited = 1;
    const started = Date.now();
    assert.equal((await syncTaskLink(t.env, l.id)).ok, false);
    let link = (await t.req('/api/tasks/links')).json[0];
    assert.match(link.lastError, /asked Kinwall to slow down/);
    const wait = Date.parse(link.retryAfter) - started;
    assert.ok(wait >= 59_000 && wait < 70_000, `at least a minute (got ${wait})`);
    // Waiting: neither the schedule nor Sync now calls Todoist.
    const calls = t.todoist.state.calls.length;
    await syncDue(t.env);
    await t.req(`/api/tasks/links/${l.id}/sync`, 'POST');
    assert.equal(t.todoist.state.calls.length, calls);
    // A second refusal in a row waits twice as long.
    await t.db.prepare('UPDATE task_links SET retry_after = NULL').run();
    t.todoist.state.limited = 1;
    await syncTaskLink(t.env, l.id);
    link = (await t.req('/api/tasks/links')).json[0];
    assert.ok(Date.parse(link.retryAfter) - Date.now() > 110_000);
    // Once it's over, the schedule syncs it again.
    await t.db.prepare("UPDATE task_links SET retry_after = '2000-01-01T00:00:00.000Z', last_synced_at = '2000-01-01T00:00:00.000Z'").run();
    await syncDue(t.env);
    link = (await t.req('/api/tasks/links')).json[0];
    assert.equal(link.lastError, null);
    assert.equal(link.retryAfter, null);
  } finally { t.restore(); }
});

test('tasks: a new list made in the app; unlinking keeps every item; removing the account removes its links', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list('Garden');
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Plant bulbs' });
    const link = await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, newListName: 'Garden' });
    assert.equal(link.json.remoteName, 'Garden');
    assert.equal(t.todoist.byTitle('Plant bulbs')!.project_id, link.json.remoteId);
    // A second Kinwall list can't take the same project.
    const other = await t.list('Other');
    assert.equal((await t.req(`/api/tasks/links/${other.id}`, 'PUT', { accountId: acc.id, remoteId: link.json.remoteId })).status, 409);
    // Shopping lists don't sync.
    const shop = (await t.req('/api/lists', 'POST', { name: 'Groceries', kind: 'shopping' })).json;
    assert.equal((await t.req(`/api/tasks/links/${shop.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' })).status, 400);

    assert.equal((await t.req(`/api/tasks/links/${l.id}`, 'DELETE')).status, 200);
    assert.equal((await t.items(l.id)).length, 1);
    assert.ok(t.todoist.byTitle('Plant bulbs'));
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: link.json.remoteId });
    assert.equal([...t.todoist.tasks.values()].filter((x) => x.content === 'Plant bulbs').length, 1, 'linking again pairs by title');
    assert.equal((await t.req(`/api/tasks/accounts/${acc.id}`, 'DELETE')).status, 200);
    assert.equal((await t.req('/api/tasks/links')).json.length, 0);
    assert.equal((await t.db.prepare('SELECT count(*) AS n FROM task_link_items').first<{ n: number }>())!.n, 0);
    assert.equal((await t.items(l.id)).length, 1);
    await settle();
  } finally { t.restore(); }
});

test('tasks: Google Tasks asks for the tasks scope alone, incrementally, suggesting the calendar account', async () => {
  const t = await setup();
  try {
    const res = await t.req('/api/tasks/accounts/google/start', 'POST', { loginHint: 'sam@example.com' });
    assert.equal(res.status, 200);
    const url = new URL(res.json.url);
    assert.deepEqual(url.searchParams.get('scope')!.split(' ').sort(), ['email', 'https://www.googleapis.com/auth/tasks', 'openid']);
    assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
    assert.equal(url.searchParams.get('login_hint'), 'sam@example.com');
    const ms = new URL((await t.req('/api/tasks/accounts/microsoft/start', 'POST', {})).json.url);
    assert.deepEqual(ms.searchParams.get('scope')!.split(' ').sort(), ['Tasks.ReadWrite', 'User.Read', 'email', 'offline_access', 'openid']);
  } finally { t.restore(); }
});

test('tasks: the Google Tasks sign-in comes back as a task account, not a calendar account', async () => {
  const t = await setup();
  try {
    const app = createApp();
    const start = await app.request('https://kinwall.example/api/tasks/accounts/google/start', { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` } }, t.env);
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')!;
    const cookie = start.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
    globalThis.fetch = (async (u: unknown) => String(u).includes('token') ? Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) : Response.json({ email: 'sam@example.com' })) as typeof fetch;
    const back = await app.request(`https://kinwall.example/api/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { Cookie: cookie } }, t.env);
    assert.equal(back.status, 302);
    assert.match(back.headers.get('location')!, /#\/settings\?tab=calendars&taskAccount=/);
    assert.equal((await t.db.prepare('SELECT count(*) AS n FROM accounts').first<{ n: number }>())!.n, 0);
    const accounts = (await t.req('/api/tasks/accounts')).json;
    assert.deepEqual(accounts.map((a: any) => [a.kind, a.name, a.alsoCalendar]), [['google', 'sam@example.com', false]]);
  } finally { t.restore(); }
});

test('tasks: Google Tasks syncs title, notes, done and a due day; no priority; deletes both ways', async () => {
  const t = await setup('America/Los_Angeles');
  try {
    const acc = await t.addOAuthAccount('google', 'sam@example.com', true); // expired: refreshed first
    t.google.tasks.set('a', { id: 'a', title: 'Return library books', due: '2026-10-20T00:00:00.000Z', notes: 'Two', status: 'needsAction', updated: '2026-10-01T00:00:00.000Z' });
    t.google.tasks.set('b', { id: 'b', title: 'Sub', parent: 'a', status: 'needsAction' });
    t.google.tasks.set('c', { id: 'c', title: 'Done long ago', status: 'completed' });
    const l = await t.list();
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Wash the car', priority: 'high', dueDate: '2026-10-25' });
    assert.equal((await t.req(`/api/tasks/accounts/${acc}/lists`)).json[0].name, 'Family');
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc, remoteId: 'gl1' });

    const mine = await t.items(l.id);
    assert.deepEqual(mine.map((i) => i.title), ['Return library books', 'Wash the car']);
    assert.equal(mine[0].dueDate, '2026-10-20', 'the day stays the day in Los Angeles');
    const car = [...t.google.tasks.values()].find((x) => x.title === 'Wash the car')!;
    assert.equal(car.due, '2026-10-25T00:00:00.000Z');
    assert.equal(car.priority, undefined);

    await t.req(`/api/lists/${l.id}/items/${mine[0].id}`, 'PATCH', { done: true });
    await settle();
    assert.equal(t.google.tasks.get('a')!.status, 'completed');
    // Still listed when done (Google lists them), and an edit there comes back.
    Object.assign(t.google.tasks.get('a')!, { status: 'needsAction', completed: null, updated: '2030-01-01T00:00:00.000Z' });
    await syncTaskLink(t.env, l.id);
    assert.equal((await t.items(l.id))[0].done, false);
    assert.equal((await t.items(l.id))[1].priority, 'high', 'priority stays in Kinwall');
    t.google.tasks.delete(car.id);
    await syncTaskLink(t.env, l.id);
    assert.deepEqual((await t.items(l.id)).map((i) => i.title), ['Return library books']);

    // A refused refresh: revoked, in plain words.
    await t.db.prepare('UPDATE task_accounts SET config = ? WHERE id = ?').bind(await encryptConfig(t.env, acc, { access_token: 'x', refresh_token: 'r', expires_at: 0 }), acc).run();
    t.google.state.refreshRefused = true;
    await syncTaskLink(t.env, l.id);
    const link = (await t.req('/api/tasks/links')).json[0];
    assert.equal(link.lastErrorCode, 'revoked');
    assert.match(link.lastError, /^Google Tasks stopped letting Kinwall see this list/);
  } finally { t.restore(); }
});

test('tasks: removing Google Tasks revokes the sign-in only when no calendar uses that account', async () => {
  const t = await setup();
  try {
    const alone = await t.addOAuthAccount('google', 'leo@example.com');
    await t.req(`/api/tasks/accounts/${alone}`, 'DELETE');
    assert.equal(t.google.state.revoked, 1);
    const shared = await t.addOAuthAccount('google', 'sam@example.com');
    await t.db.prepare("INSERT INTO accounts (id, kind, name, config, created_at) VALUES ('cal', 'google', 'Sam@example.com', '{}', '2026-01-01')").run();
    assert.equal((await t.req('/api/tasks/accounts')).json[0].alsoCalendar, true);
    await t.req(`/api/tasks/accounts/${shared}`, 'DELETE');
    assert.equal(t.google.state.revoked, 1, "the calendar's sign-in is left alone");
    assert.equal((await t.db.prepare('SELECT count(*) AS n FROM accounts').first<{ n: number }>())!.n, 1);
  } finally { t.restore(); }
});

test('tasks: Microsoft To Do syncs importance (urgent goes as high and stays urgent here), due day and notes', async () => {
  const t = await setup('America/Chicago');
  try {
    const acc = await t.addOAuthAccount('microsoft', 'alex@example.com', true);
    t.ms.tasks.set('x', { id: 'x', title: 'Pay the water bill', importance: 'high', status: 'notStarted', body: { content: 'Online', contentType: 'text' }, dueDateTime: { dateTime: '2026-10-20T00:00:00.0000000', timeZone: 'UTC' }, lastModifiedDateTime: '2026-10-01T00:00:00Z' });
    const l = await t.list();
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Book the dentist', priority: 'urgent', dueDate: '2026-11-02' });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc, remoteId: 'ml1' });
    assert.ok(t.ms.state.scopes.every((s) => s.includes('Tasks.ReadWrite') && !s.includes('Calendars')), 'refreshes ask for the To Do permission');

    const mine = await t.items(l.id);
    const bill = mine.find((i) => i.title === 'Pay the water bill');
    assert.equal(bill.priority, 'high');
    assert.equal(bill.dueDate, '2026-10-20');
    assert.equal(bill.notes, 'Online');
    const dentist = [...t.ms.tasks.values()].find((x) => x.title === 'Book the dentist')!;
    assert.equal(dentist.importance, 'high');
    assert.deepEqual(dentist.dueDateTime, { dateTime: '2026-11-02T00:00:00', timeZone: 'America/Chicago' });

    // A sync later: urgent isn't mistaken for a change in To Do, so nothing moves.
    t.ms.state.bodies.length = 0;
    assert.deepEqual(await syncTaskLink(t.env, l.id), { ok: true, pulled: 0, pushed: 0 });
    assert.equal((await t.items(l.id)).find((i) => i.title === 'Book the dentist').priority, 'urgent');
    // Done in To Do, then deleted in Kinwall.
    Object.assign(t.ms.tasks.get('x')!, { status: 'completed', lastModifiedDateTime: '2030-01-01T00:00:00Z' });
    await syncTaskLink(t.env, l.id);
    assert.equal((await t.items(l.id)).find((i) => i.title === 'Pay the water bill').done, true);
    await t.req(`/api/lists/${l.id}/items/${bill.id}`, 'DELETE');
    await settle();
    assert.equal(t.ms.tasks.has('x'), false);
  } finally { t.restore(); }
});

// --- Steps ↔ subtasks and checklist items -----------------------------------------------------

const stepTitles = (item: any) => [...item.steps].sort((a: any, b: any) => a.sort - b.sort).map((s: any) => `${s.done ? '✓' : '○'} ${s.title}`);
const subtasks = (fake: ReturnType<typeof fakeTodoist>, parent: string) =>
  [...fake.tasks.values()].filter((x) => x.parent_id === parent && !x.is_deleted).sort((a, b) => a.child_order - b.child_order).map((x) => `${x.checked ? '✓' : '○'} ${x.content}`);

test('tasks: steps sync with Todoist subtasks: copied both ways in order, ticked, renamed, deleted', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Pack for camp', steps: ['Tent', 'Sleeping bag', 'Flashlight'] });
    const rake = t.todoist.add({ content: 'Rake leaves' });
    t.todoist.add({ content: 'Find the rake', parent_id: rake });
    t.todoist.add({ content: 'Rake the front', parent_id: rake });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });

    let [pack, rakeItem] = await t.items(l.id);
    const packId = t.todoist.byTitle('Pack for camp')!.id;
    assert.deepEqual(subtasks(t.todoist, packId), ['○ Tent', '○ Sleeping bag', '○ Flashlight']);
    assert.deepEqual(stepTitles(rakeItem), ['○ Find the rake', '○ Rake the front']);

    // Ticked in Kinwall (syncs on its own), ticked and renamed in Todoist.
    const tent = pack.steps.find((s: any) => s.title === 'Tent');
    await t.req(`/api/lists/${l.id}/items/${pack.id}/steps/${tent.id}`, 'PATCH', { done: true });
    await settle();
    assert.deepEqual(subtasks(t.todoist, packId), ['✓ Tent', '○ Sleeping bag', '○ Flashlight']);
    t.todoist.edit(t.todoist.byTitle('Find the rake')!.id, { checked: true });
    t.todoist.edit(t.todoist.byTitle('Rake the front')!.id, { content: 'Rake the front yard' });
    await syncTaskLink(t.env, l.id);
    [pack, rakeItem] = await t.items(l.id);
    assert.deepEqual(stepTitles(rakeItem), ['✓ Find the rake', '○ Rake the front yard']);

    // Deleted in Kinwall → deleted in Todoist; deleted in Todoist → deleted in Kinwall.
    const bag = pack.steps.find((s: any) => s.title === 'Sleeping bag');
    await t.req(`/api/lists/${l.id}/items/${pack.id}/steps/${bag.id}`, 'DELETE');
    await settle();
    assert.equal(t.todoist.byTitle('Sleeping bag'), undefined);
    t.todoist.edit(t.todoist.byTitle('Flashlight')!.id, { is_deleted: true });
    await syncTaskLink(t.env, l.id);
    [pack] = await t.items(l.id);
    assert.deepEqual(stepTitles(pack), ['✓ Tent']);
    // ...and with every step done, the item is done, here and in Todoist.
    assert.equal(pack.done, true);
    await syncTaskLink(t.env, l.id);
    assert.equal(t.todoist.tasks.get(packId)!.checked, true);
  } finally { t.restore(); }
});

test('tasks: step order — Kinwall’s on the first sync, then whichever side moved them', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Pack for camp', steps: ['Tent', 'Sleeping bag', 'Flashlight'] });
    const id = t.todoist.add({ content: 'Pack for camp' });
    t.todoist.add({ content: 'Flashlight', parent_id: id });
    t.todoist.add({ content: 'Tent', parent_id: id });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    assert.deepEqual(subtasks(t.todoist, id), ['○ Tent', '○ Sleeping bag', '○ Flashlight'], "the first sync takes Kinwall's order");
    let pack = (await t.items(l.id))[0];
    assert.deepEqual(stepTitles(pack), ['○ Tent', '○ Sleeping bag', '○ Flashlight']);

    // Moved in Todoist: Flashlight first.
    t.todoist.byTitle('Flashlight')!.child_order = 0;
    await syncTaskLink(t.env, l.id);
    pack = (await t.items(l.id))[0];
    assert.deepEqual(stepTitles(pack), ['○ Flashlight', '○ Tent', '○ Sleeping bag']);

    // Moved in Kinwall: Sleeping bag first (syncs on its own).
    const order = ['Sleeping bag', 'Flashlight', 'Tent'].map((title) => pack.steps.find((s: any) => s.title === title).id);
    assert.equal((await t.req(`/api/lists/${l.id}/items/${pack.id}/steps/reorder`, 'POST', { stepIds: order })).status, 200);
    await settle();
    assert.deepEqual(subtasks(t.todoist, id), ['○ Sleeping bag', '○ Flashlight', '○ Tent']);
  } finally { t.restore(); }
});

test('tasks: Google Tasks subtasks are steps, placed and moved by position', async () => {
  const t = await setup();
  try {
    const acc = await t.addOAuthAccount('google', 'sam@example.com');
    const a = t.google.add({ title: 'Plan the party' });
    t.google.add({ title: 'Invitations', parent: a });
    t.google.add({ title: 'Cake', parent: a });
    const l = await t.list();
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc, remoteId: 'gl1' });
    let item = (await t.items(l.id))[0];
    assert.deepEqual(stepTitles(item), ['○ Invitations', '○ Cake']);

    // A step added in Kinwall between them lands between them in Google.
    await t.req(`/api/lists/${l.id}/items/${item.id}/steps`, 'POST', { title: 'Balloons' });
    item = (await t.items(l.id))[0];
    const ids = ['Invitations', 'Balloons', 'Cake'].map((title) => item.steps.find((s: any) => s.title === title).id);
    await t.req(`/api/lists/${l.id}/items/${item.id}/steps/reorder`, 'POST', { stepIds: ids });
    await settle();
    const kids = () => [...t.google.tasks.values()].filter((x) => x.parent === a).sort((x, y) => x.position.localeCompare(y.position)).map((x) => x.title);
    assert.deepEqual(kids(), ['Invitations', 'Balloons', 'Cake']);

    // Moved in Google: Cake first, and ticked.
    Object.assign([...t.google.tasks.values()].find((x) => x.title === 'Cake')!, { ord: -1, status: 'completed' });
    t.google.renumber(a);
    await syncTaskLink(t.env, l.id);
    item = (await t.items(l.id))[0];
    assert.deepEqual(stepTitles(item), ['✓ Cake', '○ Invitations', '○ Balloons']);
    // Deleting the item deletes the task and its subtasks.
    await t.req(`/api/lists/${l.id}/items/${item.id}`, 'DELETE');
    await settle();
    assert.equal(t.google.tasks.size, 0);
  } finally { t.restore(); }
});

test('tasks: an item with steps reopened in Kinwall stays open in Google Tasks', async () => {
  const t = await setup();
  try {
    const acc = await t.addOAuthAccount('google', 'sam@example.com');
    const a = t.google.add({ title: 'Pack for camp' });
    t.google.add({ title: 'Sleeping bag', parent: a });
    t.google.add({ title: 'Flashlight', parent: a });
    const l = await t.list();
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc, remoteId: 'gl1' });
    let item = (await t.items(l.id))[0];
    await t.req(`/api/lists/${l.id}/items/${item.id}`, 'PATCH', { done: true });
    await settle();
    assert.equal(t.google.tasks.get(a)!.status, 'completed');
    await t.req(`/api/lists/${l.id}/items/${item.id}`, 'PATCH', { done: false });
    await settle();
    await syncTaskLink(t.env, l.id); // a pull afterwards must not finish it again
    item = (await t.items(l.id))[0];
    assert.equal(item.done, false);
    assert.deepEqual(stepTitles(item), ['○ Sleeping bag', '○ Flashlight']);
    assert.equal(t.google.tasks.get(a)!.status, 'needsAction');
    assert.ok([...t.google.tasks.values()].filter((x) => x.parent === a).every((x) => x.status === 'needsAction'));
  } finally { t.restore(); }
});

test('tasks: Microsoft To Do checklist items are steps (title and done; order stays as added)', async () => {
  const t = await setup();
  try {
    const acc = await t.addOAuthAccount('microsoft', 'alex@example.com');
    t.ms.tasks.set('x', { id: 'x', title: 'Clean the garage', status: 'notStarted', importance: 'normal', lastModifiedDateTime: '2026-10-01T00:00:00Z', checklistItems: [{ id: 'c1', displayName: 'Sweep', isChecked: true }] });
    const l = await t.list();
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Wash the car', steps: ['Soap', 'Rinse'] });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc, remoteId: 'ml1' });
    assert.equal(t.ms.state.expand, 'checklistItems');
    const [garage] = await t.items(l.id);
    assert.deepEqual(stepTitles(garage), ['✓ Sweep']);
    const car = [...t.ms.tasks.values()].find((x) => x.title === 'Wash the car')!;
    assert.deepEqual(car.checklistItems.map((c: Fake) => c.displayName), ['Soap', 'Rinse']);
    // Ticked in To Do, renamed in Kinwall.
    car.checklistItems[0].isChecked = true;
    const rinse = (await t.items(l.id))[1].steps.find((s: any) => s.title === 'Rinse');
    await t.req(`/api/lists/${l.id}/items/${(await t.items(l.id))[1].id}/steps/${rinse.id}`, 'PATCH', { title: 'Rinse and dry' });
    await settle();
    await syncTaskLink(t.env, l.id);
    assert.deepEqual(stepTitles((await t.items(l.id))[1]), ['✓ Soap', '○ Rinse and dry']);
    assert.deepEqual(car.checklistItems.map((c: Fake) => c.displayName), ['Soap', 'Rinse and dry']);
    // Removed in To Do → removed here.
    car.checklistItems.splice(0, 1);
    await syncTaskLink(t.env, l.id);
    assert.deepEqual(stepTitles((await t.items(l.id))[1]), ['○ Rinse and dry']);
  } finally { t.restore(); }
});

// --- Edge cases --------------------------------------------------------------------------------

test('tasks: a Todoist task deleted while done is removed from Kinwall too', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    const id = t.todoist.add({ content: 'Return library books' });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    t.todoist.edit(id, { checked: true });
    await syncTaskLink(t.env, l.id);
    assert.equal((await t.items(l.id))[0].done, true);
    // Still done there: looked up, kept.
    await syncTaskLink(t.env, l.id);
    assert.equal((await t.items(l.id)).length, 1);
    t.todoist.edit(id, { is_deleted: true });
    await syncTaskLink(t.env, l.id);
    assert.equal((await t.items(l.id)).length, 0);
  } finally { t.restore(); }
});

test('tasks: an item moved to another Kinwall list leaves the synced list in Todoist', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    const other = await t.list('Someday');
    const id = t.todoist.add({ content: 'Paint the fence' });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    const item = (await t.items(l.id))[0];
    assert.equal((await t.req(`/api/lists/${l.id}/items/move`, 'POST', { itemIds: [item.id], toListId: other.id })).status, 200);
    await settle();
    assert.equal(t.todoist.tasks.get(id)!.is_deleted, true);
    assert.equal((await t.items(other.id))[0].title, 'Paint the fence', 'it stays in Kinwall, on the other list');
  } finally { t.restore(); }
});

test('tasks: a turned-down sign-in tells the grown-ups once, in their language, until it syncs again', async () => {
  const t = await setup();
  try {
    await t.req('/api/members', 'POST', { name: 'Sam', color: '#57e', grownUp: true });
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list('Weekend To-Dos');
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    const NOON = new Date('2026-10-08T16:00:00Z');
    const bell = async () => (await t.req('/api/notifications')).json.filter((n: any) => n.url === '/#/settings?tab=calendars&section=todo-apps');
    t.todoist.state.token = 'fake-reset-token-999';
    await syncTaskLink(t.env, l.id);
    await runNotifications(t.env, NOON);
    await syncTaskLink(t.env, l.id);
    await runNotifications(t.env, NOON);
    assert.deepEqual((await bell()).map((n: any) => [n.title, n.body]), [['Weekend To-Dos stopped syncing with Todoist', 'Tap to reconnect it.']]);
    // Fixed, then turned down again: told again.
    t.todoist.state.token = GOOD;
    await syncTaskLink(t.env, l.id);
    t.todoist.state.token = 'fake-reset-token-999';
    await syncTaskLink(t.env, l.id);
    await runNotifications(t.env, NOON);
    assert.equal((await bell()).length, 2);
    // German for a German family.
    await t.req('/api/settings', 'PATCH', { language: 'de' });
    await t.db.prepare('UPDATE task_links SET reconnect_notified_at = NULL').run();
    await runNotifications(t.env, NOON);
    assert.equal((await bell())[0].title, 'Weekend To-Dos synchronisiert nicht mehr mit Todoist');
  } finally { t.restore(); }
});

test('tasks: export and import carry synced lists without the account; connecting it again picks up where it was', async () => {
  const t = await setup();
  try {
    const acc = (await t.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD })).json;
    const l = await t.list();
    await t.req(`/api/lists/${l.id}/items`, 'POST', { title: 'Pack for camp', steps: ['Tent'] });
    t.todoist.add({ content: 'Rake leaves' });
    await t.req(`/api/tasks/links/${l.id}`, 'PUT', { accountId: acc.id, remoteId: 'p1' });
    const file = (await t.req('/api/export')).json;
    assert.equal(file.taskLinks.length, 1);
    assert.equal(file.taskLinks[0].items.length, 3); // two items and a step
    assert.ok(!JSON.stringify(file).includes(GOOD), 'never the token');

    // A fresh Kinwall: the list comes back waiting for Todoist.
    const fresh = await setup();
    fresh.restore();
    globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => t.todoist.handle(new URL(String(input)), init)) as typeof fetch;
    assert.equal((await fresh.req('/api/import', 'POST', file)).status, 200);
    let link = (await fresh.req('/api/tasks/links')).json[0];
    assert.deepEqual([link.needsReconnect, link.accountId, link.app, link.remoteName], [true, null, 'todoist', 'Chores']);
    assert.equal((await syncTaskLink(fresh.env, l.id)).ok, false);
    // Connecting Todoist takes it up with its pairings: nothing doubles.
    const before = t.todoist.tasks.size;
    await fresh.req('/api/tasks/accounts/todoist', 'POST', { token: GOOD });
    await syncTaskLink(fresh.env, l.id);
    link = (await fresh.req('/api/tasks/links')).json[0];
    assert.equal(link.needsReconnect, false);
    assert.equal(link.lastError, null);
    assert.equal(t.todoist.tasks.size, before);
    assert.equal((await fresh.items(l.id)).length, 2);
    // A second import changes nothing.
    assert.equal((await fresh.req('/api/import', 'POST', file)).status, 200);
    assert.equal((await fresh.req('/api/tasks/links')).json[0].needsReconnect, false);
  } finally { t.restore(); }
});
