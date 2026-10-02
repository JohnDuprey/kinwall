// The calendar OAuth callback only finishes in the browser that started the flow: start (a POST
// with the key in the Authorization header, so a link can't do it) sets a short-lived cookie
// holding a hash of the state, and the callback needs it before it consumes the state. Without it,
// the callback hands the code back to the Kinwall app, which replays it in its own web view, where
// the cookie is. (Google Photos' web sign-in, the same path: google-photos.test.ts.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { sha256Hex } from '../src/auth.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'kw_test_binding_admin';
const GOOGLE = { GOOGLE_CLIENT_ID: 'fake-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'fake-secret' };

function setup(overrides: Partial<Env> = {}, origin = 'https://kinwall.example') {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', PUBLIC_URL: origin, ...GOOGLE, ...overrides };
  const app = createApp();
  /** A browser starting the flow: the provider's consent URL, the state, and the cookies it was handed. */
  const start = async (kind = 'google') => {
    const res = await app.request(`${origin}/api/oauth/${kind}/start`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_KEY}` } }, env);
    assert.equal(res.status, 200);
    const state = new URL(((await res.json()) as { url: string }).url).searchParams.get('state')!;
    return { state, setCookies: res.headers.getSetCookie(), cookie: res.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ') };
  };
  const raw = (path: string, init: RequestInit = {}) => app.request(`${origin}${path}`, { redirect: 'manual', ...init }, env);
  /** The provider sending a browser back, with whatever cookies that browser holds. */
  const callback = (state: string, cookie?: string, kind = 'google') =>
    app.request(`${origin}/api/oauth/${kind}/callback?code=c&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} }, env);
  const stateRows = async () => (await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'oauth_state:%'").first<{ n: number }>())!.n;
  const accounts = async () => (await db.prepare('SELECT COUNT(*) AS n FROM accounts').first<{ n: number }>())!.n;
  return { env, start, raw, callback, stateRows, accounts };
}

async function withProvider<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (url: unknown) =>
    String(url).includes('token') ? Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }) : Response.json({ email: `kid${++n}@example.com` })) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const attrs = (setCookie: string) => setCookie.split('; ').slice(1).sort();
/** The hand-back page (a callback without the cookie): the app link it offers, or null. */
async function handBack(res: Response): Promise<string | null> {
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /^text\/html/);
  const m = /href="(family\.kinwall\.app:[^"]*)"/.exec(await res.text());
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

test('oauth binding: start sets a short-lived, HttpOnly, callback-only cookie holding a hash of the state', async () => {
  const t = setup();
  const { state, setCookies } = await t.start();
  assert.equal(setCookies.length, 1);
  const hash = await sha256Hex(state);
  assert.equal(setCookies[0].split(';')[0], `__Secure-kinwall_oauth_${hash.slice(0, 16)}=${hash}`);
  assert.deepEqual(attrs(setCookies[0]), ['HttpOnly', 'Max-Age=600', 'Path=/api/oauth/google/callback', 'SameSite=Lax', 'Secure']);
  assert.ok(!setCookies[0].includes(state), 'the state itself stays out of the cookie jar');
});

test('oauth binding: plain http (a LAN address) gets no Secure and no __Secure- prefix; a path prefix in PUBLIC_URL is in Path', async () => {
  const lan = setup({}, 'http://192.168.1.20:8080');
  const a = (await lan.start()).setCookies[0];
  assert.match(a, /^kinwall_oauth_[0-9a-f]{16}=[0-9a-f]{64};/);
  assert.deepEqual(attrs(a), ['HttpOnly', 'Max-Age=600', 'Path=/api/oauth/google/callback', 'SameSite=Lax']);

  // Behind a TLS-terminating proxy under a path: the request arrives as http at /api/…, but the
  // browser is where PUBLIC_URL says, and that is where the callback (and so the cookie) goes.
  const db = setup({ PUBLIC_URL: 'https://home.example/kinwall' }, 'http://10.0.0.5:8080');
  const b = (await db.start()).setCookies[0];
  assert.match(b, /^__Secure-kinwall_oauth_/);
  assert.deepEqual(attrs(b), ['HttpOnly', 'Max-Age=600', 'Path=/kinwall/api/oauth/google/callback', 'SameSite=Lax', 'Secure']);
});

