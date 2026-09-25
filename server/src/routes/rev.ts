import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { getRev } from '../bus.ts';

export const revRoutes = createRouter();

revRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/rev',
    tags: ['System'],
    summary: 'Current revision counter, bumped on every write. Poll for near-live updates.',
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ rev: z.number() }) } } },
    },
  }),
  async (c) => c.json({ rev: await getRev(c.env.DB) }, 200),
);
