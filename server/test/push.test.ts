// Web Push: VAPID (RFC 8292) + payload encryption (RFC 8291/8188), the push subscription API,
// and the notification scheduler (notify.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { encryptPushPayload, ensureVapidKeys, vapidAuthHeader } from '../src/webpush.ts';
import { decrypt } from '../src/crypto.ts';
import { runNotifications } from '../src/notify.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const TEST_ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function makeEnv(): Env {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  return { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: TEST_ENCRYPTION_KEY };
}

function makeApp(env: Env) {
  const app = createApp();
  return (p: string, init: RequestInit = {}, key = ADMIN_KEY) => {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${key}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return Promise.resolve(app.request(p, { ...init, headers }, env));
  };
}

function b64uToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// A subscriber's ECDH keypair + auth secret, as a browser's pushManager.subscribe() would hand
// back (p256dh/auth are base64url of the raw public key / random secret).
async function makeSubscriberKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, p256dh: bytesToB64u(publicRaw), auth: bytesToB64u(auth) };
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource));
}
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const t1 = await hmacSha256(prk, concat(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

// Independent reference decryptor, written straight from RFC 8291/8188 (not sharing webpush.ts's
// internal helpers beyond generic HMAC/AES-GCM) - proves encryptPushPayload's output round-trips
// under a from-scratch implementation of the spec, not just its own mirror-image code.
async function referenceDecrypt(body: Uint8Array, subscriberPrivateKey: CryptoKey, p256dh: string, authB64u: string): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const keyid = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  const asPublicKey = await crypto.subtle.importKey('raw', keyid as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asPublicKey }, subscriberPrivateKey, 256));
  const authSecret = b64uToBytes(authB64u);
  const uaPublicRaw = b64uToBytes(p256dh);

  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concat(new TextEncoder().encode('WebPush: info\0'), uaPublicRaw, keyid);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const prk = await hmacSha256(salt, ikm);
  const cekBytes = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const cek = await crypto.subtle.importKey('raw', cekBytes as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cek, ciphertext as BufferSource));
  // Strip the trailing 0x02 last-record delimiter (and any padding after it, none here).
  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  assert.equal(padded[end - 1], 2);
  return new TextDecoder().decode(padded.slice(0, end - 1));
}

test('webpush: RFC 8291 aes128gcm payload round-trips through an independent reference decryptor', async () => {
  const sub = await makeSubscriberKeys();
  const plaintext = 'When I grow up, I want to be a watermelon';
  const body = await encryptPushPayload({ endpoint: 'https://push.example/x', p256dh: sub.p256dh, auth: sub.auth }, plaintext);

  // Header shape: salt(16) || rs(4 BE) || idlen(1) || keyid(65 for a P-256 uncompressed point).
  assert.equal(body.length > 16 + 4 + 1 + 65, true);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
  assert.equal(rs, 4096);
  assert.equal(body[20], 65);

  const decrypted = await referenceDecrypt(body, sub.privateKey, sub.p256dh, sub.auth);
  assert.equal(decrypted, plaintext);
});

test('webpush: two encryptions of the same payload use different salts/ciphertexts (fresh ephemeral key + random salt)', async () => {
  const sub = await makeSubscriberKeys();
  const a = await encryptPushPayload({ endpoint: 'https://push.example/x', p256dh: sub.p256dh, auth: sub.auth }, 'hello');
  const b = await encryptPushPayload({ endpoint: 'https://push.example/x', p256dh: sub.p256dh, auth: sub.auth }, 'hello');
  assert.notEqual(Buffer.from(a).toString('base64'), Buffer.from(b).toString('base64'));
});

