import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';

// Remote Night screen (Home Assistant: "nobody's home"). Stored in the settings table:
// 'nightScreen' for every wall screen, 'nightScreen:<display key id>' for one screen, which wins
// over the family-wide one. Each holds { on, since, until }; past `until` it counts as off, so a
// forgotten "on" runs out by itself with no write. Wall screens read their own state from
// GET /api/rev (routes/rev.ts), which they already poll; admin only otherwise (not in DISPLAY_ALLOWED).
const FAMILY = 'nightScreen';
const DEFAULT_HOURS = 12;

type Stored = { on: boolean; since: string; until: string };
export const NightStateSchema = z.object({ on: z.boolean(), since: z.string(), until: z.string() }).openapi('NightScreenState');
export const NightScreenSchema = z
  .object({
    all: NightStateSchema.nullable().describe('On for every wall screen, or null'),
    displays: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        owner: z.string().nullable(),
        on: z.boolean(),
        since: z.string().nullable(),
        until: z.string().nullable(),
      }),
    ),
  })
  .openapi('NightScreen');

function live(value: string | undefined, now: number): Stored | null {
  if (!value) return null;
  try {
    const s = JSON.parse(value) as Stored;
    return Date.parse(s.until) > now ? s : null;
  } catch {
    return null;
  }
}

/** One screen's state from the stored rows: its own if set, else the family-wide one. Null = off. */
export function effectiveNight(rows: Map<string, string>, keyId: string | undefined, now = Date.now()): Stored | null {
  const s = (keyId && live(rows.get(`${FAMILY}:${keyId}`), now)) || live(rows.get(FAMILY), now);
  return s?.on ? s : null;
}

export const nightRowKeys = (keyId: string | undefined) => (keyId ? [FAMILY, `${FAMILY}:${keyId}`] : [FAMILY]);

async function readState(db: KinwallDb) {
  const [rows, keys] = await db.batch([
    db.prepare("SELECT key, value FROM settings WHERE key = 'nightScreen' OR key LIKE 'nightScreen:%'"),
    db.prepare("SELECT id, name, owner FROM api_keys WHERE kind = 'api' AND scope = 'display' AND device_kind IS NOT 'widgets' ORDER BY created_at"), // not the app's widgets
  ]);
  const map = new Map((rows.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const all = effectiveNight(map, undefined);
  return {
    all,
    displays: (keys.results as { id: string; name: string; owner: string | null }[]).map((k) => {
      const s = effectiveNight(map, k.id);
      return { id: k.id, name: k.name, owner: k.owner, on: !!s, since: s?.since ?? null, until: s?.until ?? null };
    }),
  };
}

export const nightScreenRoutes = createRouter();

nightScreenRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/displays/night-screen',
    tags: ['Displays'],
    summary: "Whether the Night screen is on, for every wall screen and for each paired display (admin; walls read theirs from /api/rev)",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: NightScreenSchema } } } },
  }),
  async (c) => c.json(await readState(c.env.DB), 200),
);

nightScreenRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/displays/night-screen',
    tags: ['Displays'],
    summary: 'Start (on) or end (off) the Night screen on every wall screen, or on the given paired displays',
    description:
      'Without `displays` it sets every wall screen and drops any per-screen choice. `on` runs out after `hours` (default 12). ' +
      'Walls pick it up on their next /api/rev check: within 30 seconds to start, within 10 seconds to wake.',
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              on: z.boolean(),
              displays: z.array(z.string()).min(1).optional().describe('Display key ids (from GET /api/displays/night-screen). Omit for every wall screen.'),
              hours: z.number().positive().max(168).optional().describe('How long "on" lasts before it runs out. Default 12.'),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: NightScreenSchema } } },
      400: { description: 'unknown display', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { on, displays, hours } = c.req.valid('json');
    const db = c.env.DB;
    const now = Date.now();
    const value = JSON.stringify({ on, since: new Date(now).toISOString(), until: new Date(now + (hours ?? DEFAULT_HOURS) * 3600e3).toISOString() });
    const put = (key: string) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
    if (displays) {
      const ids = [...new Set(displays)];
      const known = await db.prepare(`SELECT id FROM api_keys WHERE kind = 'api' AND scope = 'display' AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>();
      if (known.results.length !== ids.length) return c.json({ error: 'displays: unknown display' }, 400);
      // Off is stored too (not deleted), so one screen can wake while the rest stay asleep.
      await db.batch(ids.map((id) => put(`${FAMILY}:${id}`)));
    } else {
      const clear = db.prepare("DELETE FROM settings WHERE key = 'nightScreen' OR key LIKE 'nightScreen:%'");
      await db.batch(on ? [clear, put(FAMILY)] : [clear]);
    }
    const state = await readState(db);
    emit(c, 'display.night_screen', { on, displays: displays ?? null, until: on ? JSON.parse(value).until : null });
    return c.json(state, 200);
  },
);
