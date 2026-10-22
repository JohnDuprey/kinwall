import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativePushConfigured, sendNativeAlert, sendNativeLiveActivity, type NativePushEnv, type NativePushRequest } from '../src/native-push.ts';

test('native push provider: sends alerts and activities without Apple credentials', async () => {
  const requests: NativePushRequest[] = [];
  const env: NativePushEnv = { NATIVE_PUSH_SEND: async request => { requests.push(request); return { ok: true, gone: false }; } };
  assert.equal(await nativePushConfigured(env), true);
  assert.deepEqual(await sendNativeAlert(env, 'device-token', { title: 'Hello', body: 'Family message', url: 'https://untrusted.invalid' }), { ok: true, gone: false });
  assert.deepEqual(await sendNativeLiveActivity(env, 'activity-token', { event: 'end', timestamp: 1 }, 5), { ok: true, gone: false });
  assert.deepEqual(requests, [
    { type: 'alert', token: 'device-token', payload: { title: 'Hello', body: 'Family message', url: '/' } },
    { type: 'liveactivity', token: 'activity-token', aps: { event: 'end', timestamp: 1 }, priority: 5 },
  ]);
});

test('native push provider: overrides direct APNs without signing or calling its transport', async () => {
  const env: NativePushEnv = { APNS_KEY: 'must not be parsed', APNS_KEY_ID: 'test', APNS_TEAM_ID: 'test', APNS_BUNDLE_ID: 'family.kinwall.app',
    APNS_SEND: async () => { assert.fail('direct APNs transport used'); },
    NATIVE_PUSH_SEND: async () => ({ ok: false, gone: true }) };
  assert.deepEqual(await sendNativeAlert(env, 'token', { title: 'Hello', body: 'Test' }), { ok: false, gone: true });
  assert.deepEqual(await sendNativeLiveActivity(env, 'token', {}), { ok: false, gone: true });
});

test('native push provider: a transport exception retains registrations and logs no secrets', async () => {
  const env: NativePushEnv = { NATIVE_PUSH_SEND: async () => { throw new Error('secret-token and private payload'); } };
  const logs: unknown[][] = [], error = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    assert.deepEqual(await sendNativeAlert(env, 'token', { title: 'Hello', body: 'Test' }), { ok: false, gone: false });
    assert.deepEqual(await sendNativeLiveActivity(env, 'token', {}), { ok: false, gone: false });
    assert.deepEqual(logs, []);
  } finally { console.error = error; }
});

test('native push provider: unconfigured hosts remain disabled', async () => {
  assert.equal(await nativePushConfigured({}), false);
  assert.equal(await nativePushConfigured({ APNS_SEND: async () => ({ status: 200 }) }), false, 'raw transport still requires Apple credentials');
  assert.deepEqual(await sendNativeAlert({}, 'token', { title: 'Hello', body: 'Test' }), { ok: false, gone: false });
  assert.deepEqual(await sendNativeLiveActivity({}, 'token', {}), { ok: false, gone: false });
});
