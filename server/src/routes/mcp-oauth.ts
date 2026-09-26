// OAuth 2.1 authorization server for the MCP endpoint, per the MCP authorization spec: protected-
// resource + authorization-server metadata, dynamic client registration, authorization code + PKCE
// (S256 only), rotating refresh tokens. Public clients only (no client secrets).
//
// Flow: GET /oauth/authorize validates the client and bounces the browser to the SPA's consent
// screen (#/authorize?...), where a signed-in admin approves via POST /api/authorizations/approve.
// That returns the redirect (with a one-time code) for the SPA to follow. The client then swaps
// the code at POST /oauth/token for an access token - a short-lived api_keys row (kind 'oauth'),
// so /mcp and REST auth need no changes - plus a refresh token.
import type { KinwallDb } from '../db.ts';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { createApiKey, resolveKey, sha256Hex, type KeyScope } from '../auth.ts';
import { effectivePublicUrl } from '../providers/config.ts';

export const mcpOAuthRoutes = createRouter();

const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SCOPES = { admin: 'kinwall:admin', display: 'kinwall:display' } as const;

type ClientRow = { id: string; name: string; redirect_uris: string; created_at: string };

// Issuer/resource URLs must be the public https origin, not whatever a reverse proxy forwarded.
async function baseUrl(c: Context<{ Bindings: Env }>): Promise<string> {
  const configured = (await effectivePublicUrl(c.env, c.env.DB)).value;
  return (configured || new URL(c.req.url).origin).replace(/\/$/, '');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function s256(verifier: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// A native app's own link scheme (RFC 8252 7.1): reverse-domain only, like family.kinwall.app:/oauth,
// so javascript:, data:, file: and other single-word schemes can never be a redirect.
const APP_SCHEME = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+:$/;

// https anywhere, http only on loopback (native/CLI clients), or an app's reverse-domain scheme.
// No fragments (RFC 6749 3.1.2).
export function redirectUriAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return APP_SCHEME.test(u.protocol);
}

function scopeFrom(requested: string | undefined | null): KeyScope | null {
  if (!requested) return 'admin';
  const parts = requested.split(/\s+/).filter(Boolean);
  if (parts.includes(SCOPES.admin)) return 'admin';
  if (parts.includes(SCOPES.display)) return 'display';
  return null;
}

function oauthError(c: Context, error: string, description: string, status: 400 | 401 = 400) {
  c.header('Cache-Control', 'no-store');
  return c.json({ error, error_description: description }, status);
}

async function getClient(db: KinwallDb, clientId: string | undefined | null): Promise<ClientRow | null> {
  if (!clientId) return null;
  return db.prepare('SELECT * FROM oauth_clients WHERE id = ?').bind(clientId).first<ClientRow>();
}

function clientHasRedirect(client: ClientRow, redirectUri: string): boolean {
  return (JSON.parse(client.redirect_uris) as string[]).includes(redirectUri);
}

export async function revokeGrant(db: KinwallDb, grantId: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM api_keys WHERE oauth_grant_id = ?').bind(grantId),
    db.prepare('DELETE FROM oauth_refresh_tokens WHERE grant_id = ?').bind(grantId),
    db.prepare('DELETE FROM oauth_grants WHERE id = ?').bind(grantId),
  ]);
}

async function issueTokens(db: KinwallDb, grant: { id: string; scope: KeyScope; clientName: string }) {
  const now = Date.now();
  const access = await createApiKey(db, grant.clientName, grant.scope, { kind: 'oauth', expiresAt: new Date(now + ACCESS_TTL_S * 1000).toISOString() });
  const refresh = randomToken();
  await db.batch([
    db.prepare('UPDATE api_keys SET oauth_grant_id = ? WHERE id = ?').bind(grant.id, access.id),
    db.prepare('INSERT INTO oauth_refresh_tokens (hash, grant_id, expires_at) VALUES (?,?,?)').bind(await sha256Hex(refresh), grant.id, new Date(now + REFRESH_TTL_MS).toISOString()),
    db.prepare('UPDATE oauth_grants SET last_used_at = ? WHERE id = ?').bind(new Date(now).toISOString(), grant.id),
    // Expired access tokens of this grant are dead weight.
    db.prepare('DELETE FROM api_keys WHERE oauth_grant_id = ? AND expires_at < ?').bind(grant.id, new Date(now).toISOString()),
  ]);
  return { access_token: access.key, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPES[grant.scope] };
}

