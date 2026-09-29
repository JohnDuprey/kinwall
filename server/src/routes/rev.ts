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
    description: "Also this key's remote Night screen (POST /api/displays/night-screen): on, or null. Same single read, no writes.",
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ rev: z.number(), nightScreen: NightStateSchema.nullable() }) } } },
    },
  }),
  async (c) => {
    const keyId = (await requestKey(c))?.id;
    const keys = ['rev', ...nightRowKeys(keyId)];
    const { results } = await c.env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ key: string; value: string }>();
    const rows = new Map(results.map((r) => [r.key, r.value]));
    return c.json({ rev: Number(rows.get('rev')) || 0, nightScreen: effectiveNight(rows, keyId) }, 200);
  },
);