test('webpush: VAPID JWT is a valid ES256 JWS that verifies with the published public key', async () => {
  const env = makeEnv();
  const { publicKey, privateKey } = await ensureVapidKeys(env, env.DB);
  const header = await vapidAuthHeader(env, privateKey, publicKey, 'https://push.example.com/sub/123');
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, 'Authorization header shape');
  const [, jwt, k] = m!;
  assert.equal(k, publicKey);

  const [headerB64, payloadB64, sigB64] = jwt.split('.');
  const payload = JSON.parse(new TextDecoder().decode(b64uToBytes(payloadB64)));
  assert.equal(payload.aud, 'https://push.example.com');
  assert.ok(payload.exp > Date.now() / 1000);

  const publicCryptoKey = await crypto.subtle.importKey('raw', b64uToBytes(publicKey) as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicCryptoKey,
    b64uToBytes(sigB64) as BufferSource,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`) as BufferSource,
  );
  assert.equal(ok, true);
});

test('webpush: VAPID keys persist across calls (generated once, stored encrypted)', async () => {
  const env = makeEnv();
  const a = await ensureVapidKeys(env, env.DB);
  const b = await ensureVapidKeys(env, env.DB);
  assert.equal(a.publicKey, b.publicKey);
});

async function subscribe(request: ReturnType<typeof makeApp>, key: string, deviceName: string, prefs?: Record<string, unknown>) {
  const sub = await makeSubscriberKeys();
  const res = await request(
    '/api/push/subscriptions',
    { method: 'POST', body: JSON.stringify({ subscription: { endpoint: `https://push.example/${deviceName}`, keys: { p256dh: sub.p256dh, auth: sub.auth } }, deviceName, prefs }) },
    key,
  );
  return { row: (await res.json()) as any, keys: sub };
}

test('push: subscription CRUD + scoping (a display key cannot touch another device\'s subscription)', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const displayA = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'A', scope: 'display' }) })).json()) as any;
  const displayB = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'B', scope: 'display' }) })).json()) as any;

  const { row: subA } = await subscribe(request, displayA.key, 'deviceA');
  assert.equal(subA.deviceName, 'deviceA');

  // B can't see or modify A's subscription.
  const listAsB = (await (await request('/api/push/subscriptions', {}, displayB.key)).json()) as any[];
  assert.equal(listAsB.some((s) => s.id === subA.id), false);
  const patchAsB = await request(`/api/push/subscriptions/${subA.id}`, { method: 'PATCH', body: JSON.stringify({ deviceName: 'hijacked' }) }, displayB.key);
  assert.equal(patchAsB.status, 403);
  const delAsB = await request(`/api/push/subscriptions/${subA.id}`, { method: 'DELETE' }, displayB.key);
  assert.equal(delAsB.status, 403);

  // A can update its own.
  const patchAsA = await (await request(`/api/push/subscriptions/${subA.id}`, { method: 'PATCH', body: JSON.stringify({ deviceName: 'renamed' }) }, displayA.key)).json();
  assert.equal((patchAsA as any).deviceName, 'renamed');

  // Admin sees everything.
  const listAsAdmin = (await (await request('/api/push/subscriptions')).json()) as any[];
  assert.equal(listAsAdmin.length, 1);

  // The endpoint/keys are never returned.
  assert.equal('endpoint' in subA, false);
  assert.equal('p256dh' in subA, false);
});

test('push: GET /api/push/vapid-public-key is display-allowed and stable', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const display = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'D', scope: 'display' }) })).json()) as any;
  const a = (await (await request('/api/push/vapid-public-key', {}, display.key)).json()) as any;
  const b = (await (await request('/api/push/vapid-public-key')).json()) as any;
  assert.equal(a.publicKey, b.publicKey);
});

test('push: POST /api/notify is admin-only', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const display = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'D', scope: 'display' }) })).json()) as any;
  const res = await request('/api/notify', { method: 'POST', body: JSON.stringify({ title: 't', body: 'b' }) }, display.key);
  assert.equal(res.status, 403);
});

// Captures every push send instead of hitting the network; a 410 for a given endpoint simulates
// an expired subscription.
function stubPush(goneEndpoints: Set<string> = new Set()) {
  const realFetch = globalThis.fetch;
  const sent: { url: string; body?: Uint8Array }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const u = String(url);
    sent.push({ url: u, body: init?.body instanceof Uint8Array ? init.body : undefined });
    if ([...goneEndpoints].some((e) => u.includes(e))) return new Response('', { status: 410 });
    return new Response('', { status: 201 });
  }) as typeof fetch;
  return { sent, restore: () => (globalThis.fetch = realFetch) };
}