// Discovery and the token/registration endpoints are called cross-origin by browser-based MCP
// clients. No cookies are involved anywhere, so a wildcard origin is safe.
for (const path of ['/.well-known/*', '/oauth/register', '/oauth/token', '/oauth/revoke']) {
  mcpOAuthRoutes.use(path, cors({ origin: '*', allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'OPTIONS'] }));
}

const protectedResource = async (c: Context<{ Bindings: Env }>) => {
  const base = await baseUrl(c);
  return c.json({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: Object.values(SCOPES),
    bearer_methods_supported: ['header'],
    resource_name: 'Kinwall',
  });
};
mcpOAuthRoutes.get('/.well-known/oauth-protected-resource', protectedResource);
mcpOAuthRoutes.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

const authServerMetadata = async (c: Context<{ Bindings: Env }>) => {
  const base = await baseUrl(c);
  return c.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: Object.values(SCOPES),
  });
};
mcpOAuthRoutes.get('/.well-known/oauth-authorization-server', authServerMetadata);
mcpOAuthRoutes.get('/.well-known/openid-configuration', authServerMetadata); // some clients only probe this

// RFC 7591 dynamic registration. Open by design (the spec expects it) - a registered client can do
// nothing until a signed-in admin approves it on the consent screen.
mcpOAuthRoutes.post('/oauth/register', async (c) => {
  let body: { redirect_uris?: unknown; client_name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return oauthError(c, 'invalid_client_metadata', 'body must be JSON');
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (uris.length === 0 || uris.length > 5 || uris.some((u) => u.length > 500 || !redirectUriAllowed(u))) {
    return oauthError(c, 'invalid_redirect_uri', 'redirect_uris must be 1-5 https URLs, loopback http URLs, or reverse-domain app links (like com.example.app:/oauth), without fragments');
  }
  const name = (typeof body.client_name === 'string' && body.client_name.trim().slice(0, 80)) || 'MCP client';
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)').bind(id, name, JSON.stringify(uris), createdAt),
    // Registration is unauthenticated, so never-approved registrations are pruned after a day.
    c.env.DB.prepare('DELETE FROM oauth_clients WHERE created_at < ? AND id NOT IN (SELECT client_id FROM oauth_grants) AND id NOT IN (SELECT client_id FROM oauth_codes)')
      .bind(new Date(Date.now() - 24 * 3600e3).toISOString()),
  ]);
  return c.json(
    {
      client_id: id,
      client_id_issued_at: Math.floor(Date.parse(createdAt) / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  );
});

// Validates the parts that decide where the browser may be sent, then hands off to the SPA's
// consent screen. A bad client or redirect_uri is shown as an error page, never redirected to.
mcpOAuthRoutes.get('/oauth/authorize', async (c) => {
  const q = c.req.query();
  const client = await getClient(c.env.DB, q.client_id);
  if (!client || !q.redirect_uri || !clientHasRedirect(client, q.redirect_uri)) {
    return c.html('<h1>Kinwall</h1><p>This sign-in link is invalid: unknown app or redirect address.</p>', 400);
  }
  const back = new URL(q.redirect_uri);
  if (q.state) back.searchParams.set('state', q.state);
  if (q.response_type !== 'code' || !q.code_challenge || q.code_challenge_method !== 'S256' || !scopeFrom(q.scope)) {
    back.searchParams.set('error', 'invalid_request');
    back.searchParams.set('error_description', 'response_type=code with an S256 code_challenge is required');
    return c.redirect(back.toString(), 302);
  }
  return c.redirect(`/#/authorize?${new URLSearchParams(q).toString()}`, 302);
});

