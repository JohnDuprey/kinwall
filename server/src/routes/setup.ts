// First-run setup: the instance is "unclaimed" until POST /api/setup/claim succeeds (see
// isClaimed below - derived from existing data, no new column/migration needed). Node
// generates+logs a 6-digit setup code on every boot while unclaimed (regenerated each boot);
// Workers has no boot hook, so GET /api/setup lazily generates one on first call instead and
// logs it with console.log (visible in `wrangler tail` / the dashboard). An ADMIN_API_KEY
// env/secret is always also accepted as the claim code, on both targets.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { createApiKey, sha256Hex, timingSafeEqual } from '../auth.ts';
import { emit } from '../bus.ts';
import { effectivePublicUrl, providerSources } from '../providers/config.ts';
import { ErrorSchema } from '../schemas.ts';
import { hasAnyPasskey } from './passkeys.ts';

export const setupRoutes = createRouter();

const CODE_DIGITS = 6;
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 60 * 60 * 1000;

// Uniform digit via rejection sampling (no modulo bias) - same approach as routes/pair.ts.
function randomDigit(): number {
  const buf = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < 250) return buf[0] % 10;
  }
}
function randomCode(): string {
  return Array.from({ length: CODE_DIGITS }, randomDigit).join('');
}
function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

async function upsertSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

// Claimed = an admin key exists (claim always creates one) or, for a pre-existing dev DB that
// predates this feature, any member already exists. No explicit "claimed" flag/migration needed.
export async function isClaimed(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare('SELECT (SELECT COUNT(*) FROM api_keys) + (SELECT COUNT(*) FROM members) AS n')
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

// Generates a fresh code, stores its hash (no expiry - lives until claimed), clears any lockout
// state from a previous code, and logs it prominently. Used by Node on every boot while
// unclaimed, and lazily by GET /api/setup on Workers.
export async function regenerateSetupCode(db: D1Database, url: string): Promise<string> {
  const code = randomCode();
  await upsertSetting(db, 'setupCodeHash', await sha256Hex(code));
  await db.prepare("DELETE FROM settings WHERE key IN ('setupCodeAttempts','setupCodeWindowStart')").run();
  console.log(`\nKinwall setup code: ${formatCode(code)} — open ${url} to finish setup\n`);
  return code;
}

async function ensureSetupCode(env: Env): Promise<void> {
  const existing = await env.DB.prepare("SELECT value FROM settings WHERE key = 'setupCodeHash'").first();
  if (existing) return;
  const publicUrl = await effectivePublicUrl(env, env.DB);
  await regenerateSetupCode(env.DB, publicUrl.value || '(this server)');
}

async function verifyCode(env: Env, code: string): Promise<boolean> {
  const inputHash = await sha256Hex(code);
  const candidates: string[] = [];
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'setupCodeHash'").first<{ value: string }>();
  if (row) candidates.push(row.value);
  if (env.ADMIN_API_KEY) candidates.push(await sha256Hex(env.ADMIN_API_KEY));
  return candidates.some((h) => timingSafeEqual(inputHash, h));
}

async function attemptState(db: D1Database): Promise<{ attempts: number; windowStart: number }> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('setupCodeAttempts','setupCodeWindowStart')")
    .all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return { attempts: Number(map.get('setupCodeAttempts') ?? 0), windowStart: Number(map.get('setupCodeWindowStart') ?? 0) };
}

async function isLockedOut(db: D1Database): Promise<boolean> {
  const { attempts, windowStart } = await attemptState(db);
  if (!windowStart || Date.now() - windowStart > WINDOW_MS) return false;
  return attempts >= MAX_ATTEMPTS;
}

async function recordFailedAttempt(db: D1Database): Promise<void> {
  const now = Date.now();
  let { attempts, windowStart } = await attemptState(db);
  if (!windowStart || now - windowStart > WINDOW_MS) {
    windowStart = now;
    attempts = 0;
  }
  attempts += 1;
  await upsertSetting(db, 'setupCodeAttempts', String(attempts));
  await upsertSetting(db, 'setupCodeWindowStart', String(windowStart));
}

async function clearSetupCode(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key IN ('setupCodeHash','setupCodeAttempts','setupCodeWindowStart')").run();
}

const SetupStatusSchema = z
  .object({ claimed: z.boolean(), oauth: z.object({ google: z.boolean(), microsoft: z.boolean() }), passkeys: z.boolean() })
  .openapi('SetupStatus');

setupRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/setup',
    tags: ['Setup'],
    summary: 'First-run setup state (no auth) - whether this instance has been claimed yet',
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: SetupStatusSchema } } } },
  }),
  async (c) => {
    const claimed = await isClaimed(c.env.DB);
    if (!claimed) await ensureSetupCode(c.env);
    const { google, microsoft } = await providerSources(c.env, c.env.DB);
    return c.json(
      {
        claimed,
        oauth: { google: google !== null, microsoft: microsoft !== null },
        passkeys: await hasAnyPasskey(c.env.DB),
      },
      200,
    );
  },
);

const ClaimInputSchema = z
  .object({
    code: z.string().min(6),
    deviceRole: z.enum(['admin', 'display']),
    deviceName: z.string().min(1),
  })
  .openapi('SetupClaimInput');

// adminKeyId lets the client delete the just-issued admin key after it upgrades to a passkey
// session (see routes/passkeys.ts + Setup.tsx) so no long-lived admin key is left lying around.
const ClaimResponseSchema = z.object({ adminKey: z.string(), adminKeyId: z.string(), displayKey: z.string().optional() }).openapi('SetupClaimResponse');

setupRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/setup/claim',
    tags: ['Setup'],
    summary: 'Claim this instance with the setup code (no auth) - creates the first admin key',
    request: { body: { content: { 'application/json': { schema: ClaimInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ClaimResponseSchema } } },
      401: { description: 'wrong code', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'already claimed', content: { 'application/json': { schema: ErrorSchema } } },
      429: { description: 'too many bad attempts', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { code, deviceRole, deviceName } = c.req.valid('json');
    if (await isClaimed(c.env.DB)) return c.json({ error: 'already claimed' }, 409);
    if (await isLockedOut(c.env.DB)) return c.json({ error: 'too many attempts — try again later' }, 429);
    if (!(await verifyCode(c.env, code))) {
      await recordFailedAttempt(c.env.DB);
      return c.json({ error: 'invalid setup code' }, 401);
    }

    await clearSetupCode(c.env.DB);
    const admin = await createApiKey(c.env.DB, deviceRole === 'admin' ? deviceName : `${deviceName} (admin)`, 'admin');
    let displayKey: string | undefined;
    if (deviceRole === 'display') {
      displayKey = (await createApiKey(c.env.DB, deviceName, 'display')).key;
    }
    emit(c, 'settings.changed', {});
    return c.json({ adminKey: admin.key, adminKeyId: admin.id, displayKey }, 200);
  },
);