test('push: subscription keys are encrypted at rest; re-subscribing keeps the row id so they still decrypt', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const { row, keys } = await subscribe(request, ADMIN_KEY, 'phone');
  const stored = await env.DB.prepare('SELECT id, p256dh, auth FROM push_subscriptions').first<{ id: string; p256dh: string; auth: string }>();
  assert.ok(stored!.p256dh.startsWith('v1:') && stored!.auth.startsWith('v1:'));
  assert.notEqual(stored!.p256dh, keys.p256dh);
  assert.equal(await decrypt(env, stored!.p256dh, row.id), keys.p256dh);

  // Same endpoint again (browser re-registers): ON CONFLICT keeps the original id = AAD.
  const again = await makeSubscriberKeys();
  await request('/api/push/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: { endpoint: 'https://push.example/phone', keys: { p256dh: again.p256dh, auth: again.auth } }, deviceName: 'phone' }) });
  const after = await env.DB.prepare('SELECT id, auth FROM push_subscriptions').first<{ id: string; auth: string }>();
  assert.equal(after!.id, row.id);
  assert.equal(await decrypt(env, after!.auth, row.id), again.auth);
});

test('push: a legacy plaintext-key row still sends and is re-wrapped after the send', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const keys = await makeSubscriberKeys();
  await env.DB.prepare("INSERT INTO push_subscriptions (id, api_key_id, endpoint, p256dh, auth, device_name, member_ids, prefs, created_at) VALUES ('legacy', NULL, 'https://push.example/old', ?, ?, 'old', '[]', '{}', ?)")
    .bind(keys.p256dh, keys.auth, new Date().toISOString())
    .run();
  const push = stubPush();
  const res = (await (await request('/api/push/test/legacy', { method: 'POST' })).json()) as any;
  push.restore();
  assert.equal(res.ok, true);
  const payload = JSON.parse(await referenceDecrypt(push.sent[0].body!, keys.privateKey, keys.p256dh, keys.auth));
  assert.match(payload.title, /Notifications are on/);
  const stored = await env.DB.prepare("SELECT p256dh, auth FROM push_subscriptions WHERE id = 'legacy'").first<{ p256dh: string; auth: string }>();
  assert.ok(stored!.p256dh.startsWith('v1:') && stored!.auth.startsWith('v1:'));
  assert.equal(await decrypt(env, stored!.auth, 'legacy'), keys.auth);
});

test('push: /api/push/test sends a push and records last_success_at; a 410 deletes the subscription', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const { row } = await subscribe(request, ADMIN_KEY, 'phone');

  const ok = stubPush();
  const res1 = await request(`/api/push/test/${row.id}`, { method: 'POST' });
  assert.equal(((await res1.json()) as any).ok, true);
  ok.restore();
  const afterOk = (await (await request('/api/push/subscriptions')).json()) as any[];
  assert.ok(afterOk[0].lastSuccessAt);

  const gone = stubPush(new Set([`push.example/phone`]));
  await request(`/api/push/test/${row.id}`, { method: 'POST' });
  gone.restore();
  const afterGone = (await (await request('/api/push/subscriptions')).json()) as any[];
  assert.equal(afterGone.length, 0);
});

