// Chore library: saved, unscheduled chores a parent hands out in a couple of taps. CRUD, assigning
// (a one-off, or a repeating chore), last done from the chores made from it, parent-only access,
// the starter set on a new family, and export/import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { seedChoreLibrary, STARTER_LIBRARY } from '../src/routes/chore-library.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  return { db, env, req };
}

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('library: create, list, update and delete; checklist and person are checked', async () => {
  const { req } = setup();
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const list = (await req('/api/lists', 'POST', { name: 'Car checklist', kind: 'reusable' })).json;
  const created = await req('/api/chore-library', 'POST', { title: 'Clean out the car', emoji: '🚗', points: 10, listId: list.id, memberId: leo.id, everyN: 4, everyUnit: 'week', notes: 'Vacuum the mats too' });
  assert.equal(created.status, 201);
  assert.deepEqual(
    { ...created.json, id: undefined, createdAt: undefined },
    { id: undefined, createdAt: undefined, title: 'Clean out the car', emoji: '🚗', points: 10, listId: list.id, memberId: leo.id, everyN: 4, everyUnit: 'week', needsApproval: null, notes: 'Vacuum the mats too', lastDone: null, lastMemberId: null, timesAssigned: 0, open: null },
  );
  assert.equal((await req('/api/chore-library', 'POST', { title: 'X', listId: 'nope' })).status, 400);
  assert.equal((await req('/api/chore-library', 'POST', { title: 'X', memberId: 'nope' })).status, 400);
  assert.equal((await req('/api/chore-library', 'POST', { title: 'X', everyN: 2 })).status, 400); // a number needs its unit

  const patched = await req(`/api/chore-library/${created.json.id}`, 'PATCH', { points: 12, everyN: null, everyUnit: null, memberId: null });
  assert.equal(patched.status, 200);
  assert.deepEqual([patched.json.points, patched.json.everyN, patched.json.everyUnit, patched.json.memberId, patched.json.title], [12, null, null, null, 'Clean out the car']);
  assert.equal((await req('/api/chore-library')).json.length, 1);

  assert.equal((await req(`/api/chore-library/${created.json.id}`, 'DELETE')).status, 200);
  assert.equal((await req(`/api/chore-library/${created.json.id}`, 'DELETE')).status, 404);
  assert.deepEqual((await req('/api/chore-library')).json, []);
});

test('library: assigning makes a normal one-off chore; "Make it repeat" makes a recurring one', async () => {
  const { req } = setup();
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const list = (await req('/api/lists', 'POST', { name: 'Windows', kind: 'reusable' })).json;
  const item = (await req('/api/chore-library', 'POST', { title: 'Wash the windows', emoji: '🪟', points: 15, listId: list.id, memberId: leo.id, needsApproval: true })).json;

  const once = await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: today });
  assert.equal(once.status, 201);
  assert.deepEqual(
    [once.json.title, once.json.emoji, once.json.points, once.json.memberId, once.json.listId, once.json.needsApproval, once.json.rrule, once.json.dueDate, once.json.libraryId],
    ['Wash the windows', '🪟', 15, leo.id, list.id, true, null, today, item.id], // the suggested person when no one is named
  );
  const day = (await req(`/api/chores/day?date=${today}`)).json;
  assert.deepEqual(day.map((c: any) => c.title), ['Wash the windows']);

  const forMaya = await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: daysAgo(-2), memberId: maya.id });
  assert.equal(forMaya.json.memberId, maya.id);
  const anyone = await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: today, memberId: null });
  assert.equal(anyone.json.memberId, null);

  const repeat = await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: today, memberId: maya.id, rrule: 'FREQ=WEEKLY;INTERVAL=4' });
  assert.equal(repeat.status, 201);
  assert.deepEqual([repeat.json.rrule, repeat.json.dueDate, repeat.json.libraryId], ['FREQ=WEEKLY;INTERVAL=4', today, item.id]);
  assert.equal((await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: today, rrule: 'nonsense' })).status, 400);
  assert.equal((await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: 'tomorrow' })).status, 400);
  assert.equal((await req('/api/chore-library/nope/assign', 'POST', { date: today })).status, 404);

  // The chore editor's "Make it repeat" path: POST /api/chores with the library id.
  const viaEditor = await req('/api/chores', 'POST', { title: 'Wash the windows', libraryId: item.id, rrule: 'FREQ=MONTHLY' });
  assert.equal(viaEditor.json.libraryId, item.id);
  assert.equal((await req('/api/chores', 'POST', { title: 'X', libraryId: 'nope' })).status, 400);

  // A deleted library item leaves its chores alone.
  await req(`/api/chore-library/${item.id}`, 'DELETE');
  const chores = (await req('/api/chores')).json;
  assert.equal(chores.length, 5);
  assert.ok(chores.every((c: any) => c.libraryId === null));
});

