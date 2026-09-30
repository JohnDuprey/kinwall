import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { requestKey } from '../auth.ts';
import { effectiveNight, nightRowKeys, NightStateSchema } from './night-screen.ts';

export const revRoutes = createRouter();

revRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/rev',
    tags: ['System'],
    summary: 'Current revision counter, bumped on every write. Poll for near-live updates.',
    description:
      "Also this key's remote Night screen (POST /api/displays/night-screen): on, or null. Same single read, no writes. `revs` counts changes per area, so a client can refetch only what changed: `lists` (lists and their items), `chores` (chores, completions and rewards, which change points) and `events` (events, calendars, members, settings and everything else shown; a change to contacts, recipes, journals, trackers or photos bumps only `rev`). Compare each to the value you saw last; older servers leave `revs` out.",
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ rev: z.number(), revs: z.object({ events: z.number(), lists: z.number(), chores: z.number() }), nightScreen: NightStateSchema.nullable() }) } } },
    },
  }),
  async (c) => {
    const keyId = (await requestKey(c))?.id;
    const keys = ['rev', 'revs', ...nightRowKeys(keyId)];
    const { results } = await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ key: string; value: string }>();
    const rows = new Map(results.map((r) => [r.key, r.value]));
    const revs = JSON.parse(rows.get('revs') ?? '{}') as Record<string, number>; // bus.ts bumps them
    return c.json({ rev: Number(rows.get('rev')) || 0, revs: { events: revs.events ?? 0, lists: revs.lists ?? 0, chores: revs.chores ?? 0 }, nightScreen: effectiveNight(rows, keyId) }, 200);
  },
);