test('oauth binding: a callback without the cookie, or with another flow\'s, is refused and the state survives; the right one finishes and clears it', async () => {
  const t = setup();
  await withProvider(async () => {
    const { state, cookie } = await t.start();
    const other = await t.start(); // e.g. the attacker's own browser, or another flow here

    for (const jar of [undefined, other.cookie, `${cookie.split('=')[0]}=${'0'.repeat(64)}`]) {
      assert.ok(await handBack(await t.callback(state, jar)), 'refused, with the hand-back to the app');
    }
    assert.equal(await t.accounts(), 0);
    assert.equal(await t.stateRows(), 2, 'a refused callback does not consume the state');

    const ok = await t.callback(state, cookie);
    assert.match(ok.headers.get('location')!, /^https:\/\/kinwall\.example\/#\/settings\?account=/);
    assert.equal(await t.accounts(), 1);
    assert.equal(await t.stateRows(), 1);
    const cleared = ok.headers.getSetCookie();
    assert.equal(cleared.length, 1);
    assert.ok(cleared[0].startsWith(`${cookie.split('=')[0]}=;`), cleared[0]);
    assert.ok(attrs(cleared[0]).includes('Max-Age=0') && attrs(cleared[0]).includes('Path=/api/oauth/google/callback'), cleared[0]);

    // Single use still holds, cookie or not.
    assert.match((await t.callback(state, cookie)).headers.get('location')!, /oauthError=google%3Ainvalid/);
  });
});

test('oauth binding: two flows started in the same browser (two tabs) both finish', async () => {
  const t = setup();
  await withProvider(async () => {
    const a = await t.start();
    const b = await t.start();
    const jar = `${a.cookie}; ${b.cookie}`;
    assert.match((await t.callback(b.state, jar)).headers.get('location')!, /settings\?account=/);
    assert.match((await t.callback(a.state, jar)).headers.get('location')!, /settings\?account=/);
    assert.equal(await t.accounts(), 2);
  });
});

test('oauth binding: on a shared-app host the cookie is for the family host\'s own callback path', async () => {
  const t = setup({ OAUTH_REDIRECT_URI: 'https://app.host.example/oauth/callback' }, 'https://smiths.host.example');
  await withProvider(async () => {
    const { state, setCookies, cookie } = await t.start();
    assert.match(state, /^smiths\.google\./);
    assert.deepEqual(attrs(setCookies[0]), ['HttpOnly', 'Max-Age=600', 'Path=/api/oauth/google/callback', 'SameSite=Lax', 'Secure']);
    // The host sends the browser itself here (a redirect, not a server-side forward), so its cookie comes along.
    assert.ok(await handBack(await t.callback(state)));
    assert.match((await t.callback(state, cookie)).headers.get('location')!, /settings\?account=/);
  });
});

test('oauth start: only a POST with the key in the Authorization header starts a flow; a link (GET, ?key=) or a form can\'t', async () => {
  const t = setup();
  const noCookie = (res: Response) => assert.deepEqual(res.headers.getSetCookie(), [], 'no flow cookie');
  const get = await t.raw(`/api/oauth/google/start?key=${ADMIN_KEY}`);
  assert.ok(get.status >= 400, `GET start is gone (${get.status})`);
  noCookie(get);
  const queryKey = await t.raw(`/api/oauth/google/start?key=${ADMIN_KEY}`, { method: 'POST' });
  assert.equal(queryKey.status, 401, 'the key is never taken from the URL');
  noCookie(queryKey);
  const form = await t.raw('/api/oauth/google/start', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `key=${ADMIN_KEY}` });
  assert.equal(form.status, 401, 'nor from a form body');
  noCookie(form);
  assert.equal(await t.stateRows(), 0);

  const bad = await t.raw('/api/oauth/yahoo/start', { method: 'POST', headers: { Authorization: `Bearer ${ADMIN_KEY}` } });
  assert.equal(bad.status, 400);
});

