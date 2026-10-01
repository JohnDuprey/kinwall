// Security activity (routes/security-events.ts): every sign-in, passkey, recovery code, key, paired
// device, connected app, PIN and private-journal change leaves one line, credited to who did it,
// with no secrets. Parent devices read it; the family's feed doesn't get these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { createApiKey } from '../src/auth.ts';
import { __resetVerifiers, __setVerifiers } from '../src/webauthn.ts';
import { recordSecurityEvent, SECURITY_KEEP } from '../src/routes/security-events.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = 'fc_test_admin_key';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(__dirname, '..', 'migrations'));
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (p: string, init: RequestInit = {}, key: string | null = ADMIN) => {
    const headers = new Headers(init.headers);
    if (key) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return Promise.resolve(app.request(p, { ...init, headers }, env));
  };
  const req = async (p: string, method = 'GET', body?: unknown, key: string | null = ADMIN) => {
    const res = await raw(p, { method, body: body === undefined ? undefined : JSON.stringify(body) }, key);
    return { status: res.status, json: (await res.json().catch(() => null)) as any };
  };
  const events = async () => (await req('/api/security-events?limit=100')).json as { kind: string; summary: string; by: { memberId: string | null; label: string | null } | null; device: string | null; detail: any }[];
  const last = async (kind: string) => (await events()).find((e) => e.kind === kind);
  return { db, env, raw, req, events, last };
}

const fakeAttestation = (challenge: string, id: string) => ({
  id, rawId: id, type: 'public-key', clientExtensionResults: {},
  response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: 'http://localhost:8080' })).toString('base64url') },
});

