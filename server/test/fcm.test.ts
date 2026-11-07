import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fcmPushStatus, sendFcmAlert, type FcmEnv } from '../src/fcm.ts';

async function credentials() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const key = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))));
  return { pair, env: { FCM_PROJECT_ID: 'fake-project', FCM_CLIENT_EMAIL: 'fake@fake-project.iam.gserviceaccount.com', FCM_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\\n${key}\\n-----END PRIVATE KEY-----`, PUBLIC_URL: 'https://our-family.example/path' } satisfies FcmEnv };
}
const decode = (v: string) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const payload = { title: 'New chore', body: 'Feed the cat', url: '//evil.invalid', tag: 'chore:new:fake-id' };

test('FCM signs Google scoped RS256 assertions, caches short-lived access tokens and refreshes on expiry/credential rotation', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1900000000000 }); t.after(() => t.mock.timers.reset());
  const { pair, env } = await credentials();
  let authCalls = 0, sendCalls = 0;
  const transport: typeof fetch = async (input, init) => {
    assert.equal(init?.redirect, 'manual'); assert.ok(init?.signal);
    if (String(input) === 'https://oauth2.googleapis.com/token') {
      authCalls++;
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const jwt = body.get('assertion')!.split('.');
      assert.deepEqual(JSON.parse(new TextDecoder().decode(decode(jwt[0]))), { alg: 'RS256', typ: 'JWT' });
      const claims = JSON.parse(new TextDecoder().decode(decode(jwt[1])));
      assert.deepEqual(claims, { iss: env.FCM_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
      assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, decode(jwt[2]), new TextEncoder().encode(jwt.slice(0, 2).join('.'))), true);
      return Response.json({ access_token: 'obvious-fake-access-token', expires_in: 3600 });
    }
    sendCalls++;
    assert.equal(String(input), 'https://fcm.googleapis.com/v1/projects/fake-project/messages:send');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer obvious-fake-access-token');
    assert.deepEqual(JSON.parse(JSON.parse(String(init?.body)).message.data.body), { url: '/', server: 'https://our-family.example' });
    // A sleeping (Doze) device is often unreachable at send time; TTL 0 made FCM drop the alert.
    assert.equal(JSON.parse(String(init?.body)).message.android.ttl, '3600s');
    return Response.json({ name: 'fake-message' });
  };
  const configured = { ...env, FCM_FETCH: transport };
  assert.deepEqual(await fcmPushStatus(configured), { push: true, delivery: 'direct' });
  for (let i = 0; i < 2; i++) assert.deepEqual(await sendFcmAlert(configured, 'fake-fcm-token', payload), { ok: true, gone: false });
  assert.equal(authCalls, 1); assert.equal(sendCalls, 2);
  t.mock.timers.setTime(Date.now() + 3600000);
  await sendFcmAlert(configured, 'fake-fcm-token', payload); assert.equal(authCalls, 2);
  configured.FCM_CLIENT_EMAIL = 'rotated@fake-project.iam.gserviceaccount.com'; env.FCM_CLIENT_EMAIL = configured.FCM_CLIENT_EMAIL;
  await sendFcmAlert(configured, 'fake-fcm-token', payload); assert.equal(authCalls, 3);
});

test('FCM configuration failures and unsafe origins keep local reminders; provider exceptions never log secrets', async () => {
  const { env } = await credentials();
  for (const broken of [{}, { ...env, FCM_PRIVATE_KEY: 'obvious-fake-invalid-key' }, { ...env, FCM_PROJECT_ID: '../wrong' }, { ...env, PUBLIC_URL: 'https://user:secret@our-family.example' }, { ...env, PUBLIC_URL: 'file:///secret' }, { ...env, PUBLIC_URL: undefined }]) {
    assert.deepEqual(await fcmPushStatus(broken), { push: false, delivery: 'unavailable' });
  }
  const logs: unknown[][] = [];
  const error = console.error, log = console.log, warn = console.warn;
  console.error = console.log = console.warn = (...args) => { logs.push(args); };
  try {
    assert.deepEqual(await sendFcmAlert({ ...env, FCM_FETCH: async () => { throw new Error('secret key, token, and medical content'); } }, 'fake-token', payload), { ok: false, gone: false });
    assert.deepEqual(logs, []);
  } finally { console.error = error; console.log = log; console.warn = warn; }
});

test('FCM retains destinations on OAuth failures, invalid payloads, quotas, outages and malformed responses; 401 refreshes authorization', async () => {
  const { env } = await credentials();
  let status = 401, authCalls = 0;
  const configured: FcmEnv = { ...env, FCM_FETCH: async (input) => {
    if (new URL(String(input)).host === 'oauth2.googleapis.com') { authCalls++; return Response.json({ access_token: 'fake-access-token', expires_in: 3600 }); }
    return new Response('untrusted provider text with fake-token and private content', { status });
  } };
  for (status of [401, 400, 403, 404, 429, 500, 503]) assert.deepEqual(await sendFcmAlert(configured, 'fake-token', payload), { ok: false, gone: false });
  assert.equal(authCalls, 2, 'authorization is renewed after 401');
  configured.FCM_FETCH = async () => Response.json({ error: 'fake OAuth failure' }, { status: 503 });
  configured.FCM_CLIENT_EMAIL = 'new-fake@fake-project.iam.gserviceaccount.com';
  assert.deepEqual(await sendFcmAlert(configured, 'fake-token', payload), { ok: false, gone: false });
});

test('FCM supports Workers manual redirects and never forwards credentials or tokens on redirects', async () => {
  const { env } = await credentials();
  let calls = 0, redirectOauth = false, redirectSend = false;
  const configured: FcmEnv = { ...env, FCM_FETCH: async (input, init) => {
    calls++;
    // Workers accepts only follow/manual; error mode must not silently disable native alerts.
    assert.equal(init?.redirect, 'manual');
    if (String(input) === 'https://oauth2.googleapis.com/token') return redirectOauth ? new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/' } }) : Response.json({ access_token: 'fake-access-token', expires_in: 3600 });
    assert.equal(String(input), 'https://fcm.googleapis.com/v1/projects/fake-project/messages:send');
    return redirectSend ? new Response(null, { status: 307, headers: { Location: 'https://untrusted.invalid/' } }) : Response.json({ name: 'fake-message' });
  } };
  assert.deepEqual(await sendFcmAlert(configured, 'fake-token', payload), { ok: true, gone: false });
  assert.equal(calls, 2);
  redirectSend = true;
  assert.deepEqual(await sendFcmAlert(configured, 'fake-token', payload), { ok: false, gone: false });
  assert.equal(calls, 3, 'redirect is not followed');
  redirectOauth = true; configured.FCM_CLIENT_EMAIL = 'rotated-fake@fake-project.iam.gserviceaccount.com';
  assert.deepEqual(await sendFcmAlert(configured, 'fake-token', payload), { ok: false, gone: false });
  assert.equal(calls, 4, 'OAuth redirect is not followed and no message is sent');
});
