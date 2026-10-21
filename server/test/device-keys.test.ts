import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = 'dk_test_admin';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(__dirname, '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  return (p: string, init: RequestInit = {}, key = ADMIN) => {
    const headers = new Headers(init.headers);
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (init.body) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
}

test('device keys: an app mints an everyday key for its widgets, which can only revoke itself', async () => {
  const req = setup();
  // A paired display (everyday access) can mint one; it's display scope and works on everyday routes.
  const display = (await (await req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Kitchen iPad', scope: 'display' }) })).json()) as any;
  const res = await req('/api/device-keys', { method: 'POST', body: JSON.stringify({ name: 'Widgets on iPhone' }) }, display.key);
  assert.equal(res.status, 201);
  const widget = (await res.json()) as any;
  assert.equal(widget.scope, 'display');
  assert.equal((await req('/api/settings', {}, widget.key)).status, 200);
  assert.equal((await req('/api/keys', {}, widget.key)).status, 403, 'still everyday access only');
  assert.ok(((await (await req('/api/keys')).json()) as any[]).some((k) => k.id === widget.id), 'listed for the admin to revoke');

  // Revoking itself works, and only itself.
  assert.equal((await req('/api/device-keys/self', { method: 'DELETE' }, widget.key)).status, 200);
  assert.equal((await req('/api/settings', {}, widget.key)).status, 401);
  assert.equal((await req('/api/settings', {}, display.key)).status, 200, 'the key that minted it is untouched');
  assert.equal((await req('/api/device-keys/self', { method: 'DELETE' })).status, 400, 'the admin env key is not revocable here');
});

test('device keys: widget and Watch keys are marked, linked to the key that made them, and go when it goes', async () => {
  const req = setup();
  const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<any>;
  const phone = await json(req('/api/keys', { method: 'POST', body: JSON.stringify({ name: "Alex's phone", scope: 'admin' }) }));
  const widgets = await json(req('/api/device-keys', { method: 'POST', body: JSON.stringify({ name: 'Widgets on iPhone' }) }, phone.key));
  const watch = await json(req('/api/device-keys', { method: 'POST', body: JSON.stringify({ name: 'Apple Watch' }) }, widgets.key)); // the app makes it with the widgets' key
  const wall = await json(req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Kitchen', scope: 'display' }) }));
  const listed = new Map(((await json(req('/api/keys'))) as any[]).map((k) => [k.id, k]));
  assert.deepEqual([listed.get(widgets.id).kind, listed.get(widgets.id).parentKeyId, listed.get(widgets.id).owner], ['widgets', phone.id, 'shared']);
  assert.deepEqual([listed.get(watch.id).kind, listed.get(watch.id).parentKeyId], ['widgets', widgets.id]);
  assert.deepEqual([listed.get(wall.id).kind, listed.get(wall.id).parentKeyId, listed.get(wall.id).parentGrantId], [null, null, null]);
  // Not a screen: left out of the night screen's displays, and not re-kindable as one.
  const night = await json(req('/api/displays/night-screen'));
  assert.deepEqual(night.displays.map((d: any) => d.id), [wall.id]);
  const patched = await req(`/api/keys/${widgets.id}`, { method: 'PATCH', body: JSON.stringify({ kind: 'wall' }) });
  assert.equal(patched.status, 400);
  assert.equal(((await json(req('/api/keys'))) as any[]).find((k) => k.id === widgets.id).kind, 'widgets');

  // Revoking the phone signs out its widgets and Watch too; the wall is untouched.
  assert.equal((await req(`/api/keys/${phone.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await req('/api/settings', {}, widgets.key)).status, 401);
  assert.equal((await req('/api/settings', {}, watch.key)).status, 401);
  assert.equal((await req('/api/settings', {}, wall.key)).status, 200);
  assert.deepEqual(((await json(req('/api/keys'))) as any[]).map((k) => k.id), [wall.id]);
});

test('migration 0067: keys the app made for widgets and the Watch are marked by their names; nothing else', async () => {
  const { runMigrations } = await import('../src/migrate.ts');
  const { readdirSync, readFileSync } = await import('node:fs');
  const dir = path.join(__dirname, '..', 'migrations');
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));
  const db = openDb(':memory:') as unknown as D1Database;
  await runMigrations(db, all.filter((m) => m.name < '0067'));
  const key = (id: string, name: string, scope: string, kind = 'api', deviceKind: string | null = 'wall') =>
    db.prepare("INSERT INTO api_keys (id, name, hash, prefix, scope, created_at, kind, owner, device_kind) VALUES (?, ?, ?, 'kw_x', ?, '2026-01-01', ?, 'shared', ?)").bind(id, name, `h-${id}`, scope, kind, deviceKind).run();
  await key('iphone', 'Widgets on iPhone', 'display');
  await key('ipad', 'Widgets on iPad', 'display', 'api', null);
  await key('android', 'Widgets on Android', 'display');
  await key('watch', 'Apple Watch', 'display');
  await key('kitchen', 'Kitchen iPad', 'display');
  await key('renamed', 'Widgets on iPhone (old)', 'display');
  await key('admin', 'Widgets on iPhone', 'admin', 'api', null);
  await runMigrations(db, all);
  const kinds = Object.fromEntries((await db.prepare('SELECT id, device_kind FROM api_keys').all<{ id: string; device_kind: string | null }>()).results.map((r) => [r.id, r.device_kind]));
  assert.deepEqual(kinds, { iphone: 'widgets', ipad: 'widgets', android: 'widgets', watch: 'widgets', kitchen: 'wall', renamed: 'wall', admin: null });
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('api_keys')").all<{ name: string }>()).results.map((r) => r.name);
  assert.ok(cols.includes('parent_key_id') && cols.includes('parent_grant_id'));
});

test('Watch keys inherit only the signed-in person; shared widgets never gain personal access', async () => {
  const req = setup();
  const json = async (r: Response | Promise<Response>) => (await r).json() as Promise<any>;
  const member = async (name: string, grownUp = true) => json(req('/api/members', { method: 'POST', body: JSON.stringify({ name, color: '#7AB8FF', grownUp, tempCheck: { on: true, sleep: true } }) }));
  const alex = await member('Alex'), sam = await member('Sam'), maya = await member('Maya', false);
  const phone = await json(req('/api/keys', { method: 'POST', body: JSON.stringify({ name: "Alex's phone", scope: 'admin', owner: alex.id }) }));
  assert.equal((await req('/api/me/owner', { method: 'PUT', body: JSON.stringify({ owner: alex.id }) }, phone.key)).status, 200);
  const mint = (key: string, purpose?: string) => json(req('/api/device-keys', { method: 'POST', body: JSON.stringify({ name: 'Apple Watch', purpose, owner: sam.id }) }, key));
  const widgets = await mint(phone.key);
  const watch = await mint(phone.key, 'watch');
  assert.equal((await json(req('/api/me', {}, widgets.key))).owner, 'shared');
  assert.equal((await json(req('/api/me', {}, watch.key))).owner, alex.id, 'server chooses the phone owner, ignoring a supplied member');
  const url = (id: string) => `/api/members/${id}/temp-check`;
  assert.equal((await req(url(alex.id), { method: 'PUT', body: JSON.stringify({ sleep: 'good' }) }, watch.key)).status, 200);
  assert.equal((await req(url(sam.id), { method: 'PUT', body: JSON.stringify({ sleep: 'good' }) }, watch.key)).status, 403);
  assert.equal((await req('/api/keys', {}, watch.key)).status, 403, 'Watch never gets parent privileges');
  assert.equal((await json(req(url(alex.id), {}, watch.key))).sleep, 'good');
  assert.equal((await json(req(url(alex.id), {}, widgets.key))).sleep, null, 'shared widgets do not gain private answers');
  const forged = await mint(widgets.key, 'watch');
  assert.equal((await json(req('/api/me', {}, forged.key))).owner, 'shared', 'a shared widgets key cannot claim its parent\'s private identity');
  const nested = await mint(watch.key);
  assert.equal((await req('/api/me/owner', { method: 'PUT', body: JSON.stringify({ owner: sam.id }) }, phone.key)).status, 200);
  assert.equal((await req('/api/me', {}, watch.key)).status, 401, 'changing the phone owner invalidates its previous personal Watch key');
  assert.equal((await req('/api/me', {}, nested.key)).status, 401, 'nested keys cannot retain the previous owner either');
  assert.equal((await req('/api/me', {}, widgets.key)).status, 200, 'shared widgets remain shared');
  const nextWatch = await mint(phone.key, 'watch');
  assert.equal((await json(req('/api/me', {}, nextWatch.key))).owner, sam.id);
  const kid = await json(req('/api/keys', { method: 'POST', body: JSON.stringify({ name: "Maya's phone", scope: 'display', owner: maya.id }) }));
  assert.equal((await req(`/api/keys/${kid.id}`, { method: 'PATCH', body: JSON.stringify({ owner: maya.id }) })).status, 200);
  const kidWatch = await mint(kid.key, 'watch');
  assert.equal((await json(req('/api/me', {}, kidWatch.key))).owner, maya.id);
  assert.equal((await req(url(maya.id), { method: 'PUT', body: JSON.stringify({ sleep: 'good' }) }, kidWatch.key)).status, 200);
  const hidden = await json(req(url(alex.id), {}, kidWatch.key));
  assert.equal(hidden.private, true);
  assert.equal(hidden.sleep, null, 'another person cannot read Alex’s sleep answer');
  assert.equal((await req(`/api/keys/${phone.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await req('/api/me', {}, nextWatch.key)).status, 401, 'revoking the phone revokes the Watch');
});
