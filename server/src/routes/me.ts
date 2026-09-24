import { createRoute } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { resolveKey } from '../auth.ts';
import { MeSchema } from '../schemas.ts';
import { VERSION } from '../version.ts';

export const meRoutes = createRouter();

meRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/me',
    tags: ['System'],
    summary: 'Identify the current API key (scope + name), so clients can adapt their UI',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: MeSchema } } } },
  }),
  async (c) => {
    // requireAuth already validated the key; re-resolving here is cheap and avoids threading
    // Variables typing through every route file just for this one endpoint.
    const resolved = await resolveKey(c);
    return c.json({ scope: resolved?.scope ?? 'admin', keyName: resolved?.name ?? '', kind: resolved?.kind ?? 'api', version: VERSION }, 200);
  },
);