test('library: last done, last person and the open assignment come from the chores made from it', async () => {
  const { req } = setup();
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const item = (await req('/api/chore-library', 'POST', { title: 'Flip the mattress', points: 5, everyN: 3, everyUnit: 'month' })).json;
  const other = (await req('/api/chore-library', 'POST', { title: 'Rake leaves', points: 5 })).json;

  const first = (await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: daysAgo(40), memberId: leo.id })).json;
  await req(`/api/chores/${first.id}/complete`, 'POST', { date: daysAgo(40) });
  const second = (await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: daysAgo(9), memberId: maya.id })).json;
  await req(`/api/chores/${second.id}/complete`, 'POST', { date: daysAgo(9) });
  const next = (await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: daysAgo(-3), memberId: leo.id })).json;
  // A chore made by hand (not from the library) doesn't count.
  const byHand = (await req('/api/chores', 'POST', { title: 'Flip the mattress', dueDate: today })).json;
  await req(`/api/chores/${byHand.id}/complete`, 'POST', { date: today });

  const lib = (await req('/api/chore-library')).json;
  const got = lib.find((l: any) => l.id === item.id);
  assert.deepEqual(got.lastDone, { date: daysAgo(9), memberId: maya.id });
  assert.deepEqual([got.lastMemberId, got.timesAssigned], [leo.id, 3]);
  assert.deepEqual(got.open, { choreId: next.id, dueDate: daysAgo(-3), memberId: leo.id, repeats: false });
  assert.deepEqual(lib.find((l: any) => l.id === other.id).lastDone, null);
  assert.deepEqual(lib.map((l: any) => l.title), ['Flip the mattress', 'Rake leaves']); // A-Z; the app sorts "due-ish" first

  // A completion still waiting for a parent's OK isn't "done".
  const kid = (await req('/api/keys', 'POST', { name: 'Leo tablet', scope: 'display' })).json.key;
  await req(`/api/members/${leo.id}`, 'PATCH', { needsApproval: true });
  await req(`/api/chores/${next.id}/complete`, 'POST', { date: daysAgo(-3) }, kid);
  assert.deepEqual((await req('/api/chore-library')).json.find((l: any) => l.id === item.id).lastDone.date, daysAgo(9));
});

test("library: parent devices only - wall screens and kids' devices get 403, but still do assigned chores", async () => {
  const { req } = setup();
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const item = (await req('/api/chore-library', 'POST', { title: 'Organize the garage', points: 20 })).json;
  const assigned = (await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: today, memberId: leo.id })).json;
  const wall = (await req('/api/keys', 'POST', { name: 'Kitchen', scope: 'display' })).json.key;
  const kid = (await req('/api/keys', 'POST', { name: 'Leo tablet', scope: 'display' })).json;
  await req(`/api/keys/${kid.id}`, 'PATCH', { owner: leo.id });
  for (const key of [wall, kid.key]) {
    assert.equal((await req('/api/chore-library', 'GET', undefined, key)).status, 403);
    assert.equal((await req('/api/chore-library', 'POST', { title: 'Sneaky' }, key)).status, 403);
    assert.equal((await req(`/api/chore-library/${item.id}`, 'PATCH', { points: 999 }, key)).status, 403);
    assert.equal((await req(`/api/chore-library/${item.id}`, 'DELETE', undefined, key)).status, 403);
    assert.equal((await req(`/api/chore-library/${item.id}/assign`, 'POST', { date: today }, key)).status, 403);
  }
  assert.equal((await req(`/api/chores/${assigned.id}/complete`, 'POST', { date: today }, kid.key)).status, 200);
});

