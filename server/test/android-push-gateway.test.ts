import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey, sha256Hex } from '../src/auth.ts';
import { decrypt } from '../src/crypto.ts';
import { pushToMembers } from '../src/notify.ts';
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

  // Outages retry a bounded number of times, then give up.
  await DB.prepare("INSERT INTO android_push_revocations(fingerprint,subscription_id,credential,created_at) VALUES ('f','s','v1:x',?)").bind(Date.now()).run();
  env.PUSH_GATEWAY_FETCH = async () => new Response(null, { status: 503 });
  for (let i = 0; i < 3; i++) await revokeAndroidGateways(env, Date.now() + i * 600000);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM android_push_revocations').first<any>()).n, 0);
});
