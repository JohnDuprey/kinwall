import { z } from 'zod';
import type { KinwallDb } from './db.ts';
import { decrypt, type EncryptionEnv } from './crypto.ts';
import { sha256Hex } from './auth.ts';
import type { NativePushRequest, NativePushResult } from './native-push.ts';

export type GatewayKind = 'alert' | 'liveactivity-start' | 'liveactivity-update';
export const GatewayInput = z.object({ credential: z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/) }).strict();
export type PushGatewayEnv = EncryptionEnv & {
  DB?: KinwallDb;
  PUBLIC_URL?: string;
  PUSH_GATEWAY_FETCH?: typeof fetch; // trusted test/host transport, never selected by a request
};
const ORIGIN = 'https://push.kinwall.family';
export const gatewayAad = (id: string) => `push-gateway:${id}`;

async function smallJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  let text = '', size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { reader.releaseLock(); }
}

const call = (env: PushGatewayEnv, path: string, credential: string, body?: unknown) =>
  (env.PUSH_GATEWAY_FETCH ?? fetch)(`${ORIGIN}${path}`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Verify destination ownership metadata without displaying a test notification. No notification
 * or URL supplied by the caller can choose the gateway or the registered server origin. */
export async function verifyGateway(env: PushGatewayEnv, credential: string, token: string, kind: GatewayKind): Promise<number | null> {
  if (!env.PUBLIC_URL || !GatewayInput.safeParse({ credential }).success) return null;
  try {
    const response = await call(env, '/v1/registration/verify', credential);
    if (response.status !== 200) return null;
    const data = z.object({ server: z.string(), tokenHash: z.string(), kind: z.string(), expiresAt: z.number().int() }).safeParse(await smallJson(response));
    if (!data.success) return null;
    const m = data.data;
    return m.server === new URL(env.PUBLIC_URL).origin && m.tokenHash === await sha256Hex(token.toLowerCase()) && m.kind === kind
      && m.expiresAt > Date.now() && m.expiresAt <= Date.now() + 31 * 86400000 ? m.expiresAt : null;
  } catch { return null; }
}

type Stored = { id: string; gateway_credential: string | null; gateway_expires_at: number | null };
export async function gatewayForToken(env: PushGatewayEnv, token: string, kind: GatewayKind) {
  if (!env.DB) return null;
  const fingerprint = await sha256Hex(token.toLowerCase());
  const table = kind === 'alert' ? 'push_subscriptions' : 'live_activity_tokens';
  const row = kind === 'alert'
    ? await env.DB.prepare('SELECT id,gateway_credential,gateway_expires_at FROM push_subscriptions WHERE endpoint=?').bind(`apns:${fingerprint}`).first<Stored>()
    : await env.DB.prepare('SELECT id,gateway_credential,gateway_expires_at FROM live_activity_tokens WHERE gateway_token_hash=? AND kind=?').bind(fingerprint, kind === 'liveactivity-start' ? 'start' : 'update').first<Stored>();
  if (!row?.gateway_credential?.startsWith('v1:') || !row.gateway_expires_at || row.gateway_expires_at <= Date.now()) return null;
  try {
    const credential = await decrypt(env, row.gateway_credential, gatewayAad(row.id));
    return GatewayInput.safeParse({ credential }).success ? { credential, ciphertext: row.gateway_credential, table, id: row.id } : null;
  } catch { return null; }
}

export async function sendGateway(env: PushGatewayEnv, request: NativePushRequest): Promise<NativePushResult> {
  const kind = request.type === 'alert' ? 'alert' : request.aps.event === 'start' ? 'liveactivity-start' : 'liveactivity-update';
  const registration = await gatewayForToken(env, request.token, kind);
  if (!registration) return { ok: false, gone: false };
  const body = request.type === 'alert' ? { type: request.type, payload: request.payload } : { type: request.type, aps: request.aps, priority: request.priority };
  try {
    const response = await call(env, '/v1/send', registration.credential, body);
    if (response.status === 401 || response.status === 403) {
      // Re-enrollment is needed, but the underlying APNs destination is not necessarily retired.
      await env.DB!.prepare(`UPDATE ${registration.table} SET gateway_credential=NULL,gateway_expires_at=NULL WHERE id=? AND gateway_credential=?`).bind(registration.id, registration.ciphertext).run();
    }
    const result = z.object({ ok: z.boolean(), gone: z.boolean() }).safeParse(await smallJson(response));
    return { ok: response.status === 200 && result.success && result.data.ok && !result.data.gone,
      gone: response.status === 410 && result.success && result.data.gone };
  } catch { return { ok: false, gone: false }; }
}
