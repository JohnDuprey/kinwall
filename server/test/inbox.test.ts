import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const app = createApp();
  const send = async (path: string, method = 'GET', body?: unknown, key = 'k') => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: await res.json() as any };
  };
  const wall = (await send('/api/keys', 'POST', { name: 'Kitchen wall', scope: 'display' })).body.key;
  const maya = (await send('/api/members', 'POST', { name: 'Maya', color: '#339966' })).body;
  const child = (await send('/api/keys', 'POST', { name: "Maya's tablet", scope: 'display' })).body;
  await send(`/api/keys/${child.id}`, 'PATCH', { kind: 'kid', owner: maya.id });
  const list = (await send('/api/lists', 'POST', { name: 'To-do', kind: 'todo' })).body;
  return { send, db, wall, kid: child.key, list };
}
const count = async (db: any, sql: string, ...args: unknown[]) => (await db.prepare(sql).bind(...args).first() as { n: number }).n;

test('inbox: parents jot thoughts down; a retry with the same id adds it once; walls and kids see nothing', async () => {
  const { send, db, wall, kid } = await setup();
  const id = crypto.randomUUID();
  const first = await send('/api/inbox', 'POST', { id, text: '  Permission slip for Friday ' });
  assert.equal(first.status, 201);
  assert.equal(first.body.text, 'Permission slip for Friday');
  assert.equal(first.body.status, 'open');
  assert.equal((await send('/api/inbox', 'POST', { id, text: 'Permission slip for Friday' })).status, 201);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM inbox_items'), 1);
  assert.equal((await send('/api/inbox', 'POST', { text: '   ' })).status, 400);
  for (const key of [wall, kid]) {
    assert.equal((await send('/api/inbox', 'GET', undefined, key)).status, 403);
    assert.equal((await send('/api/inbox', 'POST', { text: 'x' }, key)).status, 403);
    assert.equal((await send(`/api/inbox/${id}/sort`, 'POST', { kind: 'note', title: 'x', expiresAt: '2030-01-01T00:00:00Z' }, key)).status, 403);
  }
  assert.deepEqual((await send('/api/inbox')).body.items.map((i: any) => i.text), ['Permission slip for Friday']);
});

test('inbox: sorting into a task adds it once, keeps the words and says where it went', async () => {
  const { send, db, list } = await setup();
  const item = (await send('/api/inbox', 'POST', { text: 'Permission slip for Friday' })).body;
  const sorted = await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'task', listId: list.id, title: 'Sign permission slip', dueDate: '2026-11-20' });
  assert.equal(sorted.status, 200);
  assert.equal(sorted.body.status, 'sorted');
  assert.equal(sorted.body.text, 'Permission slip for Friday');
  assert.deepEqual(sorted.body.target, { kind: 'task', id: item.id, listId: list.id, label: 'To-do' });
  const again = await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'task', listId: list.id, title: 'Sign permission slip' });
  assert.equal(again.status, 409);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM list_items WHERE list_id = ?', list.id), 1);
  const added = await db.prepare('SELECT title, due_date FROM list_items WHERE id = ?').bind(item.id).first();
  assert.deepEqual({ ...(added as object) }, { title: 'Sign permission slip', due_date: '2026-11-20' });
});

test('inbox: sorting into an event or a note goes through their own routes', async () => {
  const { send } = await setup();
  await send('/api/calendars', 'POST', { kind: 'local', name: 'Family', color: '#F2A27A' });
  const a = (await send('/api/inbox', 'POST', { text: 'Bake sale Thursday' })).body;
  const event = await send(`/api/inbox/${a.id}/sort`, 'POST', { kind: 'event', event: { title: 'Bake sale', start: '2026-11-19', end: '2026-11-20', allDay: true } });
  assert.equal(event.status, 200, JSON.stringify(event.body));
  assert.equal(event.body.target.kind, 'event');
  assert.equal(event.body.target.at, '2026-11-19');
  assert.equal((await send(`/api/events/${encodeURIComponent(event.body.target.id)}`)).body.title, 'Bake sale');
  const b = (await send('/api/inbox', 'POST', { text: 'Remember an idea for dinner' })).body;
  const note = await send(`/api/inbox/${b.id}/sort`, 'POST', { kind: 'note', title: 'Taco night idea', details: 'Remember an idea for dinner', expiresAt: '2099-01-01T00:00:00Z' });
  assert.equal(note.status, 200);
  const all = (await send('/api/announcements?status=all')).body.announcements;
  assert.deepEqual(all.map((x: any) => [x.id, x.title]), [[note.body.target.id, 'Taco night idea']]);
});