test('oauth start: parent devices only; a wall display and a connected app are refused', async () => {
  const t = setup();
  const admin = { Authorization: `Bearer ${ADMIN_KEY}` };
  const display = (await (await t.raw('/api/keys', { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'wall', scope: 'display' }) })).json()) as { key: string };
  const wall = await t.raw('/api/oauth/google/start', { method: 'POST', headers: { Authorization: `Bearer ${display.key}` } });
  assert.equal(wall.status, 403);
  assert.deepEqual(wall.headers.getSetCookie(), []);
  const app = await t.raw('/api/oauth/google/start', { method: 'POST', headers: { ...admin, 'X-Kinwall-Source': 'mcp' } });
  assert.equal(app.status, 403);
  assert.deepEqual(app.headers.getSetCookie(), []);
  assert.equal(await t.stateRows(), 0);
});

test('oauth start: another site can\'t make a browser start a flow with its key (CORS)', async () => {
  const preflight = (t: ReturnType<typeof setup>, origin: string) =>
    t.raw('/api/oauth/google/start', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
  // Default (no CORS_ORIGINS): no CORS headers at all, so a cross-site fetch with an Authorization
  // header fails its preflight and is never sent.
  const plain = setup();
  const p = await preflight(plain, 'https://evil.example');
  assert.equal(p.headers.get('access-control-allow-origin'), null);
  assert.equal(p.headers.get('access-control-allow-credentials'), null);
  // CORS_ORIGINS lets listed origins call the API with a key, never with credentials: a browser
  // drops Set-Cookie from a cross-origin response without Access-Control-Allow-Credentials.
  const listed = setup({ CORS_ORIGINS: 'https://dashboard.example' });
  assert.equal((await preflight(listed, 'https://evil.example')).headers.get('access-control-allow-origin'), null);
  const ok = await preflight(listed, 'https://dashboard.example');
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://dashboard.example');
  assert.equal(ok.headers.get('access-control-allow-credentials'), null);
  const res = await listed.raw('/api/oauth/google/start', { method: 'POST', headers: { Origin: 'https://dashboard.example', Authorization: `Bearer ${ADMIN_KEY}` } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-credentials'), null);
});

test('oauth hand-back: a callback without the cookie offers the Kinwall app link, escaped, under its own strict policy, and leaves the state alone', async () => {
  const t = setup();
  const { state, cookie } = await t.start();
  const code = '4/0AX"><script>alert(1)</script>&x=1';
  const res = await t.raw(`/api/oauth/google/callback?${new URLSearchParams({ code, state })}`);
  const html = await res.clone().text();
  const link = await handBack(res);
  assert.ok(link);
  const u = new URL(link.replace(/^family\.kinwall\.app:\//, 'https://app/'));
  assert.equal(u.pathname, '/provider-return');
  assert.deepEqual(Object.fromEntries(u.searchParams), { kind: 'google', state, code });
  assert.ok(!html.includes('<script'), 'nothing from the query is rendered as markup');
  assert.match(html, /different browser/);
  assert.match(html, /update the Kinwall app/);
  assert.match(html, /href="https:\/\/kinwall\.example\/#\/settings\?tab=calendars"/);
  const csp = res.headers.get('content-security-policy')!;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /style-src 'nonce-[0-9a-f]{32}'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/script-src/.test(csp), 'no script at all');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await t.stateRows(), 1, 'nothing used up');

  // The app replays the link's code and state in its web view, where the cookie is.
  await withProvider(async () => {
    const replay = await t.callback(state, cookie);
    assert.match(replay.headers.get('location')!, /settings\?account=/);
  });
});

test('oauth hand-back: a declined consent or a missing code still goes back to Settings', async () => {
  const t = setup();
  const { state } = await t.start();
  const declined = await t.raw(`/api/oauth/google/callback?error=access_denied&state=${state}`);
  assert.match(declined.headers.get('location')!, /oauthError=google%3Acanceled$/);
  const noState = await t.raw('/api/oauth/google/callback?code=c');
  assert.match(noState.headers.get('location')!, /oauthError=google%3Amissing/);
  assert.equal(await t.stateRows(), 1);
});
