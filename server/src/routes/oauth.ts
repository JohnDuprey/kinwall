import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { encryptConfig } from '../crypto.ts';
import * as google from '../providers/google.ts';
import * as microsoft from '../providers/microsoft.ts';
import { providerEnv, providerSource, redirectUri } from '../providers/config.ts';
import { ErrorSchema } from '../schemas.ts';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { DEVICE_APP_SCHEME, sha256Hex, timingSafeEqual } from '../auth.ts';
import { esc } from './recipe-share.ts';
import type { ProviderEnv } from '../providers/types.ts';
import { finishGooglePhotosWeb } from './google-photos.ts';

export const oauthRoutes = createRouter();

const KindSchema = z.enum(['google', 'microsoft']);

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

// Single-use state, storing the PKCE verifier and the redirect_uri start sent (the token exchange
// must repeat it exactly) alongside it - all consumed together in the callback.
// purpose 'photos': Google Photos' own sign-in (routes/google-photos.ts), through the same client and
// callback as Calendar; the callback hands it back there instead of making a calendar account.
async function saveState(db: KinwallDb, state: string, kind: string, verifier: string, redirectUri: string, purpose?: 'photos'): Promise<void> {
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(`oauth_state:${state}`, JSON.stringify({ kind, expiresAt, verifier, redirectUri, purpose }))
    .run();
}

type StoredState = { verifier: string; redirectUri?: string; purpose?: 'photos' };

async function isPhotosState(db: KinwallDb, state: string): Promise<boolean> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(`oauth_state:${state}`).first<{ value: string }>();
  try {
    return !!row && JSON.parse(row.value).purpose === 'photos';
  } catch {
    return false;
  }
}

// Single-use: consumes (deletes) the state row if valid, returning its PKCE verifier + redirect_uri.
async function consumeState(db: KinwallDb, state: string, kind: string): Promise<StoredState | null> {
  const key = `oauth_state:${state}`;
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { kind: string; expiresAt: string } & StoredState;
    if (parsed.kind !== kind || new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return { verifier: parsed.verifier, redirectUri: parsed.redirectUri, purpose: parsed.purpose };
  } catch {
    return null;
  }
}

oauthRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/oauth/{kind}/start',
    tags: ['Accounts'],
    summary: "Start connecting a Google/Microsoft calendar account (parent devices): returns the provider's consent URL (PKCE S256) and sets a short-lived cookie. Open the URL in the browser that made this call: the callback only finishes there.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ kind: KindSchema }) },
    responses: {
      200: { description: "the provider's consent URL", content: { 'application/json': { schema: z.object({ url: z.string() }) } } },
      400: { description: 'bad kind', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { kind } = c.req.valid('param');
    const penv = await providerEnv(c.env, c.env.DB);
    // Shared-app host (OAUTH_REDIRECT_URI + the host's env credentials): the provider calls back
    // to the host's one fixed URI, which routes on the state prefix "<hostLabel>.<kind>." and
    // redirects the browser, query intact, to this instance's /api/oauth/{kind}/callback (SPEC
    // "Embedding the server"). A household using its own app keeps its own per-instance redirect URI.
    // A POST with the key in the Authorization header, never a link: a link (or a page that sends a
    // browser to one) would hand the flow, and its cookie, to whoever opens it.
    const { state, redirect, challenge } = await newState(c, kind, penv);
    const impl = kind === 'google' ? google : microsoft;
    return c.json({ url: impl.authUrl(penv, redirect, state, challenge) }, 200);
  },
);

// A flow belongs to the browser that started it: start hands that browser a cookie holding a hash
// of the state, and the callback finishes only for a request carrying it. Without this, whoever
// started a flow could pass the provider's consent link to someone else, whose account would then
// be connected here (on a shared-app host: to another family).
// - One cookie per flow (the name carries the start of the hash), so two tabs don't clash.
// - Path is the callback as the browser sees it: PUBLIC_URL's path (a proxy may serve the app under
//   a prefix this server never sees); on a shared-app host, the family host's own callback, where
//   the host redirects the browser (SPEC "Embedding the server").
// - Secure (and the __Secure- prefix) follow the callback URL's scheme, not the request's: behind
//   a TLS-terminating proxy the request arrives as http while the browser is on https, and plain
//   http on a LAN must still work.
// Started at one address and returned to another (the LAN address vs PUBLIC_URL, Home Assistant
// ingress vs PUBLIC_URL, another browser): no cookie arrives, the callback refuses and says so.
async function flowTarget(c: Context<{ Bindings: Env }>, kind: 'google' | 'microsoft', penv: ProviderEnv) {
  const shared = !!c.env.OAUTH_REDIRECT_URI && (await providerSource(c.env, c.env.DB, kind)) === 'env';
  const redirect = shared ? c.env.OAUTH_REDIRECT_URI! : redirectUri(penv.PUBLIC_URL, kind);
  const url = new URL(redirect, c.req.url);
  const cookie = { path: shared ? `/api/oauth/${kind}/callback` : url.pathname, secure: url.protocol === 'https:', httpOnly: true, sameSite: 'Lax' as const };
  return { shared, redirect, cookie };
}