test('notify: event reminder fires once inside the window, dedupes on a second tick, and respects member filter', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const members = [];
  for (const [name, color] of [['Ava', '#e57'], ['Bo', '#5ae']] as const) {
    members.push((await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name, color }) })).json()) as any);
  }
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;

  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000); // fires now with a 30-min reminder
  await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      calendarId: cal.id,
      title: 'Dentist',
      start: start.toISOString(),
      end: new Date(start.getTime() + 30 * 60 * 1000).toISOString(),
      allDay: false,
      memberIds: [members[0].id],
      reminders: [30],
    }),
  });

  const { row: subFollowsAva } = await subscribe(request, ADMIN_KEY, 'follows-ava', { eventReminders: true });
  await request(`/api/push/subscriptions/${subFollowsAva.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [members[0].id] }) });
  const { row: subFollowsBo } = await subscribe(request, ADMIN_KEY, 'follows-bo', { eventReminders: true });
  await request(`/api/push/subscriptions/${subFollowsBo.id}`, { method: 'PATCH', body: JSON.stringify({ memberIds: [members[1].id] }) });

  const push = stubPush();
  await runNotifications(env, now);
  assert.equal(push.sent.length, 1, 'only the device following Ava gets it');
  assert.ok(push.sent[0].url.includes('follows-ava'));

  await runNotifications(env, now); // second tick, same window - must not re-send
  assert.equal(push.sent.length, 1, 'deduped via sent_notifications');
  push.restore();
});

test('notify: recurring local event reminder fires for the right occurrence', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;
  const now = new Date();
  // A daily event whose *today* occurrence starts in 15 minutes - anchor the series far enough
  // in the past that RRULE FREQ=DAILY has already produced today's instance.
  const seriesStart = new Date(now.getTime() + 15 * 60 * 1000 - 2 * 24 * 60 * 60 * 1000);
  await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({
      calendarId: cal.id,
      title: 'Standup',
      start: seriesStart.toISOString(),
      end: new Date(seriesStart.getTime() + 15 * 60 * 1000).toISOString(),
      allDay: false,
      rrule: 'FREQ=DAILY',
      reminders: [15],
    }),
  });
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  await subscribe(request, ADMIN_KEY, 'wall', { eventReminders: true });

  const push = stubPush();
  await runNotifications(env, now);
  assert.equal(push.sent.length, 1);
  push.restore();
});

test('notify: provider (own) reminders take priority over the household default', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultReminderMinutes: [60], timezone: 'UTC' }) });
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;
  const now = new Date();
  // A 5-minute-before reminder set on the event itself; the household default (60) would not
  // fire yet for a start this close, so only firing at all proves the event's own value was used.
  const start = new Date(now.getTime() + 5 * 60 * 1000);
  await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: cal.id, title: 'Call', start: start.toISOString(), end: new Date(start.getTime() + 30 * 60 * 1000).toISOString(), allDay: false, reminders: [5] }),
  });
  await subscribe(request, ADMIN_KEY, 'wall', { eventReminders: true });

  const push = stubPush();
  await runNotifications(env, now);
  assert.equal(push.sent.length, 1);
  push.restore();
});

test('reminders: an event with reminders turned off stays silent; source says where reminders came from', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ defaultReminderMinutes: [30] }) });
  const cal = await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Fam' }) })).json() as any;
  const mk = async (reminders?: number[] | null) => (await (await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 't', start: '2030-01-01T10:00:00Z', end: '2030-01-01T11:00:00Z', allDay: false, ...(reminders !== undefined ? { reminders } : {}) }) })).json()) as any;
  const dflt = await mk()
  assert.deepEqual([dflt.reminders, dflt.reminderSource], [[30], 'default']);
  const own = await mk([10]);
  assert.deepEqual([own.reminders, own.reminderSource], [[10], 'event']);
  const off = await mk([]);
  assert.deepEqual([off.reminders, off.reminderSource], [null, null]);
});

test('notify: a reminder carries long-press details and a link that opens the event', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const ava = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#e57' }) })).json()) as any;
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;
  const now = new Date();
  const start = new Date(now.getTime() + 15 * 60 * 1000);
  const ev = (await (await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: cal.id, title: 'Dentist', start: start.toISOString(), end: new Date(start.getTime() + 1800e3).toISOString(), allDay: false, memberIds: [ava.id], reminders: [15], location: '210 Oak St\nSpringfield', description: 'Bring the <b>insurance</b> card' }),
  })).json()) as any;
  const { keys } = await subscribe(request, ADMIN_KEY, 'phone', { eventReminders: true });

  const push = stubPush();
  await runNotifications(env, now);
  push.restore();
  assert.equal(push.sent.length, 1);
  const payload = JSON.parse(await referenceDecrypt(push.sent[0].body!, keys.privateKey, keys.p256dh, keys.auth));
  assert.equal(payload.title, 'Dentist');
  const lines = payload.body.split('\n');
  assert.match(lines[0], /^In 15 minutes · /);
  assert.ok(lines.includes('📍 210 Oak St, Springfield'), payload.body);
  assert.ok(lines.includes('👥 Ava'), payload.body);
  assert.ok(lines.includes('🗓 Home'), payload.body);
  assert.ok(lines.includes('Bring the insurance card'), payload.body);
  assert.ok(payload.url.startsWith(`/#/calendar?event=${ev.id}&at=`), payload.url);
});

