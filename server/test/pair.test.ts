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

test('pairing: 429 after 5 pending from one address; other addresses unaffected', async () => {
  const anon = makeAnon(makeEnv());
  const start = (ip: string) => anon('/api/pair', { method: 'POST', headers: { 'cf-connecting-ip': ip } });
  for (let i = 0; i < 5; i++) assert.equal((await start('203.0.113.7')).status, 201);
  const res = await start('203.0.113.7');
  assert.equal(res.status, 429);
  assert.ok(((await res.json()) as any).error);
  assert.equal((await start('198.51.100.2')).status, 201);
});

// Pair a display through the real flow and return its key.
async function pairDisplay(env: Env, owner?: string) {
  const admin = makeApp(env);
  const anon = makeAnon(env);
  const start = await (await anon('/api/pair', { method: 'POST' })).json() as any;
  const res = await admin('/api/pair/approve', { method: 'POST', body: JSON.stringify({ code: start.code, name: 'Maya room', ...(owner ? { owner } : {}) }) });
  assert.equal(res.status, 200);
  const approved = await res.json() as any;
  const polled = await (await anon('/api/pair/poll', { method: 'POST', body: JSON.stringify({ pairingId: start.pairingId, pollToken: start.pollToken }) })).json() as any;
  return { keyId: approved.keyId as string, key: polled.key as string };
}

test('device owner: set at approval, visible to the device, locked for the device, admin can change it', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  const maya = await (await admin('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Maya', color: '#7C9CFF' }) })).json() as any;
  const leo = await (await admin('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Leo', color: '#FF9E7A' }) })).json() as any;

  // unknown member is rejected before anything is approved
  const anon = makeAnon(env);
  const start = await (await anon('/api/pair', { method: 'POST' })).json() as any;
  const bad = await admin('/api/pair/approve', { method: 'POST', body: JSON.stringify({ code: start.code, name: 'X', owner: 'nobody' }) });
  assert.equal(bad.status, 400);

  const { keyId, key } = await pairDisplay(env, maya.id);
  const device = makeApp(env, key);
  assert.equal(((await (await device('/api/me')).json()) as any).owner, maya.id);
  const listed = ((await (await admin('/api/keys')).json()) as any[]).find((k) => k.id === keyId);
  assert.equal(listed.owner, maya.id);

  // the device can't re-assign itself (or anyone)
  const selfPatch = await device(`/api/keys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ owner: 'shared' }) });
  assert.equal(selfPatch.status, 403);
  assert.equal(((await (await device('/api/me')).json()) as any).owner, maya.id);

  // widgets minted by the device belong to the same person
  const widget = await (await device('/api/device-keys', { method: 'POST', body: JSON.stringify({ name: 'Widgets' }) })).json() as any;
  assert.equal(((await (await makeApp(env, widget.key)('/api/me')).json()) as any).owner, maya.id);

  // admin can change it; unknown members and non-device keys are refused
  assert.equal((await admin(`/api/keys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ owner: 'nope' }) })).status, 400);
  const changed = await admin(`/api/keys/${keyId}`, { method: 'PATCH', body: JSON.stringify({ owner: leo.id }) });
  assert.equal(changed.status, 200);
  assert.equal(((await changed.json()) as any).owner, leo.id);
  assert.equal(((await (await device('/api/me')).json()) as any).owner, leo.id);
  const adminKey = await (await admin('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Automation', scope: 'admin' }) })).json() as any;
  assert.equal((await admin(`/api/keys/${adminKey.id}`, { method: 'PATCH', body: JSON.stringify({ owner: 'shared' }) })).status, 404);

  // deleting the owner leaves the device shared (still locked)
  await admin(`/api/members/${leo.id}`, { method: 'DELETE' });
  assert.equal(((await (await device('/api/me')).json()) as any).owner, 'shared');

  // omitted owner = shared
  const shared = await pairDisplay(env);
  assert.equal(((await (await makeApp(env, shared.key)('/api/me')).json()) as any).owner, 'shared');
});
