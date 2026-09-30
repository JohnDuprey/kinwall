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
  const body = await encryptPushPayload({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: sub.p256dh, auth: sub.auth }, plaintext);

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
  const a = await encryptPushPayload({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: sub.p256dh, auth: sub.auth }, 'hello');
  const b = await encryptPushPayload({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: sub.p256dh, auth: sub.auth }, 'hello');
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
    { method: 'POST', body: JSON.stringify({ subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${deviceName}`, keys: { p256dh: sub.p256dh, auth: sub.auth } }, deviceName, prefs }) },
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
  await request('/api/push/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/phone', keys: { p256dh: again.p256dh, auth: again.auth } }, deviceName: 'phone' }) });
  const after = await env.DB.prepare('SELECT id, auth FROM push_subscriptions').first<{ id: string; auth: string }>();
  assert.equal(after!.id, row.id);
  assert.equal(await decrypt(env, after!.auth, row.id), again.auth);
});

test('push: a legacy plaintext-key row still sends and is re-wrapped after the send', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const keys = await makeSubscriberKeys();
  await env.DB.prepare("INSERT INTO push_subscriptions (id, api_key_id, endpoint, p256dh, auth, device_name, member_ids, prefs, created_at) VALUES ('legacy', NULL, 'https://fcm.googleapis.com/fcm/send/old', ?, ?, 'old', '[]', '{}', ?)")
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

  const gone = stubPush(new Set([`fcm.googleapis.com/fcm/send/phone`]));
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

// --- Per-person transition reminders ---

test('transitions: member setting defaults off, validates, round-trips, and only admins set it', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const leo = (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name: 'Leo', color: '#5ae' }) })).json()) as any;
  assert.deepEqual(leo.transitionReminders, { on: false, minutes: [], repeat: null, leaveBy: true });

  const set = (body: unknown, key = ADMIN_KEY) => request(`/api/members/${leo.id}`, { method: 'PATCH', body: JSON.stringify({ transitionReminders: body }) }, key);
  for (const bad of [{ on: true, minutes: [0] }, { on: true, minutes: [121] }, { on: true, minutes: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { on: true, repeat: { every: 10, within: 5 } }, { on: true, repeat: { every: 0, within: 5 } }, { on: true, repeat: { every: 2, within: 10 } }]) {
    assert.equal((await set(bad)).status, 400, JSON.stringify(bad));
  }
  const ok = (await (await set({ on: true, minutes: [10], repeat: { every: 5, within: 30 } })).json()) as any;
  assert.deepEqual(ok.transitionReminders, { on: true, minutes: [10], repeat: { every: 5, within: 30 }, leaveBy: true });
  const listed = (await (await request('/api/members')).json()) as any[];
  assert.deepEqual(listed[0].transitionReminders.repeat, { every: 5, within: 30 });
  // A name change leaves it alone.
  assert.equal(((await (await request(`/api/members/${leo.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Leo B' }) })).json()) as any).transitionReminders.on, true);

  const display = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Wall', scope: 'display' }) })).json()) as any;
  assert.equal((await set({ on: false }, display.key)).status, 403);

  // Export carries it; import restores it.
  const exported = (await (await request('/api/export')).json()) as any;
  assert.equal(exported.members[0].transitionReminders.on, true);
  const target = makeEnv();
  const into = makeApp(target);
  assert.equal((await into('/api/import', { method: 'POST', body: JSON.stringify(exported) })).status, 200);
  assert.deepEqual(((await (await into('/api/members')).json()) as any[])[0].transitionReminders.repeat, { every: 5, within: 30 });
});

test('transitions: expand repeat times, dedupe, latest first', async () => {
  const { transitionTimes, inQuietHours } = await import('../src/notify.ts');
  assert.deepEqual(transitionTimes([10, 5], { every: 5, within: 15 }), [15, 10, 5]);
  assert.deepEqual(transitionTimes([1], { every: 10, within: 30 }), [30, 20, 10, 1]);
  assert.deepEqual(transitionTimes([7, 7], null), [7]);
  assert.equal(inQuietHours('21:00', '07:00', new Date('2030-03-04T23:30:00Z'), 'UTC'), true);
  assert.equal(inQuietHours('21:00', '07:00', new Date('2030-03-04T12:00:00Z'), 'UTC'), false);
  assert.equal(inQuietHours('13:00', '14:00', new Date('2030-03-04T13:59:00Z'), 'UTC'), true);
});

// Leo (transitions on) owns "leo-phone"; Sam owns "sam-phone"; "family-ipad" is shared.
async function transitionsSetup(transitions: Record<string, unknown>, event: Record<string, unknown>) {
  const env = makeEnv();
  const request = makeApp(env);
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'UTC' }) });
  const mk = async (name: string) => (await (await request('/api/members', { method: 'POST', body: JSON.stringify({ name, color: '#5ae' }) })).json()) as any;
  const leo = await mk('Leo');
  const sam = await mk('Sam');
  await request(`/api/members/${leo.id}`, { method: 'PATCH', body: JSON.stringify({ transitionReminders: transitions }) });
  const cal = (await (await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json()) as any;
  const devices: Record<string, { keys: Awaited<ReturnType<typeof makeSubscriberKeys>> }> = {};
  for (const [name, owner] of [['leo-phone', leo.id], ['sam-phone', sam.id], ['family-ipad', 'shared']] as const) {
    const k = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name, scope: 'display' }) })).json()) as any;
    await request(`/api/keys/${k.id}`, { method: 'PATCH', body: JSON.stringify({ owner }) });
    devices[name] = { keys: (await subscribe(request, k.key, name, { eventReminders: true })).keys };
  }
  await request('/api/events', {
    method: 'POST',
    body: JSON.stringify({ calendarId: cal.id, title: 'Soccer practice', allDay: false, memberIds: [leo.id], reminders: [], ...event }),
  });
  const run = async (at: Date) => {
    const push = stubPush();
    await runNotifications(env, at);
    push.restore();
    return Promise.all(push.sent.map(async (s) => ({ device: s.url.split('/').pop()!, payload: JSON.parse(await referenceDecrypt(s.body!, devices[s.url.split('/').pop()!].keys.privateKey, devices[s.url.split('/').pop()!].keys.p256dh, devices[s.url.split('/').pop()!].keys.auth)) })));
  };
  return { request, sam, run, env };
}

