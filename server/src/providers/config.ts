// Resolves Google/Microsoft OAuth credentials and PUBLIC_URL from either env vars or
// UI-configured settings (see routes/providers.ts), env taking precedence. Single source of
// truth for "where do provider credentials come from" - every place that used to read
// env.GOOGLE_CLIENT_ID etc. directly goes through here instead.
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

async function getSetting(db: D1Database, key: string): Promise<string | undefined> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? undefined;
}

async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

async function deleteSetting(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
}

export type StoredProviderConfig = { clientId?: string; clientSecret?: string; tenant?: string };

export async function readStoredProvider(env: Env, db: D1Database, kind: ProviderKind): Promise<StoredProviderConfig> {
  const keys = SETTING_KEYS[kind];
  const clientId = await getSetting(db, keys.clientId);
  const secretBlob = await getSetting(db, keys.clientSecret);
  const clientSecret = secretBlob ? await decrypt(env, secretBlob, keys.clientSecret) : undefined;
  const tenant = 'tenant' in keys ? await getSetting(db, keys.tenant) : undefined;
  return { clientId, clientSecret, tenant };
}

export async function writeStoredProvider(env: Env, db: D1Database, kind: ProviderKind, config: StoredProviderConfig): Promise<void> {
  const keys = SETTING_KEYS[kind];
  await setSetting(db, keys.clientId, config.clientId ?? '');
  if (config.clientSecret !== undefined) {
    await setSetting(db, keys.clientSecret, await encrypt(env, config.clientSecret, keys.clientSecret));
  }
  if ('tenant' in keys) await setSetting(db, keys.tenant, config.tenant || 'common');
}

export async function clearStoredProvider(db: D1Database, kind: ProviderKind): Promise<void> {
  const keys = SETTING_KEYS[kind];
  await deleteSetting(db, keys.clientId);
  await deleteSetting(db, keys.clientSecret);
  if ('tenant' in keys) await deleteSetting(db, keys.tenant);
}

export function envConfigured(env: Env, kind: ProviderKind): boolean {
  return kind === 'google' ? !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) : !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
}

export async function providerSource(env: Env, db: D1Database, kind: ProviderKind): Promise<Source> {
  if (envConfigured(env, kind)) return 'env';
  const stored = await readStoredProvider(env, db, kind);
  return stored.clientId ? 'ui' : null;
}

export async function storedPublicUrl(db: D1Database): Promise<string | undefined> {
  return getSetting(db, PUBLIC_URL_KEY);
}

export async function setStoredPublicUrl(db: D1Database, value: string): Promise<void> {
  await setSetting(db, PUBLIC_URL_KEY, value);
}

export async function clearStoredPublicUrl(db: D1Database): Promise<void> {
  await deleteSetting(db, PUBLIC_URL_KEY);
}

export async function effectivePublicUrl(env: Env, db: D1Database): Promise<{ value: string | undefined; source: Source }> {
  if (env.PUBLIC_URL) return { value: env.PUBLIC_URL, source: 'env' };
  const stored = await storedPublicUrl(db);
  return { value: stored, source: stored ? 'ui' : null };
}

// The one merge point: env var wins, else UI-configured value. Used everywhere provider
// credentials or PUBLIC_URL are read (OAuth start/callback, token refresh, redirect URIs,
// setup flags, passkey rpID).
export async function providerEnv(env: Env, db: D1Database): Promise<ProviderEnv> {
  const [google, microsoft, publicUrl] = await Promise.all([
    readStoredProvider(env, db, 'google'),
    readStoredProvider(env, db, 'microsoft'),
    effectivePublicUrl(env, db),
  ]);
  return {
    PUBLIC_URL: publicUrl.value,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || google.clientId,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET || google.clientSecret,
    MS_CLIENT_ID: env.MS_CLIENT_ID || microsoft.clientId,
    MS_CLIENT_SECRET: env.MS_CLIENT_SECRET || microsoft.clientSecret,
    MS_TENANT: env.MS_TENANT || microsoft.tenant || 'common',
  };
}

export function redirectUri(publicUrl: string | undefined, kind: ProviderKind): string {
  return `${publicUrl ?? ''}/api/oauth/${kind}/callback`;
}
