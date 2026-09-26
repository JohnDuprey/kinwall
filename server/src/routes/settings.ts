import type { KinwallDb, KinwallStatement } from '../db.ts';
import { createRoute, type z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { schemeContrastFailures } from '../colors.ts';
import { COLOR_SCHEMES, CUSTOM_SCHEME_ID_RE, CustomSchemeSchema, ErrorSchema, LocationSchema, SettingsPatchSchema, SettingsSchema, TidbitSettingsSchema } from '../schemas.ts';

export const settingsRoutes = createRouter();

const DEFAULTS: Record<string, string> = {
  familyName: 'Our Family',
  weekStart: '0',
  themeMode: 'light',
  darkFrom: '20:00',
  darkTo: '07:00',
  accent: '#FF9E7A',
  colorScheme: 'meadow',
  backgroundLight: 'warm',
  backgroundDark: 'cocoa',
  textScale: 'm',
  density: 'comfortable',
  defaultReminderMinutes: '[30]',
  lateCompletionCredit: '50',
  streakGraceDays: '1',
  leaderboardEnabled: 'true',
  stickersEnabled: 'true',
  stickerPriceScale: '100',
};

export async function readSettings(db: KinwallDb) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  const location = parseLocation(map.get('location'));
  return {
    familyName: map.get('familyName') ?? DEFAULTS.familyName,
    // No household default - stays null until set explicitly (server fallback: hostTimezone()) or
    // PATCHed by the web UI on first load with the browser's Intl timezone.
    timezone: map.get('timezone') ?? null,
    weekStart: Number(map.get('weekStart') ?? DEFAULTS.weekStart) as 0 | 1,
    themeMode: (map.get('themeMode') ?? DEFAULTS.themeMode) as 'light' | 'dark' | 'auto' | 'scheduled',
    darkFrom: map.get('darkFrom') ?? DEFAULTS.darkFrom,
    darkTo: map.get('darkTo') ?? DEFAULTS.darkTo,
    // Off by default; cleared is stored as '' (the loop in PATCH below), read back as null.
    quietFrom: map.get('quietFrom') || null,
    quietTo: map.get('quietTo') || null,
    accent: map.get('accent') ?? DEFAULTS.accent,
    colorScheme: parseColorScheme(map.get('colorScheme')),
    customColors: parseCustomColors(map.get('customColors')),
    customSchemes: parseCustomSchemes(map.get('customSchemes')),
    backgroundLight: (map.get('backgroundLight') ?? DEFAULTS.backgroundLight) as 'warm' | 'white' | 'gray' | 'sage',
    backgroundDark: (map.get('backgroundDark') ?? DEFAULTS.backgroundDark) as 'cocoa' | 'charcoal' | 'midnight',
    textScale: (map.get('textScale') ?? DEFAULTS.textScale) as 's' | 'm' | 'l' | 'xl',
    density: (map.get('density') ?? DEFAULTS.density) as 'comfortable' | 'compact',
    defaultReminderMinutes: parseReminderMinutes(map.get('defaultReminderMinutes') ?? DEFAULTS.defaultReminderMinutes),
    lateCompletionCredit: Number(map.get('lateCompletionCredit') ?? DEFAULTS.lateCompletionCredit),
    streakGraceDays: Number(map.get('streakGraceDays') ?? DEFAULTS.streakGraceDays),
    leaderboardEnabled: (map.get('leaderboardEnabled') ?? DEFAULTS.leaderboardEnabled) === 'true',
    stickersEnabled: (map.get('stickersEnabled') ?? DEFAULTS.stickersEnabled) === 'true',
    stickerPriceScale: Number(map.get('stickerPriceScale') ?? DEFAULTS.stickerPriceScale),
    location,
    temperatureUnit: (map.get('temperatureUnit') || defaultUnit(location, map.get('timezone'))) as 'celsius' | 'fahrenheit',
    tidbits: parseTidbits(map.get('tidbits')),
  };
}

// Fahrenheit where it's the everyday unit: by the location's country, else a US timezone.
const FAHRENHEIT_COUNTRIES = ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'];
function defaultUnit(location: Location | null, tz: string | undefined): 'celsius' | 'fahrenheit' {
  if (location?.countryCode) return FAHRENHEIT_COUNTRIES.includes(location.countryCode.toUpperCase()) ? 'fahrenheit' : 'celsius';
  return /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Juneau|Detroit|Boise|Indiana|Kentucky|North_Dakota)|Pacific\/Honolulu|US\/)/.test(tz ?? '') ? 'fahrenheit' : 'celsius';
}

export const DEFAULT_TIDBITS: z.infer<typeof TidbitSettingsSchema> = {
  sources: ['quotes', 'facts'], // the online sources are opt-in: the server only reaches out once a family asks it to
  factCategories: [],
  onThisDay: ['holidays', 'births'],
  birthsAfter: 1900,
  triviaCategories: [27, 17, 22, 9], // Animals, Science & Nature, Geography, General Knowledge
  triviaDifficulty: 'easy',
};
function parseTidbits(raw: string | undefined): z.infer<typeof TidbitSettingsSchema> {
  try {
    const parsed = TidbitSettingsSchema.safeParse({ ...DEFAULT_TIDBITS, ...JSON.parse(raw ?? '{}') });
    return parsed.success ? parsed.data : DEFAULT_TIDBITS;
  } catch { return DEFAULT_TIDBITS; }
}

function parseColorScheme(raw: string | undefined): string {
  return (COLOR_SCHEMES as readonly string[]).includes(raw ?? '') || CUSTOM_SCHEME_ID_RE.test(raw ?? '') ? raw! : 'meadow';
}

// Stored as JSON; anything that no longer validates is dropped rather than failing the read.
function parseCustomSchemes(raw: string | undefined): z.infer<typeof CustomSchemeSchema>[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.flatMap((x) => { const p = CustomSchemeSchema.safeParse(x); return p.success ? [p.data] : []; }) : [];
  } catch {
    return [];
  }
}

// Stored as JSON; an empty object or unreadable value reads back as null (no custom colors).
function parseCustomColors(raw: string | undefined): { bg?: string; card?: string; text?: string } | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    const out: { bg?: string; card?: string; text?: string } = {};
    for (const k of ['bg', 'card', 'text'] as const) if (typeof v?.[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(v[k])) out[k] = v[k];
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

type Location = z.infer<typeof LocationSchema>;
function parseLocation(raw: string | undefined): Location | null {
  if (!raw) return null;
  try {
    const parsed = LocationSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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

// A validated PATCH body as upsert statements - shared by PATCH /api/settings and POST /api/import.
export function settingsWrites(db: KinwallDb, { theme, ...body }: z.infer<typeof SettingsPatchSchema>): KinwallStatement[] {
  const patch: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    patch[key] = value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value); // arrays, location
  }
  // Legacy 'theme': 'light'|'dark' -> themeMode, unless an explicit themeMode was also sent.
  if (theme && patch.themeMode === undefined) patch.themeMode = theme;
  return Object.entries(patch).map(([key, value]) =>
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value),
  );
}

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
    const body = c.req.valid('json');
    // A saved scheme must be readable in both modes, the same bar as the app's editor.
    const failures = (body.customSchemes ?? []).flatMap(schemeContrastFailures);
    if (failures.length) return c.json({ error: `Not enough contrast. ${failures.join('. ')}.` }, 400);
    const writes = settingsWrites(c.env.DB, body);
    if (writes.length) await c.env.DB.batch(writes);
    emit(c, 'settings.changed', {});
    return c.json(await readSettings(c.env.DB), 200);
  },
);