const at = (iso: string, plusMin: number) => new Date(Date.parse(iso) + plusMin * 60000);
// A transition headline varies (nudges.ts) but always says what and when: the minutes left or the time.
const says = (title: string, what: string, minutes: number, time: string) => {
  assert.ok(title.includes(what) && (title.includes(`${minutes} min`) || title.includes(time)), title);
  return true;
};

test('transitions: pushes at each time before the member\'s event, only to their own devices, once', async () => {
  const start = '2030-03-04T15:30:00Z';
  const { run } = await transitionsSetup({ on: true, minutes: [10], repeat: { every: 5, within: 15 } }, { start, end: at(start, 60).toISOString() });
  assert.deepEqual(await run(at(start, -20)), [], 'nothing 20 min out');
  const first = await run(at(start, -15));
  assert.equal(first.length, 1);
  assert.equal(first[0].device, 'leo-phone');
  says(first[0].payload.title, 'Soccer practice', 15, '3:30 PM');
  assert.equal(first[0].payload.body, 'Starts at 3:30 PM');
  assert.equal(first[0].payload.tag, `transition:${first[0].payload.url.match(/event=([^&]+)/)![1]}`);
  assert.deepEqual(await run(at(start, -14)), [], 'deduped on the next tick');
  const ten = (await run(at(start, -10)))[0].payload.title, five = (await run(at(start, -5)))[0].payload.title;
  says(ten, 'Soccer practice', 10, '3:30 PM'); says(five, 'Soccer practice', 5, '3:30 PM');
  assert.equal(new Set([first[0].payload.title, ten, five]).size, 3, 'a different line each time');
});

