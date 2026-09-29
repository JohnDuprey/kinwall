// The iPhone app's Live Activity push: token registration (routes/live-activities.ts), the APNs
// client (apns.ts) and the notify tick starting and ending a leave-by activity (notify.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { apnsJwt, swiftDate, type ApnsRequest } from '../src/apns.ts';
import { runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';

const TOKEN = 'ab'.repeat(32); // an obvious fake
const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function p8() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { pem: `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`, publicKey: pair.publicKey };
}

async function fixture(apns: boolean) {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const sent: ApnsRequest[] = [];
  let status = 200;
  const env: Env = {
    DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    APNS_SEND: async (r) => { sent.push(r); return status === 200 ? { status } : { status, reason: 'Unregistered' }; },
    ...(apns ? { APNS_KEY_ID: 'KEY123', APNS_TEAM_ID: 'TEAM123', APNS_KEY: (await p8()).pem, APNS_BUNDLE_ID: 'family.kinwall.app' } : {}),
  };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown, key = 'test-admin') =>
    app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown, key?: string): Promise<any> => {
    const res = await request(path, method, body, key); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  await json('/api/settings', 'PATCH', { timezone: 'UTC' });
  const sam = await json('/api/members', 'POST', { name: 'Sam', color: '#FF8FA3' });
  await json(`/api/members/${sam.id}`, 'PATCH', { transitionReminders: { on: true, minutes: [10], repeat: { every: 5, within: 30 }, leaveBy: true } });
  const phone = await json('/api/keys', 'POST', { name: "Sam's iPhone", scope: 'display' });
  await json(`/api/keys/${phone.id}`, 'PATCH', { owner: sam.id });
  const cal = await json('/api/calendars', 'POST', { kind: 'local', name: 'Home' });
  const soccer = await json('/api/events', 'POST', { calendarId: cal.id, title: 'Soccer practice', start: '2030-03-04T16:00:00Z', end: '2030-03-04T17:00:00Z', allDay: false, memberIds: [sam.id], travelMinutes: 20, reminders: [] });
  return { env, db, sent, request, json, phone, soccer, setStatus: (s: number) => { status = s; } };
}

test('apns: the provider token is an ES256 JWT that verifies with the key', async () => {
  const { pem, publicKey } = await p8();
  const jwt = await apnsJwt({ APNS_KEY_ID: 'K1', APNS_TEAM_ID: 'T1', APNS_KEY: pem, APNS_BUNDLE_ID: 'b' }, Date.parse('2030-01-01T00:00:00Z'));
  const [h, p, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64(h))), { alg: 'ES256', kid: 'K1' });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64(p))), { iss: 'T1', iat: 1893456000 });
  assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, b64(sig), new TextEncoder().encode(`${h}.${p}`)));
  assert.equal(swiftDate(Date.parse('2001-01-01T00:01:00Z')), 60, 'content-state dates count from 2001');
});

test('live activities: a device registers its tokens (sealed), and revoking the key deletes them', async () => {
  const { db, request, json, phone } = await fixture(false);
  assert.deepEqual(await json('/api/live-activities/tokens', 'PUT', { kind: 'start', token: TOKEN }, phone.key), { push: false });
  assert.equal((await request('/api/live-activities/tokens', 'PUT', { kind: 'start', token: 'not hex!' }, phone.key)).status, 400);
  assert.equal((await request('/api/live-activities/tokens', 'PUT', { kind: 'update', token: TOKEN }, phone.key)).status, 400, 'an update token needs its activity');
  assert.equal((await request('/api/live-activities/tokens', 'PUT', { kind: 'start', token: TOKEN })).status, 400, 'ADMIN_API_KEY is no device');
  await json('/api/live-activities/tokens', 'PUT', { kind: 'start', token: 'cd'.repeat(32) }, phone.key); // replaces
  const rows = (await db.prepare('SELECT token FROM live_activity_tokens').all<{ token: string }>()).results;
  assert.equal(rows.length, 1);
  assert.ok(rows[0].token.startsWith('enc:') && !rows[0].token.includes('cdcd'), 'sealed at rest');
  await json(`/api/keys/${phone.id}`, 'DELETE');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM live_activity_tokens').first<{ n: number }>())!.n, 0);
});

test('live activities: nothing is sent without APNs set up, and nothing fails', async () => {
  const { env, sent, json, phone } = await fixture(false);
  await json('/api/live-activities/tokens', 'PUT', { kind: 'start', token: TOKEN }, phone.key);
  await runNotifications(env, new Date('2030-03-04T15:20:00Z'));
  assert.deepEqual(sent, []);
});

