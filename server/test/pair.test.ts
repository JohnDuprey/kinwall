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
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env, defaultKey = ADMIN_KEY) {
  const app = createApp();
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization') && !path.includes('key=')) headers.set('Authorization', `Bearer ${defaultKey}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
}

// No-auth caller: routes/pair.ts's start + poll must work with zero Authorization header.
function makeAnon(env: Env) {
  const app = createApp();
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
}

test('pairing: start -> poll pending -> approve -> poll returns key once -> poll again 404', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const anon = makeAnon(env);

  const start = await (await anon('/api/pair', { method: 'POST' })).json() as any;
  assert.match(start.code, /^\d{6}$/);
  assert.ok(start.pairingId);
  assert.ok(start.pollToken);
  assert.ok(start.expiresAt);

  const pending = await (await anon('/api/pair/poll', {
    method: 'POST',
    body: JSON.stringify({ pairingId: start.pairingId, pollToken: start.pollToken }),
  })).json() as any;
  assert.equal(pending.status, 'pending');

  const approveRes = await admin('/api/pair/approve', { method: 'POST', body: JSON.stringify({ code: start.code, name: 'Kitchen iPad' }) });
  assert.equal(approveRes.status, 200);
  const approved = await approveRes.json() as any;
  assert.ok(approved.keyId);
  assert.equal(approved.name, 'Kitchen iPad');

  // encrypted, not plaintext, while the row still exists
  const stored = await env.DB.prepare('SELECT encrypted_key FROM pairings WHERE id = ?').bind(start.pairingId).first<{ encrypted_key: string }>();
  assert.ok(stored?.encrypted_key.startsWith('v1:'));

  const pollRes = await anon('/api/pair/poll', {
    method: 'POST',
    body: JSON.stringify({ pairingId: start.pairingId, pollToken: start.pollToken }),
  });
  assert.equal(pollRes.status, 200);
  const polled = await pollRes.json() as any;
  assert.equal(polled.status, 'approved');
  assert.match(polled.key, /^kw_/);

  // returned key works, and is display-scope
  const displayApp = makeApp(env, polled.key);
  const meRes = await displayApp('/api/me');
  assert.equal(meRes.status, 200);
  const me = await meRes.json() as any;
  assert.equal(me.scope, 'display');

  // key never stored in plaintext on the pairing row
  const raw = await env.DB.prepare('SELECT encrypted_key FROM pairings WHERE key_id = ?').bind(approved.keyId).first<any>();
  assert.equal(raw, null); // row is gone by now (deleted on the poll that returned the key)

  // poll again -> 404 (row deleted)
  const again = await anon('/api/pair/poll', {
    method: 'POST',
    body: JSON.stringify({ pairingId: start.pairingId, pollToken: start.pollToken }),
  });
  assert.equal(again.status, 404);
});

test('pairing: display key cannot approve (403)', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const anon = makeAnon(env);

  const createdKey = await (await admin('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) })).json() as any;
  const display = makeApp(env, createdKey.key);

  const start = await (await anon('/api/pair', { method: 'POST' })).json() as any;
  const res = await display('/api/pair/approve', { method: 'POST', body: JSON.stringify({ code: start.code, name: 'x' }) });
  assert.equal(res.status, 403);
});

test('pairing: wrong pollToken -> 404', async () => {
  const env = makeEnv();
  const anon = makeAnon(env);
  const start = await (await anon('/api/pair', { method: 'POST' })).json() as any;
  const res = await anon('/api/pair/poll', {
    method: 'POST',
    body: JSON.stringify({ pairingId: start.pairingId, pollToken: 'wrong-token-wrong-token-wrong-token' }),
  });
  assert.equal(res.status, 404);
});

test('pairing: expired pairing -> 404 on poll and approve', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const anon = makeAnon(env);

  const start = await (await anon('/api/pair', { method: 'POST' })).json() as any;
  env.DB.prepare("UPDATE pairings SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(start.pairingId).run();

  const pollRes = await anon('/api/pair/poll', {
    method: 'POST',
    body: JSON.stringify({ pairingId: start.pairingId, pollToken: start.pollToken }),
  });
  assert.equal(pollRes.status, 404);

  const approveRes = await admin('/api/pair/approve', { method: 'POST', body: JSON.stringify({ code: start.code, name: 'x' }) });
  assert.equal(approveRes.status, 404);
});

test('pairing: 429 after 20 pending', async () => {
  const env = makeEnv();
  const anon = makeAnon(env);
  for (let i = 0; i < 20; i++) {
    const res = await anon('/api/pair', { method: 'POST' });
    assert.equal(res.status, 201);
  }
  const res = await anon('/api/pair', { method: 'POST' });
  assert.equal(res.status, 429);
});