// What the consent screen shows: the app's name and where it will send you afterwards.
mcpOAuthRoutes.get('/api/authorizations/request', async (c) => {
  const client = await getClient(c.env.DB, c.req.query('client_id'));
  const redirectUri = c.req.query('redirect_uri') ?? '';
  if (!client || !clientHasRedirect(client, redirectUri)) return c.json({ error: 'unknown app or redirect address' }, 400);
  // Where the consent screen says you'll return: a web address's host, or "the app" for an app link.
  const back = new URL(redirectUri);
  const redirectHost = back.protocol === 'https:' || back.protocol === 'http:' ? back.host : 'the app';
  return c.json({ clientName: client.name, redirectHost, requestedScope: scopeFrom(c.req.query('scope')) ?? 'admin' });
});

mcpOAuthRoutes.post('/api/authorizations/approve', async (c) => {
  // Only a person can approve: a passkey session or an API key - never an OAuth token itself.
  const approver = await resolveKey(c);
  if (!approver || approver.scope !== 'admin' || approver.kind === 'oauth') return c.json({ error: 'sign in as an admin to approve apps' }, 403);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, string | undefined>;
  const client = await getClient(c.env.DB, body.client_id);
  if (!client || !body.redirect_uri || !clientHasRedirect(client, body.redirect_uri)) return c.json({ error: 'unknown app or redirect address' }, 400);
  const back = new URL(body.redirect_uri);
  if (body.state) back.searchParams.set('state', body.state);
  back.searchParams.set('iss', await baseUrl(c));
  if (body.decision !== 'approve') {
    back.searchParams.set('error', 'access_denied');
    return c.json({ redirect: back.toString() });
  }
  const scope: KeyScope = body.scope === 'display' ? 'display' : 'admin';
  if (!body.code_challenge || body.code_challenge_method !== 'S256') return c.json({ error: 'S256 code_challenge required' }, 400);
  const code = randomToken();
  await c.env.DB.prepare('INSERT INTO oauth_codes (hash, client_id, scope, redirect_uri, code_challenge, approved_by, expires_at) VALUES (?,?,?,?,?,?,?)')
    .bind(await sha256Hex(code), client.id, scope, body.redirect_uri, body.code_challenge, approver.name, new Date(Date.now() + CODE_TTL_MS).toISOString())
    .run();
  back.searchParams.set('code', code);
  return c.json({ redirect: back.toString() });
});

mcpOAuthRoutes.post('/oauth/token', async (c) => {
  const type = c.req.header('Content-Type') ?? '';
  const p: Record<string, string> = type.includes('application/json')
    ? await c.req.json().catch(() => ({}))
    : Object.fromEntries(Object.entries(await c.req.parseBody().catch(() => ({}))).map(([k, v]) => [k, String(v)]));
  const db = c.env.DB;
  const now = new Date().toISOString();

  if (p.grant_type === 'authorization_code') {
    if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) return oauthError(c, 'invalid_request', 'code, code_verifier, client_id and redirect_uri are required');
    const hash = await sha256Hex(p.code);
    const row = await db.prepare('SELECT * FROM oauth_codes WHERE hash = ?').bind(hash).first<{
      client_id: string; scope: KeyScope; redirect_uri: string; code_challenge: string; approved_by: string | null; expires_at: string; grant_id: string | null;
    }>();
    if (!row) return oauthError(c, 'invalid_grant', 'unknown or expired code');
    if (row.grant_id) {
      // Replayed code: someone else may hold it. Kill everything it produced (RFC 6749 4.1.2).
      await revokeGrant(db, row.grant_id);
      return oauthError(c, 'invalid_grant', 'code already used');
    }
    if (row.expires_at < now || row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri) return oauthError(c, 'invalid_grant', 'code does not match this request');
    if ((await s256(p.code_verifier)) !== row.code_challenge) return oauthError(c, 'invalid_grant', 'PKCE verification failed');
    const client = await getClient(db, row.client_id);
    if (!client) return oauthError(c, 'invalid_client', 'unknown client');
    const grantId = crypto.randomUUID();
    await db.batch([
      db.prepare('INSERT INTO oauth_grants (id, client_id, scope, approved_by, created_at) VALUES (?,?,?,?,?)').bind(grantId, client.id, row.scope, row.approved_by, now),
      db.prepare('UPDATE oauth_codes SET grant_id = ? WHERE hash = ?').bind(grantId, hash),
      db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(new Date(Date.now() - 24 * 3600e3).toISOString()),
    ]);
    c.header('Cache-Control', 'no-store');
    return c.json(await issueTokens(db, { id: grantId, scope: row.scope, clientName: client.name }));
  }

  if (p.grant_type === 'refresh_token') {
    if (!p.refresh_token) return oauthError(c, 'invalid_request', 'refresh_token is required');
    const hash = await sha256Hex(p.refresh_token);
    const row = await db
      .prepare('SELECT r.grant_id, r.expires_at, r.used_at, g.scope, g.client_id, cl.name AS client_name FROM oauth_refresh_tokens r JOIN oauth_grants g ON g.id = r.grant_id JOIN oauth_clients cl ON cl.id = g.client_id WHERE r.hash = ?')
      .bind(hash)
      .first<{ grant_id: string; expires_at: string; used_at: string | null; scope: KeyScope; client_id: string; client_name: string }>();
    if (!row) return oauthError(c, 'invalid_grant', 'unknown refresh token');
    if (row.used_at) {
      // Rotation reuse = likely theft. Revoke the whole connection; the user re-approves.
      await revokeGrant(db, row.grant_id);
      return oauthError(c, 'invalid_grant', 'refresh token already used');
    }
    if (row.expires_at < now || (p.client_id && p.client_id !== row.client_id)) return oauthError(c, 'invalid_grant', 'refresh token expired or not for this client');
    await db.prepare('UPDATE oauth_refresh_tokens SET used_at = ? WHERE hash = ?').bind(now, hash).run();
    c.header('Cache-Control', 'no-store');
    return c.json(await issueTokens(db, { id: row.grant_id, scope: row.scope, clientName: row.client_name }));
  }

  return oauthError(c, 'unsupported_grant_type', 'use authorization_code or refresh_token');
});

