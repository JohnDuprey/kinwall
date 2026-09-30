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
  for (const bad of ['http://evil.example/cb', 'https://ok.example/cb#frag', 'javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'kinwall:/oauth', 'family.kinwall.app:/oauth#frag']) {
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

test('oauth: a native app signs in with its own reverse-domain link (RFC 8252)', async () => {
  const t = setup();
  const APP = 'family.kinwall.app:/oauth';
  const reg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Kinwall for iPhone', redirect_uris: [APP] }) })).json() as any;
  assert.ok(reg.client_id, JSON.stringify(reg));
  const { verifier, challenge } = pkce();
  const info = await (await t.req(`/api/authorizations/request?${new URLSearchParams({ client_id: reg.client_id, redirect_uri: APP })}`, {}, ADMIN_KEY)).json() as any;
  assert.equal(info.redirectHost, 'the Kinwall app');
  const approved = await (await t.req('/api/authorizations/approve', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve', client_id: reg.client_id, redirect_uri: APP, code_challenge: challenge, code_challenge_method: 'S256', state: 's1', scope: 'display' }),
  }, ADMIN_KEY)).json() as any;
  const back = new URL(approved.redirect);
  assert.equal(back.protocol + back.pathname, APP);
  assert.equal(back.searchParams.get('state'), 's1');
  const tokens = await (await t.req('/oauth/token', t.form({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: APP }))).json() as any;
  assert.equal(tokens.scope, 'kinwall:display');
  assert.equal((await t.req('/api/settings', {}, tokens.access_token)).status, 200);
});

// The app's sign-in: "Whose device is this?" on the consent screen becomes the owner of its keys.
async function appSignIn(t: ReturnType<typeof setup>, scope: 'admin' | 'display', owner?: string) {
  const APP = 'family.kinwall.app:/oauth';
  const reg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Kinwall for iPhone', redirect_uris: [APP] }) })).json() as any;
  const { verifier, challenge } = pkce();
  const approved = await (await t.req('/api/authorizations/approve', {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve', client_id: reg.client_id, redirect_uri: APP, code_challenge: challenge, code_challenge_method: 'S256', scope, owner }),
  }, ADMIN_KEY)).json() as any;
  const code = new URL(approved.redirect).searchParams.get('code')!;
  return await (await t.req('/oauth/token', t.form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: APP }))).json() as any;
}
const addMember = async (t: ReturnType<typeof setup>, name: string) => (await (await t.req('/api/members', { method: 'POST', body: JSON.stringify({ name, color: '#336699' }) }, ADMIN_KEY)).json() as any).id as string;
const me = async (t: ReturnType<typeof setup>, key: string) => (await (await t.req('/api/me', {}, key)).json()) as any;

test('oauth owner: the app asks whose device it is; MCP clients never get an owner', async () => {
  const t = setup();
  const alex = await addMember(t, 'Alex');
  const APP = 'family.kinwall.app:/oauth';
  const reg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Kinwall for iPhone', redirect_uris: [APP] }) })).json() as any;
  const info = await (await t.req(`/api/authorizations/request?${new URLSearchParams({ client_id: reg.client_id, redirect_uri: APP })}`, {}, ADMIN_KEY)).json() as any;
  assert.equal(info.deviceApp, true);

  const tok = await appSignIn(t, 'admin', alex);
  const who = await me(t, tok.access_token);
  assert.equal(who.owner, alex);
  const grants = await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json() as any[];
  assert.equal(grants[0].owner, alex);
  assert.equal(grants[0].deviceApp, true);
  // the refreshed key is Alex's too
  const refreshed = await (await t.req('/oauth/token', t.form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).json() as any;
  assert.equal((await me(t, refreshed.access_token)).owner, alex);

  // no pick = shared; an unknown member is refused
  assert.equal((await me(t, (await appSignIn(t, 'admin')).access_token)).owner, 'shared');
  const { challenge } = pkce();
  const bad = await t.req('/api/authorizations/approve', { method: 'POST', body: JSON.stringify({ decision: 'approve', client_id: reg.client_id, redirect_uri: APP, code_challenge: challenge, code_challenge_method: 'S256', owner: 'nobody' }) }, ADMIN_KEY);
  assert.equal(bad.status, 400);

  // An MCP client: not a device app, and an owner in the approval is ignored.
  const mcpReg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }) })).json() as any;
  const mcpInfo = await (await t.req(`/api/authorizations/request?${new URLSearchParams({ client_id: mcpReg.client_id, redirect_uri: REDIRECT })}`, {}, ADMIN_KEY)).json() as any;
  assert.equal(mcpInfo.deviceApp, false);
  const mcpTok = await (await exchange(t, await authorize(t))).json() as any;
  assert.equal((await me(t, mcpTok.access_token)).owner, null);
});