async function bindingCookie(state: string, secure: boolean): Promise<{ name: string; value: string }> {
  const value = await sha256Hex(state);
  return { name: `${secure ? '__Secure-' : ''}kinwall_oauth_${value.slice(0, 16)}`, value };
}

async function newState(c: Context<{ Bindings: Env }>, kind: 'google' | 'microsoft', penv: ProviderEnv, purpose?: 'photos') {
  const { shared, redirect, cookie } = await flowTarget(c, kind, penv);
  const hostLabel = new URL(c.req.url).hostname.split('.')[0];
  const state = shared ? `${hostLabel}.${kind}.${crypto.randomUUID()}` : crypto.randomUUID();
  const verifier = generateVerifier();
  const challenge = await s256Challenge(verifier);
  await saveState(c.env.DB, state, kind, verifier, redirect, purpose);
  const { name, value } = await bindingCookie(state, cookie.secure);
  setCookie(c, name, value, { ...cookie, maxAge: STATE_TTL_MS / 1000 });
  return { state, redirect, challenge };
}

/** Google Photos' web sign-in (routes/google-photos.ts): Calendar's client, redirect URI and
 * callback, asking for the Photos scope alone. Returns Google's consent URL, and sets the flow's
 * cookie on `c`'s response: the caller answers the browser that will open that URL. */
export async function googlePhotosAuthUrl(c: Context<{ Bindings: Env }>, scope: string): Promise<string> {
  const penv = await providerEnv(c.env, c.env.DB);
  const { state, redirect, challenge } = await newState(c, 'google', penv, 'photos');
  return google.authUrl(penv, redirect, state, challenge, scope);
}

oauthRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/oauth/{kind}/callback',
    tags: ['Accounts'],
    summary: "OAuth callback (no API key; the provider sends the browser here, which must carry the cookie start gave it). Creates the account and redirects to the UI. Without the cookie: a page handing the code back to the Kinwall app (family.kinwall.app:/provider-return?kind=&state=&code=), nothing used up.",
    request: { params: z.object({ kind: KindSchema }), query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional() }) },
    responses: {
      200: { description: "the flow's cookie is missing (another browser, or the Kinwall app's in-app browser): a page with an Open in the Kinwall app link", content: { 'text/html': { schema: z.string() } } },
      302: { description: 'redirect to the UI: Settings → Calendars, with ?account=<id> on success or ?oauthError=<kind>:<reason> otherwise (a declined consent is "canceled")' },
    },
  }),
  async (c) => {
    const { kind } = c.req.valid('param');
    const { code, state, error } = c.req.valid('query');
    const penv = await providerEnv(c.env, c.env.DB);
    // The browser lands here straight from the provider, so a failure must go back to the app
    // (Settings → Calendars shows it), never a bare JSON page. A declined consent is the common case.
    const back = (message: string, status: 400 | 500 = 400) =>
      c.redirect(`${penv.PUBLIC_URL ?? ''}/#/settings?tab=calendars&oauthError=${encodeURIComponent(`${kind}:${status === 500 ? 'server: ' : ''}${message}`)}`, 302);
    // Only the browser that started this flow may finish it (flowTarget). Checked before the state
    // is consumed, so someone else's attempt doesn't use up the real one.
    const { cookie } = await flowTarget(c, kind, penv);
    const binding = state ? await bindingCookie(state, cookie.secure) : undefined;
    const bound = !!binding && timingSafeEqual(getCookie(c, binding.name) ?? '', binding.value);
    const elsewhere = () => (code && state ? handBack(c, kind, state, code, penv.PUBLIC_URL, purpose) : back(ELSEWHERE));
    // Google Photos' own sign-in (its state says so) finishes there, a refusal included.
    const purpose = state && (await isPhotosState(c.env.DB, state)) ? ('photos' as const) : undefined;
    if (state && purpose) {
      if (!bound) return elsewhere();
      deleteCookie(c, binding!.name, cookie);
      const stored = await consumeState(c.env.DB, state, kind);
      const outcome = stored ? await finishGooglePhotosWeb(c, { code, error, redirectUri: stored.redirectUri ?? redirectUri(penv.PUBLIC_URL, kind), verifier: stored.verifier }) : 'failed';
      return c.redirect(`${penv.PUBLIC_URL ?? ''}/#/settings?googlePhotos=${outcome}`, 302);
    }
    if (error) return back(error === 'access_denied' || error === 'consent_required' ? 'canceled' : error);
    if (!code || !state) return back('missing code/state');
    if (!bound) return elsewhere();
    deleteCookie(c, binding!.name, cookie);
    const stored = await consumeState(c.env.DB, state, kind);
    if (!stored) return back('invalid or expired state');

    const impl = kind === 'google' ? google : microsoft;
    let exchanged: { name: string; config: unknown };
    try {
      exchanged = await impl.exchangeCode(penv, code, stored.redirectUri ?? redirectUri(penv.PUBLIC_URL, kind), stored.verifier);
    } catch (err) {
      return back(err instanceof Error ? err.message : 'oauth exchange failed');
    }

    let id: string;
    try {
      id = await saveOAuthAccount(c.env, kind, exchanged.name, exchanged.config);
    } catch (err) {
      return back(err instanceof Error ? err.message : 'encryption not configured', 500);
    }
    emit(c, 'calendar.changed', { accountId: id });
    return c.redirect(`${penv.PUBLIC_URL ?? ''}/#/settings?account=${id}`, 302);
  },
);

