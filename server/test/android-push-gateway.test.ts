import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey, sha256Hex } from '../src/auth.ts';
import { decrypt } from '../src/crypto.ts';
import { pushToMembers, runNotifications } from '../src/notify.ts';
import { revokeAndroidGateways } from '../src/android-push-gateway.ts';
import type { Env } from '../src/env.ts';

const TOKEN = 'obvious-fake-FCM:CaseSensitiveToken';
const CREDENTIAL = `android-v1.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.${'b'.repeat(64)}`;
const RENEWED = CREDENTIAL.replace(/b/g, 'c');
const APPLE = `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.${'b'.repeat(64)}`;
const ORIGIN = 'https://our-family.example';
async function fixture() {
  const DB = openDb(':memory:');
  applyMigrations(DB, fileURLToPath(new URL('../migrations', import.meta.url)));
  const phone = await createApiKey(DB, 'Android', 'display');
  const other = await createApiKey(DB, 'Other Android', 'display');
  const metadata = { server: ORIGIN, kind: 'android-alert', tokenHash: await sha256Hex(TOKEN), expiresAt: Date.now() + 3600000 };
  let status = 200;
  const calls: { url: string; init?: RequestInit }[] = [];
  const env: Env = { DB, PUBLIC_URL: ORIGIN + '/path', ADMIN_API_KEY: 'fake-admin', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    NATIVE_PUSH_SEND: async () => assert.fail('Android reached Apple host adapter'), APNS_SEND: async () => assert.fail('Android reached APNs'),
    FCM_FETCH: async () => assert.fail('unconfigured direct FCM transport'),
    PUSH_GATEWAY_FETCH: async (input, init) => {
      const url = String(input); calls.push({ url, init });
      assert.ok(url.startsWith('https://push.kinwall.family/v1/android/'), 'no Apple endpoint');
      assert.equal(init?.redirect, 'manual');
      if (url.endsWith('/verify')) return Response.json(metadata);
      if (init?.method === 'DELETE') return Response.json({ revoked: true });
      return Response.json({ ok: status === 200, gone: status === 410 }, { status });
    } };
  const app = createApp(), background: Promise<unknown>[] = [];
  const drain = async () => { while (background.length) await Promise.all(background.splice(0)); };
  const request = async (path: string, method = 'GET', body?: unknown, bearer = phone.key) => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env, { waitUntil: p => background.push(p), passThroughOnException() {}, props: {} });
    await drain(); return res;
  };
  const register = (gateway: unknown = { credential: CREDENTIAL }, token = TOKEN, bearer = phone.key) => request('/api/push/android', 'PUT', { token, ...(gateway === undefined ? {} : { gateway }) }, bearer);
  return { DB, env, phone, other, metadata, calls, request, register, setStatus: (n: number) => { status = n; } };
}

test('Android gateway verifies transport-bound metadata, encrypts capability and sends scoped full alerts without raw tokens', async () => {
  const { DB, env, calls, register, request } = await fixture();
  const initial = await request('/api/push/android', 'PUT', { token: TOKEN });
  const notReady = await initial.json() as any;
  assert.equal(notReady.push, false); assert.equal(notReady.gatewayAvailable, true);
  const response = await register(); assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json() as any;
  assert.equal(result.push, true); assert.equal(result.delivery, 'gateway'); assert.ok(result.gatewayExpiresAt > Date.now());
  assert.equal(result.subscription.prefs.eventReminders, false); assert.equal(result.subscription.prefs.newChores, false);
  const row = await DB.prepare('SELECT * FROM push_subscriptions').first<any>();
  assert.ok(!JSON.stringify(row).includes(CREDENTIAL)); assert.ok(!JSON.stringify(row).includes(TOKEN));
  assert.equal(await decrypt(env, row.gateway_credential, `push-gateway:${row.id}`), CREDENTIAL);
  assert.equal(calls[0].url, 'https://push.kinwall.family/v1/android/registration/verify');
  assert.equal(calls[0].init?.body, undefined, 'token is never sent for verification');
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Family message', url: '/#/lists', tag: 'fake-tag' }), 1);
  const sent = calls[1];
  assert.equal(sent.url, 'https://push.kinwall.family/v1/android/send');
  assert.deepEqual(JSON.parse(String(sent.init?.body)), { type: 'android-alert', payload: { title: 'Hello', body: 'Family message', url: '/#/lists', tag: 'fake-tag' } });
  assert.equal(new Headers(sent.init?.headers).get('Authorization'), `Bearer ${CREDENTIAL}`);
  assert.ok(!String(sent.init?.body).includes(TOKEN));
});