test('library: "Save to library" from a chore copies it and links that chore', async () => {
  const { req } = setup();
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const chore = (await req('/api/chores', 'POST', { title: 'Deep-clean the fridge', emoji: '🧊', points: 8, memberId: leo.id, dueDate: daysAgo(20), needsApproval: false })).json;
  await req(`/api/chores/${chore.id}/complete`, 'POST', { date: daysAgo(20) });
  const saved = await req('/api/chore-library', 'POST', { fromChoreId: chore.id, everyN: 1, everyUnit: 'month' });
  assert.equal(saved.status, 201);
  assert.deepEqual([saved.json.title, saved.json.emoji, saved.json.points, saved.json.memberId, saved.json.needsApproval, saved.json.everyN], ['Deep-clean the fridge', '🧊', 8, leo.id, false, 1]);
  assert.deepEqual(saved.json.lastDone, { date: daysAgo(20), memberId: leo.id }); // its history comes along
  assert.equal((await req('/api/chores')).json[0].libraryId, saved.json.id);
  assert.equal((await req('/api/chore-library', 'POST', { fromChoreId: 'nope' })).status, 404);
  assert.equal((await req('/api/chore-library', 'POST', {})).status, 400); // a title or a chore to copy
});

test('library: a new family gets the starter set once; an existing family gets none', async () => {
  const fresh = setup();
  const claim = await fresh.req('/api/setup/claim', 'POST', { code: ADMIN, deviceRole: 'admin', deviceName: 'Phone' }, '');
  assert.equal(claim.status, 200);
  const lib = (await fresh.req('/api/chore-library')).json;
  assert.deepEqual(lib.map((l: any) => l.title).sort(), STARTER_LIBRARY.map((s) => s.title).sort());
  assert.ok(lib.length >= 6 && lib.length <= 10);
  // Deleting them sticks: seeding again (another boot, a second claim attempt) adds nothing.
  for (const l of lib) await fresh.req(`/api/chore-library/${l.id}`, 'DELETE');
  await seedChoreLibrary(fresh.env.DB);
  assert.equal((await fresh.req('/api/setup/claim', 'POST', { code: ADMIN, deviceRole: 'admin', deviceName: 'Phone' }, '')).status, 409);
  assert.deepEqual((await fresh.req('/api/chore-library')).json, []);

  const existing = setup();
  await existing.req('/api/members', 'POST', { name: 'Leo', color: '#e57' });
  assert.equal((await existing.req('/api/setup/claim', 'POST', { code: ADMIN, deviceRole: 'admin', deviceName: 'Phone' }, '')).status, 409);
  assert.deepEqual((await existing.req('/api/chore-library')).json, []);
});

test('library: export -> import round-trips the library and which chores came from it', async () => {
  const source = setup();
  const leo = (await source.req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const list = (await source.req('/api/lists', 'POST', { name: 'Car', kind: 'reusable' })).json;
  const item = (await source.req('/api/chore-library', 'POST', { title: 'Clean out the car', emoji: '🚗', points: 10, listId: list.id, memberId: leo.id, everyN: 1, everyUnit: 'month', needsApproval: true, notes: 'Mats too' })).json;
  const chore = (await source.req(`/api/chore-library/${item.id}/assign`, 'POST', { date: daysAgo(3) })).json;
  await source.req(`/api/chores/${chore.id}/complete`, 'POST', { date: daysAgo(3) });
  const file = (await source.req('/api/export')).json;
  assert.equal(file.choreLibrary.length, 1);
  assert.equal(file.chores[0].libraryId, item.id);

  const target = setup();
  const res = await target.req('/api/import', 'POST', file);
  assert.equal(res.status, 200);
  assert.equal(res.json.imported.choreLibrary, 1);
  const { exportedAt: _a, ...before } = file;
  const { exportedAt: _b, ...after } = (await target.req('/api/export')).json;
  assert.deepEqual(after, { ...before, passkeys: [], webhooks: [] });
  assert.deepEqual((await target.req('/api/chore-library')).json, (await source.req('/api/chore-library')).json);

  // Files from before the library import fine.
  const { choreLibrary: _c, ...old } = file;
  const fresh = setup();
  assert.equal((await fresh.req('/api/import', 'POST', { ...old, chores: old.chores.map(({ libraryId: _l, ...ch }: any) => ch) })).status, 200);
  assert.equal((await fresh.req('/api/chores')).json[0].libraryId, null);
});
