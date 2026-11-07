// Direct FCM HTTP v1. Shared Node/Workers code uses only Web Crypto and fetch.
// Service-account credentials never leave Google's fixed OAuth endpoint; destinations and
// provider errors (which may echo tokens or content) are never logged.
import type { KinwallDb } from './db.ts';
import { storedPublicUrl } from './providers/config.ts';
import type { NativeAlert, NativePushResult } from './native-push.ts';

export type FcmEnv = {
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  /** Server-only service-account RSA private key, PKCS8 PEM (literal \\n also accepted). */
  FCM_PRIVATE_KEY?: string;
  /** Trusted fetch adapter for hosts and offline tests; URLs are fixed by this module. */
  FCM_FETCH?: typeof fetch;
  PUBLIC_URL?: string;
  DB?: KinwallDb;
};
const OAUTH = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const encode = (value: string | Uint8Array) => btoa(typeof value === 'string' ? value : String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unavailable = (): NativePushResult => ({ ok: false, gone: false });
export const validFcmToken = (token: string) => /^[\x21-\x7e]{1,4096}$/.test(token);

export async function fcmOrigin(env: FcmEnv): Promise<string | null> {
  try {
    const value = env.PUBLIC_URL || (env.DB ? await storedPublicUrl(env.DB) : undefined);
    if (!value) return null;
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
}

// One bounded cache, keyed by the complete credential set: rotation or a different family
// cannot reuse an old account's access token. Private keys are never cache identifiers.
let cached: { identity: string; key: CryptoKey; accessToken?: string; expires: number } | undefined;
async function credentials(env: FcmEnv) {
  if (!env.FCM_PROJECT_ID || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(env.FCM_PROJECT_ID) || !env.FCM_CLIENT_EMAIL || !/^[^\s@]+@[^\s@]+$/.test(env.FCM_CLIENT_EMAIL) || !env.FCM_PRIVATE_KEY) return null;
  const identity = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([env.FCM_PROJECT_ID, env.FCM_CLIENT_EMAIL, env.FCM_PRIVATE_KEY])))));
  if (cached?.identity === identity) return cached;
  const der = Uint8Array.from(atob(env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  cached = { identity, key, expires: 0 };
  return cached;
}

/** Full native alert capability, including medicines and daily chores; not delivery confirmation.
 * Event reminders remain local. Malformed credentials/origin never disable local scheduling. */
export async function fcmPushStatus(env: FcmEnv): Promise<{ push: boolean; delivery: 'direct' | 'unavailable' }> {
  try {
    if (await fcmOrigin(env) && await credentials(env)) return { push: true, delivery: 'direct' };
  } catch { /* invalid operator configuration */ }
  return { push: false, delivery: 'unavailable' };
}

async function accessToken(env: FcmEnv): Promise<string> {
  const account = await credentials(env);
  if (!account) throw new Error();
  const now = Math.floor(Date.now() / 1000);
  if (account.accessToken && account.expires > now + 60) return account.accessToken;
  const input = `${encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${encode(JSON.stringify({ iss: env.FCM_CLIENT_EMAIL, scope: SCOPE, aud: OAUTH, iat: now, exp: now + 3600 }))}`;
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', account.key, new TextEncoder().encode(input)));
  const response = await (env.FCM_FETCH ?? fetch)(OAUTH, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${encode(signature)}` }).toString() });
  if (!response.ok) throw new Error();
  const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== 'string' || !/^[\x21-\x7e]+$/.test(data.access_token) || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 60) throw new Error();
  account.accessToken = data.access_token;
  account.expires = now + Math.min(data.expires_in, 3600);
  return account.accessToken;
}

export async function sendFcmAlert(env: FcmEnv, token: string, payload: NativeAlert): Promise<NativePushResult> {
  try {
    const server = await fcmOrigin(env);
    if (!server || !validFcmToken(token)) return unavailable();
    const url = payload.url && /^\/(?!\/)/.test(payload.url) && !/[\\\u0000-\u001f]/.test(payload.url) ? payload.url : '/';
    const tag = payload.tag;
    const channel = tag?.startsWith('chore:new:') ? 'new_chores' : tag?.startsWith('med:') ? 'medicine' : tag?.startsWith('chore:') ? 'chores' : 'reminders';
    const response = await (env.FCM_FETCH ?? fetch)(`https://fcm.googleapis.com/v1/projects/${env.FCM_PROJECT_ID}/messages:send`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { Authorization: 'Bearer ' + await accessToken(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token, notification: { title: payload.title, body: payload.body }, data: { body: JSON.stringify({ url, server }), ...(tag ? { tag } : {}) }, android: { priority: 'HIGH', ttl: '3600s', notification: { channel_id: channel, ...(tag ? { tag } : {}), sound: 'default' } } } }),
    });
    if (response.ok) return { ok: true, gone: false };
    if (response.status === 401 && cached) { cached.accessToken = undefined; cached.expires = 0; }
    const data = await response.json().catch(() => null) as { error?: { details?: { '@type'?: string; errorCode?: string }[] } } | null;
    // HTTP 404 alone can be a project/configuration error. Only Google's typed token retirement
    // removes a subscription; quotas, credentials, malformed payloads and outages retain it.
    return { ok: false, gone: response.status === 404 && Array.isArray(data?.error?.details) && data.error.details.some(d => d?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError' && d.errorCode === 'UNREGISTERED') };
  } catch { return unavailable(); }
}
