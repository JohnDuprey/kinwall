import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'https://kinwall.example', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const req = (p: string, init: RequestInit = {}, key?: string) => {
    const headers = new Headers(init.headers);
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...init, headers }, env);
  };
  const mcp = (key: string, method = 'tools/list', params: unknown = {}) =>
    req('/mcp', { method: 'POST', headers: { Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, key);
  const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  return { env, req, mcp, form };
}

const pkce = () => {
  const verifier = Buffer.from(randomBytes(32)).toString('base64url');
  return { verifier, challenge: Buffer.from(createHash('sha256').update(verifier).digest()).toString('base64url') };
};

// register -> authorize -> approve -> code, returning what the client needs for /oauth/token.
async function authorize(t: ReturnType<typeof setup>, scope?: 'admin' | 'display') {
  const reg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) })).json() as any;
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' });
  const auth = await t.req(`/oauth/authorize?${q}`);
  assert.equal(auth.status, 302);
  assert.ok(auth.headers.get('Location')!.startsWith('/#/authorize?'));
  const approved = await (await t.req('/api/authorizations/approve', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope }),
  }, ADMIN_KEY)).json() as any;
  const back = new URL(approved.redirect);
  assert.equal(back.origin + back.pathname, REDIRECT);
  assert.equal(back.searchParams.get('state'), 'xyz');
  assert.equal(back.searchParams.get('iss'), 'https://kinwall.example');
  return { clientId: reg.client_id as string, code: back.searchParams.get('code')!, verifier };
}

const exchange = (t: ReturnType<typeof setup>, a: { clientId: string; code: string; verifier: string }) =>
  t.req('/oauth/token', t.form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier, client_id: a.clientId, redirect_uri: REDIRECT }));

test('oauth: discovery documents point clients at Kinwall', async () => {
  const t = setup();
  const unauth = await t.mcp('');
  assert.match(unauth.headers.get('WWW-Authenticate')!, /resource_metadata="https:\/\/kinwall\.example\/\.well-known\/oauth-protected-resource"/);
  const pr = await (await t.req('/.well-known/oauth-protected-resource')).json() as any;
  assert.equal(pr.resource, 'https://kinwall.example/mcp');
  assert.deepEqual(pr.authorization_servers, ['https://kinwall.example']);
  const as = await (await t.req('/.well-known/oauth-authorization-server')).json() as any;
  assert.equal(as.token_endpoint, 'https://kinwall.example/oauth/token');
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
});

test('oauth: full flow issues a working token; refresh rotates; revoking in Settings ends it', async () => {
  const t = setup();
  const tok = await (await exchange(t, await authorize(t))).json() as any;
  assert.equal(tok.token_type, 'Bearer');
  assert.equal(tok.scope, 'kinwall:admin');
  assert.equal((await t.mcp(tok.access_token)).status, 200);

  const refreshed = await (await t.req('/oauth/token', t.form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).json() as any;
  assert.ok(refreshed.access_token && refreshed.refresh_token && refreshed.refresh_token !== tok.refresh_token);
  assert.equal((await t.mcp(refreshed.access_token)).status, 200);

  const grants = await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json() as any[];
  assert.equal(grants.length, 1);
  assert.equal(grants[0].clientName, 'Claude');
  await t.req(`/api/authorizations/${grants[0].id}`, { method: 'DELETE' }, ADMIN_KEY);
  assert.equal((await t.mcp(refreshed.access_token)).status, 401);
  const dead = await t.req('/oauth/token', t.form({ grant_type: 'refresh_token', refresh_token: refreshed.refresh_token }));
  assert.equal(dead.status, 400);
});

test('oauth: a reused refresh token revokes the whole connection', async () => {
  const t = setup();
  const tok = await (await exchange(t, await authorize(t))).json() as any;
  const next = await (await t.req('/oauth/token', t.form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).json() as any;
  const replay = await t.req('/oauth/token', t.form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }));
  assert.equal(((await replay.json()) as any).error, 'invalid_grant');
  assert.equal((await t.mcp(next.access_token)).status, 401, 'tokens from the rotated chain are dead too');
});

