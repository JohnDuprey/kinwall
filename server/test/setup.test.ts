import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// No ADMIN_API_KEY / keys / members here on purpose - a fresh, unclaimed instance.
function makeEnv(overrides: Partial<Env> = {}): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ...overrides };
}

function makeAnon(env: Env) {
  const app = createApp();
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
}

async function getCode(env: Env): Promise<string> {
  // The test can't read the plaintext code back through the API (only its hash is stored), so
  // regenerate through the same exported helper node.ts's boot logic uses.
  const { regenerateSetupCode } = await import('../src/routes/setup.ts');
  return regenerateSetupCode(env.DB, 'http://localhost:8080');
}

test('setup: unclaimed by default, /api/setup needs no auth', async () => {
  const env = makeEnv();
  const anon = makeAnon(env);
  const res = await anon('/api/setup');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.claimed, false);
  assert.deepEqual(body.oauth, { google: false, microsoft: false });
});

test('setup: claim with wrong code -> 401, right code -> admin key that works, second claim -> 409', async () => {
  const env = makeEnv();
  const anon = makeAnon(env);

  const code = await getCode(env);

  const wrong = await anon('/api/setup/claim', {
    method: 'POST',
    body: JSON.stringify({ code: '000000', deviceRole: 'admin', deviceName: 'My phone' }),
  });
  assert.equal(wrong.status, 401);

  const right = await anon('/api/setup/claim', {
    method: 'POST',
    body: JSON.stringify({ code, deviceRole: 'admin', deviceName: 'My phone' }),
  });
  assert.equal(right.status, 200);
  const { adminKey, displayKey } = await right.json() as any;
  assert.match(adminKey, /^kw_/);
  assert.equal(displayKey, undefined);

  // the new admin key actually works
  const app = createApp();
  const meRes = await app.request('/api/me', { headers: { Authorization: `Bearer ${adminKey}` } }, env);
  assert.equal(meRes.status, 200);
  assert.equal((await meRes.json() as any).scope, 'admin');

  // instance now shows claimed
  const status = await (await anon('/api/setup')).json() as any;
  assert.equal(status.claimed, true);

  // second claim attempt -> 409, even with a fresh code request
  const again = await anon('/api/setup/claim', {
    method: 'POST',
    body: JSON.stringify({ code, deviceRole: 'admin', deviceName: 'Another' }),
  });
  assert.equal(again.status, 409);
});

test('setup: display role also gets a display key, admin key still issued', async () => {
  const env = makeEnv();
  const anon = makeAnon(env);
  const code = await getCode(env);
  const res = await anon('/api/setup/claim', {
    method: 'POST',
    body: JSON.stringify({ code, deviceRole: 'display', deviceName: 'Kitchen iPad' }),
  });
  assert.equal(res.status, 200);
  const { adminKey, displayKey } = await res.json() as any;
  assert.match(adminKey, /^kw_/);
  assert.match(displayKey, /^kw_/);
});

test('setup: lockout after 10 bad attempts -> 429', async () => {
  const env = makeEnv();
  const anon = makeAnon(env);
  await getCode(env);
  let last!: Response;
  for (let i = 0; i < 10; i++) {
    last = await anon('/api/setup/claim', {
      method: 'POST',
      body: JSON.stringify({ code: '000000', deviceRole: 'admin', deviceName: 'x' }),
    });
    assert.equal(last.status, 401);
  }
  const locked = await anon('/api/setup/claim', {
    method: 'POST',
    body: JSON.stringify({ code: '000000', deviceRole: 'admin', deviceName: 'x' }),
  });
  assert.equal(locked.status, 429);
});

test('setup: ADMIN_API_KEY works as the claim code', async () => {
  const env = makeEnv({ ADMIN_API_KEY: 'fc_admin_secret' });
  const anon = makeAnon(env);
  // still unclaimed for UI purposes even with ADMIN_API_KEY set
  assert.equal((await (await anon('/api/setup')).json() as any).claimed, false);

  const res = await anon('/api/setup/claim', {
    method: 'POST',
    body: JSON.stringify({ code: 'fc_admin_secret', deviceRole: 'admin', deviceName: 'x' }),
  });
  assert.equal(res.status, 200);
});

test('setup: existing members/keys count as claimed (dev DB migrated in place)', async () => {
  const env = makeEnv();
  await env.DB.prepare('INSERT INTO members (id, name, color, avatar, sort, created_at) VALUES (?,?,?,?,?,?)')
    .bind('m1', 'Existing', '#fff', null, 0, new Date().toISOString())
    .run();
  const anon = makeAnon(env);
  assert.equal((await (await anon('/api/setup')).json() as any).claimed, true);
});