test('oauth owner: full access records the owner without locking; everyday access is pinned', async () => {
  const t = setup();
  const sam = await addMember(t, 'Sam');
  const maya = await addMember(t, 'Maya');
  const parent = await me(t, (await appSignIn(t, 'admin', sam)).access_token);
  assert.equal(parent.scope, 'admin');
  assert.equal(parent.owner, sam);
  assert.equal(parent.locked, false);
  const kid = await me(t, (await appSignIn(t, 'display', maya)).access_token);
  assert.equal(kid.scope, 'display');
  assert.equal(kid.owner, maya);
  assert.equal(kid.locked, true);
  assert.equal((await me(t, ADMIN_KEY)).locked, false);
});

test("oauth owner: widget/watch keys follow a pinned device's owner, but a parent's stay shared", async () => {
  const t = setup();
  const leo = await addMember(t, 'Leo');
  const mint = async (token: string) => me(t, (await (await t.req('/api/device-keys', { method: 'POST', body: JSON.stringify({ name: 'Widgets on iPhone' }) }, token)).json() as any).key)
  const kid = await mint((await appSignIn(t, 'display', leo)).access_token)
  assert.equal(kid.scope, 'display');
  assert.equal(kid.owner, leo, "a kid's widgets are theirs");
  const parent = await mint((await appSignIn(t, 'admin', leo)).access_token)
  assert.equal(parent.owner, 'shared', "a parent's widgets show the whole family");
  assert.equal(parent.locked, true, 'still an everyday-access key');
});

test("oauth owner: an admin can change a signed-in app's owner later; not an MCP client's", async () => {
  const t = setup();
  const alex = await addMember(t, 'Alex');
  const tok = await appSignIn(t, 'admin');
  const [grant] = await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json() as any[];
  const patch = (id: string, owner: string, key = ADMIN_KEY) => t.req(`/api/authorizations/${id}`, { method: 'PATCH', body: JSON.stringify({ owner }) }, key);
  assert.equal((await patch(grant.id, alex, tok.access_token)).status, 403, 'the app itself cannot re-assign itself');
  assert.equal((await patch(grant.id, 'nobody')).status, 400);
  assert.equal((await patch(grant.id, alex)).status, 200);
  assert.equal((await me(t, tok.access_token)).owner, alex, 'the live key follows at once');
  const refreshed = await (await t.req('/oauth/token', t.form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }))).json() as any;
  assert.equal((await me(t, refreshed.access_token)).owner, alex);

  // deleting the member makes the device shared again
  await t.req(`/api/members/${alex}`, { method: 'DELETE' }, ADMIN_KEY);
  assert.equal(((await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json()) as any[])[0].owner, 'shared');

  await exchange(t, await authorize(t));
  const mcpGrant = ((await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json()) as any[]).find((g) => !g.deviceApp);
  assert.equal((await patch(mcpGrant.id, 'shared')).status, 404);
});

test('oauth: the Kinwall app (admin) manages connected apps and sees itself as current; display and MCP tokens cannot', async () => {
  const t = setup();
  const app = await appSignIn(t, 'admin');
  const list = await t.req('/api/authorizations', {}, app.access_token);
  assert.equal(list.status, 200);
  const grants = await list.json() as any[];
  assert.equal(grants.length, 1);
  assert.equal(grants[0].current, true);
  assert.equal((await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json() as any[])[0].current, false);
  const kid = await appSignIn(t, 'display');
  assert.equal((await t.req('/api/authorizations', {}, kid.access_token)).status, 403, 'display app');
  const mcp = await (await exchange(t, await authorize(t, 'admin'))).json() as any;
  assert.equal((await t.req('/api/authorizations', {}, mcp.access_token)).status, 403, 'MCP client');
  assert.equal((await t.req(`/api/authorizations/${grants[0].id}`, { method: 'DELETE' }, mcp.access_token)).status, 403);
});

