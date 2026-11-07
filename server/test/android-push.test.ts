import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import { decrypt } from '../src/crypto.ts';
import { pushToMembers, runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';

const TOKEN = 'obvious-fake-fcm:Android_TOKEN-123';
async function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pem = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))));
  const sent: any[] = [];
  let status = 200, code = '';
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', PUBLIC_URL: 'https://our-family.example/',
    FCM_PROJECT_ID: 'fake-project', FCM_CLIENT_EMAIL: 'fake@fake-project.iam.gserviceaccount.com', FCM_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----`,
    FCM_FETCH: async (input, init) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'obvious-fake-oauth-token', expires_in: 3600 });
      sent.push(JSON.parse(String(init?.body)));
      return Response.json(status === 200 ? { name: 'fake-message' } : { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } }, { status });
    },
    APNS_SEND: async () => assert.fail('Android token reached APNs'), NATIVE_PUSH_SEND: async () => assert.fail('Android token reached Apple host adapter'),
  };
  const app = createApp();
  const background: Promise<unknown>[] = [];
  const drain = async () => { while (background.length) await Promise.all(background.splice(0)); };
  const phone = await createApiKey(db, 'Android', 'display');
  const other = await createApiKey(db, 'Other', 'display');
  const request = (path: string, method = 'GET', body?: unknown, bearer = phone.key) => app.request(path, { method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env, { waitUntil: p => background.push(p), passThroughOnException() {}, props: {} });
  const register = async (token = TOKEN, bearer = phone.key) => {
    const res = await request('/api/push/android', 'PUT', { token, deviceName: 'Kinwall Android' }, bearer);
    assert.equal(res.status, 200, await res.clone().text()); return await res.json() as any;
  };
  const admin = async (path: string, method = 'GET', body?: unknown) => {
    const res = await request(path, method, body, 'test-admin'); await drain(); assert.ok(res.ok, await res.clone().text()); return await res.json() as any;
  };
  return { db, env, sent, phone, other, request, register, admin, drain, setStatus: (s: number, c = '') => { status = s; code = c; } };
}

test('Android registration encrypts opaque tokens, keeps paired identity/preferences, enforces access and cleans up revoke', async () => {
  const { db, env, phone, other, request, register, admin } = await fixture();
  assert.equal((await request('/api/push/android', 'PUT', { token: TOKEN }, '')).status, 401);
  const first = await register();
  assert.equal(first.push, true); assert.equal(first.delivery, 'direct');
  assert.equal(first.subscription.prefs.eventReminders, false); assert.equal(first.subscription.prefs.newChores, false);
  const id = first.subscription.id;
  const maya = await admin('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' });
  const row = await db.prepare('SELECT * FROM push_subscriptions WHERE id=?').bind(id).first<any>();
  assert.match(row.endpoint, /^fcm:[a-f0-9]{64}$/); assert.ok(!JSON.stringify(row).includes(TOKEN)); assert.equal(await decrypt(env, row.auth, id), TOKEN);
  assert.equal((await request(`/api/push/subscriptions/${id}`, 'PATCH', { prefs: { newChores: true } }, other.key)).status, 403);
  await request(`/api/push/subscriptions/${id}`, 'PATCH', { memberIds: [maya.id], prefs: { newChores: true, eventReminders: true } });
  const rotated = await register('obvious-fake-rotated-fcm');
  assert.equal(rotated.subscription.id, id); assert.equal(rotated.subscription.prefs.newChores, true); assert.equal(rotated.subscription.prefs.eventReminders, false);
  assert.deepEqual(rotated.subscription.memberIds, [maya.id]); assert.equal(rotated.subscription.createdAt, first.subscription.createdAt);
  assert.equal((await request('/api/push/android', 'PUT', { token: TOKEN }, 'test-admin')).status, 400);
  assert.equal((await request('/api/push/android', 'PUT', { token: ' ' })).status, 400);
  assert.equal((await request('/api/push/native', 'PUT', { token: TOKEN })).status, 400);
  await request(`/api/keys/${phone.id}`, 'DELETE', undefined, 'test-admin');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
});

test('Android OAuth grant survives access-key rotation, blocks third-party apps, enforces child and retires previous sign-in', async () => {
  const { db, env, phone, other, request, register, admin } = await fixture();
  await db.prepare("INSERT INTO oauth_clients (id,name,redirect_uris,created_at) VALUES ('app','Test app','[]',?)").bind(new Date().toISOString()).run();
  await db.prepare("INSERT INTO oauth_grants (id,client_id,scope,created_at,device_app) VALUES ('grant','app','display',?,1)").bind(new Date().toISOString()).run();
  const maya = await admin('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' });
  await db.prepare("UPDATE api_keys SET kind='oauth',oauth_grant_id='grant',owner=? WHERE id=?").bind(maya.id, phone.id).run();
  const first = await register();
  await request(`/api/push/subscriptions/${first.subscription.id}`, 'PATCH', { memberIds: [], prefs: { newChores: true } });
  const next = await createApiKey(db, 'Rotated Android', 'display');
  await db.prepare("UPDATE api_keys SET kind='oauth',oauth_grant_id='grant',owner=? WHERE id=?").bind(maya.id, next.id).run();
  await db.prepare('DELETE FROM api_keys WHERE id=?').bind(phone.id).run();
  const rotated = await register('another-fake-token', next.key);
  assert.equal(rotated.subscription.id, first.subscription.id); assert.equal(rotated.subscription.prefs.newChores, true); assert.deepEqual(rotated.subscription.memberIds, [maya.id]);
  assert.equal((await request(`/api/push/subscriptions/${first.subscription.id}`, 'PATCH', { deviceName: 'Updated' }, next.key)).status, 200);
  await db.prepare("UPDATE oauth_grants SET device_app=0 WHERE id='grant'").run();
  assert.equal((await request('/api/push/android', 'PUT', { token: TOKEN }, next.key)).status, 403);
  await db.prepare("UPDATE oauth_grants SET device_app=1 WHERE id='grant'").run();
  await db.prepare("UPDATE api_keys SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(next.id).run();
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Expired' }), 0);
  await db.prepare("INSERT INTO oauth_refresh_tokens(hash,grant_id,expires_at) VALUES ('fake-refresh','grant','2099-01-01T00:00:00Z')").run();
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Refreshable' }), 1);
  await register('another-fake-token', other.key);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1, 'same token moves to its new sign-in');
  await db.prepare('UPDATE api_keys SET expires_at=NULL WHERE id=?').bind(next.id).run();
  await register('different-fake-grant-token', next.key);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 2);
  await db.prepare("DELETE FROM oauth_grants WHERE id='grant'").run();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1, 'grant revocation cascades only its subscription');
  const current = (await request('/api/push/subscriptions', 'GET', undefined, other.key));
  const currentId = (await current.json() as any[])[0].id;
  assert.equal((await request(`/api/push/subscriptions/${currentId}`, 'DELETE', undefined, other.key)).status, 200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
});

test('Android new chores use shared recipient rules and exact Expo FCM payload, with one bell entry', async () => {
  const { db, env, sent, register, request, admin, phone, drain } = await fixture();
  const maya = await admin('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6', language: 'de' });
  await db.prepare('UPDATE api_keys SET owner=? WHERE id=?').bind(maya.id, phone.id).run();
  const { subscription } = await register();
  await request(`/api/push/subscriptions/${subscription.id}`, 'PATCH', { prefs: { newChores: true } });
  const chore = await admin('/api/chores', 'POST', { title: 'Feed the cat', memberId: maya.id });
  await drain();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { message: { token: TOKEN, notification: { title: 'Neue Aufgabe', body: 'Feed the cat' }, data: { body: JSON.stringify({ url: '/#/chores', server: 'https://our-family.example' }), tag: `chore:new:${chore.id}` }, android: { priority: 'HIGH', ttl: '0s', notification: { channel_id: 'new_chores', tag: `chore:new:${chore.id}`, sound: 'default' } } } });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind='chore'").first<any>()).n, 1);
  await admin('/api/chores', 'POST', { title: 'Anyone chore' });
  await drain(); assert.equal(sent.length, 2);
  const leo = await admin('/api/members', 'POST', { name: 'Leo', color: '#FF8FA3' });
  await db.prepare("UPDATE push_subscriptions SET member_ids='[]' WHERE id=?").bind(subscription.id).run();
  await admin('/api/chores', 'POST', { title: 'Leo chore', memberId: leo.id });
  assert.equal(sent.length, 2, 'legacy child rows stay pinned at send time');
  await admin(`/api/chores/${chore.id}`, 'PATCH', { title: 'Edited chore' });
  await drain(); assert.equal(sent.length, 2);
  const alex = await admin('/api/members', 'POST', { name: 'Alex', color: '#FF8FA3', grownUp: true });
  const recipient = await createApiKey(db, 'Alex phone', 'admin', { owner: alex.id });
  const creator = await createApiKey(db, 'Alex tablet', 'admin', { owner: alex.id });
  const parentSub = await register('fake-alex-fcm-token', recipient.key);
  await request(`/api/push/subscriptions/${parentSub.subscription.id}`, 'PATCH', { prefs: { newChores: true } }, recipient.key);
  assert.equal((await request('/api/chores', 'POST', { title: 'Own chore', memberId: alex.id }, creator.key)).status, 201);
  await drain(); assert.equal(sent.length, 2, 'creator person excluded');
  assert.equal((await request('/api/chores', 'POST', { title: 'On own device', memberId: alex.id }, recipient.key)).status, 201);
  await drain(); assert.equal(sent.length, 2, 'creator device excluded');
  await admin('/api/settings', 'PATCH', { features: { ...(await admin('/api/settings')).features, chores: false } });
  await admin('/api/chores', 'POST', { title: 'Feature disabled' });
  await drain(); assert.equal(sent.length, 2);
  env.FCM_PRIVATE_KEY = undefined;
  assert.equal((await register()).push, false, 'Apple adapter cannot enable Android');
});

test('Android full native sender delivers medicine and daily reminders; only FCM UNREGISTERED retires tokens', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-04T08:01:00Z') });
  t.after(() => t.mock.timers.reset());
  const { db, env, sent, register, admin, phone, request, setStatus } = await fixture();
  await admin('/api/settings', 'PATCH', { timezone: 'UTC', medications: true });
  const maya = await admin('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' });
  await db.prepare('UPDATE api_keys SET owner=? WHERE id=?').bind(maya.id, phone.id).run();
  const { subscription } = await register();
  await request(`/api/push/subscriptions/${subscription.id}`, 'PATCH', { prefs: { choreNudge: true } });
  await admin('/api/chores', 'POST', { title: 'Feed the cat', memberId: maya.id, dueDate: '2030-03-04' });
  await admin('/api/medications', 'POST', { memberId: maya.id, name: 'Sample medicine', dose: '1 tablet', times: ['08:00'] });
  await runNotifications(env, new Date('2030-03-04T08:01:00Z'));
  assert.ok(sent.some(r => r.message.notification.body === 'Tap to mark it taken.' && r.message.android.notification.channel_id === 'medicine'));
  assert.ok(sent.some(r => r.message.notification.body === 'Feed the cat' && r.message.android.notification.channel_id === 'chores'));
  assert.ok(sent.every(r => !JSON.stringify(r).includes('Sample medicine') && !JSON.stringify(r).includes('1 tablet')));
  setStatus(503, 'UNAVAILABLE'); assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Retry' }), 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1);
  setStatus(404, 'NOT_FOUND'); await pushToMembers(env, [], { title: 'Test', body: 'Config error' });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1);
  setStatus(404, 'UNREGISTERED'); await pushToMembers(env, [], { title: 'Test', body: 'Retire' });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
});


test('Android and Apple fingerprints stay separate even for identical token bytes', async () => {
  const { db, register, request } = await fixture();
  const token = 'ab'.repeat(32);
  const android = await register(token);
  const apple = await request('/api/push/native', 'PUT', { token });
  assert.equal(apple.status, 200);
  const ios = await apple.json() as any;
  assert.notEqual(android.subscription.id, ios.subscription.id);
  const rows = (await db.prepare('SELECT endpoint FROM push_subscriptions ORDER BY endpoint').all<{ endpoint: string }>()).results;
  assert.equal(rows.length, 2); assert.ok(rows[0].endpoint.startsWith('apns:')); assert.ok(rows[1].endpoint.startsWith('fcm:'));
  assert.equal((await request('/api/push/android', 'PUT', { token, gateway: { credential: 'fake-apple-credential' } })).status, 400);
});
