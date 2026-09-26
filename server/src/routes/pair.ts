// Device-flow style pairing for wall displays (like pairing a TV app): a display starts
// unauthenticated, gets a 6-digit code, an admin approves it from an already-paired session,
// and the display polls until it receives its own display-scope key. /api/pair and
// /api/pair/poll are unauthenticated (see auth.ts PUBLIC_PATH); /api/pair/approve requires an
// admin key like everything else under /api/*.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { createApiKey, timingSafeEqual, validOwner } from '../auth.ts';
import { encrypt, decrypt } from '../crypto.ts';
import { emit } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';
import { clientIp } from '../ratelimit.ts';

export const pairRoutes = createRouter();

const CODE_DIGITS = 6;
const TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 20;
const MAX_PENDING_PER_IP = 5;

// Uniform digit via rejection sampling (no modulo bias): 256 % 10 == 6, so reject the top 6
// byte values (250-255) before reducing mod 10.
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

function randomPollToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type PairingRow = {
  id: string;
  code: string;
  poll_token_hash: string;
  approved: number;
  key_id: string | null;
  key_name: string | null;
  encrypted_key: string | null;
  created_at: string;
  expires_at: string;
};

const PairStartResponseSchema = z
  .object({ pairingId: z.string(), code: z.string(), pollToken: z.string(), expiresAt: z.string() })
  .openapi('PairStart');

pairRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/pair',
    tags: ['Displays'],
    summary: 'Start display pairing (no auth) - returns a 6-digit code to show on the display',
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: PairStartResponseSchema } } },
      429: { description: 'too many pending pairings', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const now = new Date();
    const nowIso = now.toISOString();
    await c.env.DB.prepare('DELETE FROM pairings WHERE expires_at < ?').bind(nowIso).run();

    const pending = await c.env.DB.prepare('SELECT COUNT(*) as n FROM pairings WHERE approved = 0').first<{ n: number }>();
    if ((pending?.n ?? 0) >= MAX_PENDING) {
      return c.json({ error: 'too many pending pairings, try again shortly' }, 429);
    }
    // Stored on the row (not in memory) because Worker isolates don't share state. With no client
    // address header (Docker without a proxy) only the global cap applies.
    const ip = clientIp(c);
    if (ip) {
      const mine = await c.env.DB.prepare('SELECT COUNT(*) as n FROM pairings WHERE approved = 0 AND ip = ?').bind(ip).first<{ n: number }>();
      if ((mine?.n ?? 0) >= MAX_PENDING_PER_IP) return c.json({ error: 'too many pending pairings, try again shortly' }, 429);
    }

    let code = randomCode();
    // Uniqueness among pending (unapproved, unexpired) pairings only - approved/expired codes
    // are already unusable.
    while (
      await c.env.DB.prepare('SELECT 1 FROM pairings WHERE code = ? AND approved = 0 AND expires_at > ?')
        .bind(code, nowIso)
        .first()
    ) {
      code = randomCode();
    }

    const pollToken = randomPollToken();
    const id = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();
    await c.env.DB.prepare(
      'INSERT INTO pairings (id, code, poll_token_hash, approved, created_at, expires_at, ip) VALUES (?,?,?,0,?,?,?)',
    )
      .bind(id, code, await sha256Hex(pollToken), nowIso, expiresAt, ip)
      .run();

    return c.json({ pairingId: id, code, pollToken, expiresAt }, 201);
  },
);

// owner: 'shared' (the whole family) or a member id the display is pinned to. Only an admin can
// change it later (PATCH /api/keys/{id}); omitted = shared.
const PairApproveInputSchema = z.object({ code: z.string().length(CODE_DIGITS), name: z.string().min(1), owner: z.string().min(1).optional() }).openapi('PairApproveInput');
const PairApproveResponseSchema = z.object({ keyId: z.string(), name: z.string() }).openapi('PairApproveResponse');

pairRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/pair/approve',
    tags: ['Displays'],
    summary: 'Approve a pending display code (admin only) - creates a display-scope key for it',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PairApproveInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: PairApproveResponseSchema } } },
      400: { description: 'unknown owner', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found or expired', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { code, name, owner: ownerIn } = c.req.valid('json');
    const owner = await validOwner(c.env.DB, ownerIn ?? 'shared');
    if (!owner) return c.json({ error: 'unknown family member' }, 400);
    const nowIso = new Date().toISOString();
    const pairing = await c.env.DB.prepare('SELECT * FROM pairings WHERE code = ? AND approved = 0 AND expires_at > ?')
      .bind(code, nowIso)
      .first<PairingRow>();
    if (!pairing) return c.json({ error: 'Code not found or expired' }, 404);

    const { id: keyId, key } = await createApiKey(c.env.DB, name, 'display', { owner });
    const encryptedKey = await encrypt(c.env, key, pairing.id);

    await c.env.DB.prepare('UPDATE pairings SET approved = 1, key_id = ?, key_name = ?, encrypted_key = ? WHERE id = ?')
      .bind(keyId, name, encryptedKey, pairing.id)
      .run();

    emit(c, 'display.paired', { keyId, name });
    return c.json({ keyId, name }, 200);
  },
);

const PairPollInputSchema = z.object({ pairingId: z.string(), pollToken: z.string() }).openapi('PairPollInput');
const PairPollResponseSchema = z
  .object({ status: z.enum(['pending', 'approved']), key: z.string().optional() })
  .openapi('PairPollResponse');

pairRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/pair/poll',
    tags: ['Displays'],
    summary: 'Poll pairing status (no auth) - returns the new key exactly once, then the pairing is gone',
    request: { body: { content: { 'application/json': { schema: PairPollInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: PairPollResponseSchema } } },
      404: { description: 'not found, expired, or wrong token', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { pairingId, pollToken } = c.req.valid('json');
    const nowIso = new Date().toISOString();
    const pairing = await c.env.DB.prepare('SELECT * FROM pairings WHERE id = ?').bind(pairingId).first<PairingRow>();
    if (!pairing || pairing.expires_at < nowIso) return c.json({ error: 'not found or expired' }, 404);
    if (!timingSafeEqual(await sha256Hex(pollToken), pairing.poll_token_hash)) {
      return c.json({ error: 'not found or expired' }, 404);
    }

    if (!pairing.approved || !pairing.encrypted_key) {
      return c.json({ status: 'pending' as const }, 200);
    }

    const key = await decrypt(c.env, pairing.encrypted_key, pairing.id);
    await c.env.DB.prepare('DELETE FROM pairings WHERE id = ?').bind(pairing.id).run();
    return c.json({ status: 'approved' as const, key }, 200);
  },
);