// A connected app (an MCP client's OAuth token, or any MCP tool call) uses the family's data but never
// manages how anyone signs in: otherwise it could mint itself a permanent key that outlives revoking it.
test('oauth: a connected app cannot create, change or remove sign-ins; the Kinwall app and API keys can', async () => {
  const t = setup();
  const alex = await (await t.req('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Alex', color: '#336699', grownUp: true }) }, ADMIN_KEY)).json() as any;
  const mcp = (await (await exchange(t, await authorize(t, 'admin'))).json() as any).access_token as string;
  const existing = (await (await t.req('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Hallway', scope: 'display' }) }, ADMIN_KEY)).json() as any).id;
  const credentialCalls: [string, string, unknown?][] = [
    ['POST', '/api/keys', { name: 'x', scope: 'admin' }],
    ['PATCH', `/api/keys/${existing}`, { owner: 'shared' }],
    ['DELETE', `/api/keys/${existing}`],
    ['POST', '/api/device-keys', { name: 'Widgets' }],
    ['POST', '/api/recovery-codes'],
    ['POST', '/api/passkeys/register-token'],
    ['POST', '/api/passkeys/register/options', {}],
    ['PATCH', '/api/passkeys/p1', { name: 'x' }],
    ['DELETE', '/api/passkeys/p1'],
    ['POST', '/api/pair/approve', { code: '123456', name: 'Wall' }],
    ['PUT', '/api/me/owner', { owner: alex.id }],
    ['PUT', '/api/providers/public-url', { url: 'https://elsewhere.example' }],
    ['PUT', '/api/providers/google', { clientId: 'x', clientSecret: 'y' }],
    ['DELETE', '/api/providers/google'],
    ['PATCH', '/api/settings', { aiHealthAccess: true }],
    ['GET', '/api/authorizations'],
  ];
  const call = (method: string, p: string, body: unknown, key: string, headers: Record<string, string> = {}) =>
    t.req(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, key);
  for (const [method, p, body] of credentialCalls) {
    const res = await call(method, p, body, mcp);
    assert.equal(res.status, 403, `${method} ${p} from an MCP token`);
    // any key, when it comes through the MCP server
    assert.equal((await call(method, p, body, ADMIN_KEY, { 'X-Kinwall-Source': 'mcp' })).status, 403, `${method} ${p} through MCP`);
  }
  assert.match((await (await call('POST', '/api/keys', { name: 'x' }, mcp)).json() as any).error, /connected app/i);
  assert.equal(((await (await t.req('/api/keys', {}, ADMIN_KEY)).json()) as any[]).length, 1, 'no key was made or removed');
  // Everyday use still works for the app.
  assert.equal((await t.req('/api/members', {}, mcp)).status, 200);
  assert.equal((await t.req('/api/keys', {}, mcp)).status, 200, 'it may still see which keys exist');

  // The Kinwall app's own sign-in is a family device, and an admin API key is the family's.
  const app = (await appSignIn(t, 'admin')).access_token as string;
  assert.equal((await call('POST', '/api/keys', { name: 'From the app', scope: 'admin' }, app)).status, 201);
  assert.equal((await call('POST', '/api/device-keys', { name: 'Widgets' }, app)).status, 201);
  assert.equal((await call('POST', '/api/recovery-codes', undefined, app)).status, 200);
  const key = (await (await call('POST', '/api/keys', { name: 'Script', scope: 'admin' }, ADMIN_KEY)).json() as any).key;
  assert.equal((await call('POST', '/api/keys', { name: 'Another', scope: 'display' }, key)).status, 201);
  assert.equal((await call('POST', '/api/passkeys/register-token', undefined, key)).status, 200);
});

