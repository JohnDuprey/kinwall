import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';
import { __resetVerifiers, __setVerifiers, isSupervisorPeer, resolveRpId } from '../src/webauthn.ts';
import { finishPasskeyLogin } from '../src/entry.ts';

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

test('passkey login: 20 attempts per 10 minutes per address, then 429', async () => {
  const env = makeEnv();
  const anon = makeApp(env, null);
  const from = (ip: string, path = '/api/passkeys/login/options') => anon(path, { method: 'POST', headers: { 'cf-connecting-ip': ip } });
  for (let i = 0; i < 20; i++) assert.equal((await from('203.0.113.7')).status, 200);
  assert.equal((await from('203.0.113.7')).status, 429);
  const verify = await anon('/api/passkeys/login/verify', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.7' }, body: JSON.stringify({ response: {} }) });
  assert.equal(verify.status, 429);
  assert.equal((await from('198.51.100.1')).status, 200); // other addresses unaffected
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
  assert.equal(before.hasPasskey, false);
  assert.equal(before.passkeyRequired, false); // self-hosted default

  await env.DB.prepare('INSERT INTO passkeys (id, credential_id, public_key, counter, transports, name, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), 'cred-x', 'AAAA', 0, '[]', 'Test passkey', new Date().toISOString())
    .run();

  const after = await (await anon('/api/setup')).json() as any;
  assert.equal(after.passkeys, true);
  assert.equal(after.hasPasskey, true);
});

test('REQUIRE_PASSKEY_SETUP=1 -> /api/setup reports passkeyRequired', async () => {
  const env = { ...makeEnv(), REQUIRE_PASSKEY_SETUP: '1' };
  const s = await (await makeApp(env, null)('/api/setup')).json() as any;
  assert.equal(s.passkeyRequired, true);
  assert.equal(s.hasPasskey, false);
});

test('behind a TLS-terminating proxy (no PUBLIC_URL, http request) the https origin of the same host is accepted', async () => {
  const env = makeEnv('');
  assert.deepEqual((await resolveRpId(env, new Request('http://ha.example.com:8443/api/passkeys/register'))).expectedOrigins,
    ['http://ha.example.com:8443', 'https://ha.example.com:8443']);
  assert.deepEqual((await resolveRpId(makeEnv('http://kinwall.example.com'), new Request('http://x.test/'))).expectedOrigins,
    ['http://kinwall.example.com'], 'an explicit PUBLIC_URL is taken as is');
});

// What reaches the app through Home Assistant ingress: HA core and the Supervisor pass the
// browser's headers on (Host included) and add X-Ingress-Path, X-Hass-Source and X-Forwarded-*
// (home-assistant/core hassio/ingress.py, supervisor api/ingress.py). Here a proxy in front of
// Home Assistant has swapped Host for its upstream name, as nginx does by default ($proxy_host).
const ingressHeaders = (origin: string) => ({
  Origin: origin,
  'X-Ingress-Path': '/api/hassio_ingress/abc123',
  'X-Hass-Source': 'core.ingress',
  'X-Forwarded-Host': 'homeassistant:8123',
  'X-Forwarded-Proto': 'http',
  'X-Forwarded-For': '203.0.113.9, 172.30.32.1',
});

test('Home Assistant ingress: passkeys follow the page the browser is on, whatever Host says', async () => {
  const env: Env = { ...makeEnv(''), HA_INGRESS: () => true };
  const app = createApp();
  const call = (path: string, origin: string, body: unknown = {}) =>
    app.request(`http://homeassistant:8123${path}`, { method: 'POST', body: JSON.stringify(body), headers: { ...ingressHeaders(origin), Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env);

  const seen: any[] = [];
  __setVerifiers({ registration: async (opts: any) => { seen.push(opts); return { verified: true, registrationInfo: { credential: { id: 'cred-ha', publicKey: new Uint8Array([1]), counter: 0, transports: [] } } } as any; } });
  try {
    const options = await (await call('/api/passkeys/register/options', 'https://ha.example.com')).json() as any;
    assert.equal(options.rp.id, 'ha.example.com');
    const verify = await call('/api/passkeys/register/verify', 'https://ha.example.com', { name: 'Phone', response: fakeAttestationResponse(options.challenge, 'https://ha.example.com', 'cred-ha') });
    assert.equal(verify.status, 200);
    assert.deepEqual(seen[0].expectedOrigin, ['https://ha.example.com']);
    assert.equal(seen[0].expectedRPID, 'ha.example.com');
  } finally {
    __resetVerifiers();
  }

  // Remote access through Home Assistant's external address (Home Assistant Cloud here) gets its own rpID.
  const remote = await (await call('/api/passkeys/login/options', 'https://abcd.ui.nabu.casa')).json() as any;
  assert.equal(remote.rpId, 'abcd.ui.nabu.casa');

  // Home Assistant opened by IP can't hold a passkey; say what to do instead.
  const byIp = await call('/api/passkeys/login/options', 'https://192.168.1.5:8123');
  assert.equal(byIp.status, 400);
  assert.match(((await byIp.json()) as any).error, /IP address.*PUBLIC_URL/);
});

test('the browser Origin only picks the rpID for requests the Supervisor proxied', async () => {
  const app = createApp();
  const login = (env: Env) => app.request('http://homeassistant:8123/api/passkeys/login/options', { method: 'POST', headers: ingressHeaders('https://evil.example') }, env);

  // Docker / any other deployment (no HA_INGRESS), and the add-on's own port (not from the Supervisor).
  for (const env of [makeEnv(''), { ...makeEnv(''), HA_INGRESS: () => false }]) {
    const res = await login(env);
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as any).error, /open at https:\/\/evil\.example.*http:\/\/homeassistant:8123.*PUBLIC_URL/);
  }

  // PUBLIC_URL still wins over the ingress page.
  const pinned = await login({ ...makeEnv('https://kinwall.example.com'), HA_INGRESS: () => true });
  assert.equal(pinned.status, 400);
  assert.match(((await pinned.json()) as any).error, /set up for https:\/\/kinwall\.example\.com/);

  assert.equal(isSupervisorPeer('172.30.32.2'), true);
  assert.equal(isSupervisorPeer('::ffff:172.30.32.2'), true);
  for (const peer of ['172.30.32.1', '192.168.1.5', '::1', undefined]) assert.equal(isSupervisorPeer(peer), false);
});

test('WEBAUTHN_RP_ID: shared rpID for a subdomain origin, refused for an unrelated host', async () => {
  const env = { ...makeEnv('https://smiths.example.com'), WEBAUTHN_RP_ID: 'example.com' };
  assert.deepEqual(await resolveRpId(env, new Request('https://ignored.test/')), { rpID: 'example.com', origin: 'https://smiths.example.com', expectedOrigins: ['https://smiths.example.com'] });

  const options = await (await makeApp(env)('/api/passkeys/register/options', { method: 'POST', body: '{}' })).json() as any;
  assert.equal(options.rp.id, 'example.com');
  assert.equal(options.user.name, 'smiths.example.com', 'per-instance user under a shared rpID');
  assert.equal(Buffer.from(options.user.id, 'base64url').toString(), 'kinwall-admin@smiths.example.com');

  const other = { ...makeEnv('https://evil.test'), WEBAUTHN_RP_ID: 'example.com' };
  const res = await makeApp(other, null)('/api/passkeys/login/options', { method: 'POST' });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as any).error, /not example.com or a subdomain/);
  // Suffix match must be on a label boundary.
  await assert.rejects(resolveRpId({ ...makeEnv('https://notexample.com'), WEBAUTHN_RP_ID: 'example.com' }, new Request('https://x/')));
});

