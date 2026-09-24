import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { encryptConfig } from '../crypto.ts';
import * as google from '../providers/google.ts';
import * as microsoft from '../providers/microsoft.ts';
import { ErrorSchema } from '../schemas.ts';

export const oauthRoutes = createRouter();

const KindSchema = z.enum(['google', 'microsoft']);

function redirectUri(env: Env, kind: string): string {
  return `${env.PUBLIC_URL ?? ''}/api/oauth/${kind}/callback`;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// PKCE (RFC 7636), S256.
function generateVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// Single-use state, storing the PKCE verifier alongside it (both consumed together in the callback).
async function saveState(db: D1Database, state: string, kind: string, verifier: string): Promise<void> {
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(`oauth_state:${state}`, JSON.stringify({ kind, expiresAt, verifier }))
    .run();
}

// Single-use: consumes (deletes) the state row if valid, returning its PKCE verifier.
async function consumeState(db: D1Database, state: string, kind: string): Promise<string | null> {
  const key = `oauth_state:${state}`;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { kind: string; expiresAt: string; verifier: string };
    if (parsed.kind !== kind || new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed.verifier;
  } catch {
    return null;
  }
}

oauthRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/oauth/{kind}/start',
    tags: ['Accounts'],
    summary: 'Start Google/Microsoft OAuth (browser redirect to provider consent, PKCE S256). Pass the API key as ?key=.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ kind: KindSchema }), query: z.object({ key: z.string() }) },
    responses: {
      302: { description: 'redirect to provider' },
      400: { description: 'bad kind', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { kind } = c.req.valid('param');
    const state = crypto.randomUUID();
    const verifier = generateVerifier();
    const challenge = await s256Challenge(verifier);
    await saveState(c.env.DB, state, kind, verifier);
    const impl = kind === 'google' ? google : microsoft;
    const url = impl.authUrl(c.env, redirectUri(c.env, kind), state, challenge);
    return c.redirect(url, 302);
  },
);

oauthRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/oauth/{kind}/callback',
    tags: ['Accounts'],
    summary: 'OAuth callback (no auth; called by the provider). Creates the account and redirects to the UI.',
    request: { params: z.object({ kind: KindSchema }), query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }) },
    responses: {
      302: { description: 'redirect to UI' },
      400: { description: 'bad request', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'server misconfigured', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { kind } = c.req.valid('param');
    const { code, state, error } = c.req.valid('query');
    if (error || !code || !state) return c.json({ error: error ?? 'missing code/state' }, 400);
    const verifier = await consumeState(c.env.DB, state, kind);
    if (!verifier) return c.json({ error: 'invalid or expired state' }, 400);

    const impl = kind === 'google' ? google : microsoft;
    let exchanged: { name: string; config: unknown };
    try {
      exchanged = await impl.exchangeCode(c.env, code, redirectUri(c.env, kind), verifier);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'oauth exchange failed' }, 400);
    }

    let id: string;
    try {
      id = await saveOAuthAccount(c.env, kind, exchanged.name, exchanged.config);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'encryption not configured' }, 500);
    }
    emit(c, 'calendar.changed', { accountId: id });
    return c.redirect(`${c.env.PUBLIC_URL ?? ''}/#/settings?account=${id}`, 302);
  },
);

/** Reconnecting an account that already exists (same provider + email, e.g. after a revoked
 * token) refreshes its tokens in place, keeping its calendars; only a new email adds an account. */
export async function saveOAuthAccount(env: Env, kind: string, name: string, tokens: unknown): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM accounts WHERE kind = ? AND lower(name) = lower(?)')
    .bind(kind, name)
    .first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const config = await encryptConfig(env, id, tokens); // row id is the AAD, so encrypt per row
  if (existing) {
    await env.DB.prepare('UPDATE accounts SET config = ? WHERE id = ?').bind(config, id).run();
  } else {
    await env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
      .bind(id, kind, name, config, new Date().toISOString())
      .run();
  }
  return id;
}
