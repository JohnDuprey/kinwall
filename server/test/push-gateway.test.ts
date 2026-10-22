import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey, sha256Hex } from '../src/auth.ts';
import { pushToMembers } from '../src/notify.ts';
import { sendNativeLiveActivity } from '../src/native-push.ts';
import type { Env } from '../src/env.ts';

const TOKEN = 'ab'.repeat(32), CREDENTIAL = `${'a'.repeat(8)}-aaaa-aaaa-aaaa-${'a'.repeat(12)}.${'b'.repeat(64)}`;
async function fixture() {
  const DB = openDb(':memory:');
  applyMigrations(DB, fileURLToPath(new URL('../migrations', import.meta.url)));
  const phone = await createApiKey(DB, 'Phone', 'display');
  const other = await createApiKey(DB, 'Other phone', 'display');
  const calls: { url: string; init?: RequestInit }[] = [];
  const metadata = { server: 'https://family.example', kind: 'alert', tokenHash: await sha256Hex(TOKEN), expiresAt: Date.now() + 3600000 };
  let status = 200;
  const env: Env = { DB, PUBLIC_URL: metadata.server, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    PUSH_GATEWAY_FETCH: async (url, init) => {
      calls.push({ url: String(url), init });
      return String(url).endsWith('/verify') ? Response.json(metadata) : Response.json({ ok: status === 200, gone: status === 410 }, { status });
    } };
  const app = createApp();
  const register = async (body: unknown, bearer = phone.key) => app.request('/api/push/native', { method: 'PUT', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  const activity = async (body: unknown) => app.request('/api/live-activities/tokens', { method: 'PUT', headers: { Authorization: `Bearer ${phone.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
  return { DB, env, phone, other, calls, metadata, register, activity, setStatus: (s: number) => { status = s; } };
}

test('self-hosted gateway: verifies and encrypts a device credential; sends only to the fixed gateway', async () => {
  const { DB, calls, env, register, other } = await fixture();
  assert.equal((await (await register({ token: TOKEN })).json() as any).push, false, 'an unregistered device keeps local reminders');
  const response = await register({ token: TOKEN, gateway: { credential: CREDENTIAL } });
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).push, true);
  const row = await DB.prepare('SELECT * FROM push_subscriptions').first<any>();
  assert.ok(!JSON.stringify(row).includes(CREDENTIAL));
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Test', url: '/#/lists' }), 1);
  assert.equal(calls[1].url, 'https://push.kinwall.family/v1/send');
  assert.equal(calls[1].init?.redirect, 'error');
  assert.equal(new Headers(calls[1].init?.headers).get('Authorization'), `Bearer ${CREDENTIAL}`);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { type: 'alert', payload: { title: 'Hello', body: 'Test', url: '/#/lists' } });
  assert.ok(!String(calls[1].init?.body).includes(TOKEN));
  assert.equal((await (await register({ token: 'cd'.repeat(32) }, other.key)).json() as any).push, false);
  assert.equal((await (await register({ token: TOKEN })).json() as any).push, true, 'ordinary app refresh keeps a verified credential');
  assert.equal((await (await register({ token: 'ef'.repeat(32) })).json() as any).push, false, 'rotated tokens need their own verified credential');
});

test('self-hosted gateway: wrong server, token or type cannot replace an existing registration', async () => {
  const { DB, metadata, register } = await fixture();
  assert.equal((await register({ token: TOKEN, gateway: { credential: CREDENTIAL } })).status, 200);
  const before = await DB.prepare('SELECT auth,gateway_credential FROM push_subscriptions').first<any>();
  for (const change of [{ server: 'https://evil.invalid' }, { tokenHash: 'c'.repeat(64) }, { kind: 'liveactivity-start' }, { expiresAt: 0 }]) {
    const saved = { ...metadata }; Object.assign(metadata, change);
    assert.equal((await register({ token: TOKEN, gateway: { credential: CREDENTIAL } })).status, 400);
    assert.deepEqual(await DB.prepare('SELECT auth,gateway_credential FROM push_subscriptions').first<any>(), before);
    Object.assign(metadata, saved);
  }
});

test('self-hosted gateway: a device can disable forwarding by clearing its credential', async () => {
  const { env, calls, register } = await fixture();
  await register({ token: TOKEN, gateway: { credential: CREDENTIAL } });
  assert.equal((await (await register({ token: TOKEN, gateway: null })).json() as any).push, false);
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Test' }), 0);
  assert.equal(calls.length, 1);
});

test('self-hosted gateway: plaintext credentials in storage are never used', async () => {
  const { DB, env, register, calls } = await fixture();
  await register({ token: TOKEN, gateway: { credential: CREDENTIAL } });
  await DB.prepare('UPDATE push_subscriptions SET gateway_credential=?').bind(CREDENTIAL).run();
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Test' }), 0);
  assert.equal(calls.length, 1);
});

test('self-hosted gateway: expired credentials and gateway auth failures retain the APNs subscription', async () => {
  const { DB, env, register, setStatus } = await fixture();
  await register({ token: TOKEN, gateway: { credential: CREDENTIAL } });
  setStatus(429);
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Test' }), 0);
  assert.equal((await (await register({ token: TOKEN })).json() as any).push, true, 'throttling does not retire the credential');
  setStatus(401);
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Test' }), 0);
  assert.equal((await (await register({ token: TOKEN })).json() as any).push, false);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<any>()).n, 1);
});

test('self-hosted gateway: Live Activity credentials retain their token binding through refresh and rotation', async () => {
  const { env, metadata, activity, calls } = await fixture();
  metadata.kind = 'liveactivity-start';
  assert.equal((await (await activity({ token: TOKEN, kind: 'start', gateway: { credential: CREDENTIAL } })).json() as any).push, true);
  assert.deepEqual(await sendNativeLiveActivity(env, TOKEN, { event: 'start', timestamp: 1 }), { ok: true, gone: false });
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { type: 'liveactivity', aps: { event: 'start', timestamp: 1 }, priority: 10 });
  assert.equal((await (await activity({ token: TOKEN, kind: 'start' })).json() as any).push, true);
  assert.equal((await (await activity({ token: 'cd'.repeat(32), kind: 'start' })).json() as any).push, false);
  assert.deepEqual(await sendNativeLiveActivity(env, TOKEN, { event: 'start', timestamp: 1 }), { ok: false, gone: false });
});

test('self-hosted gateway: local expiry disables remote capability without a network request', async () => {
  const { env, DB, calls, register } = await fixture();
  await register({ token: TOKEN, gateway: { credential: CREDENTIAL } });
  await DB.prepare('UPDATE push_subscriptions SET gateway_expires_at=0').run();
  assert.equal((await (await register({ token: TOKEN })).json() as any).push, false);
  assert.equal(await pushToMembers(env, [], { title: 'Hello', body: 'Test' }), 0);
  assert.equal(calls.length, 1);
});

test('self-hosted gateway: an old unauthorized response cannot discard a newly renewed credential', async () => {
  const { env, register, metadata } = await fixture();
  await register({ token: TOKEN, gateway: { credential: CREDENTIAL } });
  let finish!: (response: Response) => void, started!: () => void;
  const sending = new Promise<void>(resolve => { started = resolve; });
  env.PUSH_GATEWAY_FETCH = async url => {
    if (String(url).endsWith('/verify')) return Response.json(metadata);
    started(); return await new Promise<Response>(resolve => { finish = resolve; });
  };
  const pending = pushToMembers(env, [], { title: 'Hello', body: 'Test' });
  await sending;
  const renewed = await register({ token: TOKEN, gateway: { credential: CREDENTIAL.replace(/b/g, 'c') } });
  assert.equal(renewed.status, 200);
  finish(Response.json({ ok: false, gone: false }, { status: 401 }));
  await pending;
  assert.equal((await (await register({ token: TOKEN })).json() as any).push, true);
});

test('self-hosted gateway: a retired response for an old token cannot delete its rotated replacement', async () => {
  const { env, register, metadata } = await fixture();
  await register({ token: TOKEN, gateway: { credential: CREDENTIAL } });
  let finish!: (response: Response) => void, started!: () => void;
  const sending = new Promise<void>(resolve => { started = resolve; });
  env.PUSH_GATEWAY_FETCH = async url => {
    if (String(url).endsWith('/verify')) return Response.json(metadata);
    started(); return await new Promise<Response>(resolve => { finish = resolve; });
  };
  const pending = pushToMembers(env, [], { title: 'Hello', body: 'Test' });
  await sending;
  const rotated = 'cd'.repeat(32);
  metadata.tokenHash = await sha256Hex(rotated);
  assert.equal((await register({ token: rotated, gateway: { credential: CREDENTIAL.replace(/b/g, 'c') } })).status, 200);
  finish(Response.json({ ok: false, gone: true }, { status: 410 }));
  await pending;
  assert.equal((await (await register({ token: rotated })).json() as any).push, true);
});
