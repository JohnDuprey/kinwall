// Media tokens (GET /api/media-token) and photo download links (POST /api/photos/export-link):
// what an <img src> or a download link carries instead of the caller's full key, so a full key
// never lands in browser history or access logs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function setup(envOver: Partial<Env> = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'https://kinwall.example', ENCRYPTION_KEY, ...envOver } as Env;
  const app = createApp();
  const req = async (p: string, init: RequestInit & { key?: string | null } = {}) => {
    const { key = ADMIN_KEY, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (typeof rest.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return app.request(p, { ...rest, headers }, env);
  };
  const send = async (method: string, p: string, body?: unknown, key: string | null = ADMIN_KEY) => {
    const res = await req(p, { method, key, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  /** An <img src>: no header, the credential rides as ?key=. */
  const img = (p: string, key: string, method = 'GET') => req(`${p}${p.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`, { method, key: null });
  const tokenFor = async (key: string) => (await send('GET', '/api/media-token', undefined, key)).body?.token as string | null;
  const form = (fields: Record<string, string>) => ({ method: 'POST', key: null, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });
  return { env, db, req, send, img, tokenFor, form };
}
type T = ReturnType<typeof setup>;

const newKey = async (t: T, scope: 'admin' | 'display') => (await t.send('POST', '/api/keys', { name: scope === 'admin' ? 'Laptop' : 'Wall', scope })).body as { id: string; key: string };

// The remote images (recipe photos, book covers) come from the network: answer every fetch with a JPEG.
function mockImages() {
  globalThis.fetch = (async () => new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } })) as typeof fetch;
}

/** One of every image route, with something to show. */
async function images(t: T) {
  const photo = (await t.req('/api/photos', { method: 'POST', body: JPEG, headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Width': '4', 'X-Photo-Height': '3' } }).then((r) => r.json())) as any;
  const recipe = (await t.send('POST', '/api/recipes', { name: 'Tacos', imageUrl: 'https://images.example.com/tacos.jpg', steps: [{ text: 'Warm the tortillas', imageUrl: 'https://images.example.com/step.jpg' }] })).body;
  const meal = (await t.send('POST', '/api/meals', { date: '2026-10-05', slot: 'dinner', recipeId: recipe.id })).body;
  const book = (await t.send('POST', '/api/trackers', { kind: 'reading', title: 'Matilda', data: { coverUrl: 'https://covers.example.com/matilda.jpg' } })).body;
  return [`/api/photos/${photo.id}/image`, `/api/recipes/${recipe.id}/image`, `/api/meals/${meal.id}/image`, `/api/recipes/${recipe.id}/steps/1/image`, `/api/trackers/${book.id}/cover`, '/api/books/covers/12345'];
}

const pkce = () => {
  const verifier = Buffer.from(randomBytes(32)).toString('base64url');
  return { verifier, challenge: Buffer.from(createHash('sha256').update(verifier).digest()).toString('base64url') };
};
/** A connected app (Claude) signs in: its hourly access token and its refresh token. */
async function connectApp(t: T) {
  const reg = (await t.send('POST', '/oauth/register', { client_name: 'Claude', redirect_uris: [REDIRECT] }, null)).body;
  const { verifier, challenge } = pkce();
  const approved = (await t.send('POST', '/api/authorizations/approve', { decision: 'approve', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's' })).body;
  const code = new URL(approved.redirect).searchParams.get('code')!;
  const tok = (await t.req('/oauth/token', t.form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT })).then((r) => r.json())) as any;
  return { access: tok.access_token as string, refresh: tok.refresh_token as string, clientId: reg.client_id as string };
}

test('media token: works as ?key= on every image route and serves the same bytes as the header', async () => {
  const t = setup();
  mockImages();
  const paths = await images(t);
  const laptop = await newKey(t, 'admin');
  const token = await t.tokenFor(laptop.key);
  assert.match(token!, /^km_/);
  assert.ok(!token!.includes(laptop.key), 'the full key is nowhere in it');
  assert.equal(await t.tokenFor(laptop.key), token, 'stable for the sign-in, so image URLs and the browser cache stay put');
  for (const p of paths) {
    const viaKey = await t.req(p, { key: laptop.key });
    const viaToken = await t.img(p, token!);
    assert.equal(viaToken.status, 200, p);
    assert.deepEqual(new Uint8Array(await viaToken.arrayBuffer()), new Uint8Array(await viaKey.arrayBuffer()), p);
  }
});

test('a full key in the URL: refused on every image route and on the photo zip; the header still works', async () => {
  const t = setup();
  mockImages();
  const paths = await images(t);
  const laptop = await newKey(t, 'admin');
  const wall = await newKey(t, 'display');
  for (const p of paths) {
    for (const key of [ADMIN_KEY, laptop.key, wall.key]) assert.equal((await t.img(p, key)).status, 401, `${p} with a full key`);
    assert.equal((await t.req(p, { key: laptop.key })).status, 200, `${p} with the header`);
  }
  assert.equal((await t.img('/api/photos/export.zip', ADMIN_KEY)).status, 401);
  assert.equal((await t.img('/api/photos/export.zip', laptop.key)).status, 401);
  const zip = await t.req('/api/photos/export.zip', { key: laptop.key });
  assert.equal(zip.status, 200);
  await zip.arrayBuffer();
});

test('media token: refused as a Bearer header, on other routes and methods, on the OAuth start and on the photo zip', async () => {
  const t = setup();
  mockImages();
  const [photo] = await images(t);
  const token = (await t.tokenFor((await newKey(t, 'admin')).key))!;
  assert.equal((await t.req(photo, { key: token })).status, 401, 'never as a Bearer header, even on an image route');
  assert.equal((await t.req('/api/settings', { key: token })).status, 401);
  assert.equal((await t.req('/api/media-token', { key: token })).status, 401, "can't mint itself another one");
  for (const p of ['/api/settings', '/api/photos', '/api/me', '/api/oauth/google/start', '/api/photos/export.zip', '/api/recipes']) {
    assert.equal((await t.img(p, token)).status, 401, p);
  }
  for (const method of ['DELETE', 'PATCH', 'PUT', 'POST']) assert.equal((await t.img(photo, token, method)).status, 401, method);
  assert.equal((await t.img(photo.replace('/image', ''), token, 'DELETE')).status, 401, 'nor DELETE /api/photos/{id}');
});

test('media token: a wall display keeps its limits and a connected app stays a connected app', async () => {
  const t = setup();
  mockImages();
  const [photo] = await images(t);
  const checkup = (await t.send('POST', '/api/trackers', { kind: 'health', title: 'Checkup', data: { type: 'checkup' } })).body;
  const cover = `/api/trackers/${checkup.id}/cover`;

  const wall = await newKey(t, 'display');
  const wallToken = (await t.tokenFor(wall.key))!;
  assert.ok(wallToken, 'display keys get one too');
  assert.equal((await t.img(photo, wallToken)).status, 200);
  assert.equal((await t.req(cover, { key: wall.key })).status, 403);
  assert.equal((await t.img(cover, wallToken)).status, 403, 'a health entry stays off the wall');

  const app = await connectApp(t);
  const appToken = (await t.tokenFor(app.access))!;
  assert.ok(appToken);
  assert.equal((await t.req(cover, { key: app.access })).status, 403);
  assert.equal((await t.img(cover, appToken)).status, 403, 'health stays away from connected apps');
  assert.equal((await t.img(cover, (await t.tokenFor(ADMIN_KEY))!)).status, 404, "the family's own device gets past the health check (and finds no cover)");
  assert.equal((await t.img(photo, appToken)).status, 200);
});

test('media token: revoking the key, the passkey, the sign-in or the connected app ends it at once', async () => {
  const t = setup();
  mockImages();
  const [photo] = await images(t);

  const laptop = await newKey(t, 'admin');
  const laptopToken = (await t.tokenFor(laptop.key))!;
  assert.equal((await t.img(photo, laptopToken)).status, 200);
  assert.equal((await t.send('DELETE', `/api/keys/${laptop.id}`)).status, 200);
  assert.equal((await t.img(photo, laptopToken)).status, 401, 'deleted key');

  const now = new Date().toISOString();
  await t.db.prepare('INSERT INTO passkeys (id, credential_id, public_key, name, created_at) VALUES (?,?,?,?,?)').bind('pk1', 'cred1', 'pub1', "Alex's phone", now).run();
  const session = await createApiKey(t.env.DB, "Passkey: Alex's phone", 'admin', { kind: 'session', expiresAt: new Date(Date.now() + 864e5).toISOString(), passkeyId: 'pk1' });
  const sessionToken = (await t.tokenFor(session.key))!;
  assert.equal((await t.img(photo, sessionToken)).status, 200);
  assert.equal((await t.send('DELETE', '/api/passkeys/pk1')).status, 200);
  assert.equal((await t.img(photo, sessionToken)).status, 401, 'removed passkey');

  const recovery = await createApiKey(t.env.DB, 'Recovery code', 'admin', { kind: 'session', expiresAt: new Date(Date.now() + 864e5).toISOString() });
  const recoveryToken = (await t.tokenFor(recovery.key))!;
  assert.equal((await t.img(photo, recoveryToken)).status, 200);
  await t.db.prepare('UPDATE api_keys SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), recovery.id).run();
  assert.equal((await t.img(photo, recoveryToken)).status, 401, 'expired sign-in');

  const signedIn = await createApiKey(t.env.DB, 'Recovery code', 'admin', { kind: 'session', expiresAt: new Date(Date.now() + 864e5).toISOString() });
  const signedInToken = (await t.tokenFor(signedIn.key))!;
  assert.equal((await t.send('POST', '/api/sessions/logout', undefined, signedIn.key)).status, 200);
  assert.equal((await t.img(photo, signedInToken)).status, 401, 'signed out');

  const app = await connectApp(t);
  const appToken = (await t.tokenFor(app.access))!;
  const grant = ((await t.send('GET', '/api/authorizations')).body as any[])[0];
  assert.equal((await t.send('DELETE', `/api/authorizations/${grant.id}`)).status, 200);
  assert.equal((await t.img(photo, appToken)).status, 401, 'disconnected app');
});

test("media token: an app's hourly key refreshing keeps the same token working; a lapsed refresh token ends it", async () => {
  const t = setup();
  mockImages();
  const [photo] = await images(t);
  const app = await connectApp(t);
  const token = (await t.tokenFor(app.access))!;

  // The hour is up and the app hasn't refreshed yet (asleep): its sign-in is still alive.
  await t.db.prepare("UPDATE api_keys SET expires_at = ? WHERE kind = 'oauth'").bind(new Date(Date.now() - 1000).toISOString()).run();
  assert.equal((await t.req(photo, { key: app.access })).status, 401, 'the hourly key itself has lapsed');
  assert.equal((await t.img(photo, token)).status, 200, 'images keep loading until the app refreshes');

  const next = (await t.req('/oauth/token', t.form({ grant_type: 'refresh_token', refresh_token: app.refresh })).then((r) => r.json())) as any;
  assert.ok(next.access_token && next.access_token !== app.access);
  assert.equal(await t.tokenFor(next.access_token), token, 'the same token after a refresh');
  assert.equal((await t.img(photo, token)).status, 200);

  // The whole sign-in lapses: no live key and no usable refresh token.
  await t.db.prepare("UPDATE api_keys SET expires_at = ? WHERE kind = 'oauth'").bind(new Date(Date.now() - 1000).toISOString()).run();
  await t.db.prepare('UPDATE oauth_refresh_tokens SET expires_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
  assert.equal((await t.img(photo, token)).status, 401);
});

test('media token: a tampered MAC, or a token for another key, fails', async () => {
  const t = setup();
  mockImages();
  const [photo] = await images(t);
  const laptop = await newKey(t, 'admin');
  const other = await newKey(t, 'admin');
  const token = (await t.tokenFor(laptop.key))!;
  const mac = token.slice(token.lastIndexOf('.') + 1);
  const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  assert.equal((await t.img(photo, flipped)).status, 401, 'tampered MAC');
  assert.equal((await t.img(photo, token.replace(laptop.id, other.id))).status, 401, "another key's id under this MAC");
  assert.equal((await t.img(photo, `km_k.${other.id}.${mac}`)).status, 401);
  assert.equal((await t.img(photo, token.replace('km_k.', 'km_g.'))).status, 401, 'a key id passed off as a grant id');
  assert.equal((await t.img(photo, 'km_k.nope')).status, 401, 'malformed');
  const elsewhere = setup();
  await images(elsewhere);
  assert.equal((await elsewhere.img(photo, token)).status, 401, "another server's token (its own secret)");
  t.env.ENCRYPTION_KEY = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';
  assert.equal((await t.img(photo, token)).status, 401, 'made under another ENCRYPTION_KEY');
});

test("media token: the server's ADMIN_API_KEY gets one, and it dies when that key changes or is removed", async () => {
  const t = setup();
  mockImages();
  const [photo] = await images(t);
  const token = (await t.tokenFor(ADMIN_KEY))!;
  assert.match(token, /^km_e\./);
  assert.ok(!token.includes(ADMIN_KEY));
  assert.equal(await t.tokenFor(ADMIN_KEY), token, 'stable');
  assert.equal((await t.img(photo, token)).status, 200);
  assert.equal((await t.img('/api/settings', token)).status, 401, 'images only');
  assert.equal((await t.img(photo, token.replace('km_e.admin.', 'km_e.other.'))).status, 401);
  t.env.ADMIN_API_KEY = 'fc_test_admin_key_rotated';
  assert.equal((await t.img(photo, token)).status, 401, 'changed key');
  const rotated = (await t.tokenFor('fc_test_admin_key_rotated'))!;
  assert.notEqual(rotated, token);
  assert.equal((await t.img(photo, rotated)).status, 200);
  t.env.ADMIN_API_KEY = undefined; // hosted: the setup code is removed after its 24 hours
  assert.equal((await t.img(photo, rotated)).status, 401, 'removed key');
  assert.equal((await t.img(photo, 'km_e.admin.' + 'A'.repeat(43))).status, 401, 'forged with no ADMIN_API_KEY at all');
});

test('media token: a server without ENCRYPTION_KEY still issues working, revocable tokens', async () => {
  const t = setup({ ENCRYPTION_KEY: undefined });
  mockImages();
  const [photo] = await images(t);
  const laptop = await newKey(t, 'admin');
  const token = (await t.tokenFor(laptop.key))!;
  assert.match(token, /^km_k\./);
  assert.equal(await t.tokenFor(laptop.key), token, 'stable');
  assert.equal((await t.img(photo, token)).status, 200);
  const admin = (await t.tokenFor(ADMIN_KEY))!;
  assert.equal((await t.img(photo, admin)).status, 200);
  const app = await connectApp(t);
  const appToken = (await t.tokenFor(app.access))!;
  assert.match(appToken, /^km_g\./);
  assert.equal((await t.img(photo, appToken)).status, 200);
  assert.equal((await t.send('DELETE', `/api/keys/${laptop.id}`)).status, 200);
  assert.equal((await t.img(photo, token)).status, 401, 'deleted key');
  const secret = await t.db.prepare("SELECT value FROM settings WHERE key = 'mediaTokenSecret'").first<{ value: string }>();
  assert.ok(secret && secret.value.length >= 40, 'a random per-server secret, kept in the database');
  assert.ok(!JSON.stringify((await t.send('GET', '/api/settings')).body).includes(secret.value), 'never in the settings API');
});

test('photo download link: admin only, single use, short-lived, and good for nothing else', async () => {
  const t = setup();
  mockImages();
  const [photo] = await images(t);
  const wall = await newKey(t, 'display');
  assert.equal((await t.send('POST', '/api/photos/export-link', undefined, wall.key)).status, 403, 'admin only');
  assert.equal((await t.send('POST', '/api/photos/export-link', undefined, null)).status, 401);

  const link = (await t.send('POST', '/api/photos/export-link')).body;
  assert.match(link.url, /^\/api\/photos\/export\.zip\?ticket=[\w-]{20,}$/);
  assert.ok(Date.parse(link.expiresAt) - Date.now() <= 61_000);
  const ticket = new URL(link.url, 'https://x').searchParams.get('ticket')!;
  const stored = await t.db.prepare("SELECT subject FROM webauthn_challenges WHERE kind = 'photo_export'").first<{ subject: string }>();
  assert.ok(stored && stored.subject !== ticket, 'only a hash is stored');

  assert.equal((await t.img(photo, ticket)).status, 401, 'not a key anywhere');
  assert.equal((await t.req(`/api/photos?ticket=${ticket}`, { key: null })).status, 401, 'nor on another route');
  assert.equal((await t.req(`/api/photos/export.zip`, { key: ticket })).status, 401, 'nor as a Bearer header');
  const zip = await t.req(link.url, { key: null });
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  await zip.arrayBuffer();
  assert.equal((await t.req(link.url, { key: null })).status, 401, 'single use');
  assert.equal((await t.req(link.url, { method: 'DELETE', key: null })).status, 401);

  const late = (await t.send('POST', '/api/photos/export-link')).body;
  await t.db.prepare("UPDATE webauthn_challenges SET expires_at = ? WHERE kind = 'photo_export'").bind(new Date(Date.now() - 1000).toISOString()).run();
  assert.equal((await t.req(late.url, { key: null })).status, 401, 'expired');
  await t.send('POST', '/api/photos/export-link');
  assert.equal((await t.db.prepare("SELECT COUNT(*) AS n FROM webauthn_challenges WHERE kind = 'photo_export'").first<{ n: number }>())!.n, 1, 'expired links are pruned');
});
