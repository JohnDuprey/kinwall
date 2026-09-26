import { createRoute } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { AppearanceSchema } from '../schemas.ts';
import { readSettings } from './settings.ts';

// Public (no-auth) counterpart to GET /api/settings: only the fields useTheme.ts needs to paint
// the pairing gate / setup wizard correctly before a display has a key (see auth.ts PUBLIC_PATH).
export const appearanceRoutes = createRouter();

appearanceRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/appearance',
    tags: ['Settings'],
    summary: 'Public appearance-only settings (no auth) — for the pre-pairing screen',
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: AppearanceSchema } } } },
  }),
  async (c) => {
    const { themeMode, darkFrom, darkTo, accent, colorScheme, customColors, customSchemes, backgroundLight, backgroundDark, textScale, density } = await readSettings(c.env.DB);
    return c.json({ themeMode, darkFrom, darkTo, accent, colorScheme, customColors, customSchemes, backgroundLight, backgroundDark, textScale, density }, 200);
  },
);
