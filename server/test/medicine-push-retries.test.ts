import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/d1-sqlite.ts';
import { enqueueMedicinePush, retryMedicinePushes } from '../src/medicine-push-retries.ts';

function fixture() {
  const DB = openDb(':memory:');
  DB.exec('CREATE TABLE push_subscriptions(id TEXT PRIMARY KEY)');
  DB.exec(readFileSync(new URL('../migrations/0125_push_retries.sql', import.meta.url), 'utf8'));
  DB.exec("INSERT INTO push_subscriptions VALUES ('phone')");
  const env = { DB, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const sub = { id: 'phone', auth: 'encrypted-token', endpoint: 'apns:' + 'a'.repeat(64), prefs: '{}', member_ids: '[]', lang: 'en', gateway_credential: 'v1:encrypted' };
  const payload = { title: "Time for Sam's medicine", body: 'private-medicine-name', tag: 'med:person' };
  return { DB, env, sub, payload, now: 1000000 };
}
test('medicine retries: encrypted per destination, bounded attempts and successful delivery retires the retry', async () => {
  const { DB, env, sub, payload, now } = fixture();
  await enqueueMedicinePush(env, sub, payload, 'snapshot', now);
  const row = await DB.prepare('SELECT * FROM push_retries').first<any>();
  assert.ok(row.payload.startsWith('enc:v1:'));
  assert.ok(!JSON.stringify(row).includes(payload.body));
  let attempts = 0;
  const send = async () => { attempts++; return { ok: attempts === 2, gone: false } };
  await retryMedicinePushes(env, [sub], 'snapshot', now, send);
  assert.equal(attempts, 0, 'backoff prevents immediate retry');
  await retryMedicinePushes(env, [sub], 'snapshot', now + 60000, send);
  await retryMedicinePushes(env, [sub], 'snapshot', now + 120000, send);
  assert.equal(attempts, 2);
  assert.equal(await DB.prepare('SELECT * FROM push_retries').first(), null);
});
test('medicine retries: discard on dose/settings change, token rotation, removal or expiry', async () => {
  for (const scenario of ['changed', 'rotated', 'removed', 'expired']) {
    const { DB, env, sub, payload, now } = fixture();
    await enqueueMedicinePush(env, sub, payload, 'snapshot', now);
    const subs = scenario === 'removed' ? [] : [{ ...sub, ...(scenario === 'rotated' ? { auth: 'new-token' } : {}) }];
    await retryMedicinePushes(env, subs, scenario === 'changed' ? 'new-snapshot' : 'snapshot', now + (scenario === 'expired' ? 600001 : 60000), async () => { assert.fail('stale medicine push'); });
    assert.equal(await DB.prepare('SELECT * FROM push_retries').first(), null, scenario);
  }
});
test('medicine retries: failed retries stop after two further attempts', async () => {
  const { DB, env, sub, payload, now } = fixture();
  await enqueueMedicinePush(env, sub, payload, 'snapshot', now);
  let n = 0;
  for (let minute = 1; minute < 5; minute++) await retryMedicinePushes(env, [sub], 'snapshot', now + minute * 60000, async () => { n++; return { ok: false, gone: false } });
  assert.equal(n, 2);
  assert.equal(await DB.prepare('SELECT * FROM push_retries').first(), null);
});

test('medicine retries: a concurrent tick cannot start the same pending attempt', async () => {
  const { DB, env, sub, payload, now } = fixture();
  await enqueueMedicinePush(env,sub,payload,'snapshot',now);
  let release!: () => void, began!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { began = resolve; });
  let attempts = 0;
  const send = async () => { attempts++; began(); await waiting; return { ok: true }; };
  const first = retryMedicinePushes(env,[sub],'snapshot',now+60000,send);
  await started;
  await retryMedicinePushes(env,[sub],'snapshot',now+60000,send);
  assert.equal(attempts,1);
  release(); await first;
  assert.equal(await DB.prepare('SELECT * FROM push_retries').first(),null);
});

test('medicine retries: a direct host does not enqueue gateway retries from stale gateway metadata', async () => {
  const { DB, env, sub, payload, now } = fixture();
  await enqueueMedicinePush({ ...env, NATIVE_PUSH_SEND: async () => ({ ok: false, gone: false }) },sub,payload,'snapshot',now);
  assert.equal(await DB.prepare('SELECT * FROM push_retries').first(),null);
});