test('inbox: a refused task, event or note leaves the thought in the inbox to try again', async () => {
  const { send, db, list } = await setup();
  const item = (await send('/api/inbox', 'POST', { text: 'Ask about a library book' })).body;
  const missing = await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'task', listId: 'nope', title: 'Ask about a library book' });
  assert.equal(missing.status, 404);
  const badEvent = await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'event', event: { title: 'x', start: 'soon', end: 'later' } });
  assert.equal(badEvent.status, 400);
  await send('/api/settings', 'PATCH', { features: { ...(await send('/api/settings')).body.features, announcements: false } });
  assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'note', title: 'x', expiresAt: '2099-01-01T00:00:00Z' })).status, 404);
  const back = (await send('/api/inbox')).body.items[0];
  assert.deepEqual([back.status, back.target, back.text], ['open', null, 'Ask about a library book']);
  assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'task', listId: list.id, title: 'Ask about a library book' })).status, 200);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM list_items'), 1);
});

test('inbox: not needed clears without deleting, put back returns it, and an interrupted sort can be put back', async () => {
  const { send, db } = await setup();
  const item = (await send('/api/inbox', 'POST', { text: 'Call grandma' })).body;
  const cleared = await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'cleared' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.status, 'cleared');
  assert.ok(cleared.body.doneAt);
  assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'cleared' })).status, 409);
  assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'note', title: 'x', expiresAt: '2099-01-01T00:00:00Z' })).status, 409);
  assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' })).body.status, 'open');
  // A sort that stopped after claiming it (nothing made): still listed. While it might still be
  // saving it stays put; a few minutes later it can go back.
  await db.prepare("UPDATE inbox_items SET status = 'sorted', target = '{\"kind\":\"task\",\"id\":null}', updated_at = ? WHERE id = ?").bind(new Date().toISOString(), item.id).run();
  assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' })).status, 409);
  await db.prepare('UPDATE inbox_items SET updated_at = ? WHERE id = ?').bind(new Date(Date.now() - 10 * 60_000).toISOString(), item.id).run();
  assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' })).body.status, 'open');
  assert.equal((await send(`/api/inbox/nope`, 'PATCH', { status: 'open' })).status, 404);
});

test('inbox: turned off in Features, every route answers 404', async () => {
  const { send } = await setup();
  const item = (await send('/api/inbox', 'POST', { text: 'x' })).body;
  await send('/api/settings', 'PATCH', { features: { ...(await send('/api/settings')).body.features, inbox: false } });
  assert.equal((await send('/api/inbox')).status, 404);
  assert.equal((await send('/api/inbox', 'POST', { text: 'y' })).status, 404);
  assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'cleared' })).status, 404);
});

test('inbox: the family backup carries every thought, and restoring it brings them back', async () => {
  const { send, list } = await setup();
  const a = (await send('/api/inbox', 'POST', { text: 'Permission slip for Friday' })).body;
  await send(`/api/inbox/${a.id}/sort`, 'POST', { kind: 'task', listId: list.id, title: 'Permission slip' });
  await send('/api/inbox', 'POST', { text: 'Ask about a library book' });
  const backup = (await send('/api/export')).body;
  assert.deepEqual(backup.inboxItems.map((i: any) => [i.text, i.status]), [['Ask about a library book', 'open'], ['Permission slip for Friday', 'sorted']]);
  const fresh = await setup();
  const restored = await fresh.send('/api/import', 'POST', { ...backup, lists: [] });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.imported.inboxItems, 2);
  assert.deepEqual((await fresh.send('/api/inbox')).body.items, backup.inboxItems);
});

// Interruptions: the database fails (or the request stops) after the task, event or note was made.
/** Makes statements matching `match` throw while `on()` is true. */
function failing(db: any, match: RegExp, on: () => boolean) {
  const prepare = db.prepare.bind(db);
  db.prepare = (sql: string) => {
    if (match.test(sql) && on()) throw new Error('simulated interruption');
    return prepare(sql);
  };
}
/** Holds statements matching `match` until the returned function is called. */
function holding(db: any, match: RegExp) {
  const prepare = db.prepare.bind(db);
  let go!: () => void, reached!: () => void;
  const gate = new Promise<void>(r => { go = r; }), held = new Promise<void>(r => { reached = r; });
  db.prepare = (sql: string) => {
    const stmt = prepare(sql);
    if (!match.test(sql)) return stmt;
    return { bind: (...args: unknown[]) => ({ run: async () => { reached(); await gate; return stmt.bind(...args).run(); } }) };
  };
  return { held, go };
}
const ago = (db: any, id: string, minutes: number) => db.prepare('UPDATE inbox_items SET updated_at = ? WHERE id = ?').bind(new Date(Date.now() - minutes * 60_000).toISOString(), id).run();
const bakeSale = { kind: 'event', event: { title: 'Bake sale', start: '2026-11-20', end: '2026-11-21', allDay: true } };
const tacoNote = { kind: 'note', title: 'Taco night idea', expiresAt: '2099-01-01T00:00:00Z' };