// RFC 7009: revoking either token ends the whole connection. Always 200, whether or not it matched.
mcpOAuthRoutes.post('/oauth/revoke', async (c) => {
  const body = Object.fromEntries(Object.entries(await c.req.parseBody().catch(() => ({}))).map(([k, v]) => [k, String(v)]));
  const token = body.token;
  if (token) {
    const hash = await sha256Hex(token);
    const viaRefresh = await c.env.DB.prepare('SELECT grant_id FROM oauth_refresh_tokens WHERE hash = ?').bind(hash).first<{ grant_id: string }>();
    const viaAccess = viaRefresh ? null : await c.env.DB.prepare("SELECT oauth_grant_id AS grant_id FROM api_keys WHERE hash = ? AND kind = 'oauth'").bind(hash).first<{ grant_id: string | null }>();
    const grantId = viaRefresh?.grant_id ?? viaAccess?.grant_id;
    if (grantId) await revokeGrant(c.env.DB, grantId);
  }
  return c.body(null, 200);
});

// Settings → Access: connected apps. Like approve, only a person manages these - an OAuth
// token must not be able to list or revoke other apps' grants.
mcpOAuthRoutes.get('/api/authorizations', async (c) => {
  const caller = await resolveKey(c);
  if (!caller || caller.scope !== 'admin' || caller.kind === 'oauth') return c.json({ error: 'sign in as an admin to manage connected apps' }, 403);
  const { results } = await c.env.DB.prepare(
    'SELECT g.id, g.scope, g.approved_by, g.created_at, g.last_used_at, cl.name AS client_name FROM oauth_grants g JOIN oauth_clients cl ON cl.id = g.client_id ORDER BY g.created_at',
  ).all<{ id: string; scope: string; approved_by: string | null; created_at: string; last_used_at: string | null; client_name: string }>();
  return c.json(results.map((r) => ({ id: r.id, clientName: r.client_name, scope: r.scope, approvedBy: r.approved_by, createdAt: r.created_at, lastUsedAt: r.last_used_at })));
});

mcpOAuthRoutes.delete('/api/authorizations/:id', async (c) => {
  const caller = await resolveKey(c);
  if (!caller || caller.scope !== 'admin' || caller.kind === 'oauth') return c.json({ error: 'sign in as an admin to manage connected apps' }, 403);
  await revokeGrant(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});