test('security activity: each kind is logged once, credited to who did it, never with a secret', async (t) => {
  const { db, raw, req, events, last } = setup();
  const secrets: string[] = [];
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#336699', grownUp: true })).json.id as string;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#993366', grownUp: false })).json.id as string;
  const alexPhone = await createApiKey(db as any, "Alex's phone", 'admin', { owner: alex });
  secrets.push(alexPhone.key);

  // Passkeys: added (credited to the phone's owner), renamed, signed in with, removed.
  const CRED = 'credential-id-that-must-not-be-logged';
  __setVerifiers({
    registration: async () => ({ verified: true, registrationInfo: { credential: { id: CRED, publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: [] } } }) as any,
    authentication: async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }) as any,
  });
  t.after(() => __resetVerifiers());
  const options = (await req('/api/passkeys/register/options', 'POST', {}, alexPhone.key)).json;
  const added = (await req('/api/passkeys/register/verify', 'POST', { name: 'iPhone', response: fakeAttestation(options.challenge, CRED) }, alexPhone.key)).json;
  secrets.push(CRED, added.session.key);
  assert.deepEqual(await last('passkey.added'), { ...(await last('passkey.added'))!, summary: 'Passkey "iPhone" added', by: { memberId: alex, label: null }, device: 'iPhone' });
  await req(`/api/passkeys/${added.id}`, 'PATCH', { name: 'Work iPhone' }, alexPhone.key);
  assert.equal((await last('passkey.renamed'))?.summary, 'Passkey "iPhone" renamed to "Work iPhone"');
  await db.prepare('UPDATE passkeys SET owner = ? WHERE id = ?').bind(alex, added.id).run();
  const login = (await req('/api/passkeys/login/options', 'POST', undefined, null)).json;
  const signedIn = (await req('/api/passkeys/login/verify', 'POST', { response: fakeAttestation(login.challenge, CRED) }, null)).json;
  secrets.push(signedIn.key);
  assert.deepEqual([(await last('signin.passkey'))?.summary, (await last('signin.passkey'))?.by?.memberId], ['Signed in with passkey "Work iPhone"', alex]);
  await req('/api/sessions/logout', 'POST', undefined, signedIn.key);
  assert.equal((await last('signout'))?.summary, 'Signed out (passkey "Work iPhone")');
  assert.equal((await last('signout'))?.by?.memberId, alex, "the session was Alex's");
  await req(`/api/passkeys/${added.id}`, 'DELETE', undefined, alexPhone.key);
  assert.equal((await last('passkey.removed'))?.summary, 'Passkey "Work iPhone" removed; its sign-ins ended');

  // Recovery codes: made, then one used to sign in (nobody to credit).
  const codes = (await req('/api/recovery-codes', 'POST', undefined, alexPhone.key)).json.codes as string[];
  secrets.push(...codes);
  assert.equal((await last('recovery.generated'))?.summary, 'Recovery codes made');
  await req('/api/recovery-codes', 'POST', undefined, alexPhone.key).then((r) => secrets.push(...r.json.codes));
  assert.match((await last('recovery.generated'))!.summary, /old ones stopped working/);
  const fresh = (await db.prepare('SELECT COUNT(*) AS n FROM recovery_codes').first<{ n: number }>())!.n;
  assert.equal(fresh, 8);
  const code = secrets.at(-1)!;
  const rec = (await req('/api/recovery/login', 'POST', { code }, null)).json;
  secrets.push(rec.key);
  const used = await last('signin.recovery');
  assert.deepEqual([used?.summary, used?.by, used?.detail], ['Recovery code used to sign in (7 left)', null, { remaining: 7 }]);

  // Keys: an API key made, a paired wall and a kid's device, an owner change, widgets, removals.
  const hook = (await req('/api/keys', 'POST', { name: 'Home Assistant', scope: 'admin' }, alexPhone.key)).json;
  secrets.push(hook.key);
  assert.deepEqual([(await last('key.created'))?.summary, (await last('key.created'))?.by?.memberId], ['Full-access API key "Home Assistant" created', alex]);
  const pair = async (name: string, body: Record<string, unknown>) => {
    const start = (await req('/api/pair', 'POST', undefined, null)).json;
    const approve = (await req('/api/pair/approve', 'POST', { code: start.code, name, ...body }, alexPhone.key)).json;
    const poll = (await req('/api/pair/poll', 'POST', { pairingId: start.pairingId, pollToken: start.pollToken }, null)).json;
    secrets.push(start.pollToken, poll.key);
    return { id: approve.keyId as string, key: poll.key as string };
  };
  const wall = await pair('Kitchen wall', { kind: 'wall' });
  assert.equal((await last('device.paired'))?.summary, '"Kitchen wall" paired as a wall screen');
  await pair("Leo's tablet", { kind: 'kid', owner: leo });
  assert.equal((await last('device.paired'))?.summary, `"Leo's tablet" paired as Leo's device`);
  await req(`/api/keys/${hook.id}`, 'PATCH', { owner: alex }, alexPhone.key);
  assert.equal((await last('device.owner'))?.summary, '"Home Assistant" now belongs to Alex (a grown-up\'s device)');
  const widgets = (await req('/api/device-keys', 'POST', { name: 'Kitchen widgets' }, wall.key)).json;
  secrets.push(widgets.key);
  assert.deepEqual([(await last('widgets.added'))?.summary, (await last('widgets.added'))?.by?.label], ['Widgets key "Kitchen widgets" added', 'Kitchen wall']);
  await req('/api/device-keys/self', 'DELETE', undefined, widgets.key);
  assert.equal((await last('widgets.removed'))?.summary, 'Widgets key "Kitchen widgets" signed out');
  await req(`/api/keys/${wall.id}`, 'DELETE', undefined, alexPhone.key);
  assert.equal((await last('key.removed'))?.summary, 'Device "Kitchen wall" removed and signed out');

  // A connected app: approved (by the parent), then disconnected by reusing its code.
  const reg = (await req('/oauth/register', 'POST', { client_name: 'Claude', redirect_uris: [REDIRECT] }, null)).json;
  const verifier = Buffer.from(randomBytes(32)).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const approved = (await req('/api/authorizations/approve', 'POST', { decision: 'approve', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' }, alexPhone.key)).json;
  const oauthCode = new URL(approved.redirect).searchParams.get('code')!;
  assert.deepEqual([(await last('app.connected'))?.summary, (await last('app.connected'))?.by?.memberId], ['Claude connected with full access', alex]);
  const form = (f: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() });
  const exchange = { grant_type: 'authorization_code', code: oauthCode, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT };
  const tokens = (await (await raw('/oauth/token', form(exchange), null)).json()) as any;
  secrets.push(oauthCode, verifier, tokens.access_token, tokens.refresh_token);
  await raw('/oauth/token', form(exchange), null); // replayed
  assert.equal((await last('app.disconnected'))?.summary, 'Claude disconnected: its sign-in code was used twice');

  // The quiet-hours PIN and a private journal.
  await req('/api/quiet-pin', 'PUT', { pin: '482915' }, alexPhone.key);
  await req('/api/quiet-pin', 'PUT', { pin: '482916' }, alexPhone.key);
  await req('/api/quiet-pin', 'DELETE', undefined, alexPhone.key);
  secrets.push('482915', '482916');
  assert.deepEqual((await events()).filter((e) => e.kind.startsWith('pin.')).map((e) => e.summary), ['Quiet-hours PIN removed', 'Quiet-hours PIN changed', 'Quiet-hours PIN set']);
  await req(`/api/members/${leo}/journal/privacy`, 'PUT', { allowed: true }, alexPhone.key);
  assert.deepEqual([(await last('journal.privacy'))?.summary, (await last('journal.privacy'))?.by?.memberId], ['Leo can keep a private journal', alex]);

  // Nothing secret anywhere in the table: not a key, token, code, PIN or credential ID, nor most of one.
  const dump = JSON.stringify(db.prepare('SELECT * FROM security_events').all().results);
  for (const s of secrets) assert.ok(s && !dump.includes(s.slice(0, 12)), `no secret in the log: ${s.slice(0, 4)}…`);

  // And none of it reached the family's feed: only the privacy notes to Alex and Leo themselves.
  const feed = (db.prepare('SELECT kind, member_ids FROM notifications').all().results as { kind: string; member_ids: string }[]);
  assert.ok(feed.every((n) => n.kind === 'privacy' && n.member_ids !== '[]'), JSON.stringify(feed));
  assert.equal(((await req('/api/notifications')).json as any[]).length, 0, "a parent device that's nobody's sees none of them");
});

