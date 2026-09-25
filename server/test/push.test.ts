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
