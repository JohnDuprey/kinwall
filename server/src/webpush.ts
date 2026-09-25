// Web Push delivery: VAPID auth (RFC 8292) + payload encryption (RFC 8291 aes128gcm, built on
// RFC 8188). Web Crypto only (fetch + crypto.subtle) - no node:* imports, no npm push library
// (the `web-push` package is Node-only), so this runs on the Workers free tier as-is.
import { decrypt, encrypt, type EncryptionEnv } from './crypto.ts';

// ---- base64url helpers ----

function b64uToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---- VAPID key pair (generated once, stored encrypted in settings; env can override) ----

export type VapidEnv = EncryptionEnv & {
  PUBLIC_URL?: string;
  VAPID_SUBJECT?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
};

const VAPID_AAD = 'vapid';

async function generateVapidKeyPair(): Promise<{ publicKeyRaw: Uint8Array; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKeyRaw, privateJwk };
}

// VAPID_PRIVATE_KEY env override is the usual web-push raw private scalar (base64url, 32 bytes);
// rebuild a JWK from it plus the public key's x/y (the public key is an uncompressed point:
// 0x04 || x(32) || y(32)).
async function importVapidPrivateFromRaw(privateB64u: string, publicB64u: string): Promise<CryptoKey> {
  const pub = b64uToBytes(publicB64u);
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: bytesToB64u(b64uToBytes(privateB64u)),
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

// Generated on first need and stored (private key encrypted at rest via crypto.ts's
// encryptConfig-style helper, AAD = fixed id 'vapid') so it survives restarts. An env override
// takes priority and is never persisted.
export async function ensureVapidKeys(env: VapidEnv, db: D1Database): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: await importVapidPrivateFromRaw(env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY) };
  }
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'vapidKeys'").first<{ value: string }>();
  if (row?.value) {
    const stored = JSON.parse(await decrypt(env, row.value, VAPID_AAD)) as { publicKey: string; privateJwk: JsonWebKey };
    const privateKey = await crypto.subtle.importKey('jwk', stored.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    return { publicKey: stored.publicKey, privateKey };
  }
  const { publicKeyRaw, privateJwk } = await generateVapidKeyPair();
  const publicKey = bytesToB64u(publicKeyRaw);
  const encrypted = await encrypt(env, JSON.stringify({ publicKey, privateJwk }), VAPID_AAD);
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('vapidKeys', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(encrypted)
    .run();
  const privateKey = await crypto.subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { publicKey, privateKey };
}

export async function getVapidPublicKey(env: VapidEnv, db: D1Database): Promise<string> {
  return (await ensureVapidKeys(env, db)).publicKey;
}

function base64uJson(obj: unknown): string {
  return bytesToB64u(new TextEncoder().encode(JSON.stringify(obj)));
}

// ponytail: PUBLIC_URL's origin (or a fixed placeholder) instead of a real mailto - fine as a
// contact identifier default; set VAPID_SUBJECT for a real one.
function defaultSubject(env: VapidEnv): string {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  if (env.PUBLIC_URL) {
    try {
      return new URL(env.PUBLIC_URL).origin;
    } catch {
      // fall through
    }
  }
  return 'https://github.com/kinwall';
}

// RFC 8292: ES256 JWT signed with the VAPID private key. Web Crypto's ECDSA signature is
// already raw r||s (IEEE P1363, 64 bytes for P-256) - exactly what JWS ES256 needs, no DER
// conversion required.
export async function vapidAuthHeader(env: VapidEnv, privateKey: CryptoKey, publicKey: string, endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = { alg: 'ES256', typ: 'JWT' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, sub: defaultSubject(env) };
  const signingInput = `${base64uJson(header)}.${base64uJson(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signingInput)));
  return `vapid t=${signingInput}.${bytesToB64u(sig)}, k=${publicKey}`;
}

// ---- Payload encryption (RFC 8291 aes128gcm, built on RFC 8188's single-record framing) ----

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as BufferSource));
}

// RFC 5869 HKDF, specialized to the <=32-byte outputs this uses (one HMAC block, so a single
// T(1) iteration is enough - no need for the general multi-block loop).
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

const RECORD_SIZE = 4096;

// Single-record aes128gcm body: RFC 8188 header (salt || rs || idlen || keyid) followed by one
// AEAD_AES_128_GCM record. keyid carries the application server's ephemeral public key, as
// RFC 8291 requires. Padding: a 0x02 delimiter byte marks the (only, so also last) record -
// no further padding needed for a payload well under the 4096 record size.
export async function encryptPushPayload(sub: PushSubscriptionKeys, plaintext: string): Promise<Uint8Array> {
  const uaPublicRaw = b64uToBytes(sub.p256dh);
  const authSecret = b64uToBytes(sub.auth);

  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublicRaw as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256));

  // PRK_key = HMAC-SHA256(auth_secret, ecdh_secret); IKM = HKDF-Expand(PRK_key, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info\0'), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cekBytes = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const cek = await crypto.subtle.importKey('raw', cekBytes as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concatBytes(new TextEncoder().encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, cek, padded as BufferSource));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE, false);
  const header = concatBytes(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

// ---- Send ----

export type PushSendResult = { ok: true } | { ok: false; status: number; gone: boolean };

export async function sendWebPush(
  env: VapidEnv,
  db: D1Database,
  sub: PushSubscriptionKeys,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<PushSendResult> {
  const { publicKey, privateKey } = await ensureVapidKeys(env, db);
  const [auth, body] = await Promise.all([vapidAuthHeader(env, privateKey, publicKey, sub.endpoint), encryptPushPayload(sub, JSON.stringify(payload))]);
  try {
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '3600',
        Urgency: 'normal',
      },
      body: body as BodyInit,
    });
    if (res.ok) return { ok: true };
    return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (err) {
    console.error('web push send failed', err);
    return { ok: false, status: 0, gone: false };
  }
}
