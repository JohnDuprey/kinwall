// PIN to wake the night-hours Night screen (docs/using/night.md#pin-to-wake). Set and removed
// from a parent's own device; checked by wall screens. Stored only as a salted PBKDF2 hash in the
// settings table (quietPinHash), which readSettings reports as quietPin: true/false and nothing
// more, so it never reaches a client, a webhook or the export. Request bodies here are never logged.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { timingSafeEqual } from '../auth.ts';
import { emit } from '../bus.ts';
import { checkRate, resetRate } from '../ratelimit.ts';
import { ErrorSchema } from '../schemas.ts';
import { isConnectedApp } from './mcp-oauth.ts';

export const quietPinRoutes = createRouter();

const KEY = 'quietPinHash';
const ITERATIONS = 100_000; // the most Workers' PBKDF2 allows
const MAX_TRIES = 10; // for the whole family, per window: the screen itself waits after 5 (web/src/quietPin.ts)
const WINDOW_MS = 15 * 60 * 1000;
// One counter for the family, not per key: a wall can mint itself fresh device keys.
const RATE_KEY = 'quiet-pin';

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function derive(pin: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256));
}

/** `pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>` */
export async function hashPin(pin: string): Promise<string> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2-sha256$${ITERATIONS}$${salt}$${await derive(pin, salt, ITERATIONS)}`;
}

export async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split('$');
  if (alg !== 'pbkdf2-sha256' || !salt || !hash) return false;
  return timingSafeEqual(await derive(pin, salt, Number(iter)), hash);
}

const PinBody = z.object({ pin: z.string().regex(/^\d{4,8}$/, 'must be 4 to 8 digits') }).openapi('QuietPin');
const OkSchema = z.object({ ok: z.boolean() });
const parentOnly = "The PIN is set from a parent's own device";

quietPinRoutes.openapi(
  createRoute({
    method: 'put', path: '/api/quiet-pin', tags: ['Settings'], summary: 'Set the PIN that wakes a wall screen during night hours (parent devices only)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PinBody } } } },
    responses: {
      200: { description: 'set', content: { 'application/json': { schema: OkSchema } } },
      400: { description: 'not 4 to 8 digits', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: 'a wall screen or a connected app', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (await isConnectedApp(c)) return c.json({ error: parentOnly }, 403);
    const { pin } = c.req.valid('json');
    const db = c.env.DB;
    await db.batch([
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(KEY, await hashPin(pin)),
      db.prepare("DELETE FROM rate_limits WHERE key LIKE 'quiet-pin%'"), // a new PIN ends the wait
    ]);
    emit(c, 'settings.changed', {});
    return c.json({ ok: true }, 200);
  },
);

quietPinRoutes.openapi(
  createRoute({
    method: 'delete', path: '/api/quiet-pin', tags: ['Settings'], summary: 'Remove the quiet-hours PIN (parent devices only; also the way out of a forgotten one)',
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'removed', content: { 'application/json': { schema: OkSchema } } },
      403: { description: 'a wall screen or a connected app', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (await isConnectedApp(c)) return c.json({ error: parentOnly }, 403);
    await c.env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(KEY).run();
    emit(c, 'settings.changed', {});
    return c.json({ ok: true }, 200);
  },
);

quietPinRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/quiet-pin/verify', tags: ['Settings'], summary: 'Check the quiet-hours PIN (wall screens may call it; rate-limited for the whole family)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PinBody } } } },
    responses: {
      200: { description: 'ok: true when it matches, or no PIN is set', content: { 'application/json': { schema: OkSchema } } },
      400: { description: 'not 4 to 8 digits', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: 'a connected app', content: { 'application/json': { schema: ErrorSchema } } },
      429: { description: 'too many wrong tries across the family; wait and try again', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (await isConnectedApp(c)) return c.json({ error: 'Connected apps cannot check the PIN' }, 403);
    const db = c.env.DB;
    if (!(await checkRate(db, RATE_KEY, MAX_TRIES, WINDOW_MS))) return c.json({ error: 'Too many tries. Wait a few minutes.' }, 429);
    const stored = (await db.prepare('SELECT value FROM settings WHERE key = ?').bind(KEY).first<{ value: string }>())?.value;
    const ok = !stored || (await pinMatches(c.req.valid('json').pin, stored));
    if (ok) await resetRate(db, RATE_KEY); // only wrong guesses in a row count
    return c.json({ ok }, 200);
  },
);
