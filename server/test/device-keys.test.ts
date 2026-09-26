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
