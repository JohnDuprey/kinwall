// Grown-ups: parents and other adults. Their chores never wait for a parent's OK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runMigrations } from '../src/migrate.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const today = new Date().toISOString().slice(0, 10);
const yearsAgo = (n: number, days = 0) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, json: (await res.json()) as any };
  };
  return { db, req };
}

test('migration 0051: grown-up backfill from birthdays with a year', async () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const migrations = files.map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }));
  const db = openDb(':memory:') as unknown as D1Database;
  await runMigrations(db, migrations.filter((m) => m.name < '0051'));
  const rows: [string, string | null, number][] = [
    ['Alex', yearsAgo(40), 1],
    ['Sam', yearsAgo(18), 1], // 18 today
    ['Maya', yearsAgo(18, 1), 0], // 18 tomorrow
    ['Leo', yearsAgo(7), 0],
    ['NoYear', '--03-14', 1],
    ['NoBirthday', null, 1],
  ];
  for (const [name, birthday, needs] of rows)
    await db.prepare("INSERT INTO members (id, name, color, birthday, sort, created_at, needs_approval) VALUES (?, ?, '#000', ?, 0, '2026-01-01', ?)").bind(name, name, birthday, needs).run();
  await runMigrations(db, migrations);
  const got = (await db.prepare('SELECT id, grown_up, needs_approval FROM members ORDER BY id').all<{ id: string; grown_up: number; needs_approval: number }>()).results;
  assert.deepEqual(Object.fromEntries(got.map((r) => [r.id, [r.grown_up, r.needs_approval]])), {
    Alex: [1, 0],
    Sam: [1, 0],
    Maya: [0, 0],
    Leo: [0, 0],
    NoYear: [0, 1],
    NoBirthday: [0, 1],
  });
});

test('members API: grownUp defaults false, forces needsApproval off', async () => {
  const { req } = makeApp();
  const leo = await req('/api/members', 'POST', { name: 'Leo', color: '#e57', needsApproval: true });
  assert.deepEqual([leo.status, leo.json.grownUp, leo.json.needsApproval], [201, false, true]);

  // A grown-up's needsApproval: true is ignored (older clients keep working).
  const alex = await req('/api/members', 'POST', { name: 'Alex', color: '#57e', grownUp: true, needsApproval: true });
  assert.deepEqual([alex.status, alex.json.grownUp, alex.json.needsApproval], [201, true, false]);
  const again = await req(`/api/members/${alex.json.id}`, 'PATCH', { needsApproval: true });
  assert.deepEqual([again.status, again.json.grownUp, again.json.needsApproval], [200, true, false]);

  // Turning grownUp on clears it; turning it off again leaves it off until set.
  const up = await req(`/api/members/${leo.json.id}`, 'PATCH', { grownUp: true });
  assert.deepEqual([up.json.grownUp, up.json.needsApproval], [true, false]);
  const down = await req(`/api/members/${leo.json.id}`, 'PATCH', { grownUp: false });
  assert.deepEqual([down.json.grownUp, down.json.needsApproval], [false, false]);
  const kid = await req(`/api/members/${leo.json.id}`, 'PATCH', { needsApproval: true });
  assert.deepEqual([kid.json.grownUp, kid.json.needsApproval], [false, true]);

  const list = (await req('/api/members')).json as any[];
  assert.deepEqual(list.map((m) => [m.name, m.grownUp]), [['Leo', false], ['Alex', true]]);
});

test('chore ticks: a grown-up never waits unless the chore itself asks', async () => {
  const { req } = makeApp();
  const sam = (await req('/api/members', 'POST', { name: 'Sam', color: '#57e', grownUp: true, needsApproval: true })).json;
  const wall = (await req('/api/keys', 'POST', { name: 'wall', scope: 'display' })).json.key as string;
  const chore = async (body: Record<string, unknown>) => (await req('/api/chores', 'POST', { title: 'Dishes', rrule: 'FREQ=DAILY', points: 5, memberId: sam.id, ...body })).json;
  const tick = async (id: string) => (await req(`/api/chores/${id}/complete`, 'POST', { date: today }, wall)).json.pending;

  assert.equal(await tick((await chore({})).id), false); // follows Sam's default: no OK
  assert.equal(await tick((await chore({ needsApproval: true })).id), true); // the chore's own setting wins
  // An "anyone" chore ticked by Sam follows Sam.
  const anyone = await chore({ memberId: null });
  assert.equal((await req(`/api/chores/${anyone.id}/complete`, 'POST', { date: today, memberId: sam.id }, wall)).json.pending, false);
});

test('export/import: grownUp round-trips; old files infer it from an 18+ birthday', async () => {
  const source = makeApp();
  await source.req('/api/members', 'POST', { name: 'Alex', color: '#57e', grownUp: true });
  await source.req('/api/members', 'POST', { name: 'Maya', color: '#e57', needsApproval: true });
  const file = (await source.req('/api/export')).json;
  assert.deepEqual(file.members.map((m: any) => [m.name, m.grownUp, m.needsApproval]), [['Alex', true, false], ['Maya', false, true]]);

  const target = makeApp();
  assert.equal((await target.req('/api/import', 'POST', file)).status, 200);
  assert.deepEqual((await target.req('/api/members')).json.map((m: any) => [m.name, m.grownUp, m.needsApproval]), [['Alex', true, false], ['Maya', false, true]]);

  // A file from before grown-ups: 18+ with a year becomes a grown-up (and loses needsApproval).
  const old = makeApp();
  const member = (id: string, birthday: string | null) => ({ id, name: id, color: '#000', avatar: null, birthday, sort: 0, needsApproval: true });
  const legacy = { ...file, members: [member('Sam', yearsAgo(35)), member('Leo', yearsAgo(9)), member('Maya', '--05-01'), member('Alex', null)] };
  assert.equal((await old.req('/api/import', 'POST', legacy)).status, 200);
  const got = (await old.req('/api/members')).json as any[];
  assert.deepEqual(Object.fromEntries(got.map((m) => [m.name, [m.grownUp, m.needsApproval]])), { Sam: [true, false], Leo: [false, true], Maya: [false, true], Alex: [false, true] });
});