test('security activity: parent devices only; paged newest first', async () => {
  const { db, req } = setup();
  const display = await createApiKey(db as any, 'Kitchen', 'display');
  assert.equal((await req('/api/security-events', 'GET', undefined, display.key)).status, 403, 'a wall screen');
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#993366', grownUp: false })).json.id as string;
  const kid = await createApiKey(db as any, "Leo's tablet", 'display', { owner: leo, deviceKind: 'kid' });
  assert.equal((await req('/api/security-events', 'GET', undefined, kid.key)).status, 403, "a kid's device");
  for (let i = 0; i < 5; i++) await recordSecurityEvent(db as any, { kind: 'pin.set', summary: `PIN ${i}` });
  const first = (await req('/api/security-events?limit=3')).json as any[];
  assert.deepEqual(first.map((e) => e.summary), ['PIN 4', 'PIN 3', 'PIN 2']);
  const more = (await req(`/api/security-events?limit=3&before=${first[2].id}`)).json as any[];
  assert.deepEqual(more.map((e) => e.summary), ['PIN 1', 'PIN 0'], 'the rest, even within the same millisecond');
});

test('security activity: a connected app (even with full access) gets 403', async () => {
  const { req, raw } = setup();
  const reg = (await req('/oauth/register', 'POST', { client_name: 'Claude', redirect_uris: [REDIRECT] }, null)).json;
  const verifier = Buffer.from(randomBytes(32)).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const approved = (await req('/api/authorizations/approve', 'POST', { decision: 'approve', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' })).json;
  const code = new URL(approved.redirect).searchParams.get('code')!;
  const tok = (await (await raw('/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }).toString() }, null)).json()) as any;
  assert.equal((await req('/api/security-events', 'GET', undefined, tok.access_token)).status, 403);
});

test('security activity: kept a year, and the newest 500', async () => {
  const { db } = setup();
  await db.prepare("INSERT INTO security_events (id, at, kind, summary) VALUES ('old', '2020-01-01T00:00:00.000Z', 'pin.set', 'old')").run();
  for (let i = 0; i < SECURITY_KEEP + 5; i++) await recordSecurityEvent(db as any, { kind: 'pin.set', summary: `n${i}` });
  const rows = (db.prepare('SELECT summary FROM security_events').all().results as { summary: string }[]).map((r) => r.summary);
  assert.equal(rows.length, SECURITY_KEEP);
  assert.ok(!rows.includes('old'), 'older than a year');
  assert.ok(rows.includes(`n${SECURITY_KEEP + 4}`) && !rows.includes('n0'), 'the newest stay');
});

test('a new passkey and a recovery-code sign-in push to parent devices only, not the feed', async () => {
  const { db, req } = setup();
  const parent = await createApiKey(db as any, "Sam's phone", 'admin');
  const wall = await createApiKey(db as any, 'Kitchen', 'display');
  const sub = async (key: string, name: string) => {
    const p = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = Buffer.from(await crypto.subtle.exportKey('raw', p.publicKey)).toString('base64url');
    await req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh, auth: Buffer.from(randomBytes(16)).toString('base64url') } }, deviceName: name }, key);
  };
  await sub(parent.key, 'sam');
  await sub(wall.key, 'kitchen');
  const codes = (await req('/api/recovery-codes', 'POST', undefined, parent.key)).json.codes as string[];
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (url: any) => (sent.push(String(url)), new Response('', { status: 201 }))) as typeof fetch;
  try {
    assert.equal((await req('/api/recovery/login', 'POST', { code: codes[0] }, null)).status, 200);
    for (let i = 0; i < 20 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 10)); // sent in the background
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(sent.map((u) => u.split('/').pop()), ['sam'], 'the parent phone, not the wall');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications').first() as { n: number }).n, 0, 'not in the feed');
});
