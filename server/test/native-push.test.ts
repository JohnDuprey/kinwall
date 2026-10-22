import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import { decrypt } from '../src/crypto.ts';
import { pushToMembers, ownSubs, runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';
import type { ApnsRequest } from '../src/apns.ts';

const TOKEN = 'ab'.repeat(32);
async function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const key = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))));
  const sent: ApnsRequest[] = [];
  let status = 200;
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    APNS_KEY: `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`, APNS_KEY_ID: crypto.randomUUID(), APNS_TEAM_ID: 'TESTTEAM', APNS_BUNDLE_ID: 'family.kinwall.app',
    APNS_SEND: async r => { sent.push(r); return { status, reason: status === 410 ? 'Unregistered' : undefined }; } };
  const app = createApp();
  const phone = await createApiKey(db, 'Phone', 'display');
  const other = await createApiKey(db, 'Other', 'display');
  const request = (path: string, method = 'GET', body?: unknown, bearer = phone.key) => app.request(path, { method,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const register = async (token = TOKEN, bearer = phone.key) => {
    const res = await request('/api/push/native', 'PUT', { token, deviceName: 'Test iPhone' }, bearer);
    assert.equal(res.status, 200, await res.clone().text()); return await res.json() as any;
  };
  return { db, env, sent, phone, other, request, register, setStatus: (s: number) => { status = s; } };
}

test('native push: encrypted registration, stable preferences through rotation, own-device access, revoke cleanup', async () => {
  const { db, env, phone, other, request, register } = await fixture();
  const first = await register();
  assert.equal(first.push, true);
  assert.equal(first.subscription.prefs.eventReminders, false, 'events already scheduled locally');
  assert.equal(first.subscription.prefs.medicationNames, false);
  const id = first.subscription.id;
  const row = await db.prepare('SELECT * FROM push_subscriptions WHERE id = ?').bind(id).first<any>();
  assert.ok(!JSON.stringify(row).includes(TOKEN));
  assert.equal(await decrypt(env, row.auth, id), TOKEN);
  assert.equal((await request(`/api/push/subscriptions/${id}`, 'PATCH', { prefs: { listUpdates: true } }, other.key)).status, 403);
  assert.equal((await request(`/api/push/subscriptions/${id}`, 'PATCH', { prefs: { listUpdates: true } })).status, 200);
  const rotated = await register('cd'.repeat(32));
  assert.equal(rotated.subscription.id, id);
  assert.equal(rotated.subscription.prefs.listUpdates, true);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1);
  assert.equal((await request('/api/push/native', 'PUT', { token: 'bad' })).status, 400);
  assert.equal((await request('/api/push/native', 'PUT', { token: TOKEN }, 'test-admin')).status, 400);
  await request(`/api/keys/${phone.id}`, 'DELETE', undefined, 'test-admin');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
});

test('native push: APNs alert payload, expiry, safe route, token retirement, and unconfigured host', async () => {
  const { env, sent, register, db, setStatus } = await fixture();
  await register();
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Family message', url: '/#/lists', tag: 'test' }), 1);
  assert.equal(sent[0].host, 'api.push.apple.com');
  assert.equal(sent[0].path, `/3/device/${TOKEN}`);
  assert.equal(sent[0].headers['apns-topic'], 'family.kinwall.app');
  assert.equal(sent[0].headers['apns-push-type'], 'alert');
  assert.equal(sent[0].headers['apns-expiration'], '0', 'do not deliver stale reminders after going offline');
  assert.deepEqual(JSON.parse(sent[0].body), { aps: { alert: { title: 'Hello', body: 'Family message' }, sound: 'default' }, body: { url: '/#/lists' } });
  env.APNS_KEY = undefined;
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Offline' }), 0);
  assert.equal(sent.length, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1);
  env.APNS_KEY = 'unused: cached JWT'; setStatus(410);
  const logs: string[] = [], error = console.error;
  console.error = (...args: unknown[]) => { logs.push(args.join(' ')); };
  try { await pushToMembers(env, [], { title: 'Hello', body: 'Retire token', url: 'https://evil.invalid' }); }
  finally { console.error = error; }
  assert.ok(logs.some(l => l.includes('410') && l.includes('Unregistered')));
  assert.ok(logs.every(l => !l.includes(TOKEN) && !l.includes('Retire token') && !l.includes('PRIVATE KEY')));
  assert.equal(JSON.parse(sent[1].body).body.url, '/');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
});

