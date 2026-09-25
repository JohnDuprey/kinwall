import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const ADMIN_KEY = 'kw_test_provider_admin';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(overrides: Partial<Env> = {}): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return {
    DB: db as unknown as D1Database,
    ADMIN_API_KEY: ADMIN_KEY,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ...overrides,
  };
}

const app = () => createApp();

function makeApp(env: Env) {
  const app = createApp();
  const request = (p: string, init: RequestInit & { display?: boolean } = {}) => {
    const { display, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${display ? DISPLAY_KEY : ADMIN_KEY}`);
    if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...rest, headers }, env);
  };
  return request;
}

const DISPLAY_KEY = 'kw_test_provider_display';

async function seedDisplayKey(env: Env) {
  const { sha256Hex } = await import('../src/auth.ts');
  await env.DB.prepare("INSERT INTO api_keys (id, name, hash, prefix, scope, created_at) VALUES ('disp1','wall','" + (await sha256Hex(DISPLAY_KEY)) + "','kw_test_','display', datetime('now'))").run();
}

test('providers: no config -> not configured, no source', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const res = await request('/api/providers');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.google.configured, false);
  assert.equal(body.google.source, null);
  assert.equal(body.google.secretSet, false);
  assert.equal(body.microsoft.configured, false);
  assert.equal(body.publicUrl.source, null);
});

test('providers: env-only credentials are read-only', async () => {
  const env = makeEnv({ GOOGLE_CLIENT_ID: 'env-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'env-secret', PUBLIC_URL: 'https://cal.example.com' });
  const request = makeApp(env);

  const status = await (await request('/api/providers')).json() as any;
  assert.equal(status.google.configured, true);
  assert.equal(status.google.source, 'env');
  assert.equal(status.google.clientId, 'env-id.apps.googleusercontent.com');
  assert.equal(status.google.secretSet, true);
  assert.equal(status.publicUrl.source, 'env');
  assert.equal(status.redirectUris.google, 'https://cal.example.com/api/oauth/google/callback');

  const put = await request('/api/providers/google', { method: 'PUT', body: JSON.stringify({ clientId: 'x.apps.googleusercontent.com', clientSecret: 's' }) });
  assert.equal(put.status, 409);

  const del = await request('/api/providers/google', { method: 'DELETE' });
  assert.equal(del.status, 409);

  const putUrl = await request('/api/providers/public-url', { method: 'PUT', body: JSON.stringify({ value: 'https://other.example.com' }) });
  assert.equal(putUrl.status, 409);
});

test('providers: UI round-trip - secret never appears in any GET response, omitting it keeps the old one', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const created = await request('/api/providers/google', {
    method: 'PUT',
    body: JSON.stringify({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'super-secret-value' }),
  });
  assert.equal(created.status, 200);
  const createdText = await created.text();
  assert.ok(!createdText.includes('super-secret-value'));
  const createdBody = JSON.parse(createdText);
  assert.equal(createdBody.source, 'ui');
  assert.equal(createdBody.secretSet, true);

  const status = await request('/api/providers');
  const statusText = await status.text();
  assert.ok(!statusText.includes('super-secret-value'));
  const statusBody = JSON.parse(statusText);
  assert.equal(statusBody.google.clientId, '123-abc.apps.googleusercontent.com');
  assert.equal(statusBody.google.source, 'ui');

  // Omitting clientSecret keeps the existing one.
  const updated = await request('/api/providers/google', {
    method: 'PUT',
    body: JSON.stringify({ clientId: '123-abc.apps.googleusercontent.com' }),
  });
  assert.equal(updated.status, 200);
  const updatedBody = await updated.json() as any;
  assert.equal(updatedBody.secretSet, true);
});

test('providers: authUrl uses the stored client id and redirect URI', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  await request('/api/providers/public-url', { method: 'PUT', body: JSON.stringify({ value: 'https://kinwall.example.com/' }) });
  await request('/api/providers/google', { method: 'PUT', body: JSON.stringify({ clientId: 'stored-id.apps.googleusercontent.com', clientSecret: 'sekret' }) });

  const start = await request(`/api/oauth/google/start?key=${ADMIN_KEY}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const location = start.headers.get('Location')!;
  assert.match(location, /^https:\/\/accounts\.google\.com/);
  assert.match(location, /client_id=stored-id\.apps\.googleusercontent\.com/);
  assert.match(location, /redirect_uri=https%3A%2F%2Fkinwall\.example\.com%2Fapi%2Foauth%2Fgoogle%2Fcallback/);

  const status = await (await request('/api/providers')).json() as any;
  assert.equal(status.redirectUris.google, 'https://kinwall.example.com/api/oauth/google/callback');
});

test('providers: PUT validates clientId format and tenant', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const badGoogle = await request('/api/providers/google', { method: 'PUT', body: JSON.stringify({ clientId: 'not-a-google-id', clientSecret: 's' }) });
  assert.equal(badGoogle.status, 400);

  const badMs = await request('/api/providers/microsoft', { method: 'PUT', body: JSON.stringify({ clientId: 'not-a-guid', clientSecret: 's' }) });
  assert.equal(badMs.status, 400);

  const goodMs = await request('/api/providers/microsoft', {
    method: 'PUT',
    body: JSON.stringify({ clientId: '11111111-2222-3333-4444-555555555555', clientSecret: 's', tenant: 'bad tenant' }),
  });
  assert.equal(goodMs.status, 400);
});

