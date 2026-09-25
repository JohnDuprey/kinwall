// Resolves Google/Microsoft OAuth credentials and PUBLIC_URL from either env vars or
// UI-configured settings (see routes/providers.ts). Provider credentials: this household's own
// settings win when present, else the env vars (a multi-tenant host's one shared app for every
// family); PUBLIC_URL: env wins. Single source of truth for "where do provider credentials come from" - every place that used to read
// env.GOOGLE_CLIENT_ID etc. directly goes through here instead.
import type { KinwallDb } from '../db.ts';
import type { Env } from '../env.ts';
import { decrypt, encrypt } from '../crypto.ts';
import type { ProviderEnv } from './types.ts';

export type ProviderKind = 'google' | 'microsoft';
export type Source = 'env' | 'ui' | null;

const SETTING_KEYS = {
  google: { clientId: 'providerGoogleClientId', clientSecret: 'providerGoogleClientSecret' },
  microsoft: { clientId: 'providerMicrosoftClientId', clientSecret: 'providerMicrosoftClientSecret', tenant: 'providerMicrosoftTenant' },
} as const;
const PUBLIC_URL_KEY = 'publicUrl';

async function getSetting(db: KinwallDb, key: string): Promise<string | undefined> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? undefined;
}

// Reads several settings keys in one D1 round trip - used wherever more than one of them is
// needed at once (providerEnv, providerSources) instead of a query per key.
async function getSettingsMap(db: KinwallDb, keys: string[]): Promise<Map<string, string>> {
  if (keys.length === 0) return new Map();
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  return new Map(results.map((r) => [r.key, r.value]));
}

async function setSetting(db: KinwallDb, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

async function deleteSetting(db: KinwallDb, key: string): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
}

export type StoredProviderConfig = { clientId?: string; clientSecret?: string; tenant?: string };

export async function readStoredProvider(env: Env, db: KinwallDb, kind: ProviderKind): Promise<StoredProviderConfig> {
  const keys = SETTING_KEYS[kind];
  const clientId = await getSetting(db, keys.clientId);
  const secretBlob = await getSetting(db, keys.clientSecret);
  const clientSecret = secretBlob ? await decrypt(env, secretBlob, keys.clientSecret) : undefined;
  const tenant = 'tenant' in keys ? await getSetting(db, keys.tenant) : undefined;
  return { clientId, clientSecret, tenant };
}

export async function writeStoredProvider(env: Env, db: KinwallDb, kind: ProviderKind, config: StoredProviderConfig): Promise<void> {
  const keys = SETTING_KEYS[kind];
  await setSetting(db, keys.clientId, config.clientId ?? '');
  if (config.clientSecret !== undefined) {
    await setSetting(db, keys.clientSecret, await encrypt(env, config.clientSecret, keys.clientSecret));
  }
  if ('tenant' in keys) await setSetting(db, keys.tenant, config.tenant || 'common');
}

export async function clearStoredProvider(db: KinwallDb, kind: ProviderKind): Promise<void> {
  const keys = SETTING_KEYS[kind];
  await deleteSetting(db, keys.clientId);
  await deleteSetting(db, keys.clientSecret);
  if ('tenant' in keys) await deleteSetting(db, keys.tenant);
}

export function envConfigured(env: Env, kind: ProviderKind): boolean {
  return kind === 'google' ? !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) : !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
}

export async function providerSource(env: Env, db: KinwallDb, kind: ProviderKind): Promise<Source> {
  if (await getSetting(db, SETTING_KEYS[kind].clientId)) return 'ui';
  return envConfigured(env, kind) ? 'env' : null;
}

// Both providers' sources in one D1 round trip (instead of two providerSource() calls) - only
// the clientId keys are needed to answer "configured or not", never the secrets. Used by
// GET /api/setup, which is on the unauthenticated hot path.
export async function providerSources(env: Env, db: KinwallDb): Promise<{ google: Source; microsoft: Source }> {
  const map = await getSettingsMap(db, [SETTING_KEYS.google.clientId, SETTING_KEYS.microsoft.clientId]);
  const source = (kind: ProviderKind): Source => (map.get(SETTING_KEYS[kind].clientId) ? 'ui' : envConfigured(env, kind) ? 'env' : null);
  return { google: source('google'), microsoft: source('microsoft') };
}

export async function storedPublicUrl(db: KinwallDb): Promise<string | undefined> {
  return getSetting(db, PUBLIC_URL_KEY);
}

export async function setStoredPublicUrl(db: KinwallDb, value: string): Promise<void> {
  await setSetting(db, PUBLIC_URL_KEY, value);
}

export async function clearStoredPublicUrl(db: KinwallDb): Promise<void> {
  await deleteSetting(db, PUBLIC_URL_KEY);
}

export async function effectivePublicUrl(env: Env, db: KinwallDb): Promise<{ value: string | undefined; source: Source }> {
  if (env.PUBLIC_URL) return { value: env.PUBLIC_URL, source: 'env' };
  const stored = await storedPublicUrl(db);
  return { value: stored, source: stored ? 'ui' : null };
}

// The one merge point: a provider's household settings win as a unit (id + secret + tenant) when
// its client id is stored, else the env vars; PUBLIC_URL env wins. Used everywhere provider
// credentials or PUBLIC_URL are read (OAuth start/callback, token refresh, redirect URIs,
// setup flags, passkey rpID). Reads every settings key it might need in a single D1 round trip
// (settings is tiny) rather than the old readStoredProvider(google)+readStoredProvider(microsoft)
// +effectivePublicUrl, which was up to 7 sequential queries.
export async function providerEnv(env: Env, db: KinwallDb): Promise<ProviderEnv> {
  const map = await getSettingsMap(db, [
    SETTING_KEYS.google.clientId,
    SETTING_KEYS.google.clientSecret,
    SETTING_KEYS.microsoft.clientId,
    SETTING_KEYS.microsoft.clientSecret,
    SETTING_KEYS.microsoft.tenant,
    PUBLIC_URL_KEY,
  ]);
  const googleId = map.get(SETTING_KEYS.google.clientId);
  const msId = map.get(SETTING_KEYS.microsoft.clientId);
  const googleSecretBlob = map.get(SETTING_KEYS.google.clientSecret);
  const msSecretBlob = map.get(SETTING_KEYS.microsoft.clientSecret);
  const [googleSecret, msSecret] = await Promise.all([
    googleId && googleSecretBlob ? decrypt(env, googleSecretBlob, SETTING_KEYS.google.clientSecret) : undefined,
    msId && msSecretBlob ? decrypt(env, msSecretBlob, SETTING_KEYS.microsoft.clientSecret) : undefined,
  ]);
  return {
    PUBLIC_URL: env.PUBLIC_URL || map.get(PUBLIC_URL_KEY),
    GOOGLE_CLIENT_ID: googleId || env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: googleId ? googleSecret : env.GOOGLE_CLIENT_SECRET,
    MS_CLIENT_ID: msId || env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: msId ? msSecret : env.MS_CLIENT_SECRET,
    MS_TENANT: (msId ? map.get(SETTING_KEYS.microsoft.tenant) : env.MS_TENANT) || 'common',
    ALLOW_PRIVATE_FEED_URLS: env.ALLOW_PRIVATE_FEED_URLS,
  };
}

export function redirectUri(publicUrl: string | undefined, kind: ProviderKind): string {
  return `${publicUrl ?? ''}/api/oauth/${kind}/callback`;
}