test('native push: OAuth registration survives access-key rotation and expires with its grant', async () => {
  const { db, env, phone, request, register } = await fixture();
  await db.prepare("INSERT INTO oauth_clients (id,name,redirect_uris,created_at) VALUES ('app','Test app','[]',?)").bind(new Date().toISOString()).run();
  await db.prepare("INSERT INTO oauth_grants (id,client_id,scope,created_at,device_app) VALUES ('grant','app','display',?,1)").bind(new Date().toISOString()).run();
  await db.prepare("UPDATE api_keys SET kind='oauth', oauth_grant_id='grant' WHERE id=?").bind(phone.id).run();
  const first = await register();
  const next = await createApiKey(db, 'Refreshed phone', 'display');
  await db.prepare("UPDATE api_keys SET kind='oauth', oauth_grant_id='grant' WHERE id=?").bind(next.id).run();
  await db.prepare('DELETE FROM api_keys WHERE id=?').bind(phone.id).run();
  const list = await request('/api/push/subscriptions', 'GET', undefined, next.key);
  assert.equal((await list.json() as any[])[0].id, first.subscription.id);
  assert.equal((await register(TOKEN, next.key)).subscription.id, first.subscription.id);
  await db.prepare("UPDATE oauth_grants SET device_app=0 WHERE id='grant'").run();
  assert.equal((await request('/api/push/native', 'PUT', { token: TOKEN }, next.key)).status, 403, 'third-party OAuth apps cannot obtain push data');
  await db.prepare("UPDATE oauth_grants SET device_app=1 WHERE id='grant'").run();
  await db.prepare("UPDATE api_keys SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(next.id).run();
  await db.prepare("INSERT INTO oauth_refresh_tokens(hash,grant_id,expires_at) VALUES ('fake-refresh-hash','grant','2099-01-01T00:00:00Z')").run();
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Phone asleep past hourly refresh' }), 1);
  await db.prepare("UPDATE oauth_refresh_tokens SET expires_at='2000-01-01T00:00:00Z'").run();
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Expired grant' }), 0);
  assert.equal((await ownSubs(db, 'nonexistent')).length, 0);
  await db.prepare("DELETE FROM oauth_grants WHERE id='grant'").run();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 0);
});

test('native push: child targeting, generic medicine text, Time Sensitive alerts and no reminder for a taken dose', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-04T08:01:00Z') });
  t.after(() => t.mock.timers.reset());
  const { db, env, phone, request, register, sent } = await fixture();
  const admin = async (path: string, method: string, body: unknown) => {
    const res = await request(path, method, body, 'test-admin');
    assert.ok(res.ok, await res.clone().text()); return await res.json() as any;
  };
  await admin('/api/settings', 'PATCH', { timezone: 'UTC', medications: true });
  const sam = await admin('/api/members', 'POST', { name: 'Sam', color: '#FF8FA3' });
  const maya = await admin('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' });
  await db.prepare('UPDATE api_keys SET owner = ? WHERE id = ?').bind(sam.id, phone.id).run();
  const { subscription } = await register();
  await request(`/api/push/subscriptions/${subscription.id}`, 'PATCH', { memberIds: [maya.id], prefs: { eventReminders: true } });
  const mine = (await ownSubs(db, sam.id))[0];
  assert.equal(mine.member_ids, JSON.stringify([sam.id]));
  assert.equal(JSON.parse(mine.prefs).eventReminders, false);
  const med = await admin('/api/medications', 'POST', { memberId: sam.id, name: 'Sample medicine', dose: '1 tablet', times: ['08:00'] });
  await runNotifications(env, new Date('2030-03-04T08:01:00Z'));
  assert.equal(sent.length, 1);
  const first = JSON.parse(sent[0].body);
  assert.equal(first.aps.alert.body, 'Tap to mark it taken.');
  assert.equal(first.aps['interruption-level'], 'time-sensitive');
  assert.ok(!sent[0].body.includes('Sample medicine') && !sent[0].body.includes('1 tablet'));
  t.mock.timers.setTime(new Date('2030-03-05T08:00:00Z').getTime());
  await admin(`/api/medications/${med.id}/doses`, 'POST', { date: '2030-03-05', time: '08:00', action: 'taken' });
  await runNotifications(env, new Date('2030-03-05T08:01:00Z'));
  assert.equal(sent.length, 1, 'a marked dose does not produce a later scheduled push');
  await db.prepare("UPDATE api_keys SET expires_at = '2000-01-01T00:00:00Z' WHERE id = ?").bind(phone.id).run();
  assert.equal(await pushToMembers(env, [], { title: 'Test', body: 'Expired sign-in' }), 0);
});
