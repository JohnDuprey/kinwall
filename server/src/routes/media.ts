// GET /api/media-token: what this sign-in's <img src>s carry as ?key= instead of its full key
// (auth.ts mediaTokenFor), so the key stays out of browser history and access logs.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { mediaTokenFor, requestKey } from '../auth.ts';

export const mediaRoutes = createRouter();

mediaRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/media-token',
    tags: ['System'],
    summary: "A token for this sign-in's image links: pass it as ?key= on the image routes instead of the key.",
    description:
      "Works only as ?key= on GET of a photo's, recipe's, recipe step's or meal's image and on book covers (never as a Bearer header, never anywhere else), as the key it came from (a wall display's token keeps a wall display's limits). It stays the same for as long as that sign-in lasts (an app's sign-in survives its hourly key refreshing), so image links and the browser's cache keep working, and stops the moment the key, passkey or connected app is removed. `null` for the server's ADMIN_API_KEY and on a server without ENCRYPTION_KEY: keep using the key there. Any key may ask.",
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ token: z.string().nullable() }).openapi('MediaToken') } } },
    },
  }),
  async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ token: await mediaTokenFor(c.env, await requestKey(c)) }, 200);
  },
);
