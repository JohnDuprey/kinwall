import type { Env } from './env.ts';
import { decrypt } from './crypto.ts';
import { sendNativeAlert } from './native-push.ts';
import { sendWebPush, type StoredPushSubscription, type PushSendResult } from './webpush.ts';

/** Native endpoints are server-created token fingerprints, never URLs supplied to fetch. */
export const nativeEndpoint = (endpoint: string) => /^apns:[a-f0-9]{64}$/.test(endpoint);

export async function sendPush(env: Env, db: Env['DB'], sub: StoredPushSubscription, payload: { title: string; body: string; url?: string; tag?: string }): Promise<PushSendResult> {
  if (!nativeEndpoint(sub.endpoint)) return sendWebPush(env, db, sub, payload);
  try {
    const token = await decrypt(env, sub.auth, sub.id);
    if (!/^[a-f0-9]{16,400}$/i.test(token)) return { ok: false, status: 0, gone: true };
    const result = await sendNativeAlert(env, token, payload);
    return result.ok ? { ok: true } : { ok: false, status: 0, gone: result.gone };
  } catch {
    // Neither ciphertext, token, notification body nor request URL belongs in a log.
    return { ok: false, status: 0, gone: false };
  }
}
