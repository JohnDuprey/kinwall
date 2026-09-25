// Node entry: @hono/node-server + serveStatic for web/dist, migrations on boot, setInterval sync loop.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createKinwall } from './entry.ts';
import type { Env } from './env.ts';
import { syncIntervalMinutes } from './env.ts';
import { openDb, applyMigrations } from './d1-sqlite.ts';
import { isClaimed, regenerateSetupCode } from './routes/setup.ts';
import { syncDue } from './sync.ts';
import { runNotifications } from './notify.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Home Assistant add-on: options set in the add-on UI land in /data/options.json. Map them to
// the env names the rest of the app expects, before anything else reads process.env. Ingress
// itself needs no path handling here - HA strips the X-Ingress-Path prefix before proxying, so
// requests arrive un-prefixed and the app never sees it.
const HA_OPTIONS_PATH = '/data/options.json';
const HA_ENV_MAP: Record<string, string> = {
  google_client_id: 'GOOGLE_CLIENT_ID',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
  ms_client_id: 'MS_CLIENT_ID',
  ms_client_secret: 'MS_CLIENT_SECRET',
  microsoft_client_id: 'MS_CLIENT_ID', // the add-on's config.yaml option names
  microsoft_client_secret: 'MS_CLIENT_SECRET',
  public_url: 'PUBLIC_URL',
  admin_api_key: 'ADMIN_API_KEY',
  encryption_key: 'ENCRYPTION_KEY',
  vapid_subject: 'VAPID_SUBJECT',
};

function loadHaOptions(): Record<string, unknown> | null {
  if (!existsSync(HA_OPTIONS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(HA_OPTIONS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

const haOptions = loadHaOptions();
let haTimezone: string | undefined;
if (haOptions) {
  for (const [haKey, envName] of Object.entries(HA_ENV_MAP)) {
    const value = haOptions[haKey];
    if (typeof value === 'string' && value && !process.env[envName]) process.env[envName] = value;
  }
  if (typeof haOptions.timezone === 'string' && haOptions.timezone) haTimezone = haOptions.timezone;
  // Home Assistant is the webhook receiver and lives on the same LAN (often the same box).
  process.env.ALLOW_PRIVATE_WEBHOOK_URLS ??= '1';
}

const DATA_DIR = process.env.DATA_DIR ?? (haOptions ? '/data' : './data');
const WEB_DIST = join(__dirname, '..', '..', 'web', 'dist');
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const PORT = Number(process.env.PORT) || 8080;

mkdirSync(DATA_DIR, { recursive: true });

// Encryption key: ENCRYPTION_KEY env, else ENCRYPTION_KEY_FILE, else generate once into
// $DATA_DIR/encryption.key (0600) and warn. Losing this file makes encrypted rows unrecoverable.
function loadEncryptionKey(): string {
  if (process.env.ENCRYPTION_KEY) return process.env.ENCRYPTION_KEY;
  if (process.env.ENCRYPTION_KEY_FILE) return readFileSync(process.env.ENCRYPTION_KEY_FILE, 'utf8').trim();
  const keyPath = join(DATA_DIR, 'encryption.key');
  if (existsSync(keyPath)) return readFileSync(keyPath, 'utf8').trim();
  // Buffer#toString(encoding) and @cloudflare/workers-types' ambient Uint8Array typings don't
  // agree on the Buffer overload set, so encode via btoa instead of Buffer#toString('base64').
  let bin = '';
  for (const b of randomBytes(32)) bin += String.fromCharCode(b);
  const key = btoa(bin);
  writeFileSync(keyPath, key, { mode: 0o600 });
  console.warn(
    `\nGenerated an encryption key at ${keyPath} (mode 0600) - no ENCRYPTION_KEY / ENCRYPTION_KEY_FILE was set.\n` +
      `Back this file up: losing it makes every encrypted account/calendar/webhook secret unrecoverable.\n`,
  );
  return key;
}
const ENCRYPTION_KEY = loadEncryptionKey();

const db = openDb(join(DATA_DIR, 'kinwall.sqlite'));
applyMigrations(db, MIGRATIONS_DIR);

// First-run setup: while unclaimed, (re)generate the setup code on every boot and log it
// prominently - it's the only way to claim the instance from a fresh install (see routes/setup.ts).
if (!(await isClaimed(db))) {
  await regenerateSetupCode(db, process.env.PUBLIC_URL || `http://localhost:${PORT}`);
}

if (haTimezone) {
  const existing = await db.prepare("SELECT value FROM settings WHERE key = 'timezone'").first();
  if (!existing) {
    await db
      .prepare("INSERT INTO settings (key, value) VALUES ('timezone', ?)")
      .bind(haTimezone)
      .run();
  }
}

const env: Env = {
  DB: db,
  PUBLIC_URL: process.env.PUBLIC_URL,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  SYNC_INTERVAL_MINUTES: process.env.SYNC_INTERVAL_MINUTES,
  CORS_ORIGINS: process.env.CORS_ORIGINS,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  MS_CLIENT_ID: process.env.MS_CLIENT_ID,
  MS_CLIENT_SECRET: process.env.MS_CLIENT_SECRET,
  MS_TENANT: process.env.MS_TENANT,
  OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI,
  ENCRYPTION_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  ALLOW_PRIVATE_FEED_URLS: process.env.ALLOW_PRIVATE_FEED_URLS,
  ALLOW_PRIVATE_WEBHOOK_URLS: process.env.ALLOW_PRIVATE_WEBHOOK_URLS,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
  HOST_PORTAL_URL: process.env.HOST_PORTAL_URL,
  REQUIRE_PASSKEY_SETUP: process.env.REQUIRE_PASSKEY_SETUP,
};

// Migrations already applied above (from the fs), so no lazy migrations here.
const kinwall = createKinwall(env);
const { app } = kinwall;

const RESERVED_PATH = /^\/api\/|^\/docs$|^\/openapi\.json$/;
const indexPath = join(WEB_DIST, 'index.html');

if (existsSync(WEB_DIST)) {
  // Hashed build assets never change; everything else (index.html, manifest, icons) must be
  // revalidated so a wall display picks up a new version instead of running a cached old app.
  app.use('*', async (c, next) => {
    await next();
    if (RESERVED_PATH.test(c.req.path) || c.res.headers.has('Cache-Control')) return;
    c.res.headers.set('Cache-Control', c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  });
  app.use('*', serveStatic({ root: WEB_DIST }));
}
app.get('*', (c) => {
  if (RESERVED_PATH.test(c.req.path) || /\.[a-z0-9]+$/i.test(c.req.path)) return c.notFound(); // missing files 404, only page routes get index.html
  if (!existsSync(indexPath)) return c.text('web/dist not built yet', 404);
  return c.html(readFileSync(indexPath, 'utf8'));
});

serve({ fetch: (req) => kinwall.fetch(req), port: PORT }, (info) => {
  console.log(`Kinwall server listening on http://localhost:${info.port}`);
});

const intervalMs = syncIntervalMinutes(env) * 60 * 1000;
setInterval(() => {
  syncDue(env).catch((err) => console.error('sync loop failed', err));
}, intervalMs);

// Notifications run on their own short cadence (independent of the sync interval, which can be
// much longer) so a reminder isn't held up waiting for the next sync tick.
const NOTIFY_INTERVAL_MS = 2 * 60 * 1000;
setInterval(() => {
  runNotifications(env, new Date()).catch((err) => console.error('notification loop failed', err));
}, NOTIFY_INTERVAL_MS);