test('oauth: PKCE, code reuse, expiry and redirect mismatches are refused', async () => {
  const t = setup();
  const a = await authorize(t);
  const wrong = await t.req('/oauth/token', t.form({ grant_type: 'authorization_code', code: a.code, code_verifier: 'x'.repeat(43), client_id: a.clientId, redirect_uri: REDIRECT }));
  assert.equal(((await wrong.json()) as any).error, 'invalid_grant');
  const otherRedirect = await t.req('/oauth/token', t.form({ grant_type: 'authorization_code', code: a.code, code_verifier: a.verifier, client_id: a.clientId, redirect_uri: 'https://evil.example/cb' }));
  assert.equal(otherRedirect.status, 400);

  const tok = await (await exchange(t, a)).json() as any;
  assert.ok(tok.access_token);
  const replay = await exchange(t, a);
  assert.equal(((await replay.json()) as any).error, 'invalid_grant');
  assert.equal((await t.mcp(tok.access_token)).status, 401, 'a replayed code revokes what it produced');

  const b = await authorize(t);
  await t.env.DB.prepare('UPDATE oauth_codes SET expires_at = ?').bind('2000-01-01T00:00:00.000Z').run();
  assert.equal(((await (await exchange(t, b)).json()) as any).error, 'invalid_grant');
});

test('oauth: registration and authorize only send the browser to registered, safe addresses', async () => {
  const t = setup();
  for (const bad of ['http://evil.example/cb', 'https://ok.example/cb#frag', 'javascript:alert(1)']) {
    const res = await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [bad] }) });
    assert.equal(res.status, 400, bad);
  }
  assert.equal((await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:3334/cb'] }) })).status, 201);

  const reg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json() as any;
  const { challenge } = pkce();
  const unregistered = await t.req(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' })}`);
  assert.equal(unregistered.status, 400, 'shown as an error page, never redirected');
  const plain = await t.req(`/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'plain' })}`);
  assert.match(plain.headers.get('Location')!, /error=invalid_request/);
});

test('oauth: only a signed-in admin (not a display, not an OAuth token) can approve; everyday scope is limited', async () => {
  const t = setup();
  const display = await (await t.req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'wall', scope: 'display' }) }, ADMIN_KEY)).json() as any;
  const reg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [REDIRECT] }) })).json() as any;
  const body = JSON.stringify({ decision: 'approve', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256' });
  assert.equal((await t.req('/api/authorizations/approve', { method: 'POST', body }, display.key)).status, 403);

  const tok = await (await exchange(t, await authorize(t, 'display'))).json() as any;
  assert.equal(tok.scope, 'kinwall:display');
  assert.equal((await t.req('/api/authorizations/approve', { method: 'POST', body }, tok.access_token)).status, 403, 'display-scoped OAuth token');
  const admin = await (await exchange(t, await authorize(t))).json() as any;
  assert.equal((await t.req('/api/authorizations/approve', { method: 'POST', body }, admin.access_token)).status, 403, 'admin OAuth token still cannot approve');
  assert.equal((await t.req('/api/authorizations', {}, admin.access_token)).status, 403, 'admin OAuth token cannot list grants');
  const grants = await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json() as any[];
  assert.equal((await t.req(`/api/authorizations/${grants[0].id}`, { method: 'DELETE' }, admin.access_token)).status, 403, 'admin OAuth token cannot revoke grants');
  assert.equal(((await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json()) as any[]).length, grants.length, 'real admin key still lists; nothing was revoked');

  const add = await (await t.mcp(tok.access_token, 'tools/call', { name: 'add_member', arguments: { name: 'X', color: '#000000' } })).json() as any;
  assert.equal(add.result.isError, true, 'everyday access cannot add members');
});
