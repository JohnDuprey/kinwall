import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { ErrorSchema, SettingsSchema } from '../schemas.ts';

export const settingsRoutes = createRouter();

const DEFAULTS: Record<string, string> = {
  familyName: 'Our Family',
  weekStart: '0',
  theme: 'light',
};

async function readSettings(db: D1Database) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return {
    familyName: map.get('familyName') ?? DEFAULTS.familyName,
    // No household default - stays null until set explicitly (server fallback: hostTimezone()) or
    // PATCHed by the web UI on first load with the browser's Intl timezone.
    timezone: map.get('timezone') ?? null,
    weekStart: Number(map.get('weekStart') ?? DEFAULTS.weekStart) as 0 | 1,
    theme: map.get('theme') ?? DEFAULTS.theme,
  };
}

settingsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/settings',
    tags: ['Settings'],
    summary: 'Get household settings',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: SettingsSchema } } } },
  }),
  async (c) => c.json(await readSettings(c.env.DB), 200),
);

const PatchSettingsSchema = z
  .object({
    familyName: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
    theme: z.string().min(1).optional(),
  })
  .openapi('SettingsPatch');

settingsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/settings',
    tags: ['Settings'],
    summary: 'Update household settings',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PatchSettingsSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: SettingsSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key, String(value))
        .run();
    }
    emit(c, 'settings.changed', {});
    return c.json(await readSettings(c.env.DB), 200);
  },
);
