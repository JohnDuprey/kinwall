// Apple push (APNs) for the iPhone app's Live Activities: token-based auth (a .p8 key signs an
// ES256 JWT with WebCrypto, so it runs on Node and Workers alike) and one POST per push. Off, doing
// nothing and logging nothing, unless APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY and APNS_BUNDLE_ID are all
// set (docs/self-hosting/configuration.md). Tokens are secrets: never logged, not even in errors.
//
// APNs only speaks HTTP/2. Node sends with node:http2 (apns-node.ts, handed over as APNS_SEND by
// node.ts). Elsewhere the default is fetch(), which on Cloudflare Workers is HTTP/1.1 to the
// origin, so Apple refuses it: a Workers host passes its own APNS_SEND (a relay) instead.

export type ApnsRequest = { host: string; path: string; headers: Record<string, string>; body: string };
export type ApnsSend = (r: ApnsRequest) => Promise<{ status: number; reason?: string }>;
export type ApnsEnv = {
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_KEY?: string; // the .p8 file's contents (PEM, PKCS #8), a secret
  APNS_BUNDLE_ID?: string; // the app's bundle id, family.kinwall.app
  APNS_SANDBOX?: string; // '1': Apple's development server (apps run from Xcode)
  APNS_SEND?: ApnsSend;
};

export const apnsConfigured = (env: ApnsEnv): boolean => !!(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_KEY && env.APNS_BUNDLE_ID);

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Apple wants a token reused for up to an hour and refreshed at least every hour (not more than
// every 20 minutes): 50 minutes.
const TOKEN_MS = 50 * 60 * 1000;
let cached: { id: string; jwt: string; at: number } | null = null;

/** The provider token: ES256 over {alg, kid} and {iss: team, iat}, signed with the .p8 key. */
export async function apnsJwt(env: ApnsEnv, now = Date.now()): Promise<string> {
  const id = `${env.APNS_TEAM_ID}:${env.APNS_KEY_ID}`;
  if (cached && cached.id === id && now - cached.at < TOKEN_MS) return cached.jwt;
  const der = Uint8Array.from(atob(env.APNS_KEY!.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const input = `${b64url(JSON.stringify({ alg: 'ES256', kid: env.APNS_KEY_ID }))}.${b64url(JSON.stringify({ iss: env.APNS_TEAM_ID, iat: Math.floor(now / 1000) }))}`;
  // WebCrypto's ECDSA signature is already r||s, the form JWS wants.
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input)));
  cached = { id, jwt: `${input}.${b64url(sig)}`, at: now };
  return cached.jwt;
}

const fetchSend: ApnsSend = async (r) => {
  const res = await fetch(`https://${r.host}${r.path}`, { method: 'POST', headers: r.headers, body: r.body });
  const reason = res.ok ? undefined : ((await res.json().catch(() => null)) as { reason?: string } | null)?.reason;
  return { status: res.status, reason };
};

/** Sends one Live Activity push. `gone`: Apple says the token is no longer valid, so drop it. */
export async function sendLiveActivity(env: ApnsEnv, token: string, aps: Record<string, unknown>, priority: 5 | 10 = 10): Promise<{ ok: boolean; gone: boolean }> {
  try {
    const { status, reason } = await (env.APNS_SEND ?? fetchSend)({
      host: env.APNS_SANDBOX === '1' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com',
      path: `/3/device/${token}`,
      headers: {
        authorization: `bearer ${await apnsJwt(env)}`,
        'apns-topic': `${env.APNS_BUNDLE_ID}.push-type.liveactivity`,
        'apns-push-type': 'liveactivity',
        'apns-priority': String(priority),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ aps }),
    });
    if (status === 200) return { ok: true, gone: false };
    console.error(`Live Activity push failed: ${status} ${reason ?? ''}`.trim()); // never the token
    return { ok: false, gone: status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' };
  } catch (e) {
    console.error('Live Activity push failed:', e instanceof Error ? e.name : 'error');
    return { ok: false, gone: false };
  }
}

/** ActivityKit decodes a content state's dates as seconds since 2001 (Swift's reference date);
 * the aps timestamps (timestamp, stale-date, dismissal-date) are Unix seconds. */
export const swiftDate = (ms: number) => ms / 1000 - 978307200;
export const unixSeconds = (ms: number) => Math.floor(ms / 1000);