test('transitions: a daily event\'s headlines avoid the person\'s last 10, remembered as part indexes', async () => {
  const start = '2030-03-04T15:30:00Z';
  const { run, env } = await transitionsSetup({ on: true, minutes: [10, 5] }, { start, end: at(start, 60).toISOString(), rrule: 'FREQ=DAILY' });
  const titles: string[] = [];
  const history: string[] = [];
  for (let day = 0; day < 8; day++) for (const before of [-10, -5]) {
    const sent = await run(at(start, day * 1440 + before));
    assert.equal(sent.length, 1);
    titles.push(sent[0].payload.title);
    const row = await env.DB.prepare("SELECT nudges FROM members WHERE name = 'Leo'").first<{ nudges: string }>();
    const seen = JSON.parse(row!.nudges) as { id: string; combo: string; opener: number }[];
    history.push(seen[seen.length - 1].combo);
  }
  const stored = (await env.DB.prepare("SELECT nudges FROM members WHERE name = 'Leo'").first<{ nudges: string }>())!.nudges;
  assert.equal(JSON.parse(stored).length, 10, 'pruned to the last 10');
  assert.doesNotMatch(stored, /Soccer practice|Cleats|shoes|PM|min\b/i, 'part indexes, not text');
  for (let i = 0; i < history.length; i++) assert.ok(!history.slice(Math.max(0, i - 10), i).includes(history[i]), `repeat: ${titles[i]}`);
  assert.match(titles.join('\n'), /Cleats on\?|Shin guards\?|Ball in the bag\?|⚽|🥅/, 'soccer hints');
});

test('transitions: a late tick sends only the latest due time, worded truthfully', async () => {
  const start = '2030-03-04T15:30:00Z';
  const { run } = await transitionsSetup({ on: true, minutes: [10, 7, 4, 2], repeat: null }, { start, end: at(start, 60).toISOString() });
  const sent = await run(at(start, -4)); // 10, 7 and 4 all due at once (a late check)
  assert.equal(sent.length, 1);
  says(sent[0].payload.title, 'Soccer practice', 4, '3:30 PM');
  assert.doesNotMatch(sent[0].payload.title, /\b(10|7) min/);
  says((await run(at(start, -2)))[0].payload.title, 'Soccer practice', 2, '3:30 PM');
});

test('transitions: leave-by counts to leaving when the event has travel time (and can be turned off)', async () => {
  const start = '2030-03-04T15:30:00Z';
  const event = { start, end: at(start, 60).toISOString(), travelMinutes: 20 };
  const leave = await transitionsSetup({ on: true, minutes: [5] }, event);
  const sent = await leave.run(at(start, -25));
  assert.equal(sent.length, 1);
  says(sent[0].payload.title, 'Soccer practice', 5, '3:10 PM');
  assert.equal(sent[0].payload.body, 'Leave by 3:10 PM · starts 3:30 PM');

  const toStart = await transitionsSetup({ on: true, minutes: [5], leaveBy: false }, event);
  assert.deepEqual(await toStart.run(at(start, -25)), []);
  says((await toStart.run(at(start, -5)))[0].payload.title, 'Soccer practice', 5, '3:30 PM');
});

