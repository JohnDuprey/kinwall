import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { applyMigrations, openDb } from '../src/d1-sqlite.ts';

// A chore for several people: one linked copy each, so each ticks it off on their own.
async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: 'k', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as any;
  const req = async (p: string, method = 'GET', body?: unknown) => {
    const r = await createApp().request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' } }, env);
    return { status: r.status, json: (await r.json()) as any };
  };
  const member = async (name: string) => (await req('/api/members', 'POST', { name, color: '#57e' })).json.id as string;
  const [maya, leo, sam] = [await member('Maya'), await member('Leo'), await member('Sam')];
  const chores = async () => (await req('/api/chores')).json as any[];
  return { req, maya, leo, sam, chores };
}

test('chore groups: creating for several people makes one linked chore each, ticked off separately', async () => {
  const { req, maya, leo, chores } = await setup();
  const res = await req('/api/chores', 'POST', { title: 'Feed the cat', points: 5, dueDate: '2026-06-01', memberIds: [maya, leo, maya] });
  assert.equal(res.status, 201);
  assert.ok(res.json.groupId);
  const all = await chores();
  assert.deepEqual(all.map((c) => c.memberId).sort(), [maya, leo].sort());
  assert.ok(all.every((c) => c.groupId === res.json.groupId && c.title === 'Feed the cat'));

  const mayas = all.find((c) => c.memberId === maya);
  assert.equal((await req(`/api/chores/${mayas.id}/complete`, 'POST', { date: '2026-06-01' })).status, 200);
  const day = (await req('/api/chores/day?date=2026-06-01')).json as any[];
  assert.deepEqual(day.map((c) => [c.memberId, c.completed]).sort(), [[maya, true], [leo, false]].sort());
});

test('chore groups: one person or Anyone stays a plain chore, and unknown people are refused', async () => {
  const { req, maya } = await setup();
  assert.equal((await req('/api/chores', 'POST', { title: 'A', dueDate: '2026-06-01', memberIds: [maya] })).json.groupId, null);
  const anyone = await req('/api/chores', 'POST', { title: 'B', dueDate: '2026-06-01', memberIds: [] });
  assert.deepEqual([anyone.json.memberId, anyone.json.groupId], [null, null]);
  assert.equal((await req('/api/chores', 'POST', { title: 'C', dueDate: '2026-06-01', memberIds: [maya, 'nobody'] })).status, 400);
});

test('chore groups: editing one copy changes them all, except its own order', async () => {
  const { req, maya, leo, chores } = await setup();
  await req('/api/chores', 'POST', { title: 'Dishes', points: 5, dueDate: '2026-06-01', memberIds: [maya, leo] });
  const [first] = await chores();
  assert.equal((await req(`/api/chores/${first.id}`, 'PATCH', { title: 'Dry dishes', points: 10, rrule: 'FREQ=DAILY', sort: 7 })).status, 200);
  const all = await chores();
  assert.ok(all.every((c) => c.title === 'Dry dishes' && c.points === 10 && c.rrule === 'FREQ=DAILY'));
  assert.deepEqual(all.map((c) => c.sort).sort(), [0, 7]);
});

test('chore groups: memberIds adds and removes people, keeping the copies that stay', async () => {
  const { req, maya, leo, sam, chores } = await setup();
  const made = await req('/api/chores', 'POST', { title: 'Tidy', dueDate: '2026-06-01', memberIds: [maya, leo] });
  const before = await chores();
  const leos = before.find((c) => c.memberId === leo);

  // Add Sam, drop Maya: Leo's copy is the same chore, Maya's goes.
  const res = await req(`/api/chores/${leos.id}`, 'PATCH', { memberIds: [leo, sam] });
  assert.equal(res.status, 200);
  assert.equal(res.json.id, leos.id);
  let all = await chores();
  assert.deepEqual(all.map((c) => c.memberId).sort(), [leo, sam].sort());
  assert.ok(all.some((c) => c.id === leos.id));
  assert.ok(all.every((c) => c.groupId === made.json.groupId && c.title === 'Tidy'));

  // Down to one person: a plain chore again.
  await req(`/api/chores/${leos.id}`, 'PATCH', { memberIds: [sam] });
  all = await chores();
  assert.equal(all.length, 1);
  assert.deepEqual([all[0].memberId, all[0].groupId], [sam, null]);

  // A plain chore becomes linked copies.
  await req(`/api/chores/${all[0].id}`, 'PATCH', { memberIds: [sam, maya] });
  all = await chores();
  assert.equal(all.length, 2);
  assert.ok(all[0].groupId && all[0].groupId === all[1].groupId);

  // Anyone: one chore nobody in particular has to do.
  await req(`/api/chores/${all[0].id}`, 'PATCH', { memberIds: [] });
  all = await chores();
  assert.deepEqual(all.map((c) => [c.memberId, c.groupId]), [[null, null]]);
});

test('chore groups: deleting one copy deletes them all, keeping the history of done ones', async () => {
  const { req, maya, leo, chores } = await setup();
  await req('/api/chores', 'POST', { title: 'Walk the dog', dueDate: '2026-06-01', memberIds: [maya, leo] });
  const [a, b] = await chores();
  await req(`/api/chores/${b.id}/complete`, 'POST', { date: '2026-06-01' });
  assert.equal((await req(`/api/chores/${a.id}`, 'DELETE')).status, 200);
  assert.deepEqual(await chores(), []);
  const exported = (await req('/api/export')).json;
  assert.deepEqual(exported.chores.map((c: any) => [c.id, c.archived, c.groupId]), [[b.id, true, a.groupId]]);
});
