// Access hardening: what connected apps may not set up (push subscriptions, webhooks), contact
// filters that only match what the asker is shown, the pinned Swagger UI on /docs, and the limits
// on what someone who isn't signed in can store or lock (passkey challenges, app registrations,
// setup code guesses).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.ts';
import { createApiKey } from '../src/auth.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { regenerateSetupCode } from '../src/routes/setup.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const KINWALL_APP = 'family.kinwall.app:/oauth';

function setup(overrides: Partial<Env> = { ADMIN_API_KEY: ADMIN_KEY }) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, PUBLIC_URL: 'https://kinwall.example', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', CLIENT_IP: (req) => req.headers.get('x-forwarded-for'), ...overrides };
  const app = createApp();
  // key: a bearer key, or null for someone who isn't signed in. ip: the address a proxy reports.
  const send = async (method: string, p: string, body?: unknown, key: string | null = ADMIN_KEY, ip?: string) => {
    const headers = new Headers();
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (ip) headers.set('X-Forwarded-For', ip);
    const res = await app.request(p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  // An OAuth sign-in: Claude's callback (a connected app) or Kinwall's own phone app link.
  const signIn = async (redirect: string) => {
    const reg = (await send('POST', '/oauth/register', { client_name: 'App', redirect_uris: [redirect] }, null)).body;
    const verifier = Buffer.from(randomBytes(32)).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const approved = (await send('POST', '/api/authorizations/approve', { decision: 'approve', client_id: reg.client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', scope: 'admin', owner: 'shared' })).body;
    const code = new URL(approved.redirect).searchParams.get('code')!;
    const tok = (await send('POST', '/oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: redirect }, null)).body;
    return tok.access_token as string;
  };
  return { db, env, send, signIn };
}

const pushBody = (deviceName: string) => ({
  subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${deviceName}`, keys: { p256dh: 'BPfake', auth: 'fake' } },
  deviceName,
  prefs: { medicationNames: true },
});

test('push: a connected app cannot subscribe a device, so medicine names never reach it', async () => {
  const t = setup();
  const NOT_A_DEVICE = "Connected apps can't get push notifications. Turn them on from a family member's own device.";
  const claude = await t.signIn(CLAUDE);

  const refused = await t.send('POST', '/api/push/subscriptions', pushBody('claude'), claude);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, NOT_A_DEVICE);
  assert.equal((await t.send('GET', '/api/push/subscriptions')).body.length, 0);

  // A parent's own subscription isn't the app's to change, test or remove either.
  const mine = await t.send('POST', '/api/push/subscriptions', pushBody('alex-phone'));
  assert.equal(mine.status, 201, JSON.stringify(mine.body));
  assert.equal((await t.send('PATCH', `/api/push/subscriptions/${mine.body.id}`, { prefs: { medicationNames: true } }, claude)).status, 403);
  assert.equal((await t.send('POST', `/api/push/test/${mine.body.id}`, undefined, claude)).status, 403);
  assert.equal((await t.send('DELETE', `/api/push/subscriptions/${mine.body.id}`, undefined, claude)).status, 403);
  assert.equal((await t.send('GET', '/api/push/subscriptions')).body.length, 1);

  // Kinwall's own app is a person's device: it still subscribes.
  const app = await t.signIn(KINWALL_APP);
  const own = await t.send('POST', '/api/push/subscriptions', pushBody('sam-phone'), app);
  assert.equal(own.status, 201, JSON.stringify(own.body));
  assert.equal((await t.send('DELETE', `/api/push/subscriptions/${own.body.id}`, undefined, app)).status, 200);
});

test('webhooks: a connected app cannot create, change, rotate or delete them', async () => {
  const t = setup();
  const PARENT_ONLY = "Connected apps can't set up webhooks. Do this from a parent's own device.";
  const claude = await t.signIn(CLAUDE);
  const hook = { url: 'https://hooks.example.com/kinwall', events: ['tracker.changed', 'journal.changed', 'tempcheck.changed'] };

  const refused = await t.send('POST', '/api/webhooks', hook, claude);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, PARENT_ONLY);

  // The family's own keys (the web app, Home Assistant, n8n) keep working.
  const made = await t.send('POST', '/api/webhooks', hook);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal((await t.send('PATCH', `/api/webhooks/${made.body.id}`, { url: 'https://evil.example.com/hook' }, claude)).status, 403);
  assert.equal((await t.send('POST', `/api/webhooks/${made.body.id}/rotate`, undefined, claude)).status, 403);
  assert.equal((await t.send('DELETE', `/api/webhooks/${made.body.id}`, undefined, claude)).status, 403);
  const kept = (await t.send('GET', '/api/webhooks')).body;
  assert.deepEqual(kept.map((w: any) => w.url), [hook.url]);

  // Kinwall's own app is a parent's device.
  const app = await t.signIn(KINWALL_APP);
  assert.equal((await t.send('PATCH', `/api/webhooks/${made.body.id}`, { enabled: false }, app)).status, 200);
});

test('contacts: filters match only what the asking device is shown', async () => {
  const t = setup();
  const leo = (await t.send('POST', '/api/members', { name: 'Leo', color: '#e57' })).body;
  const maya = (await t.send('POST', '/api/members', { name: 'Maya', color: '#5e7' })).body;
  const device = async (owner: string) => (await createApiKey(t.db as never, `tablet ${owner}`, 'display', { owner })).key;
  const wall = await device('shared'), leoTablet = await device(leo.id);
  const made = await t.send('POST', '/api/contacts', {
    kind: 'service', name: 'Front desk', organization: 'Riverside Clinic', relationship: 'Therapist', title: 'Counselor', tags: ['allergy'],
    memberIds: [maya.id], emergency: true, emergencyVisible: false, wallVisible: true, visibility: 'household',
    privateFields: ['organization', 'relationship', 'title', 'tags', 'members'],
  });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const names = async (query: string, key?: string) => (await t.send('GET', `/api/contacts?${query}`, undefined, key)).body.map((c: any) => c.name);

  // A parent's device searches everything.
  for (const q of ['search=riverside', 'search=therapist', 'search=counselor', 'search=allergy', `memberId=${maya.id}`, 'emergency=true']) {
    assert.deepEqual(await names(q), ['Front desk'], `admin: ${q}`);
  }
  // A wall and a kid's device see the contact, and can find it by its name...
  for (const key of [wall, leoTablet]) {
    assert.deepEqual(await names('search=front', key), ['Front desk']);
    // ...but can't probe the fields it hides from them.
    for (const q of ['search=riverside', 'search=therapist', 'search=counselor', 'search=allergy', `memberId=${maya.id}`]) {
      assert.deepEqual(await names(q, key), [], `device: ${q}`);
    }
  }
  // The wall isn't shown the emergency flag (emergencyVisible off), so it can't filter on it either.
  assert.deepEqual(await names('emergency=true', wall), []);
  assert.deepEqual(await names('emergency=false', wall), ['Front desk']);
});

test('/docs loads one pinned Swagger UI release, and only from that CDN', async () => {
  const t = setup();
  const res = await t.send('GET', '/docs', undefined, null);
  assert.equal(res.status, 200);
  const cdn = 'https://cdn\\.jsdelivr\\.net/npm/swagger-ui-dist@';
  assert.match(res.text, new RegExp(`<script src="${cdn}\\d+\\.\\d+\\.\\d+/swagger-ui-bundle\\.js"`));
  assert.match(res.text, new RegExp(`<link rel="stylesheet" href="${cdn}\\d+\\.\\d+\\.\\d+/swagger-ui\\.css"`));
  assert.doesNotMatch(res.text, /swagger-ui-dist\//, 'never the unpinned latest');
  assert.match(res.text, /url: '\/openapi\.json'/);

  const csp = res.headers.get('Content-Security-Policy')!;
  assert.match(csp, /script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net;/);
  assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net;/);
  assert.doesNotMatch(csp, /https:[; ]|https:$/, 'no scheme-wide https: source');
});

test('/openapi.json names its own server so importers can build request URLs', async () => {
  const t = setup();
  assert.deepEqual((await t.send('GET', '/openapi.json', undefined, null)).body.servers, [{ url: 'https://kinwall.example' }]);
  const bare = setup({ ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: undefined });
  assert.deepEqual((await bare.send('GET', '/openapi.json', undefined, null)).body.servers, [{ url: 'http://localhost' }]);
});

test('passkeys: expired challenges are pruned when a new one is stored', async () => {
  const t = setup();
  const insert = (subject: string, expires: number) => t.env.DB.prepare('INSERT INTO webauthn_challenges (id, kind, subject, data, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), 'auth_challenge', subject, null, new Date().toISOString(), new Date(Date.now() + expires).toISOString()).run();
  await insert('stale', -60_000);
  await insert('fresh', 60_000);

  assert.equal((await t.send('POST', '/api/passkeys/login/options', undefined, null)).status, 200);
  const { results } = await t.env.DB.prepare('SELECT subject FROM webauthn_challenges').all<{ subject: string }>();
  const subjects = results.map((r) => r.subject);
  assert.equal(subjects.includes('stale'), false, 'the expired challenge is gone');
  assert.equal(subjects.includes('fresh'), true);
  assert.equal(subjects.length, 2, 'fresh + the one just made');
});

test('oauth: registrations are limited per address', async () => {
  const t = setup();
  const register = (ip: string) => t.send('POST', '/oauth/register', { client_name: 'App', redirect_uris: [CLAUDE] }, null, ip);
  for (let i = 0; i < 20; i++) assert.equal((await register('203.0.113.5')).status, 201);
  const limited = await register('203.0.113.5');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'temporarily_unavailable');
  assert.match(limited.body.error_description, /too many/i);
  assert.equal((await t.env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients').first<{ n: number }>())!.n, 20, 'nothing stored once limited');
  // Another address isn't held up by it.
  assert.equal((await register('203.0.113.6')).status, 201);
});

test('oauth: never-approved registrations are capped, oldest dropped first; approved apps stay', async () => {
  const t = setup();
  const claude = await t.signIn(CLAUDE); // an approved app, older than every pending one below
  const pending = () => t.env.DB.prepare('SELECT COUNT(*) AS n FROM oauth_clients WHERE id NOT IN (SELECT client_id FROM oauth_grants) AND id NOT IN (SELECT client_id FROM oauth_codes)').first<{ n: number }>();
  for (let i = 0; i < 100; i++) {
    await t.env.DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES (?,?,?,?)')
      .bind(`pending-${i}`, 'Never approved', JSON.stringify([CLAUDE]), new Date(Date.now() - (200 - i) * 1000).toISOString()).run();
  }
  const made = await t.send('POST', '/oauth/register', { client_name: 'Newest', redirect_uris: [CLAUDE] }, null);
  assert.equal(made.status, 201);
  assert.equal((await pending())!.n, 100);
  const ids = (await t.env.DB.prepare('SELECT id FROM oauth_clients').all<{ id: string }>()).results.map((r) => r.id);
  assert.equal(ids.includes('pending-0'), false, 'the oldest pending one made room');
  assert.equal(ids.includes('pending-1'), true);
  assert.equal(ids.includes(made.body.client_id), true, 'the new one can go on to be approved');
  assert.equal((await t.send('GET', '/api/me', undefined, claude)).status, 200, 'the approved app still works');
  assert.equal((await t.send('GET', '/api/authorizations')).body.length, 1);
});

const claim = (t: ReturnType<typeof setup>, code: string, ip: string) => t.send('POST', '/api/setup/claim', { code, deviceRole: 'admin', deviceName: 'Alex phone' }, null, ip);

test("setup: wrong guesses from one address don't lock the owner out", async () => {
  const t = setup({});
  const code = await regenerateSetupCode(t.env.DB, 'http://localhost:8080');
  for (let i = 0; i < 10; i++) assert.equal((await claim(t, '000000', '203.0.113.5')).status, 401);
  assert.equal((await claim(t, '000000', '203.0.113.5')).status, 429);
  // That address has spent its guesses: even the right code is refused there, so it can't keep guessing.
  assert.equal((await claim(t, code, '203.0.113.5')).status, 429);
  // The owner, somewhere else, still gets in.
  assert.equal((await claim(t, code, '198.51.100.7')).status, 200);
});

test('setup: guesses spread over many addresses still run out; ADMIN_API_KEY always works', async () => {
  const t = setup({ ADMIN_API_KEY: 'fc_admin_secret' });
  const code = await regenerateSetupCode(t.env.DB, 'http://localhost:8080');
  for (let ip = 1; ip <= 3; ip++) {
    for (let i = 0; i < 10; i++) assert.equal((await claim(t, '000000', `203.0.113.${ip}`)).status, 401);
  }
  assert.equal((await claim(t, '000000', '203.0.113.4')).status, 429);
  assert.equal((await claim(t, code, '203.0.113.4')).status, 429, 'the 6-digit code is refused once the family-wide guesses are spent');
  assert.equal((await claim(t, 'fc_admin_secret', '203.0.113.4')).status, 200, "the server's own key is not guessable, so it is never locked");
});

test('setup: a new setup code starts every address over', async () => {
  const t = setup({});
  await regenerateSetupCode(t.env.DB, 'http://localhost:8080');
  for (let i = 0; i < 11; i++) await claim(t, '000000', '203.0.113.5');
  const code = await regenerateSetupCode(t.env.DB, 'http://localhost:8080');
  assert.equal((await claim(t, code, '203.0.113.5')).status, 200);
});

test('migration 0087: push subscriptions a connected app made before it was refused are removed; devices keep theirs', async () => {
  const { runMigrations } = await import('../src/migrate.ts');
  const { readdirSync, readFileSync } = await import('node:fs');
  const all = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }));
  const db = openDb(':memory:') as unknown as D1Database;
  await runMigrations(db, all.filter((m) => m.name < '0087'));
  await db.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created_at) VALUES ('c', 'App', '[]', '2026-01-01')").run();
  const grant = (id: string, deviceApp: number) => db.prepare("INSERT INTO oauth_grants (id, client_id, scope, created_at, device_app) VALUES (?, 'c', 'admin', '2026-01-01', ?)").bind(id, deviceApp).run();
  await grant('assistant', 0);
  await grant('phone-app', 1);
  // Each sign-in's key with a subscription on it; an expired access key still holds its subscription.
  const sub = async (id: string, kind: string, grantId: string | null, expiresAt: string | null = null) => {
    await db.prepare("INSERT INTO api_keys (id, name, hash, prefix, scope, created_at, kind, oauth_grant_id, expires_at) VALUES (?, ?, ?, 'kw_x', 'admin', '2026-01-01', ?, ?, ?)").bind(id, id, `h-${id}`, kind, grantId, expiresAt).run();
    await db.prepare("INSERT INTO push_subscriptions (id, api_key_id, endpoint, p256dh, auth, device_name, created_at) VALUES (?, ?, ?, 'p', 'a', ?, '2026-01-01')").bind(`sub-${id}`, id, `https://fcm.googleapis.com/fcm/send/${id}`, id).run();
  };
  await sub('assistant-key', 'oauth', 'assistant');
  await sub('assistant-old-key', 'oauth', 'assistant', '2026-01-02T00:00:00.000Z');
  await sub('phone-app-key', 'oauth', 'phone-app');
  await sub('parent-passkey', 'session', null);
  await sub('ha-api-key', 'api', null);
  await runMigrations(db, all);
  const left = (await db.prepare('SELECT device_name FROM push_subscriptions ORDER BY device_name').all<{ device_name: string }>()).results.map((r) => r.device_name);
  assert.deepEqual(left, ['ha-api-key', 'parent-passkey', 'phone-app-key']);
});