test('transitions: a meal\'s event counts to starting prep, for its cook only', async () => {
  const far = '2030-03-05T15:30:00Z'; // Soccer the next day stays quiet
  const cook = await transitionsSetup({ on: true, minutes: [5] }, { start: far, end: at(far, 60).toISOString() });
  const tacos = (await (await cook.request('/api/recipes', { method: 'POST', body: JSON.stringify({ name: 'Tuesday Tacos', totalMinutes: 40, ingredients: [] }) })).json()) as any;
  const leo = ((await (await cook.request('/api/members')).json()) as any[]).find((m) => m.name === 'Leo');
  const meal = async (assigneeMemberId: string, eaterIds: string[], date: string) => {
    const m = (await (await cook.request('/api/meals', { method: 'POST', body: JSON.stringify({ date, slot: 'dinner', plannedTime: '18:00', recipeId: tacos.id, assigneeMemberId, eaterIds }) })).json()) as any;
    await cook.request(`/api/meals/${m.id}/calendar-event`, { method: 'POST', body: '{}' });
  };
  await meal(leo.id, [cook.sam.id], '2030-03-04');
  // 6:00 PM dinner, 40 minutes of cooking: prep by 5:20 PM, Leo's 5-minute warning at 5:15 PM.
  const sent = await cook.run(new Date('2030-03-04T17:15:00Z'));
  assert.deepEqual(sent.map((s) => [s.device, s.payload.body]), [['leo-phone', 'Start prep by 5:20 PM · starts 6:00 PM']]);
  says(sent[0].payload.title, 'Tuesday Tacos', 5, '5:20 PM');
  assert.doesNotMatch(sent[0].payload.title, /Dinner ·/, 'the meal\'s name, not the event title');

  // Leo eats but Sam cooks: nothing for Leo.
  await meal(cook.sam.id, [leo.id], '2030-03-06');
  assert.deepEqual(await cook.run(new Date('2030-03-06T17:15:00Z')), []);
  assert.deepEqual(await cook.run(new Date('2030-03-06T17:55:00Z')), [], 'nor at the meal time');
});

test('transitions: not doubled with a regular reminder at the same minute on that device', async () => {
  const start = '2030-03-04T15:30:00Z';
  const { run } = await transitionsSetup({ on: true, minutes: [10, 5] }, { start, end: at(start, 60).toISOString(), reminders: [10] });
  // Leo's phone follows everyone (no member filter), so it gets the regular 10-min reminder.
  const ten = await run(at(start, -10));
  const leos = ten.filter((s) => s.device === 'leo-phone');
  assert.equal(leos.length, 1, 'one push, not two');
  assert.equal(leos[0].payload.title, 'Soccer practice'); // the regular one
  says((await run(at(start, -5))).find((s) => s.device === 'leo-phone')!.payload.title, 'Soccer practice', 5, '3:30 PM');
});

