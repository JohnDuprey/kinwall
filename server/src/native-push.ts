import { apnsConfigured, sendAlert, sendLiveActivity, type ApnsEnv } from './apns.ts';
import { gatewayForToken, sendGateway, type GatewayKind, type PushGatewayEnv } from './push-gateway.ts';

export type NativeAlert = { title: string; body: string; url?: string; tag?: string };
export type NativePushResult = { ok: boolean; gone: boolean };
export type NativePushRequest =
  | { type: 'alert'; token: string; payload: NativeAlert }
  | { type: 'liveactivity'; token: string; aps: Record<string, unknown>; priority: 5 | 10 };

export type NativePushEnv = ApnsEnv & PushGatewayEnv & {
  PUBLIC_URL?: string;
  /** Trusted host adapter, above Apple signing. A gateway adapter must resolve a scoped device
   * registration before sending; this hook does not itself authorize tokens or enable a gateway.
   * `ok` means provider acceptance; `gone` must mean a retired destination, never an outage. */
  NATIVE_PUSH_SEND?: (request: NativePushRequest) => Promise<NativePushResult>;
};

/** Delivery capability, not a device-delivery health check. */
export async function nativePushConfigured(env: NativePushEnv): Promise<boolean> {
  if (env.NATIVE_PUSH_SEND || apnsConfigured(env)) return true;
  if (!env.DB) return false;
  const now = Date.now();
  return !!await env.DB.prepare("SELECT 1 FROM push_subscriptions WHERE gateway_credential LIKE 'v1:%' AND gateway_expires_at>? UNION ALL SELECT 1 FROM live_activity_tokens WHERE gateway_credential LIKE 'v1:%' AND gateway_expires_at>? LIMIT 1")
    .bind(now, now).first();
}

export async function nativePushStatus(env: NativePushEnv, token: string, kind: GatewayKind): Promise<{
  push: boolean; delivery: 'direct' | 'gateway' | 'unavailable'; gatewayExpiresAt?: number;
}> {
  if (env.NATIVE_PUSH_SEND || apnsConfigured(env)) return { push: true, delivery: 'direct' };
  const gateway = await gatewayForToken(env, token, kind);
  return gateway ? { push: true, delivery: 'gateway', gatewayExpiresAt: gateway.expiresAt }
    : { push: false, delivery: 'unavailable' };
}

export const nativePushReady = async (env: NativePushEnv, token: string, kind: GatewayKind): Promise<boolean> =>
  (await nativePushStatus(env, token, kind)).push;

export async function sendNativeAlert(env: NativePushEnv, token: string, payload: NativeAlert): Promise<NativePushResult> {
  const url = payload.url && /^\/(?!\/)/.test(payload.url) && !/[\\\u0000-\u001f]/.test(payload.url) ? payload.url : '/';
  try {
    return env.NATIVE_PUSH_SEND
      ? await env.NATIVE_PUSH_SEND({ type: 'alert', token, payload: { ...payload, url } })
      : apnsConfigured(env) ? await sendAlert(env, token, { ...payload, url })
      : await sendGateway(env, { type: 'alert', token, payload: { ...payload, url } });
  } catch {
    // Host exceptions can include credentials, destination tokens or notification content.
    return { ok: false, gone: false };
  }
}

export async function sendNativeLiveActivity(env: NativePushEnv, token: string, aps: Record<string, unknown>, priority: 5 | 10 = 10): Promise<NativePushResult> {
  try {
    return env.NATIVE_PUSH_SEND
      ? await env.NATIVE_PUSH_SEND({ type: 'liveactivity', token, aps, priority })
      : apnsConfigured(env) ? await sendLiveActivity(env, token, aps, priority)
      : await sendGateway(env, { type: 'liveactivity', token, aps, priority });
  } catch {
    return { ok: false, gone: false };
  }
}