const ELSEWHERE = 'this sign-in was started in a different browser or at a different address. Connect again from here';

/** Kinwall's phone app (kinwall-mobile) starts a sign-in in its web view but shows the provider in
 * the system's in-app browser, which has its own cookies: the callback lands there without the
 * flow's cookie. Rather than only refusing, this page offers the code and state back to the app
 * (family.kinwall.app:/provider-return, a path apart from its own sign-in's /oauth), which loads
 * this callback in its web view, on its own family's address, where the cookie is. Nothing is
 * used up here, and the code alone is no use: the token exchange needs this server's PKCE
 * verifier, and finishing needs the cookie. A tap, never an automatic jump: in a browser without
 * the app a custom-scheme link does nothing, and the page still says what to do.
 * Everything from the query is escaped; no script, its own policy (app.ts leaves it alone). */
function handBack(c: Context<{ Bindings: Env }>, kind: string, state: string, code: string, publicUrl: string | undefined, purpose?: 'photos') {
  const link = `${DEVICE_APP_SCHEME}/provider-return?${new URLSearchParams({ kind, state, code })}`;
  const settings = `${publicUrl ?? ''}/#/settings${purpose ? '' : '?tab=calendars'}`;
  const what = purpose ? 'Google Photos' : kind === 'google' ? 'your Google account' : 'your Microsoft account';
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Finish in the Kinwall app</title><style nonce="${nonce}">${HAND_BACK_CSS}</style></head><body><main>
<h1>Finish connecting in the Kinwall app</h1>
<p>Started connecting ${esc(what)} in the Kinwall app? Tap below to finish there.</p>
<p><a class="btn" href="${esc(link)}">Open in the Kinwall app</a></p>
<p class="hint">If nothing happens, update the Kinwall app, or connect from a web browser instead.</p>
<h2>Not using the app?</h2>
<p>This sign-in was started in a different browser or at a different address, so it can't finish here. <a href="${esc(settings)}">Go back to Kinwall</a> and connect again from this browser.</p>
</main></body></html>`;
  return c.html(html, 200, {
    'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Cache-Control': 'no-store',
  });
}
const HAND_BACK_CSS = `:root{color-scheme:light dark;--bg:#f6f4ef;--text:#1d2420;--dim:#5b645f;--accent:#2f6f5e;--ink:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#141816;--text:#e9ede9;--dim:#a3aca7;--accent:#7cc4ad;--ink:#0d1210}}
body{margin:0;background:var(--bg);color:var(--text);font:17px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:34rem;margin:0 auto;padding:40px 16px}h1{font-size:1.5rem;line-height:1.25}h2{font-size:1.1rem;margin-top:36px}
a{color:inherit;text-underline-offset:3px}.hint{color:var(--dim);font-size:.95rem}
.btn{display:inline-flex;align-items:center;min-height:48px;padding:10px 22px;border-radius:999px;background:var(--accent);color:var(--ink);font-weight:800;text-decoration:none}`;

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