test('finishPasskeyLogin: passes the caller challenge/origin/rpID through and mints a working admin session', async () => {
  const env = makeEnv();
  await env.DB.prepare('INSERT INTO passkeys (id, credential_id, public_key, counter, transports, name, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind('pk-1', 'cred-1', 'AAAA', 0, '[]', 'Phone', new Date().toISOString())
    .run();
  const seen: any[] = [];
  __setVerifiers({
    authentication: async (opts: any) => {
      seen.push(opts);
      return { verified: true, authenticationInfo: { newCounter: 7 } } as any;
    },
  });
  try {
    const response = { id: 'cred-1', response: {} };
    const out = await finishPasskeyLogin(env, { response, expectedChallenge: 'chal', expectedOrigin: 'https://app.example.com', expectedRpId: 'example.com' });
    assert.equal(seen[0].expectedChallenge, 'chal');
    assert.equal(seen[0].expectedOrigin, 'https://app.example.com');
    assert.equal(seen[0].expectedRPID, 'example.com');
    assert.equal(out.scope, 'admin');
    assert.equal(out.keyName, 'Passkey: Phone');
    const me = await (await makeApp(env, out.key)('/api/me')).json() as any;
    assert.equal(me.scope, 'admin');
    assert.equal(me.kind, 'session');
    const row = await env.DB.prepare('SELECT counter FROM passkeys WHERE id = ?').bind('pk-1').first<{ counter: number }>();
    assert.equal(row?.counter, 7);

    await assert.rejects(
      finishPasskeyLogin(env, { response: { id: 'nope' }, expectedChallenge: 'c', expectedOrigin: 'o', expectedRpId: 'r' }),
      /unknown passkey/,
    );
    __setVerifiers({ authentication: async () => ({ verified: false }) as any });
    const before = (await env.DB.prepare('SELECT COUNT(*) AS n FROM api_keys').first<{ n: number }>())!.n;
    await assert.rejects(finishPasskeyLogin(env, { response, expectedChallenge: 'c', expectedOrigin: 'o', expectedRpId: 'r' }), /could not be verified/);
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM api_keys').first<{ n: number }>())!.n, before, 'no session on failure');
  } finally {
    __resetVerifiers();
  }
});

test('passkey login route goes through finishPasskeyLogin end to end', async () => {
  const env = makeEnv();
  await env.DB.prepare('INSERT INTO passkeys (id, credential_id, public_key, counter, transports, name, created_at) VALUES (?,?,?,?,?,?,?)')
    .bind('pk-1', 'cred-1', 'AAAA', 0, '[]', 'Phone', new Date().toISOString())
    .run();
  __setVerifiers({ authentication: async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }) as any });
  try {
    const anon = makeApp(env, null);
    const options = await (await anon('/api/passkeys/login/options', { method: 'POST' })).json() as any;
    const res = await anon('/api/passkeys/login/verify', {
      method: 'POST',
      body: JSON.stringify({ response: fakeAttestationResponse(options.challenge, 'http://localhost:8080', 'cred-1') }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.ok(body.key && body.expiresAt);
  } finally {
    __resetVerifiers();
  }
});

test('register options: authenticator choice sets attachment (+ hints for cross-platform); unset is unchanged', async () => {
  const admin = makeApp(makeEnv());
  const opts = async (body: unknown) => (await admin('/api/passkeys/register/options', { method: 'POST', body: JSON.stringify(body) })).json() as Promise<any>;

  const cross = await opts({ authenticator: 'cross-platform' });
  assert.equal(cross.authenticatorSelection.authenticatorAttachment, 'cross-platform');
  assert.deepEqual(cross.hints, ['security-key', 'hybrid']);
  assert.equal(cross.authenticatorSelection.residentKey, 'preferred');

  const platform = await opts({ authenticator: 'platform' });
  assert.equal(platform.authenticatorSelection.authenticatorAttachment, 'platform');
  assert.deepEqual(platform.hints, []);

  const unset = await opts({});
  assert.equal(unset.authenticatorSelection.authenticatorAttachment, undefined);
  assert.deepEqual(unset.hints, []);

  const bad = await admin('/api/passkeys/register/options', { method: 'POST', body: JSON.stringify({ authenticator: 'usb' }) });
  assert.equal(bad.status, 400);
});