test('oauth: only a client whose links are all the Kinwall app, signing in on that link, is the Kinwall app', async () => {
  const t = setup();
  const APP = 'family.kinwall.app:/oauth';
  const register = (uris: string[]) => t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'Some AI', redirect_uris: uris }) });
  const mixed = await register([REDIRECT, APP]);
  assert.equal(mixed.status, 400, "the Kinwall app's link can't be mixed with others");
  assert.equal(((await mixed.json()) as any).error, 'invalid_redirect_uri');
  assert.equal((await register([APP, 'family.kinwall.app:/other'])).status, 201);

  // A client registered before this rule, with both links, that signs in on the web one.
  const id = crypto.randomUUID();
  await t.env.DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)').bind(id, 'Some AI', JSON.stringify([REDIRECT, APP]), new Date().toISOString()).run();
  const info = await (await t.req(`/api/authorizations/request?${new URLSearchParams({ client_id: id, redirect_uri: REDIRECT })}`, {}, ADMIN_KEY)).json() as any;
  assert.equal(info.deviceApp, false);
  const { verifier, challenge } = pkce();
  const approved = await (await t.req('/api/authorizations/approve', { method: 'POST', body: JSON.stringify({ decision: 'approve', client_id: id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' }) }, ADMIN_KEY)).json() as any;
  const code = new URL(approved.redirect).searchParams.get('code')!;
  const tok = await (await t.req('/oauth/token', t.form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: id, redirect_uri: REDIRECT }))).json() as any;
  assert.equal((await t.req('/api/authorizations', {}, tok.access_token)).status, 403, 'not a family device');
  assert.equal((await t.req('/api/settings', { method: 'PATCH', body: JSON.stringify({ aiHealthAccess: true }) }, tok.access_token)).status, 403);
  assert.equal((await t.req('/api/trackers?kind=health', {}, tok.access_token)).status, 403, 'health stays with the family');
  const grants = await (await t.req('/api/authorizations', {}, ADMIN_KEY)).json() as any[];
  assert.equal(grants.find((g) => g.clientName === 'Some AI').deviceApp, false);
});

test("oauth: the consent screen names the Kinwall app, and marks any other app's link unverified", async () => {
  const t = setup();
  const info = async (uri: string) => {
    const reg = await (await t.req('/oauth/register', { method: 'POST', body: JSON.stringify({ client_name: 'X', redirect_uris: [uri] }) })).json() as any;
    return (await (await t.req(`/api/authorizations/request?${new URLSearchParams({ client_id: reg.client_id, redirect_uri: uri })}`, {}, ADMIN_KEY)).json()) as any;
  };
  assert.equal((await info('family.kinwall.app:/oauth')).redirectHost, 'the Kinwall app');
  assert.equal((await info('com.example.notes:/cb')).redirectHost, 'an unverified app (com.example.notes:)');
  assert.equal((await info(REDIRECT)).redirectHost, 'claude.ai');
});

test("oauth migration: the Kinwall app's existing sign-ins stay family devices; a client with mixed links loses that", async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-mig-'));
  const all = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const NEW = all.find((f) => f.includes('oauth_device_app'))!;
  for (const f of all.filter((f) => f < NEW)) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  const db = openDb(':memory:');
  applyMigrations(db, dir);
  const now = new Date().toISOString();
  const client = (id: string, uris: string[]) => db.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)').bind(id, id, JSON.stringify(uris), now).run();
  const grant = (id: string, clientId: string) => db.prepare("INSERT INTO oauth_grants (id, client_id, scope, created_at) VALUES (?,?,'admin',?)").bind(id, clientId, now).run();
  await client('app', ['family.kinwall.app:/oauth']);
  await client('mixed', [REDIRECT, 'family.kinwall.app:/oauth']);
  await client('ai', [REDIRECT]);
  await grant('g-app', 'app');
  await grant('g-mixed', 'mixed');
  await grant('g-ai', 'ai');
  applyMigrations(db, MIGRATIONS_DIR);
  const rows = db.prepare('SELECT id, device_app FROM oauth_grants ORDER BY id').all<{ id: string; device_app: number }>().results;
  assert.deepEqual(rows.map((r) => [r.id, r.device_app]), [['g-ai', 0], ['g-app', 1], ['g-mixed', 0]]);
  fs.rmSync(dir, { recursive: true });
});