test('notify: the daily summary lists open tasks linked to today\'s events, important ones first and starred', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;
  const mkEvent = async (title: string) =>
    (await (await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title, start: '2030-03-04T16:00:00Z', end: '2030-03-04T17:00:00Z', allDay: false }) })).json()) as any;
  const soccer = await mkEvent('Soccer');
  await mkEvent('Piano');
  const list = (await (await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'To do', kind: 'todo' }) })).json()) as any;
  const items = (await (await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify(['Cleats', 'Water', 'Shin guards', 'Snack', 'Ball', 'Old'].map((title) => ({ title, eventId: soccer.id }))) })).json()) as any[];
  await request(`/api/lists/${list.id}/items/${items[5].id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
  await request(`/api/lists/${list.id}/items/${items[3].id}`, { method: 'PATCH', body: JSON.stringify({ priority: 'high' }) }); // important: first, starred
  const { keys } = await subscribe(request, ADMIN_KEY, 'phone', { dailySummary: true, summaryTime: '07:30', eventReminders: false });

  const push = stubPush();
  await runNotifications(env, new Date('2030-03-04T07:30:00Z'));
  push.restore();
  assert.equal(push.sent.length, 1);
  const payload = JSON.parse(await referenceDecrypt(push.sent[0].body!, keys.privateKey, keys.p256dh, keys.auth));
  assert.equal(payload.body, "2 events · 0 chores — Soccer, Piano\nTo do for today's events:\n• Soccer — ⭐ Snack, Cleats, Water +2 more");
});

test('notify: the daily summary adds a short "Due today" line for open list items due today (any list), urgent ones first', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const mk = async (name: string) => (await (await request('/api/lists', { method: 'POST', body: JSON.stringify({ name, kind: 'todo' }) })).json()) as any;
  const todo = await mk('To do');
  const school = await mk('School');
  await request(`/api/lists/${todo.id}/items`, { method: 'POST', body: JSON.stringify([{ title: 'Library books', dueDate: '2030-03-04' }, { title: 'Tomorrow', dueDate: '2030-03-05' }]) });
  const [done] = (await (await request(`/api/lists/${school.id}/items`, { method: 'POST', body: JSON.stringify([{ title: 'Old', dueDate: '2030-03-04' }, { title: 'Permission slip', dueDate: '2030-03-04', priority: 'urgent' }]) })).json()) as any[];
  await request(`/api/lists/${school.id}/items/${done.id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
  const { keys } = await subscribe(request, ADMIN_KEY, 'phone', { dailySummary: true, summaryTime: '07:30', eventReminders: false });

  const push = stubPush();
  await runNotifications(env, new Date('2030-03-04T07:30:00Z'));
  push.restore();
  const payload = JSON.parse(await referenceDecrypt(push.sent[0].body!, keys.privateKey, keys.p256dh, keys.auth));
  assert.equal(payload.body, '0 events · 0 chores\nDue today: ‼️ Permission slip, Library books');
});

test('notify: remindBeforeLeave counts reminders back from the leave-by time and says when to leave', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;
  const now = new Date();
  // Starts in 40 min with 30 min travel: leave-by is in 10 min, so a 10-min reminder is due now
  // only when it counts back from leaving.
  const start = new Date(now.getTime() + 40 * 60 * 1000);
  const ev = (title: string, remindBeforeLeave: boolean) =>
    request('/api/events', {
      method: 'POST',
      body: JSON.stringify({ calendarId: cal.id, title, start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), allDay: false, reminders: [10], travelMinutes: 30, remindBeforeLeave }),
    });
  await ev('Soccer', true);
  await ev('Piano', false); // same travel, reminders stay relative to start: fires in 30 min, not now
  const { keys } = await subscribe(request, ADMIN_KEY, 'phone', { eventReminders: true });

  const push = stubPush();
  await runNotifications(env, now);
  push.restore();
  assert.equal(push.sent.length, 1);
  const payload = JSON.parse(await referenceDecrypt(push.sent[0].body!, keys.privateKey, keys.p256dh, keys.auth));
  assert.equal(payload.title, 'Soccer');
  const leave = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(start.getTime() - 30 * 60 * 1000));
  assert.match(payload.body.split('\n')[0], new RegExp(`^Leave by ${leave} for Soccer · starts `));
});

