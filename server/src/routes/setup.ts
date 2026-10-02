// First-run setup: the instance is "unclaimed" until POST /api/setup/claim succeeds (see
// isClaimed below - derived from existing data, no new column/migration needed). Node
// generates+logs a 6-digit setup code on every boot while unclaimed (regenerated each boot);
// Workers has no boot hook, so GET /api/setup lazily generates one on first call instead and
// logs it with console.log (visible in `wrangler tail` / the dashboard). An ADMIN_API_KEY
// env/secret is always also accepted as the claim code, on both targets.
import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { createApiKey, sha256Hex, timingSafeEqual } from '../auth.ts';
import { emit } from '../bus.ts';
import { effectivePublicUrl, providerSources } from '../providers/config.ts';
import { ErrorSchema } from '../schemas.ts';
import { hasAnyPasskey } from './passkeys.ts';
import { seedChoreLibrary } from './chore-library.ts';
import { checkRate, clientIp } from '../ratelimit.ts';

export const setupRoutes = createRouter();

const CODE_DIGITS = 6;
// Wrong guesses per hour: 10 from one address, so someone guessing can't lock the owner (at another
// address) out, and 30 from everywhere, so spreading guesses across addresses buys no more than that.
const IP_MAX_ATTEMPTS = 10;
const GLOBAL_MAX_ATTEMPTS = 30;
const WINDOW_MS = 60 * 60 * 1000;
const RATE_KEY = 'setup-code'; // everyone's; each address's is setup-code:<address>
const resetAttempts = (db: KinwallDb) => db.prepare("DELETE FROM rate_limits WHERE key LIKE 'setup-code%'").run();

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

async function upsertSetting(db: KinwallDb, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

// Claimed = an admin key exists (claim always creates one) or, for a pre-existing dev DB that
// predates this feature, any member already exists. No explicit "claimed" flag/migration needed.
export async function isClaimed(db: KinwallDb): Promise<boolean> {
  const row = await db
    .prepare('SELECT (SELECT COUNT(*) FROM api_keys) + (SELECT COUNT(*) FROM members) AS n')
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

// Generates a fresh code, stores its hash (no expiry - lives until claimed), clears any lockout
// window from a previous code, and logs it prominently. Used by Node on every boot while
// unclaimed, and lazily by GET /api/setup on Workers.
export async function regenerateSetupCode(db: KinwallDb, url: string): Promise<string> {
  const code = randomCode();
  await upsertSetting(db, 'setupCodeHash', await sha256Hex(code));
  await resetAttempts(db);
  console.log(`\nKinwall setup code: ${formatCode(code)} — open ${url} to finish setup\n`);
  return code;
}

async function ensureSetupCode(env: Env): Promise<void> {
  const existing = await env.DB.prepare("SELECT value FROM settings WHERE key = 'setupCodeHash'").first();
  if (existing) return;
  const publicUrl = await effectivePublicUrl(env, env.DB);
  await regenerateSetupCode(env.DB, publicUrl.value || '(this server)');
}

async function isAdminKey(env: Env, code: string): Promise<boolean> {
  return !!env.ADMIN_API_KEY && timingSafeEqual(await sha256Hex(code), await sha256Hex(env.ADMIN_API_KEY));
}

async function isSetupCode(env: Env, code: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'setupCodeHash'").first<{ value: string }>();
  return !!row && timingSafeEqual(await sha256Hex(code), row.value);
}

async function clearSetupCode(db: KinwallDb): Promise<void> {
  await db.prepare("DELETE FROM settings WHERE key = 'setupCodeHash'").run();
  await resetAttempts(db);
}

const SetupStatusSchema = z
  .object({
    claimed: z.boolean(),
    oauth: z.object({ google: z.boolean(), microsoft: z.boolean() }),
    passkeys: z.boolean(), // legacy name for hasPasskey
    // Host policy (REQUIRE_PASSKEY_SETUP): the wizard's passkey step can't be skipped, and a claimed
    // instance without one reopens the wizard there. hasPasskey lets a host retire bootstrap creds.
    passkeyRequired: z.boolean(),
    hasPasskey: z.boolean(),
  })
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
    const hasPasskey = await hasAnyPasskey(c.env.DB);
    return c.json(
      {
        claimed,
        oauth: { google: google !== null, microsoft: microsoft !== null },
        passkeys: hasPasskey,
        passkeyRequired: c.env.REQUIRE_PASSKEY_SETUP === '1',
        hasPasskey,
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
// displayKeyId: the wizard's "Wall screen or a kid's device?" step changes it (PATCH /api/keys/{id}).
const ClaimResponseSchema = z.object({ adminKey: z.string(), adminKeyId: z.string(), displayKey: z.string().optional(), displayKeyId: z.string().optional() }).openapi('SetupClaimResponse');

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
    // ADMIN_API_KEY is as hard to guess here as on any other route, so it's never locked out. The
    // 6-digit code is guessable: each try counts against its address, then against everyone
    // (an address over its own limit doesn't use up everyone's), and once either is spent even
    // the right code is refused, or the limit would stop nobody. A right code clears the counts
    // (clearSetupCode), so only wrong guesses are ever held against anyone.
    if (!(await isAdminKey(c.env, code))) {
      const allowed =
        (await checkRate(c.env.DB, `${RATE_KEY}:${clientIp(c) ?? 'unknown'}`, IP_MAX_ATTEMPTS, WINDOW_MS)) &&
        (await checkRate(c.env.DB, RATE_KEY, GLOBAL_MAX_ATTEMPTS, WINDOW_MS));
      if (!allowed) return c.json({ error: 'too many attempts — try again later' }, 429);
      if (!(await isSetupCode(c.env, code))) return c.json({ error: 'invalid setup code' }, 401);
    }

    await clearSetupCode(c.env.DB);
    await seedChoreLibrary(c.env.DB); // a new family starts with a few occasional chores to hand out
    const admin = await createApiKey(c.env.DB, deviceRole === 'admin' ? deviceName : `${deviceName} (admin)`, 'admin');
    // The family's wall, until the wizard's next question says it's a kid's device.
    const display = deviceRole === 'display' ? await createApiKey(c.env.DB, deviceName, 'display', { owner: 'shared', deviceKind: 'wall' }) : null;
    emit(c, 'settings.changed', {});
    return c.json({ adminKey: admin.key, adminKeyId: admin.id, displayKey: display?.key, displayKeyId: display?.id }, 200);
  },
);
