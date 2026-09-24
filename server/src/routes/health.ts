import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';

export const healthRoutes = createRouter();

healthRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/health',
    tags: ['System'],
    summary: 'Health check (no auth required)',
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean(), version: z.string() }) } } },
    },
  }),
  (c) => c.json({ ok: true, version: '1.0.0' }, 200),
);
