// Android capabilities are issued only after the official app proves Keystore possession and
// Play Integrity to the fixed gateway. Self-hosted servers verify scoped metadata, never proofs
// or raw FCM destinations. Apple enrollment, credentials and send endpoints are separate.
import { z } from 'zod';
import { fcmOrigin, fcmPushStatus, sendFcmAlert, type FcmEnv } from './fcm.ts';
import { decrypt } from './crypto.ts';
import { sha256Hex } from './auth.ts';
import { gatewayAad, smallJson, type PushGatewayEnv } from './push-gateway.ts';
import type { NativeAlert, NativePushResult } from './native-push.ts';

type Env = FcmEnv & PushGatewayEnv;
export const AndroidGatewayInput = z.object({ credential: z.string().regex(/^android-v1\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[a-f0-9]{64}$/) }).strict();
const BASE = 'https://push.kinwall.family/v1/android';
const call = (env: Env, path: string, credential: string, body?: unknown, method = 'POST') =>
  (env.PUSH_GATEWAY_FETCH ?? fetch)(BASE + path, { method, redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export async function verifyAndroidGateway(env: Env, credential: string, token: string): Promise<number | null> {
  if (!AndroidGatewayInput.safeParse({ credential }).success) return null;
  try {
    const server = await fcmOrigin(env);
    if (!server) return null;
    const response = await call(env, '/registration/verify', credential);
    if (response.status !== 200) return null;
    const metadata = z.object({ server: z.string(), kind: z.literal('android-alert'), tokenHash: z.string(), expiresAt: z.number().int() }).safeParse(await smallJson(response));
    if (!metadata.success) return null;
    const m = metadata.data, now = Date.now();
    return m.server === server && m.tokenHash === await sha256Hex(token) && m.expiresAt > now && m.expiresAt <= now + 30 * 86400000 + 300000 ? m.expiresAt : null;
  } catch { return null; }
}

type Stored = { id: string; gateway_credential: string | null; gateway_expires_at: number | null; gateway_server: string | null };
async function registrationFor(env: Env, token: string) {
  if (!env.DB) return null;
  const server = await fcmOrigin(env);
  if (!server) return null;
  const row = await env.DB.prepare('SELECT id,gateway_credential,gateway_expires_at,gateway_server FROM push_subscriptions WHERE endpoint=?').bind(`fcm:${await sha256Hex(token)}`).first<Stored>();
  if (!row?.gateway_credential?.startsWith('v1:') || !row.gateway_expires_at || row.gateway_expires_at <= Date.now() || row.gateway_server !== server) return null;
  try {
    const credential = await decrypt(env, row.gateway_credential, gatewayAad(row.id));
    return AndroidGatewayInput.safeParse({ credential }).success ? { id: row.id, credential, ciphertext: row.gateway_credential, expiresAt: row.gateway_expires_at } : null;
  } catch { return null; }
}

/** Protocol support is explicit so older direct-only servers never trigger mobile enrollment.
 * Readiness covers all native alerts, including medicine/daily chores; events stay local. */
export async function androidPushStatus(env: Env, token: string): Promise<{ push: boolean; delivery: 'direct' | 'gateway' | 'unavailable'; gatewayAvailable: boolean; gatewayExpiresAt?: number }> {
  const gatewayAvailable = !!await fcmOrigin(env);
  if ((await fcmPushStatus(env)).push) return { push: true, delivery: 'direct', gatewayAvailable };
  const registration = await registrationFor(env, token);
  return registration ? { push: true, delivery: 'gateway', gatewayAvailable, gatewayExpiresAt: registration.expiresAt }
    : { push: false, delivery: 'unavailable', gatewayAvailable };
}

export async function sendAndroidAlert(env: Env, token: string, payload: NativeAlert): Promise<NativePushResult> {
  // Never fail over after a direct send: an ambiguous provider timeout may already be accepted.
  if ((await fcmPushStatus(env)).push) return sendFcmAlert(env, token, payload);
  const registration = await registrationFor(env, token);
  if (!registration) return { ok: false, gone: false };
  const url = payload.url && /^\/(?!\/)/.test(payload.url) && !/[\\\u0000-\u001f]/.test(payload.url) ? payload.url : '/';
  try {
    const response = await call(env, '/send', registration.credential, { type: 'android-alert', payload: { ...payload, url } });
    if (response.status === 401 || response.status === 403) {
      await env.DB!.prepare('UPDATE push_subscriptions SET gateway_credential=NULL,gateway_expires_at=NULL,gateway_fingerprint=NULL,gateway_server=NULL WHERE id=? AND gateway_credential=?').bind(registration.id, registration.ciphertext).run();
    }
    const result = z.object({ ok: z.boolean(), gone: z.boolean() }).safeParse(await smallJson(response));
    return { ok: response.status === 200 && result.success && result.data.ok && !result.data.gone, gone: response.status === 410 && result.success && result.data.gone };
  } catch { return { ok: false, gone: false }; }
}

type Revocation = { fingerprint: string; subscription_id: string; credential: string; created_at: number; attempts: number; next_at: number };
/** Trigger-backed cleanup includes subscription, paired-key and grant deletion. At most five
 * concurrent requests per tick and three attempts per retired capability, within one day; local sign-out
 * never waits on the network. Active fingerprints cancel stale renewal/transfer cleanup. */
export async function revokeAndroidGateways(env: Env, now = Date.now()): Promise<void> {
  const db = env.DB;
  if (!db) return;
  await db.prepare('DELETE FROM android_push_revocations WHERE attempts>=3 OR created_at<=?').bind(now - 86400000).run();
  const { results } = await db.prepare('SELECT * FROM android_push_revocations WHERE next_at<=? ORDER BY created_at LIMIT 5').bind(now).all<Revocation>();
  await Promise.all(results.map(async row => {
    const discard = () => db.prepare('DELETE FROM android_push_revocations WHERE fingerprint=?').bind(row.fingerprint).run();
    if (await db.prepare('SELECT 1 FROM push_subscriptions WHERE gateway_fingerprint=? AND gateway_credential IS NOT NULL').bind(row.fingerprint).first()) { await discard(); return; }
    const claimed = await db.prepare('UPDATE android_push_revocations SET attempts=attempts+1,next_at=? WHERE fingerprint=? AND attempts=? RETURNING fingerprint').bind(now + 300000, row.fingerprint, row.attempts).first();
    if (!claimed) return;
    try {
      if (!row.credential.startsWith('v1:')) { await discard(); return; }
      const credential = await decrypt(env, row.credential, gatewayAad(row.subscription_id));
      if (!AndroidGatewayInput.safeParse({ credential }).success) { await discard(); return; }
      const response = await call(env, '/registration', credential, undefined, 'DELETE');
      if (response.status === 401 || response.status === 403 || (response.status === 200 && z.object({ revoked: z.literal(true) }).safeParse(await smallJson(response)).success)) await discard();
    } catch { /* Credentials, provider text and transport exceptions must never reach logs. */ }
    if (row.attempts + 1 >= 3) await discard();
  }));
}