for (const [kind, body, table] of [['event', bakeSale, 'events'], ['note', tacoNote, 'announcements']] as const) {
  test(`inbox: ${kind === "event" ? "an" : "a"} ${kind} made before saving where it went is linked, and putting it back or retrying makes no second one`, async () => {
    const { send, db } = await setup();
    await send('/api/calendars', 'POST', { kind: 'local', name: 'Family', color: '#F2A27A' });
    const item = (await send('/api/inbox', 'POST', { text: 'Bake sale Friday' })).body;
    let once = true;
    failing(db, /^UPDATE inbox_items SET target/, () => once && !(once = false));
    assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', body)).status, 500);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM ${table}`), 1);
    const made = (await db.prepare(`SELECT id FROM ${table}`).first() as any).id;
    assert.equal((await send('/api/inbox')).body.items[0].target.id, made);
    await ago(db, item.id, 10);
    assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' })).status, 409);
    assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', body)).status, 409);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM ${table}`), 1);
  });

  test(`inbox: when the database stays down after a ${kind} was made, put back links it once it can`, async () => {
    const { send, db } = await setup();
    await send('/api/calendars', 'POST', { kind: 'local', name: 'Family', color: '#F2A27A' });
    const item = (await send('/api/inbox', 'POST', { text: 'Bake sale Friday' })).body;
    let down = true;
    failing(db, /^UPDATE inbox_items SET (target|status = 'open')/, () => down);
    assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', body)).status, 500);
    down = false;
    const stuck = (await send('/api/inbox')).body.items[0];
    assert.deepEqual([stuck.status, stuck.target], ['sorted', { kind, id: null }]);
    const made = (await db.prepare(`SELECT id FROM ${table}`).first() as any).id;
    // It was made, so linking it is safe straight away.
    const back = await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' });
    assert.equal(back.status, 200);
    assert.deepEqual([back.body.status, back.body.target.kind, back.body.target.id], ['sorted', kind, made]);
    assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', body)).status, 409);
    assert.equal(await count(db, `SELECT COUNT(*) AS n FROM ${table}`), 1);
  });
}

test('inbox: an interrupted task is linked to its list, and sorting it into another list adds nothing', async () => {
  const { send, db, list } = await setup();
  const other = (await send('/api/lists', 'POST', { name: 'Errands', kind: 'todo' })).body;
  const item = (await send('/api/inbox', 'POST', { text: 'Permission slip' })).body;
  let down = true;
  failing(db, /^UPDATE inbox_items SET (target|status = 'open')/, () => down);
  assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'task', listId: list.id, title: 'Permission slip' })).status, 500);
  down = false;
  await ago(db, item.id, 10);
  const back = await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' });
  assert.deepEqual(back.body.target, { kind: 'task', id: item.id, listId: list.id, label: 'To-do' });
  assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', { kind: 'task', listId: other.id, title: 'Permission slip' })).status, 409);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM list_items'), 1);
});

test('inbox: put back while a sort is still saving waits, and the event is made once', async () => {
  const { send, db } = await setup();
  await send('/api/calendars', 'POST', { kind: 'local', name: 'Family', color: '#F2A27A' });
  const item = (await send('/api/inbox', 'POST', { text: 'Bake sale Friday' })).body;
  const { held, go } = holding(db, /^INSERT INTO events/);
  const sorting = send(`/api/inbox/${item.id}/sort`, 'POST', bakeSale);
  await held;
  assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' })).status, 409);
  go();
  const sorted = await sorting;
  assert.equal(sorted.status, 200);
  assert.equal(sorted.body.target.id, (await db.prepare('SELECT id FROM events').first() as any).id);
  assert.equal((await send(`/api/inbox/${item.id}/sort`, 'POST', bakeSale)).status, 409);
  assert.equal(await count(db, 'SELECT COUNT(*) AS n FROM events'), 1);
});

test('inbox: a sort that finishes long after the thought was put back and sorted again leaves the newer sort alone', async () => {
  const { send, db } = await setup();
  await send('/api/calendars', 'POST', { kind: 'local', name: 'Family', color: '#F2A27A' });
  const item = (await send('/api/inbox', 'POST', { text: 'Bake sale Friday' })).body;
  const { held, go } = holding(db, /^INSERT INTO events/);
  const sorting = send(`/api/inbox/${item.id}/sort`, 'POST', bakeSale);
  await held;
  await ago(db, item.id, 10);
  assert.equal((await send(`/api/inbox/${item.id}`, 'PATCH', { status: 'open' })).body.status, 'open');
  const note = await send(`/api/inbox/${item.id}/sort`, 'POST', tacoNote);
  assert.equal(note.body.target.kind, 'note');
  go();
  await sorting;
  const now = (await send('/api/inbox')).body.items[0];
  assert.deepEqual([now.status, now.target], ['sorted', note.body.target]);
});