test('providers: public-url warns on bare IP and plain http', async () => {
  const env = makeEnv();
  const request = makeApp(env);

  const ip = await request('/api/providers/public-url', { method: 'PUT', body: JSON.stringify({ value: 'http://203.0.113.5' }) });
  const ipBody = await ip.json() as any;
  assert.equal(ip.status, 200);
  assert.match(ipBody.warning, /IP address/);

  const http = await request('/api/providers/public-url', { method: 'PUT', body: JSON.stringify({ value: 'http://cal.example.com' }) });
  const httpBody = await http.json() as any;
  assert.match(httpBody.warning, /plain http/);

  const clean = await request('/api/providers/public-url', { method: 'PUT', body: JSON.stringify({ value: 'https://cal.example.com/' }) });
  const cleanBody = await clean.json() as any;
  assert.equal(cleanBody.value, 'https://cal.example.com');
  assert.equal(cleanBody.warning, undefined);
});

test('providers: a display key gets 403 on every provider route', async () => {
  const env = makeEnv();
  await seedDisplayKey(env);
  const request = makeApp(env);

  assert.equal((await request('/api/providers', { display: true })).status, 403);
  assert.equal((await request('/api/providers/google', { method: 'PUT', display: true, body: JSON.stringify({ clientId: 'a.apps.googleusercontent.com', clientSecret: 's' }) })).status, 403);
  assert.equal((await request('/api/providers/google', { method: 'DELETE', display: true })).status, 403);
  assert.equal((await request('/api/providers/public-url', { method: 'PUT', display: true, body: JSON.stringify({ value: 'https://x.example.com' }) })).status, 403);
});