// --- In-app notification feed (GET /api/notifications) ---

const feed = async (request: ReturnType<typeof makeApp>, qs = '', key = ADMIN_KEY) => (await (await request(`/api/notifications${qs}`, {}, key)).json()) as any[];

test('feed: a reminder is recorded once with no push subscriptions at all, deep-linked, for the event\'s members, and bumps rev', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const ava = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Ava', color: '#e57' }) })).json()) as any;
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  const ev = (await (await request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title: 'Dentist', start: start.toISOString(), end: new Date(start.getTime() + 1800e3).toISOString(), allDay: false, memberIds: [ava.id], reminders: [30] }) })).json()) as any;
  const rev0 = ((await (await request('/api/rev')).json()) as any).rev;

  await runNotifications(env, now);
  await runNotifications(env, now); // second tick: no duplicate
  const rows = (await feed(request)).filter((n) => n.kind === 'reminder');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Dentist');
  assert.equal(rows[0].source, 'system');
  assert.deepEqual(rows[0].memberIds, [ava.id]);
  assert.ok(rows[0].url.startsWith(`/#/calendar?event=${ev.id}&at=`));
  assert.match(rows[0].body, /^In 30 minutes · /);
  assert.ok(((await (await request('/api/rev')).json()) as any).rev > rev0, 'recording bumps rev so open clients refresh');
});

test('feed: the daily summary and chore nudge are recorded household-wide at the default time, or a device\'s earlier time, once a day', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const bo = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Bo', color: '#5ae' }) })).json()) as any;
  await request('/api/chores', { method: 'POST', body: JSON.stringify({ title: 'Feed cat', memberId: bo.id, dueDate: '2030-03-04' }) });

  await runNotifications(env, new Date('2030-03-04T07:30:00Z')); // no subscriptions
  await runNotifications(env, new Date('2030-03-04T08:00:00Z'));
  let rows = await feed(request);
  assert.deepEqual(rows.map((n) => n.kind), ['chore', 'summary']);
  assert.equal(rows[1].title, 'Today');
  assert.match(rows[1].body, /^0 events · 1 chore/);
  assert.equal(rows[0].title, '1 chore left today');
  assert.deepEqual(rows[0].memberIds, [bo.id]);

  // Next day a phone wants its summary at 06:00: the feed copy comes with it, not again at 07:30.
  await subscribe(request, ADMIN_KEY, 'phone', { dailySummary: true, summaryTime: '06:00', eventReminders: false });
  const push = stubPush();
  await runNotifications(env, new Date('2030-03-05T06:00:00Z'));
  await runNotifications(env, new Date('2030-03-05T07:30:00Z'));
  push.restore();
  assert.equal(push.sent.length, 1);
  rows = (await feed(request)).filter((n) => n.kind === 'summary');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].at, '2030-03-05T06:00:00.000Z');
});

test('notify: a tick a few minutes late still catches a summary/nudge time, once', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const { keys } = await subscribe(request, ADMIN_KEY, 'phone', { dailySummary: true, summaryTime: '07:30', eventReminders: false });

  const push = stubPush();
  await runNotifications(env, new Date('2030-03-04T07:33:00Z')); // cron/interval tick landed a few minutes past :30
  await runNotifications(env, new Date('2030-03-04T07:35:00Z')); // next tick, same window - must not resend
  push.restore();
  assert.equal(push.sent.length, 1);
  const payload = JSON.parse(await referenceDecrypt(push.sent[0].body!, keys.privateKey, keys.p256dh, keys.auth));
  assert.equal(payload.title, 'Today');
});

test('notify: a >24h gap since the last tick does not replay yesterday\'s summary time', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  await subscribe(request, ADMIN_KEY, 'phone', { dailySummary: true, summaryTime: '07:30', eventReminders: false });

  const push = stubPush();
  await runNotifications(env, new Date('2030-03-04T07:30:00Z')); // establishes a last-tick baseline
  assert.equal(push.sent.length, 1);
  // Next tick is 26h later, at an hour that isn't near 07:30 on either day - simulating downtime.
  await runNotifications(env, new Date('2030-03-05T09:30:00Z'));
  push.restore();
  assert.equal(push.sent.length, 1, 'a long gap must not replay a stale time-of-day match');
});