test('Android gateway rejects Apple credentials, wrong case/server/kind/expiry and preserves existing subscription on failed verification', async () => {
  const { DB, metadata, calls, register, request } = await fixture();
  assert.equal((await register()).status, 200);
  const before = await DB.prepare('SELECT * FROM push_subscriptions').first<any>();
  for (const change of [{ server: 'https://wrong.example' }, { kind: 'alert' }, { tokenHash: await sha256Hex(TOKEN.toLowerCase()) }, { expiresAt: 0 }, { expiresAt: Date.now() + 32 * 86400000 }]) {
    const original = { ...metadata }; Object.assign(metadata, change);
    assert.equal((await register()).status, 400);
    assert.deepEqual(await DB.prepare('SELECT * FROM push_subscriptions').first<any>(), before);
    Object.assign(metadata, original);
  }
  const count = calls.length;
  assert.equal((await register({ credential: APPLE })).status, 400); assert.equal(calls.length, count);
  assert.equal((await request('/api/push/native', 'PUT', { token: 'ab'.repeat(32), gateway: { credential: CREDENTIAL } })).status, 400);
  assert.equal(calls.length, count, 'Android capabilities never enter Apple verification');
});

test('Android gateway renewals preserve prefs, member IDs, identity and expiry; rotations detach stale capability', async () => {
  const { DB, metadata, register, request } = await fixture();
  const first = await (await register()).json() as any;
  const member = await (await request('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' }, 'fake-admin')).json() as any;
  const id = first.subscription.id;
  await request(`/api/push/subscriptions/${id}`, 'PATCH', { memberIds: [member.id], prefs: { newChores: true, eventReminders: true } });
  const ordinary = await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any;
  assert.equal(ordinary.delivery, 'gateway'); assert.equal(ordinary.subscription.prefs.newChores, true);
  metadata.expiresAt += 60000;
  const renewed = await (await register({ credential: RENEWED })).json() as any;
  assert.equal(renewed.subscription.id, id); assert.equal(renewed.subscription.prefs.eventReminders, false);
  assert.equal(renewed.subscription.prefs.newChores, true); assert.deepEqual(renewed.subscription.memberIds, [member.id]);
  assert.equal(renewed.gatewayExpiresAt, metadata.expiresAt);
  const rotated = await (await request('/api/push/android', 'PUT', { token: 'obvious-fake-rotated-token' })).json() as any;
  assert.equal(rotated.push, false); assert.equal(rotated.subscription.id, id);
  assert.equal((await DB.prepare('SELECT gateway_credential FROM push_subscriptions').first<any>()).gateway_credential, null);
});

test('Android gateway expiry/auth rejection disables readiness, outages retain capability, only 410 gone retires token', async () => {
  const { DB, env, register, request, setStatus } = await fixture();
  await register();
  for (const status of [400, 413, 429, 503]) {
    setStatus(status); assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Private content' }), 0);
    assert.equal((await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any).delivery, 'gateway');
  }
  for (const status of [401, 403]) {
    await register(); setStatus(status); await pushToMembers(env, [], { title: 'Test', body: 'Private content' });
    assert.equal((await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any).push, false);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1);
  }
  await register(); await DB.prepare('UPDATE push_subscriptions SET gateway_expires_at=0').run();
  assert.equal((await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any).push, false);
  await register(); setStatus(410); await pushToMembers(env, [], { title: 'Test', body: 'Retire' });
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
});

