// One-time recovery codes: the family's second way in if every passkey device is lost. A set of
// 8 codes is shown once; only SHA-256 hashes are stored. Using one mints the same 30-day admin
// session key a passkey login does.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { createApiKey, sha256Hex } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import { checkRate, clientIp } from '../ratelimit.ts';
import { SESSION_TTL_MS } from './passkeys.ts';

export const recoveryRoutes = createRouter();

const CODE_COUNT = 8;
// 32 symbols (no 0/O/1/I), so `byte & 31` picks uniformly; 12 symbols = 60 bits per code.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOUR_MS = 60 * 60 * 1000;
const IP_MAX_ATTEMPTS = 10;
const GLOBAL_MAX_ATTEMPTS = 30;

function generateCode(): string {
  const chars = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => ALPHABET[b & 31]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

// Forgiving input: case, spaces and missing dashes don't matter.
function normalizeCode(input: string): string {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

const CodesSchema = z.object({ codes: z.array(z.string()) }).openapi('RecoveryCodes');
const StatusSchema = z
  .object({ total: z.number(), remaining: z.number(), createdAt: z.string().nullable() })
  .openapi('RecoveryCodesStatus');

recoveryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/recovery-codes',
    tags: ['Recovery'],
    summary: 'Generate a new set of 8 recovery codes (replaces the old set; plaintext returned once)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: CodesSchema } } } },
  }),
  async (c) => {
    const codes = Array.from({ length: CODE_COUNT }, generateCode);
    const now = new Date().toISOString();
    const db = c.env.DB;
    const inserts = await Promise.all(
      codes.map(async (code) => db.prepare('INSERT INTO recovery_codes (hash, created_at) VALUES (?,?)').bind(await sha256Hex(code), now)),
    );
    await db.batch([db.prepare('DELETE FROM recovery_codes'), ...inserts]);
    return c.json({ codes }, 200);
  },
);

recoveryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/recovery-codes',
    tags: ['Recovery'],
    summary: 'How many recovery codes exist and are unused (never the codes themselves)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: StatusSchema } } } },
  }),
  async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT COUNT(*) AS total, COUNT(*) - COUNT(used_at) AS remaining, MIN(created_at) AS createdAt FROM recovery_codes',
    ).first<{ total: number; remaining: number; createdAt: string | null }>();
    return c.json({ total: row?.total ?? 0, remaining: row?.remaining ?? 0, createdAt: row?.createdAt ?? null }, 200);
  },
);

const LoginSchema = z.object({ code: z.string().min(1).max(64) }).openapi('RecoveryLoginInput');
const LoginResponseSchema = z
  .object({ key: z.string(), expiresAt: z.string(), remaining: z.number() })
  .openapi('RecoveryLoginResponse');

recoveryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/recovery/login',
    tags: ['Recovery'],
    summary: 'Sign in with a one-time recovery code (no auth) - mints a 30-day admin session key',
    request: { body: { content: { 'application/json': { schema: LoginSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: LoginResponseSchema } } },
      401: { description: 'invalid or used code', content: { 'application/json': { schema: ErrorSchema } } },
      429: { description: 'too many attempts', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const db = c.env.DB;
    // Per-address cap, plus a global one so rotating addresses can't brute-force either. The
    // per-address check runs first so an address already over its cap doesn't burn global tries.
    const ok =
      (await checkRate(db, `recovery-login:${clientIp(c) ?? 'unknown'}`, IP_MAX_ATTEMPTS, HOUR_MS)) &&
      (await checkRate(db, 'recovery-login:global', GLOBAL_MAX_ATTEMPTS, HOUR_MS));
    if (!ok) return c.json({ error: 'too many sign-in attempts — try again later' }, 429);

    const hash = await sha256Hex(normalizeCode(c.req.valid('json').code));
    // Conditional UPDATE is the single-use check: two racing requests can't both claim a code.
    const now = new Date().toISOString();
    const used = await db.prepare('UPDATE recovery_codes SET used_at = ? WHERE hash = ? AND used_at IS NULL').bind(now, hash).run();
    if (used.meta.changes !== 1) return c.json({ error: 'that recovery code is not valid' }, 401);

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const session = await createApiKey(db, 'Recovery code', 'admin', { kind: 'session', expiresAt });
    const row = await db.prepare('SELECT COUNT(*) AS n FROM recovery_codes WHERE used_at IS NULL').first<{ n: number }>();
    console.log(`Kinwall: signed in with a recovery code (${row?.n ?? 0} left)`);
    return c.json({ key: session.key, expiresAt, remaining: row?.n ?? 0 }, 200);
  },
);