test('live activities: push-to-start at the first transition warning, once; ended when the event starts', async () => {
  const { env, db, sent, json, phone, soccer } = await fixture(true);
  await json('/api/live-activities/tokens', 'PUT', { kind: 'start', token: TOKEN }, phone.key);
  await runNotifications(env, new Date('2030-03-04T15:09:00Z'));
  assert.equal(sent.length, 0, 'before the first warning (30 min before leaving at 3:40 PM)');

  await runNotifications(env, new Date('2030-03-04T15:10:00Z'));
  assert.equal(sent.length, 1);
  const [push] = sent;
  assert.equal(push.host, 'api.push.apple.com');
  assert.equal(push.path, `/3/device/${TOKEN}`);
  assert.equal(push.headers['apns-topic'], 'family.kinwall.app.push-type.liveactivity');
  assert.equal(push.headers['apns-push-type'], 'liveactivity');
  assert.match(push.headers.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  const { aps } = JSON.parse(push.body);
  const activity = `leaveBy:${soccer.id}@2030-03-04T16:00:00.000Z`;
  assert.equal(aps.event, 'start');
  assert.equal(aps['attributes-type'], 'KinwallActivityAttributes');
  assert.deepEqual(aps.attributes, { kind: 'leave', name: 'Soccer practice', eventId: soccer.id, activity, endsAt: swiftDate(Date.parse('2030-03-04T16:00:00Z')) });
  assert.equal(aps['content-state'].date, swiftDate(Date.parse('2030-03-04T15:40:00Z')));
  assert.ok(aps['content-state'].title.includes('Soccer practice') && aps['content-state'].title.includes('3:40 PM'), aps['content-state'].title);
  assert.match(aps['content-state'].detail, /now/);
  assert.equal(aps.alert.body, 'Leave by 3:40 PM · starts 4:00 PM');

  await runNotifications(env, new Date('2030-03-04T15:12:00Z'));
  assert.equal(sent.length, 1, 'once');

  // The app registers the activity's update token; the server ends it when the event starts.
  await json('/api/live-activities/tokens', 'PUT', { kind: 'update', token: 'ef'.repeat(32), activity, endsAt: '2030-03-04T16:00:00Z' }, phone.key);
  await runNotifications(env, new Date('2030-03-04T15:55:00Z'));
  assert.equal(sent.length, 1);
  await runNotifications(env, new Date('2030-03-04T16:00:00Z'));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].path, `/3/device/${'ef'.repeat(32)}`);
  assert.equal(JSON.parse(sent[1].body).aps.event, 'end');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM live_activity_tokens WHERE kind = 'update'").first<{ n: number }>())!.n, 0);
});

test('live activities: not started again when the app already shows it; a gone token is dropped; tokens never logged', async () => {
  const { env, db, sent, json, phone, soccer, setStatus } = await fixture(true);
  await json('/api/live-activities/tokens', 'PUT', { kind: 'start', token: TOKEN }, phone.key);
  await json('/api/live-activities/tokens', 'PUT', { kind: 'update', token: 'ef'.repeat(32), activity: `leaveBy:${soccer.id}@2030-03-04T16:00:00.000Z`, endsAt: '2030-03-04T16:00:00Z' }, phone.key);
  await runNotifications(env, new Date('2030-03-04T15:10:00Z'));
  assert.equal(sent.length, 0, 'the app started it itself');

  await json('/api/live-activities/tokens', 'DELETE', { activity: `leaveBy:${soccer.id}@2030-03-04T16:00:00.000Z` }, phone.key);
  setStatus(410);
  const logged: string[] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
  try { await runNotifications(env, new Date('2030-03-04T15:11:00Z')); } finally { console.error = real; }
  assert.equal(sent.length, 1);
  assert.ok(logged.length > 0 && logged.every((l) => !l.includes('abab')), logged.join('\n'));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM live_activity_tokens').first<{ n: number }>())!.n, 0, 'Apple said it is gone');
});

test('apns: without APNS_SEND it POSTs with fetch (Workers): URL, headers, JWT; 410 or BadDeviceToken means gone', async () => {
  const { sendLiveActivity } = await import('../src/apns.ts');
  const env = { APNS_KEY_ID: 'KEY123', APNS_TEAM_ID: 'TEAM123', APNS_KEY: (await p8()).pem, APNS_BUNDLE_ID: 'family.kinwall.app', APNS_SANDBOX: '1' };
  const real = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  let answer = () => new Response(null, { status: 200 });
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => { calls.push({ url: String(url), init: init! }); return answer(); }) as typeof fetch;
  const errors = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await sendLiveActivity(env, TOKEN, { event: 'end', timestamp: 1 }), { ok: true, gone: false });
    const [{ url, init }] = calls;
    assert.equal(url, `https://api.sandbox.push.apple.com/3/device/${TOKEN}`);
    assert.equal(init.method, 'POST');
    const h = init.headers as Record<string, string>;
    assert.equal(h['apns-topic'], 'family.kinwall.app.push-type.liveactivity');
    assert.equal(h['apns-push-type'], 'liveactivity');
    assert.equal(h['apns-priority'], '10');
    assert.match(h.authorization, /^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.deepEqual(JSON.parse(init.body as string), { aps: { event: 'end', timestamp: 1 } });
    answer = () => Response.json({ reason: 'BadDeviceToken' }, { status: 400 });
    assert.deepEqual(await sendLiveActivity(env, TOKEN, {}), { ok: false, gone: true });
    answer = () => new Response(JSON.stringify({ reason: 'Unregistered' }), { status: 410 });
    assert.deepEqual(await sendLiveActivity(env, TOKEN, {}), { ok: false, gone: true });
    answer = () => Response.json({ reason: 'TooManyRequests' }, { status: 429 });
    assert.deepEqual(await sendLiveActivity(env, TOKEN, {}), { ok: false, gone: false }, 'kept: try again later');
    assert.equal(new URL(calls[1].url).host, 'api.sandbox.push.apple.com');
    assert.equal((await sendLiveActivity({ ...env, APNS_SANDBOX: undefined }, TOKEN, {})).ok, false);
    assert.equal(new URL(calls.at(-1)!.url).host, 'api.push.apple.com');
  } finally { globalThis.fetch = real; console.error = errors; }
});
