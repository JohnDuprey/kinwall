// Encryption at rest for secret-bearing columns (accounts.config, calendars.config,
// webhooks.secret). AES-256-GCM via Web Crypto (Workers-compatible). Stored format:
// 'v1:<iv b64>:<ciphertext b64>'. The row id is passed as AAD so a ciphertext can't be
// copied from one row to another. Rows that don't start with 'v1:' are legacy plaintext -
// callers should re-encrypt them on next write (migration path, no backfill needed).
export type EncryptionEnv = { ENCRYPTION_KEY?: string };

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super('ENCRYPTION_KEY is not configured. On Workers, run `wrangler secret put ENCRYPTION_KEY` (32 random bytes, base64).');
    this.name = 'EncryptionKeyMissingError';
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(env: EncryptionEnv): Promise<CryptoKey> {
  if (!env.ENCRYPTION_KEY) throw new EncryptionKeyMissingError();
  const raw = base64ToBytes(env.ENCRYPTION_KEY);
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** HMAC-SHA256 of `message` (base64url) under a key derived from `secret` (HKDF) for one `purpose`,
 * so a MAC made for one thing never verifies as another and never is the secret itself. */
export async function derivedMac(secret: string, purpose: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(secret) as BufferSource, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: enc.encode(purpose) }, base, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = bytesToBase64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
  return mac.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function encrypt(env: EncryptionEnv, plaintext: string, aad: string): Promise<string> {
  const key = await importKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ct))}`;
}

// Legacy plaintext rows (no 'v1:' prefix) are returned as-is; callers re-encrypt on next write.
export async function decrypt(env: EncryptionEnv, blob: string, aad: string): Promise<string> {
  if (!blob.startsWith('v1:')) return blob;
  const [, ivB64, ctB64] = blob.split(':');
  const key = await importKey(env);
  const iv = base64ToBytes(ivB64);
  const ct = base64ToBytes(ctB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: new TextEncoder().encode(aad) }, key, ct as BufferSource);
  return new TextDecoder().decode(pt);
}

// Convenience wrappers for the JSON-config columns (accounts.config, calendars.config), keyed
// by row id.
export async function decryptConfig(env: EncryptionEnv, id: string, config: string): Promise<any> {
  if (!config) return {};
  const pt = await decrypt(env, config, id);
  try {
    return JSON.parse(pt);
  } catch {
    return {};
  }
}

export async function encryptConfig(env: EncryptionEnv, id: string, config: unknown): Promise<string> {
  return encrypt(env, JSON.stringify(config ?? {}), id);
}

// Health data (AGENTS.md "Health data"): 'enc:v1:<iv b64>:<ciphertext b64>', the same AES-256-GCM
// as above behind an 'enc:' marker, so a sealed value can't be mistaken for plaintext a person
// typed. aad binds it to its row and column ('<id>:title'). unseal passes plaintext (not yet
// sealed) through; a sealed value that won't open (wrong key, tampering) throws, so a caller never
// mistakes it for empty and writes over it.
const SEALED = 'enc:v1:';
export const isSealed = (value: string) => value.startsWith(SEALED);

export async function seal(env: EncryptionEnv, plaintext: string, aad: string): Promise<string> {
  return `enc:${await encrypt(env, plaintext, aad)}`;
}

export async function unseal(env: EncryptionEnv, value: string, aad: string): Promise<string> {
  return isSealed(value) ? decrypt(env, value.slice('enc:'.length), aad) : value;
}
