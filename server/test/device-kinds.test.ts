// Device kinds (routes/pair.ts, routes/keys.ts, auth.ts deviceKindOwner): what a paired device is (a
// wall screen or a kid's device), kept on its key and always matching its owner. A paired device is
// never a grown-up's: whoever approves a code mustn't get a key that opens a grown-up's private journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_KEY = 'fc_test_admin_key';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(__dirname, '..', 'migrations'));
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const req = async (p: string, method = 'GET', body?: unknown, key: string | null = ADMIN_KEY) => {
    const headers = new Headers();
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const res = await app.request(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const member = async (name: string, grownUp: boolean) => (await req('/api/members', 'POST', { name, color: '#336699', grownUp })).json.id as string;
  /** Starts a pairing, approves it with `body` and returns the approve result and the poll. */
  const pair = async (body: Record<string, unknown>) => {
    const start = (await req('/api/pair', 'POST', undefined, null)).json;
    const approve = await req('/api/pair/approve', 'POST', { code: start.code, name: 'Tablet', ...body });
    const poll = await req('/api/pair/poll', 'POST', { pairingId: start.pairingId, pollToken: start.pollToken }, null);
    return { approve, poll };
  };
  return { req, member, pair };
}

test('pairing: the kind is checked against the owner, kept on the key and returned by the poll', async () => {
  const { req, member, pair } = setup();
  const alex = await member('Alex', true);
  const leo = await member('Leo', false);

  // Mismatches are refused before anything is approved.
  assert.equal((await pair({ kind: 'kid', owner: alex })).approve.status, 400, "a kid's device can't be a grown-up's");
  assert.equal((await pair({ kind: 'grownup', owner: alex })).approve.status, 400, "pairing never makes a grown-up's device");
  const noParent = (await pair({ owner: alex })).approve;
  assert.equal(noParent.status, 400, 'not even through an owner alone');
  assert.match(noParent.json.error, /passkey/);
  assert.equal((await pair({ kind: 'wall', owner: leo })).approve.status, 400, 'a wall screen is the whole family');
  assert.equal((await pair({ kind: 'kid' })).approve.status, 400, "a kid's device needs its kid");
  assert.equal((await pair({ kind: 'grownup', owner: 'shared' })).approve.status, 400);

  const wall = await pair({ kind: 'wall' });
  assert.equal(wall.approve.status, 200);
  assert.equal(wall.poll.json.kind, 'wall');
  assert.equal((await req('/api/me', 'GET', undefined, wall.poll.json.key)).json.owner, 'shared');
  assert.equal((await req('/api/me', 'GET', undefined, wall.poll.json.key)).json.deviceKind, 'wall');

  const kid = await pair({ kind: 'kid', owner: leo });
  assert.equal(kid.poll.json.kind, 'kid');

  const keys = (await req('/api/keys')).json as any[];
  assert.deepEqual(keys.map((k) => k.kind).sort(), ['kid', 'wall']);
});

test('pairing: older clients that send only an owner still work; the kind follows the owner', async () => {
  const { member, pair } = setup();
  const alex = await member('Alex', true);
  const leo = await member('Leo', false);
  assert.equal((await pair({})).poll.json.kind, 'wall');
  assert.equal((await pair({ owner: 'shared' })).poll.json.kind, 'wall');
  assert.equal((await pair({ owner: leo })).poll.json.kind, 'kid');
  assert.equal((await pair({ owner: alex })).approve.status, 400, "a grown-up's owner is refused as before kinds too");
  assert.equal((await pair({ owner: 'nobody' })).approve.status, 400);
});

test("pairing: the family's log says what kind of device it is", async () => {
  const { req, member, pair } = setup();
  const leo = await member('Leo', false);
  await pair({ kind: 'kid', owner: leo });
  const line = ((await req('/api/notifications')).json as any[]).find((n) => n.kind === 'privacy');
  assert.match(line.title, /Tablet now belongs to Leo/);
  assert.match(line.body, /kid's device/);
});

test('PATCH /api/keys: an admin changes the kind, with the same rules', async () => {
  const { req, member, pair } = setup();
  const alex = await member('Alex', true);
  const leo = await member('Leo', false);
  const id = (await pair({ kind: 'wall' })).approve.json.keyId;

  assert.equal((await req(`/api/keys/${id}`, 'PATCH', { kind: 'kid', owner: alex })).status, 400);
  assert.equal((await req(`/api/keys/${id}`, 'PATCH', { kind: 'kid' })).status, 400, 'needs the kid');
  assert.equal((await req(`/api/keys/${id}`, 'PATCH', {})).status, 400, 'nothing to change');
  const kid = await req(`/api/keys/${id}`, 'PATCH', { kind: 'kid', owner: leo });
  assert.equal(kid.status, 200);
  assert.deepEqual([kid.json.kind, kid.json.owner], ['kid', leo]);
  const back = await req(`/api/keys/${id}`, 'PATCH', { kind: 'wall' });
  assert.deepEqual([back.json.kind, back.json.owner], ['wall', 'shared']);
  // owner only (older clients): the kind follows it; a grown-up is refused either way
  assert.equal((await req(`/api/keys/${id}`, 'PATCH', { owner: leo })).json.kind, 'kid');
  assert.equal((await req(`/api/keys/${id}`, 'PATCH', { owner: alex })).status, 400);
  assert.equal((await req(`/api/keys/${id}`, 'PATCH', { kind: 'grownup', owner: alex })).status, 400);

  // A full-access key is a parent's: only ever a grown-up's device.
  const admin = (await req('/api/keys', 'POST', { name: 'Automation', scope: 'admin' })).json.id;
  assert.equal((await req(`/api/keys/${admin}`, 'PATCH', { kind: 'kid', owner: leo })).status, 400);
  assert.equal((await req(`/api/keys/${admin}`, 'PATCH', { kind: 'wall' })).status, 400);
  assert.equal((await req(`/api/keys/${admin}`, 'PATCH', { kind: 'grownup', owner: alex })).json.kind, 'grownup');
  const shared = await req(`/api/keys/${admin}`, 'PATCH', { owner: 'shared' });
  assert.deepEqual([shared.json.kind, shared.json.owner], [null, 'shared'], "a shared full-access key isn't a wall screen");
});

test('setup: a wall display set up through the wizard is a wall, and the wizard can make it a kid\'s', async () => {
  const fresh = openDb(':memory:');
  applyMigrations(fresh, path.join(__dirname, '..', 'migrations'));
  const env: Env = { DB: fresh as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const call = async (p: string, method: string, body: unknown, key?: string) => {
    const res = await app.request(p, { method, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return (await res.json()) as any;
  };
  const claimed = await call('/api/setup/claim', 'POST', { code: ADMIN_KEY, deviceRole: 'display', deviceName: 'Wall display' });
  assert.ok(claimed.displayKeyId);
  assert.equal((await call('/api/me', 'GET', undefined, claimed.displayKey)).deviceKind, 'wall');
  const leo = (await call('/api/members', 'POST', { name: 'Leo', color: '#336699' }, claimed.adminKey)).id;
  const patched = await call(`/api/keys/${claimed.displayKeyId}`, 'PATCH', { kind: 'kid', owner: leo }, claimed.adminKey);
  assert.deepEqual([patched.kind, patched.owner], ['kid', leo]);
});

test('migrations 0065-0066: devices paired before kinds follow their owner', async () => {
  const { runMigrations } = await import('../src/migrate.ts');
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = path.join(__dirname, '..', 'migrations');
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));
  const db = openDb(':memory:') as unknown as D1Database;
  await runMigrations(db, all.filter((m) => m.name < '0065'));
  assert.ok(all.some((m) => m.name.startsWith('0066')));
  await db.prepare("INSERT INTO members (id, name, color, sort, created_at, grown_up) VALUES ('alex', 'Alex', '#336699', 0, '2026-01-01', 1), ('leo', 'Leo', '#336699', 1, '2026-01-01', 0)").run();
  const key = (id: string, scope: string, owner: string | null, kind = 'api') =>
    db.prepare("INSERT INTO api_keys (id, name, hash, prefix, scope, created_at, kind, owner) VALUES (?, ?, ?, 'kw_x', ?, '2026-01-01', ?, ?)").bind(id, id, `h-${id}`, scope, kind, owner).run();
  await key('wall', 'display', 'shared');
  await key('kid', 'display', 'leo');
  await key('grown', 'display', 'alex'); // paired as a grown-up's before 0066: left unset, for a parent to fix
  await key('legacy', 'display', null);
  await key('phone', 'admin', 'alex');
  await key('automation', 'admin', 'shared');
  await key('session', 'admin', 'alex', 'session');
  await runMigrations(db, all);
  const kinds = Object.fromEntries((await db.prepare('SELECT id, device_kind FROM api_keys').all<{ id: string; device_kind: string | null }>()).results.map((r) => [r.id, r.device_kind]));
  assert.deepEqual(kinds, { wall: 'wall', kid: 'kid', grown: null, legacy: null, phone: 'grownup', automation: null, session: null });
  assert.equal((await db.prepare("SELECT owner FROM api_keys WHERE id = 'grown'").first<{ owner: string }>())?.owner, 'alex', 'never silently changed');
});