test('Android gateway availability uses configured canonical origin, including saved local origins; plaintext capabilities and redirects fail closed', async () => {
  const { DB, env, metadata, register, request, calls } = await fixture();
  env.PUBLIC_URL = undefined;
  assert.equal((await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any).gatewayAvailable, false);
  await DB.prepare("INSERT INTO settings(key,value) VALUES ('publicUrl','http://kinwall.local:8080/path')").run(); metadata.server = 'http://kinwall.local:8080';
  assert.equal((await register()).status, 200);
  await DB.prepare('UPDATE push_subscriptions SET gateway_credential=?').bind(CREDENTIAL).run();
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Test' }), 0);
  env.PUBLIC_URL = 'https://user:secret@our-family.example';
  const count = calls.length;
  assert.equal((await register()).status, 400); assert.equal(calls.length, count);
  env.PUBLIC_URL = ORIGIN;
  env.PUSH_GATEWAY_FETCH = async (_url, init) => { assert.equal(init?.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://wrong.example' } }); };
  assert.equal((await register()).status, 400);
});

test('Android gateway revokes retired capabilities upstream after key deletion, bounded and without blocking sign-out', async () => {
  const { DB, env, phone, calls, register, request } = await fixture();
  await register();
  assert.equal((await request(`/api/keys/${phone.id}`, 'DELETE', undefined, 'fake-admin')).status, 200);
  assert.equal(calls.filter(c => c.init?.method === 'DELETE').length, 0, 'local removal does not wait on the gateway');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
  const queued = await DB.prepare('SELECT credential FROM android_push_revocations').first<any>();
  assert.ok(queued && !queued.credential.includes(CREDENTIAL), 'queued capability stays encrypted');
  await revokeAndroidGateways(env);
  const revoke = calls.find(c => c.init?.method === 'DELETE');
  assert.equal(revoke?.url, 'https://push.kinwall.family/v1/android/registration');
  assert.equal(new Headers(revoke?.init?.headers).get('Authorization'), `Bearer ${CREDENTIAL}`);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM android_push_revocations').first<any>()).n, 0);

  // Keep a real encrypted capability from a detached subscription, so failures reach HTTP.
  const second = await createApiKey(DB, 'Retry Android', 'display');
  const restored = await register({ credential: CREDENTIAL }, TOKEN, second.key);
  assert.equal(restored.status, 200);
  const id = (await restored.json() as any).subscription.id;
  await request(`/api/push/subscriptions/${id}`, 'DELETE', undefined, second.key);
  let attempts = 0;
  env.PUSH_GATEWAY_FETCH = async (_url, init) => { assert.equal(init?.method, 'DELETE'); attempts++; return new Response(null, { status: 503 }); };
  const now = Date.now();
  await revokeAndroidGateways(env, now);
  assert.equal(attempts, 1);
  await revokeAndroidGateways(env, now + 299999); assert.equal(attempts, 1, 'five-minute backoff');
  await revokeAndroidGateways(env, now + 300000); assert.equal(attempts, 2);
  await revokeAndroidGateways(env, now + 600000); assert.equal(attempts, 3);
  await revokeAndroidGateways(env, now + 900000); assert.equal(attempts, 3, 'no fourth attempt');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM android_push_revocations').first<any>()).n, 0);
});

test('Android gateway detach, subscription deletion and OAuth grant revocation queue encrypted cleanup; active renewals and transfers cancel stale cleanup', async () => {
  const { DB, env, phone, other, register, request, calls } = await fixture();
  const result = await (await register()).json() as any;
  await register(); // same capability, re-encrypted on ordinary renewal
  await revokeAndroidGateways(env);
  assert.equal(calls.filter(c => c.init?.method === 'DELETE').length, 0, 'still-active capability is never revoked');
  await register({ credential: CREDENTIAL }, TOKEN, other.key); // same physical phone signs in again
  await revokeAndroidGateways(env);
  assert.equal(calls.filter(c => c.init?.method === 'DELETE').length, 0, 'transferred active capability is retained');
  assert.equal((await request(`/api/push/subscriptions/${result.subscription.id}`, 'DELETE')).status, 404, 'old sign-in retired');
  const current = await (await request('/api/push/subscriptions', 'GET', undefined, other.key)).json() as any[];
  assert.equal((await request(`/api/push/subscriptions/${current[0].id}`, 'DELETE', undefined, phone.key)).status, 403);
  const cleared = await (await register(null, TOKEN, other.key)).json() as any;
  assert.equal(cleared.push, false);
  assert.equal(calls.filter(c => c.init?.method === 'DELETE').length, 0, 'detaching does not wait for network');
  await revokeAndroidGateways(env);
  assert.equal(calls.filter(c => c.init?.method === 'DELETE').length, 1);
  await register({ credential: RENEWED }, TOKEN, other.key);
  assert.equal((await request(`/api/push/subscriptions/${current[0].id}`, 'DELETE', undefined, other.key)).status, 200);
  await revokeAndroidGateways(env);
  assert.equal(calls.filter(c => c.init?.method === 'DELETE').length, 2);

  await DB.prepare("INSERT INTO oauth_clients(id,name,redirect_uris,created_at) VALUES('app','Test app','[]',?)").bind(new Date().toISOString()).run();
  await DB.prepare("INSERT INTO oauth_grants(id,client_id,scope,created_at,device_app) VALUES('grant','app','display',?,1)").bind(new Date().toISOString()).run();
  await DB.prepare("UPDATE api_keys SET kind='oauth',oauth_grant_id='grant' WHERE id=?").bind(phone.id).run();
  const oauth = await register(); assert.equal(oauth.status, 200);
  await DB.prepare("DELETE FROM oauth_grants WHERE id='grant'").run();
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
  assert.ok((await DB.prepare('SELECT credential FROM android_push_revocations').first<any>()).credential.startsWith('v1:'));
  await revokeAndroidGateways(env);
  assert.equal(calls.filter(c => c.init?.method === 'DELETE').length, 3);
});

test('Android gateway retires only old capability on token rotation, and late auth/gone responses preserve replacements', async () => {
  for (const status of [401, 410]) {
    const { DB, env, register, metadata, calls, request } = await fixture();
    const first = await (await register()).json() as any;
    let finish!: (response: Response) => void, started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const original = env.PUSH_GATEWAY_FETCH!;
    env.PUSH_GATEWAY_FETCH = async (url, init) => {
      if (String(url).endsWith('/send')) { started(); return new Promise<Response>(resolve => { finish = resolve; }); }
      return original(url, init);
    };
    const pending = pushToMembers(env, [], { title: 'Test', body: 'Private content' });
    await began;
    const token = status === 410 ? 'obvious-fake-rotated-token' : TOKEN;
    metadata.tokenHash = await sha256Hex(token);
    assert.equal((await register({ credential: RENEWED }, token)).status, 200);
    finish(Response.json({ ok: false, gone: status === 410 }, { status }));
    await pending;
    const ready = await (await request('/api/push/android', 'PUT', { token })).json() as any;
    assert.equal(ready.delivery, 'gateway'); assert.equal(ready.subscription.id, first.subscription.id);
    env.PUSH_GATEWAY_FETCH = original;
    await revokeAndroidGateways(env);
    const deletes = calls.filter(c => c.init?.method === 'DELETE');
    assert.equal(deletes.length, 1); assert.equal(new Headers(deletes[0].init?.headers).get('Authorization'), `Bearer ${CREDENTIAL}`);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1);
  }
});

test('Android direct FCM takes precedence over verified gateway and never fails over on ambiguous transport errors', async () => {
  const { env, register, calls, request } = await fixture();
  await register();
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pem = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))));
  Object.assign(env, { FCM_PROJECT_ID: 'fake-project', FCM_CLIENT_EMAIL: 'fake@fake-project.iam.gserviceaccount.com', FCM_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----` });
  let direct = 0, fail = false;
  env.FCM_FETCH = async input => {
    if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fake-oauth-token', expires_in: 3600 });
    direct++; if (fail) throw new Error('fake-token private body must not be logged');
    return Response.json({ name: 'fake-message' });
  };
  const ready = await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any;
  assert.equal(ready.delivery, 'direct'); assert.equal(ready.gatewayExpiresAt, undefined);
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Private content' }), 1);
  fail = true;
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Private content' }), 0);
  assert.equal(direct, 2); assert.equal(calls.filter(c => c.url.endsWith('/send')).length, 0, 'ambiguous direct send cannot create a second gateway copy');
});

test('Android gateway delivers full medicine and daily chore alerts before cleanup; failed medicine alerts retry encrypted and taken doses cancel them', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-04T08:01:00Z') }); t.after(() => t.mock.timers.reset());
  const { DB, env, phone, other, register, request, metadata, calls, setStatus } = await fixture();
  const admin = async (path: string, method: string, body: unknown) => {
    const res = await request(path, method, body, 'fake-admin'); assert.ok(res.ok, await res.clone().text()); return await res.json() as any;
  };
  await admin('/api/settings', 'PATCH', { timezone: 'UTC', medications: true });
  const maya = await admin('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' });
  await DB.prepare('UPDATE api_keys SET owner=? WHERE id=?').bind(maya.id, phone.id).run();
  const sub = await (await register()).json() as any;
  await request(`/api/push/subscriptions/${sub.subscription.id}`, 'PATCH', { prefs: { choreNudge: true, eventReminders: true } });
  await admin('/api/chores', 'POST', { title: 'Feed the cat', memberId: maya.id, dueDate: '2030-03-04' });
  const med = await admin('/api/medications', 'POST', { memberId: maya.id, name: 'Sample medicine', dose: '1 tablet', times: ['08:00'] });
  metadata.tokenHash = await sha256Hex('fake-other-token');
  const otherSub = await (await register({ credential: RENEWED }, 'fake-other-token', other.key)).json() as any;
  await request(`/api/push/subscriptions/${otherSub.subscription.id}`, 'DELETE', undefined, other.key);
  await DB.prepare('UPDATE android_push_revocations SET created_at=?').bind(Date.now()).run();
  const order: string[] = [], original = env.PUSH_GATEWAY_FETCH!;
  env.PUSH_GATEWAY_FETCH = async (url, init) => { order.push(init?.method === 'DELETE' ? 'revoke' : 'alert'); return original(url, init); };
  setStatus(503);
  await runNotifications(env, new Date('2030-03-04T08:01:00Z'));
  assert.equal(order.at(-1), 'revoke', 'cleanup cannot hold time-sensitive reminders behind gateway timeouts');
  const alerts = calls.filter(c => c.url.endsWith('/send')).map(c => JSON.parse(String(c.init?.body)));
  assert.ok(alerts.some(a => a.payload.tag.startsWith('med:') && a.payload.body === 'Tap to mark it taken.'));
  assert.ok(alerts.some(a => a.payload.tag.startsWith('chore:daily:') && a.payload.body === 'Feed the cat'));
  assert.ok(alerts.every(a => a.type === 'android-alert' && !JSON.stringify(a).includes('Sample medicine') && !JSON.stringify(a).includes('1 tablet')));
  assert.ok((await DB.prepare('SELECT payload FROM push_retries').first<any>()).payload.startsWith('enc:v1:'));
  setStatus(200);
  await runNotifications(env, new Date('2030-03-04T08:06:00Z'));
  assert.equal(await DB.prepare('SELECT * FROM push_retries').first(), null);
  const sentCount = calls.filter(c => c.url.endsWith('/send')).length;
  await runNotifications(env, new Date('2030-03-04T08:11:00Z'));
  assert.equal(calls.filter(c => c.url.endsWith('/send')).length, sentCount);
  t.mock.timers.setTime(new Date('2030-03-05T08:01:00Z').getTime());
  await DB.prepare('UPDATE push_subscriptions SET gateway_expires_at=?').bind(Date.now() + 3600000).run();
  setStatus(503);
  await runNotifications(env, new Date('2030-03-05T08:01:00Z'));
  await admin(`/api/medications/${med.id}/doses`, 'POST', { date: '2030-03-05', time: '08:00', action: 'taken' });
  const before = calls.filter(c => c.url.endsWith('/send')).length;
  setStatus(200); await runNotifications(env, new Date('2030-03-05T08:06:00Z'));
  assert.equal(calls.filter(c => c.url.endsWith('/send')).length, before, 'taken dose cancels pending text');
  assert.equal(await DB.prepare('SELECT * FROM push_retries').first(), null);
});

test('Android revocation batch runs concurrently, claims once, and does not hold the host alarm after reminder delivery', async () => {
  const { DB, env, register, request, metadata } = await fixture();
  for (let i = 0; i < 5; i++) {
    const key = await createApiKey(DB, `Android ${i}`, 'display');
    const token = `fake-fcm-token-${i}`;
    metadata.tokenHash = await sha256Hex(token);
    const credential = CREDENTIAL.replace(/b/g, String(i));
    const res = await register({ credential }, token, key.key);
    assert.equal(res.status, 200);
    const sub = await res.json() as any;
    await request(`/api/push/subscriptions/${sub.subscription.id}`, 'DELETE', undefined, key.key);
  }
  let calls = 0, began!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  env.PUSH_GATEWAY_FETCH = async (_input, init) => { assert.equal(init?.method, 'DELETE'); calls++; if (calls === 5) began(); await waiting; return Response.json({ revoked: true }); };
  const background: Promise<unknown>[] = [];
  let alarmReturned = false;
  const pending = runNotifications(env, new Date(), { waitUntil: p => background.push(p) }).then(() => { alarmReturned = true; });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([started, new Promise<void>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('revocation batch did not start concurrently')), 5000); })]);
    assert.equal(alarmReturned, true, 'host alarm finishes while cleanup is in flight');
    assert.equal(calls, 5, 'all five revokes share one network timeout window');
    await revokeAndroidGateways(env);
    assert.equal(calls, 5, 'another tick cannot reclaim in-flight revokes');
  } finally { clearTimeout(timeout); release(); await pending; await Promise.all(background); }
});

test('Android gateway capability cannot enable Apple Live Activity delivery', async () => {
  const { env, register } = await fixture();
  env.NATIVE_PUSH_SEND = undefined;
  await register();
  const { nativePushConfigured } = await import('../src/native-push.ts');
  assert.equal(await nativePushConfigured(env), false, 'Apple readiness ignores Android capabilities');
});

test('Android push status names the canonical origin the app enrolls with, so an app on another address still verifies', async () => {
  const { DB, env, metadata, request, register } = await fixture();
  const status = await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any;
  assert.equal(status.gatewayServer, ORIGIN, 'the origin of PUBLIC_URL, not the address the request came in on');
  // A saved address works the same; without any, there's nothing to enroll with.
  env.PUBLIC_URL = undefined;
  assert.equal((await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any).gatewayServer, null);
  await DB.prepare("INSERT INTO settings(key,value) VALUES ('publicUrl','http://kinwall.local:8080/path')").run();
  assert.equal((await (await request('/api/push/android', 'PUT', { token: TOKEN })).json() as any).gatewayServer, 'http://kinwall.local:8080');
  // The app enrolled with that origin (the gateway's metadata), whatever address it connects through.
  metadata.server = 'http://kinwall.local:8080';
  const result = await (await register()).json() as any;
  assert.equal(result.push, true); assert.equal(result.gatewayServer, 'http://kinwall.local:8080');
});

test('Android gateway: a refused credential logs why, naming addresses but never the credential or token', async () => {
  const { metadata, register } = await fixture();
  const logged: string[] = [], warn = console.warn;
  console.warn = (...a: unknown[]) => { logged.push(a.join(' ')); };
  try {
    metadata.server = 'http://192.168.1.20:8080';
    assert.equal((await register()).status, 400);
  } finally { console.warn = warn; }
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /http:\/\/192\.168\.1\.20:8080/); assert.match(logged[0]!, /https:\/\/our-family\.example/);
  assert.ok(!logged[0]!.includes(CREDENTIAL) && !logged[0]!.includes(TOKEN));
});