const HOST_ENV = { GOOGLE_CLIENT_ID: 'host-id.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'host-secret-value', PUBLIC_URL: 'https://smiths.host.example' };

test('providers: env-level (host) credentials -> /api/setup configured, "env" source, secret never returned', async () => {
  const env = makeEnv(HOST_ENV);
  const request = makeApp(env);
  const setup = await (await app().request('/api/setup', {}, env)).json() as any;
  assert.deepEqual(setup.oauth, { google: true, microsoft: false });
  for (const p of ['/api/setup', '/api/providers', '/api/me']) {
    const text = await (await request(p)).text();
    assert.ok(!text.includes('host-secret-value'), p);
  }
  const status = await (await request('/api/providers')).json() as any;
  assert.equal(status.google.source, 'env');
});

test('providers: household settings override env credentials (start + token exchange use them)', async () => {
  const env = makeEnv({ OAUTH_REDIRECT_URI: 'https://app.host.example/oauth/callback' });
  const request = makeApp(env);
  await request('/api/providers/public-url', { method: 'PUT', body: JSON.stringify({ value: 'https://smiths.host.example' }) });
  await request('/api/providers/google', { method: 'PUT', body: JSON.stringify({ clientId: 'own-id.apps.googleusercontent.com', clientSecret: 'own-secret' }) });
  Object.assign(env, { GOOGLE_CLIENT_ID: HOST_ENV.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: HOST_ENV.GOOGLE_CLIENT_SECRET });

  const status = await (await request('/api/providers')).json() as any;
  assert.equal(status.google.source, 'ui');
  assert.equal(status.google.clientId, 'own-id.apps.googleusercontent.com');

  // Own app: own client id, per-instance redirect URI and a plain state even with OAUTH_REDIRECT_URI set.
  const loc = new URL((await request(`/api/oauth/google/start?key=${ADMIN_KEY}`, { redirect: 'manual' })).headers.get('Location')!);
  assert.equal(loc.searchParams.get('client_id'), 'own-id.apps.googleusercontent.com');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://smiths.host.example/api/oauth/google/callback');
  assert.ok(!loc.searchParams.get('state')!.includes('.'));

  const { providerEnv } = await import('../src/providers/config.ts');
  const penv = await providerEnv(env, env.DB);
  assert.equal(penv.GOOGLE_CLIENT_SECRET, 'own-secret'); // token refresh reads providerEnv too
});

test('oauth: OAUTH_REDIRECT_URI -> shared redirect + "<hostLabel>.<kind>.<random>" state; forwarded callback accepts it', async () => {
  const env = makeEnv({ ...HOST_ENV, OAUTH_REDIRECT_URI: 'https://app.host.example/oauth/callback' });
  const request = makeApp(env);
  const start = await app().request(`https://smiths.host.example/api/oauth/google/start?key=${ADMIN_KEY}`, { headers: { Authorization: `Bearer ${ADMIN_KEY}` }, redirect: 'manual' }, env);
  const loc = new URL(start.headers.get('Location')!);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://app.host.example/oauth/callback');
  assert.equal(loc.searchParams.get('client_id'), HOST_ENV.GOOGLE_CLIENT_ID);
  const state = loc.searchParams.get('state')!;
  assert.match(state, /^smiths\.google\.[0-9a-f-]{36}$/);

  const realFetch = globalThis.fetch;
  let tokenBody = '';
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).includes('token')) {
      tokenBody = String(init?.body);
      return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 });
    }
    return Response.json({ email: 'kid@example.com' });
  }) as typeof fetch;
  try {
    // A tampered random part is rejected; the exact state is accepted once.
    const bad = await request(`/api/oauth/google/callback?code=c&state=${encodeURIComponent(state + 'x')}`, { redirect: 'manual' });
    assert.equal(bad.status, 400);
    const ok = await request(`/api/oauth/google/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(ok.status, 302);
    assert.match(ok.headers.get('Location')!, /^https:\/\/smiths\.host\.example\/#\/settings\?account=/);
    assert.equal(new URLSearchParams(tokenBody).get('redirect_uri'), 'https://app.host.example/oauth/callback');
    assert.equal(new URLSearchParams(tokenBody).get('client_secret'), 'host-secret-value');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('oauth: without OAUTH_REDIRECT_URI the state stays a bare UUID', async () => {
  const request = makeApp(makeEnv(HOST_ENV));
  const loc = new URL((await request(`/api/oauth/google/start?key=${ADMIN_KEY}`, { redirect: 'manual' })).headers.get('Location')!);
  assert.match(loc.searchParams.get('state')!, /^[0-9a-f-]{36}$/);
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://smiths.host.example/api/oauth/google/callback');
});