test('notify: Workers\' 5-minute cadence still fires a :30 summary time', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const { keys } = await subscribe(request, ADMIN_KEY, 'phone', { dailySummary: true, summaryTime: '07:30', eventReminders: false });

  const push = stubPush();
  for (const hm of ['07:20', '07:25', '07:30', '07:35']) await runNotifications(env, new Date(`2030-03-04T${hm}:00Z`));
  push.restore();
  assert.equal(push.sent.length, 1);
  const payload = JSON.parse(await referenceDecrypt(push.sent[0].body!, keys.privateKey, keys.p256dh, keys.auth));
  assert.equal(payload.title, 'Today');
});

test('feed: a list update is recorded even when no device follows list updates', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const list = (await (await request('/api/lists', { method: 'POST', body: JSON.stringify({ name: 'Groceries', kind: 'shopping' }) })).json()) as any;
  await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Milk' }) });
  await request(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ title: 'Eggs' }) }); // same 10-min bucket
  await new Promise((r) => setTimeout(r, 50)); // background (waitUntil) task on Node
  const rows = await feed(request);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'list');
  assert.equal(rows[0].body, 'Groceries has new items');
  assert.equal(rows[0].url, `/#/lists?list=${list.id}`); // tap opens that list
});

test('feed: /api/notify records a message (source api) with no subscriptions; the route orders, pages, and is display-readable', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  for (const title of ['One', 'Two', 'Three']) {
    const res = (await (await request('/api/notify', { method: 'POST', body: JSON.stringify({ title, body: 'b', url: '/#/lists' }) })).json()) as any;
    assert.equal(res.sent, 0);
    await new Promise((r) => setTimeout(r, 2)); // distinct timestamps
  }
  const rows = await feed(request);
  assert.deepEqual(rows.map((n) => n.title), ['Three', 'Two', 'One']);
  assert.equal(rows[0].kind, 'message');
  assert.equal(rows[0].source, 'api');
  assert.equal(rows[0].url, '/#/lists');
  assert.deepEqual((await feed(request, `?before=${encodeURIComponent(rows[0].at)}`)).map((n) => n.title), ['Two', 'One']);
  assert.deepEqual((await feed(request, '?limit=1')).map((n) => n.title), ['Three']);

  const display = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Wall', scope: 'display' }) })).json()) as any;
  assert.equal((await feed(request, '', display.key)).length, 3);
  assert.equal((await request('/api/notifications', {}, 'nope')).status, 401);
});

test('feed: the tick prunes notifications older than 90 days', async () => {
  const env = makeEnv();
  const now = new Date('2030-06-01T12:03:00Z');
  const ins = env.DB.prepare("INSERT INTO notifications (id, at, kind, title) VALUES (?, ?, 'message', 't')");
  await env.DB.batch([ins.bind('old', '2030-02-01T00:00:00.000Z'), ins.bind('new', '2030-05-01T00:00:00.000Z')]);
  await runNotifications(env, now);
  const { results } = await env.DB.prepare('SELECT id FROM notifications').all<{ id: string }>();
  assert.deepEqual(results.map((r) => r.id), ['new']);
});

test('feed: DELETE /api/notifications/:id and DELETE /api/notifications clear entries, admin only', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/notify', { method: 'POST', body: JSON.stringify({ title: 'one', body: 'b' }) });
  await request('/api/notify', { method: 'POST', body: JSON.stringify({ title: 'two', body: 'b' }) });
  const [first] = await feed(request);
  const display = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'D', scope: 'display' }) })).json()) as any;
  assert.equal((await request(`/api/notifications/${first.id}`, { method: 'DELETE' }, display.key)).status, 403);
  assert.equal((await request('/api/notifications', { method: 'DELETE' }, display.key)).status, 403);
  assert.equal((await request(`/api/notifications/${first.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/notifications/${first.id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await feed(request)).length, 1);
  const all = (await (await request('/api/notifications', { method: 'DELETE' })).json()) as any;
  assert.deepEqual(all, { ok: true, deleted: 1 });
  assert.equal((await feed(request)).length, 0);
});
