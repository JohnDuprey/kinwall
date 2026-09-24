import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';
import { __resetVerifiers, __setVerifiers } from '../src/webauthn.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(publicUrl = 'http://localhost:8080'): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: publicUrl, ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env, defaultKey: string | null = ADMIN_KEY) {
  const app = createApp();
  return (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (defaultKey && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${defaultKey}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(path, { ...init, headers }, env);
  };
}

function b64url(obj: unknown): string {
  const json = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64url');
}

function fakeAttestationResponse(challenge: string, origin: string, credentialId = 'cred-1') {
  return {
    id: credentialId,
    rawId: credentialId,
    type: 'public-key',
    response: { clientDataJSON: b64url({ type: 'webauthn.create', challenge, origin }) },
    clientExtensionResults: {},
  };
}

test('register-token: single use and expiry', async () => {
  const env = makeEnv();
  const admin = makeApp(env);

  __setVerifiers({
    registration: async () =>
      ({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: [] },
        },
      }) as any,
  });
  try {
    const { token } = await (await admin('/api/passkeys/register-token', { method: 'POST' })).json() as any;

    // Using it once succeeds end to end.
    const optionsRes = await admin('/api/passkeys/register/options', { method: 'POST', body: JSON.stringify({ token }) });
    assert.equal(optionsRes.status, 200);
    const options = await optionsRes.json() as any;

    const verifyRes = await admin('/api/passkeys/register/verify', {
      method: 'POST',
      body: JSON.stringify({ token, name: 'Phone', response: fakeAttestationResponse(options.challenge, 'http://localhost:8080') }),
    });
    assert.equal(verifyRes.status, 200);
    const verifyBody = await verifyRes.json() as any;
    assert.ok(verifyBody.session?.key, 'token-based registration should return a session key');

    // Reusing the same (now-consumed) token is rejected.
    const secondOptions = await admin('/api/passkeys/register/options', { method: 'POST', body: JSON.stringify({ token }) });
    assert.equal(secondOptions.status, 400);

    // A token whose expiry has already passed is rejected too.
    const expiredToken = 'expired-token-xyz';
    await env.DB.prepare('INSERT INTO webauthn_challenges (id, kind, subject, data, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), 'reg_token', expiredToken, null, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() - 1000).toISOString())
      .run();
    const expiredRes = await admin('/api/passkeys/register/options', { method: 'POST', body: JSON.stringify({ token: expiredToken }) });
    assert.equal(expiredRes.status, 400);
  } finally {
    __resetVerifiers();
  }
});

test('session keys: expired sessions are rejected by auth, and logout deletes the session', async () => {
  const env = makeEnv();

  const past = new Date(Date.now() - 1000).toISOString();
  const expired = await createApiKey(env.DB, 'Passkey: Old phone', 'admin', { kind: 'session', expiresAt: past });
  const expiredReq = makeApp(env, expired.key);
  const res = await expiredReq('/api/settings');
  assert.equal(res.status, 401);

  const future = new Date(Date.now() + 60_000).toISOString();
  const active = await createApiKey(env.DB, 'Passkey: New phone', 'admin', { kind: 'session', expiresAt: future });
  const activeReq = makeApp(env, active.key);
  assert.equal((await activeReq('/api/settings')).status, 200);

  const logoutRes = await activeReq('/api/sessions/logout', { method: 'POST' });
  assert.equal(logoutRes.status, 200);
  assert.equal((await activeReq('/api/settings')).status, 401, 'the session key must be rejected once logged out');

  const row = await env.DB.prepare('SELECT 1 FROM api_keys WHERE id = ?').bind(active.id).first();
  assert.equal(row, null, 'logout should delete the api_keys row, not just expire it');
});

test('session keys never show up under GET /api/keys (kind filter)', async () => {
  const env = makeEnv();
  const admin = makeApp(env);
  await createApiKey(env.DB, 'Passkey: Phone', 'admin', { kind: 'session', expiresAt: new Date(Date.now() + 60_000).toISOString() });
  await createApiKey(env.DB, 'HA integration', 'admin');
  const keys = await (await admin('/api/keys')).json() as any[];
  assert.equal(keys.length, 1);
  assert.equal(keys[0].name, 'HA integration');
});

test('passkey login: unknown credential is rejected without ever creating a session', async () => {
  const env = makeEnv();
  const anon = makeApp(env, null);

  const optionsRes = await anon('/api/passkeys/login/options', { method: 'POST' });
  assert.equal(optionsRes.status, 200);
  const options = await optionsRes.json() as any;

  const verifyRes = await anon('/api/passkeys/login/verify', {
    method: 'POST',
    body: JSON.stringify({ response: fakeAttestationResponse(options.challenge, 'http://localhost:8080', 'no-such-credential') }),
  });
  assert.equal(verifyRes.status, 401);
});

test('rpID resolution refuses an IP-addressed PUBLIC_URL with a clear 400', async () => {
  const env = makeEnv('http://127.0.0.1:8080');
  const anon = makeApp(env, null);
  const res = await anon('/api/passkeys/login/options', { method: 'POST' });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.match(body.error, /IP/);
});

test('GET /api/setup reports whether any passkey has been registered', async () => {
  const env = makeEnv();
  const anon = makeApp(env, null);

  const before = await (await anon('/api/setup')).json() as any;
  assert.equal(before.passkeys, false);

  await env.DB.prepare('INSERT INTO passkeys (id, credential_id, public_key, counter, transports, name, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), 'cred-x', 'AAAA', 0, '[]', 'Test passkey', new Date().toISOString())
    .run();

  const after = await (await anon('/api/setup')).json() as any;
  assert.equal(after.passkeys, true);
});
