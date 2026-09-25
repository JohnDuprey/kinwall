import { createRoute } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { ErrorSchema, SettingsPatchSchema, SettingsSchema } from '../schemas.ts';

export const settingsRoutes = createRouter();

const DEFAULTS: Record<string, string> = {
  familyName: 'Our Family',
  weekStart: '0',
  themeMode: 'light',
  darkFrom: '20:00',
  darkTo: '07:00',
  accent: '#FF9E7A',
  backgroundLight: 'warm',
  backgroundDark: 'cocoa',
  textScale: 'm',
  density: 'comfortable',
  defaultReminderMinutes: '[30]',
};

export async function readSettings(db: D1Database) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return {
    familyName: map.get('familyName') ?? DEFAULTS.familyName,
    // No household default - stays null until set explicitly (server fallback: hostTimezone()) or
    // PATCHed by the web UI on first load with the browser's Intl timezone.
    timezone: map.get('timezone') ?? null,
    weekStart: Number(map.get('weekStart') ?? DEFAULTS.weekStart) as 0 | 1,
    themeMode: (map.get('themeMode') ?? DEFAULTS.themeMode) as 'light' | 'dark' | 'auto' | 'scheduled',
    darkFrom: map.get('darkFrom') ?? DEFAULTS.darkFrom,
    darkTo: map.get('darkTo') ?? DEFAULTS.darkTo,
    accent: map.get('accent') ?? DEFAULTS.accent,
    backgroundLight: (map.get('backgroundLight') ?? DEFAULTS.backgroundLight) as 'warm' | 'white' | 'gray' | 'sage',
    backgroundDark: (map.get('backgroundDark') ?? DEFAULTS.backgroundDark) as 'cocoa' | 'charcoal' | 'midnight',
    textScale: (map.get('textScale') ?? DEFAULTS.textScale) as 's' | 'm' | 'l' | 'xl',
    density: (map.get('density') ?? DEFAULTS.density) as 'comfortable' | 'compact',
    defaultReminderMinutes: parseReminderMinutes(map.get('defaultReminderMinutes') ?? DEFAULTS.defaultReminderMinutes),
  };
}

function parseReminderMinutes(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
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

settingsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/settings',
    tags: ['Settings'],
    summary: 'Update household settings',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: SettingsPatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: SettingsSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { theme, ...body } = c.req.valid('json');
    const patch: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      patch[key] = Array.isArray(value) ? JSON.stringify(value) : String(value);
    }
    // Legacy 'theme': 'light'|'dark' -> themeMode, unless an explicit themeMode was also sent.
    if (theme && patch.themeMode === undefined) patch.themeMode = theme;
    for (const [key, value] of Object.entries(patch)) {
      await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(key, value)
        .run();
    }
    emit(c, 'settings.changed', {});
    return c.json(await readSettings(c.env.DB), 200);
  },
);