test('transitions: never during quiet hours; nothing when off or for other people\'s events', async () => {
  const start = '2030-03-04T22:30:00Z';
  const quiet = await transitionsSetup({ on: true, minutes: [10] }, { start, end: at(start, 60).toISOString() });
  await quiet.request('/api/settings', { method: 'PATCH', body: JSON.stringify({ quietFrom: '22:00', quietTo: '07:00' }) });
  assert.deepEqual(await quiet.run(at(start, -10)), []);

  const day = '2030-03-04T15:30:00Z';
  const off = await transitionsSetup({ on: false, minutes: [10] }, { start: day, end: at(day, 60).toISOString() });
  assert.deepEqual(await off.run(at(day, -10)), []);

  const other = await transitionsSetup({ on: true, minutes: [10] }, { start: day, end: at(day, 60).toISOString() });
  await other.request('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: ((await (await other.request('/api/calendars')).json()) as any[])[0].id, title: 'Piano', start: day, end: at(day, 60).toISOString(), allDay: false, memberIds: [other.sam.id], reminders: [] }) });
  const sent = await other.run(at(day, -10));
  assert.deepEqual(sent.map((s) => s.device), ['leo-phone'], 'Sam\'s piano: no transition push for Leo (Sam has them off)');
  says(sent[0].payload.title, 'Soccer practice', 10, '3:30 PM');
});

test('transitions: times follow the family time format, or the location\'s country on auto', async () => {
  const start = '2030-03-04T15:30:00Z';
  const event = { start, end: at(start, 60).toISOString(), travelMinutes: 20 };
  const h24 = await transitionsSetup({ on: true, minutes: [5] }, event);
  await h24.request('/api/settings', { method: 'PATCH', body: JSON.stringify({ timeFormat: '24' }) });
  const sent = await h24.run(at(start, -25));
  says(sent[0].payload.title, 'Soccer practice', 5, '15:10');
  assert.equal(sent[0].payload.body, 'Leave by 15:10 · starts 15:30');

  const berlin = await transitionsSetup({ on: true, minutes: [5] }, event);
  await berlin.request('/api/settings', { method: 'PATCH', body: JSON.stringify({ location: { name: 'Berlin', lat: 52.52, lon: 13.4, countryCode: 'DE' } }) });
  assert.equal((await berlin.run(at(start, -25)))[0].payload.body, 'Leave by 15:10 · starts 15:30', 'auto in Germany: 24-hour');
});

// Push endpoints are where the server POSTs, so only real browser push services are accepted:
// never a family's own network, the server itself, or any other address.
test('push: only https endpoints on the browser push services are accepted', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const wall = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Wall', scope: 'display' }) })).json()) as any;
  const keys = await makeSubscriberKeys();
  const sub = (endpoint: string) =>
    request('/api/push/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, deviceName: 'd' }) }, wall.key);
  for (const bad of [
    'http://127.0.0.1:8080/internal',
    'https://127.0.0.1/x',
    'https://10.0.0.1/x',
    'https://homeassistant.local/api',
    'https://evil.example/fcm/send/x',
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilpush.apple.com.example/x',
    'https://fcm.googleapis.com:8443/fcm/send/x',
    'https://user@fcm.googleapis.com/fcm/send/x',
    'https://storage.googleapis.com/bucket/x',
    'ftp://updates.push.services.mozilla.com/x',
  ]) {
    assert.equal((await sub(bad)).status, 400, bad);
  }
  for (const good of [
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com/wp/abc',
    'https://android.googleapis.com/gcm/send/abc',
    'https://web.push.apple.com/QGx',
    'https://api.push.apple.com/3/device/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ]) {
    assert.equal((await sub(good)).status, 201, good);
  }
});

test('push: a stored endpoint off the push services is never fetched and is removed; sends never follow redirects and time out', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const keys = await makeSubscriberKeys();
  await env.DB.prepare("INSERT INTO push_subscriptions (id, api_key_id, endpoint, p256dh, auth, device_name, member_ids, prefs, created_at) VALUES ('bad', NULL, 'http://127.0.0.1:9/x', ?, ?, 'old', '[]', '{}', ?)")
    .bind(keys.p256dh, keys.auth, new Date().toISOString())
    .run();
  const realFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('', { status: 201 });
  }) as typeof fetch;
  try {
    const res = (await (await request('/api/push/test/bad', { method: 'POST' })).json()) as any;
    assert.equal(res.ok, false);
    assert.equal(calls.length, 0, 'nothing was fetched');
    assert.equal(await env.DB.prepare("SELECT 1 FROM push_subscriptions WHERE id = 'bad'").first(), null, 'the row is gone');

    const { row } = await subscribe(request, ADMIN_KEY, 'phone');
    assert.equal(((await (await request(`/api/push/test/${row.id}`, { method: 'POST' })).json()) as any).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.redirect, 'manual');
    assert.ok(calls[0].init?.signal instanceof AbortSignal, 'a send has a timeout');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('push: a device keeps at most 10 subscriptions; a new one replaces its oldest', async () => {
  const env = makeEnv();
  const request = makeApp(env);
  const wall = (await (await request('/api/keys', { method: 'POST', body: JSON.stringify({ name: 'Wall', scope: 'display' }) })).json()) as any;
  for (let i = 0; i < 12; i++) {
    await subscribe(request, wall.key, `d${String(i).padStart(2, '0')}`);
    await new Promise((r) => setTimeout(r, 2)); // distinct created_at
  }
  const mine = (await (await request('/api/push/subscriptions', {}, wall.key)).json()) as any[];
  assert.equal(mine.length, 10);
  assert.deepEqual(mine.map((s) => s.deviceName).sort().slice(0, 2), ['d02', 'd03'], 'the two oldest were replaced');
  // Another device's subscriptions don't count against this one.
  await subscribe(request, ADMIN_KEY, 'parent');
  assert.equal(((await (await request('/api/push/subscriptions', {}, wall.key)).json()) as any[]).length, 10);
});
