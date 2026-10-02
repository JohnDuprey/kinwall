import type { KinwallDb, KinwallStatement } from '../db.ts';
import { createRoute, type z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { isConnectedApp } from './mcp-oauth.ts';
import { schemeContrastFailures } from '../colors.ts';
import { GOOGLE_PHOTOS_STATE_SQL, type GooglePhotosState } from './google-photos.ts';
import { isSingleEmoji } from '../emoji.ts';
import { BoardPresetSchema, TIME_FORMATS, TYPEFACES, COLOR_SCHEMES, CUSTOM_SCHEME_ID_RE, CustomSchemeSchema, MAX_CUSTOM_SCHEMES, ErrorSchema, FeaturesSchema, LocationSchema, MealTimesSchema, NightLookSchema, SettingsPatchSchema, SettingsSchema, TidbitSettingsSchema } from '../schemas.ts';

export const settingsRoutes = createRouter();

const DEFAULTS: Record<string, string> = {
  familyName: 'Our Family',
  weekStart: '0',
  themeMode: 'auto', // follow the system until the family picks one
  darkFrom: '20:00',
  darkTo: '07:00',
  accent: '#FF9E7A',
  colorScheme: 'peacock', // migrations 0079, 0084 and 0094 keep Peach ('meadow'), Sage or Eucalyptus for families from before
  backgroundLight: 'warm',
  backgroundDark: 'cocoa',
  textScale: 'm',
  density: 'comfortable',
  defaultReminderMinutes: '[30]',
  lateCompletionCredit: '50',
  streakGraceDays: '1',
  checkInPoints: '0',
  leaderboardEnabled: 'true',
  stickersEnabled: 'true',
  rewardsEnabled: 'true',
  stickerPriceScale: '100',
};

export async function readSettings(db: KinwallDb) {
  // Google Photos' state rides along in the same query (walls need it to offer the source).
  const { results } = await db
    .prepare(`SELECT key, value FROM settings UNION ALL SELECT 'googlePhotos:state', ${GOOGLE_PHOTOS_STATE_SQL} FROM google_photos`)
    .all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  const location = parseLocation(map.get('location'));
  // Night hours: off by default; cleared is stored as '' (the loop in PATCH below), read back as null.
  const quietFrom = map.get('quietFrom') || null;
  const quietTo = map.get('quietTo') || null;
  const darkWithNight = map.get('darkWithNight') === 'true';
  const nightDark = darkWithNight && quietFrom && quietTo; // dark mode follows the night hours while there are some
  return {
    familyName: map.get('familyName') ?? DEFAULTS.familyName,
    // No household default - stays null until set explicitly (server fallback: hostTimezone()) or
    // PATCHed by the web UI on first load with the browser's Intl timezone.
    timezone: map.get('timezone') ?? null,
    weekStart: Number(map.get('weekStart') ?? DEFAULTS.weekStart) as 0 | 1,
    themeMode: (map.get('themeMode') ?? DEFAULTS.themeMode) as 'light' | 'dark' | 'auto' | 'scheduled',
    darkFrom: nightDark ? quietFrom : map.get('darkFrom') ?? DEFAULTS.darkFrom,
    darkTo: nightDark ? quietTo : map.get('darkTo') ?? DEFAULTS.darkTo,
    quietFrom,
    quietTo,
    // Both on unless turned off: a family with quiet hours from before keeps what they did.
    nightRest: map.get('nightRest') !== 'false',
    nightHoldReminders: map.get('nightHoldReminders') !== 'false',
    darkWithNight,
    quietPin: !!map.get('quietPinHash'), // routes/quiet-pin.ts; the hash itself never leaves the server
    accent: map.get('accent') ?? DEFAULTS.accent,
    colorScheme: parseColorScheme(map.get('colorScheme')),
    customColors: parseCustomColors(map.get('customColors')),
    customSchemes: parseCustomSchemes(map.get('customSchemes')),
    backgroundLight: (map.get('backgroundLight') ?? DEFAULTS.backgroundLight) as 'warm' | 'white' | 'gray' | 'sage',
    backgroundDark: (map.get('backgroundDark') ?? DEFAULTS.backgroundDark) as 'cocoa' | 'charcoal' | 'midnight',
    textScale: (map.get('textScale') ?? DEFAULTS.textScale) as 's' | 'm' | 'l' | 'xl',
    density: (map.get('density') ?? DEFAULTS.density) as 'comfortable' | 'compact',
    typeface: TYPEFACES.find((t) => t === map.get('typeface')) ?? 'default',
    timeFormat: TIME_FORMATS.find((t) => t === map.get('timeFormat')) ?? 'auto',
    defaultReminderMinutes: parseReminderMinutes(map.get('defaultReminderMinutes') ?? DEFAULTS.defaultReminderMinutes),
    lateCompletionCredit: Number(map.get('lateCompletionCredit') ?? DEFAULTS.lateCompletionCredit),
    streakGraceDays: Number(map.get('streakGraceDays') ?? DEFAULTS.streakGraceDays),
    checkInPoints: Number(map.get('checkInPoints') ?? DEFAULTS.checkInPoints),
    leaderboardEnabled: (map.get('leaderboardEnabled') ?? DEFAULTS.leaderboardEnabled) === 'true',
    stickersEnabled: (map.get('stickersEnabled') ?? DEFAULTS.stickersEnabled) === 'true',
    rewardsEnabled: (map.get('rewardsEnabled') ?? DEFAULTS.rewardsEnabled) === 'true',
    stickerPriceScale: Number(map.get('stickerPriceScale') ?? DEFAULTS.stickerPriceScale),
    location,
    temperatureUnit: (map.get('temperatureUnit') || defaultUnit(location, map.get('timezone'))) as 'celsius' | 'fahrenheit',
    tidbits: parseTidbits(map.get('tidbits')),
    nightLook: parseNightLook(map.get('nightLook')),
    boardPresets: parseBoardPresets(map.get('boardPresets')),
    features: parseFeatures(map.get('features')),
    mealTimes: parseMealTimes(map.get('mealTimes')),
    aiHealthAccess: map.get('aiHealthAccess') === 'true', // off until a parent turns it on, for every family
    // Medication reminders (routes/medications.ts): off until a parent turns it on, and part of the Health tracker.
    medications: map.get('medications') === 'true' && parseFeatures(map.get('features')).trackersHealth,
    medicationNamesOnWalls: map.get('medicationNamesOnWalls') === 'true', // shared screens say "Meds" until the family turns names on
    newscastNotFeatured: parseIds(map.get('newscastNotFeatured')),
    newscastPostingPaused: parseIds(map.get('newscastPostingPaused')),
    googlePhotos: (map.get('googlePhotos:state') ?? 'off') as GooglePhotosState, // routes/google-photos.ts; left out of the export
  };
}

/** A stored JSON list of member ids (Newscast's per-person switches), or none. */
export function parseIds(raw: string | undefined): string[] {
  try { const v = JSON.parse(raw ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
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
  tipCategories: [],
  onThisDay: ['holidays', 'births'],
  birthsAfter: 1900,
  triviaCategories: [27, 17, 22, 9], // Animals, Science & Nature, Geography, General Knowledge
  triviaDifficulties: ['easy'],
};
function parseTidbits(raw: string | undefined): z.infer<typeof TidbitSettingsSchema> {
  try {
    const saved = JSON.parse(raw ?? '{}');
    // Saved before difficulty was a multi-select: one level, or 'any' for all three.
    if (typeof saved.triviaDifficulty === 'string' && !saved.triviaDifficulties) {
      saved.triviaDifficulties = saved.triviaDifficulty === 'any' ? ['easy', 'medium', 'hard'] : [saved.triviaDifficulty];
    }
    delete saved.triviaDifficulty;
    const parsed = TidbitSettingsSchema.safeParse({ ...DEFAULT_TIDBITS, ...saved });
    return parsed.success ? parsed.data : DEFAULT_TIDBITS;
  } catch { return DEFAULT_TIDBITS; }
}

export const DEFAULT_NIGHT_LOOK: z.infer<typeof NightLookSchema> = { sources: [], every: 5, brightness: 'low', clock: true, clockPosition: null };
function parseNightLook(raw: string | undefined): z.infer<typeof NightLookSchema> {
  try {
    const parsed = NightLookSchema.safeParse({ ...DEFAULT_NIGHT_LOOK, ...JSON.parse(raw ?? '{}') });
    return parsed.success ? parsed.data : DEFAULT_NIGHT_LOOK;
  } catch { return DEFAULT_NIGHT_LOOK; }
}

export const DEFAULT_MEAL_TIMES: z.infer<typeof MealTimesSchema> = { breakfast: '07:30', lunch: '12:00', dinner: '18:00', snack: '15:00' };
function parseMealTimes(raw: string | undefined): z.infer<typeof MealTimesSchema> {
  try {
    const parsed = MealTimesSchema.safeParse({ ...DEFAULT_MEAL_TIMES, ...JSON.parse(raw ?? '{}') });
    return parsed.success ? parsed.data : DEFAULT_MEAL_TIMES;
  } catch { return DEFAULT_MEAL_TIMES; }
}

export type Features = z.infer<typeof FeaturesSchema>;
export const DEFAULT_FEATURES: Features = { chores: true, lists: true, contacts: true, paint: true, photos: true, notes: true, messages: true, trackersReading: true, trackersMemories: true, trackersHealth: true, meals: true, newscast: true, checkIns: true };
// Saved over the defaults, so a switch added later starts on for families that saved before it existed.
export function parseFeatures(raw: string | undefined): Features {
  try {
    const saved = JSON.parse(raw ?? '{}');
    // Saved while Trackers had one switch: it stands for all three until they're set on their own.
    if (typeof saved.trackers === 'boolean') {
      for (const k of ['trackersReading', 'trackersMemories', 'trackersHealth']) saved[k] ??= saved.trackers;
      delete saved.trackers;
    }
    const parsed = FeaturesSchema.safeParse({ ...DEFAULT_FEATURES, ...saved });
    return parsed.success ? parsed.data : DEFAULT_FEATURES;
  } catch { return DEFAULT_FEATURES; }
}
/** The points a daily check-in earns: none while chores and points or check-ins are off. */
export const checkInPointsFor = (s: { checkInPoints: number; features: Features }) => (s.features.chores && s.features.checkIns ? s.checkInPoints : 0);
/** Rewards are on: their own switch, and chores and points. */
export const rewardsOn = (s: { rewardsEnabled: boolean; features: Features }) => s.features.chores && s.rewardsEnabled;
/** Just the feature switches, for the notification ticker and routes that respect them. */
export async function readFeatures(db: KinwallDb): Promise<Features> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'features'").first<{ value: string }>();
  return parseFeatures(row?.value);
}

function parseColorScheme(raw: string | undefined): string {
  return (COLOR_SCHEMES as readonly string[]).includes(raw ?? '') || CUSTOM_SCHEME_ID_RE.test(raw ?? '') ? raw! : DEFAULTS.colorScheme;
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

// Stored as JSON; a preset that no longer validates is dropped rather than failing the read.
function parseBoardPresets(raw: string | undefined): z.infer<typeof BoardPresetSchema>[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.flatMap((x) => { const p = BoardPresetSchema.safeParse(x); return p.success ? [p.data] : []; }) : [];
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
      403: { description: 'aiHealthAccess or a medication setting, from a connected app', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if (body.aiHealthAccess !== undefined && (await isConnectedApp(c))) return c.json({ error: "Only a parent's own device can change what connected apps may see" }, 403);
    if ((body.medications !== undefined || body.medicationNamesOnWalls !== undefined) && (await isConnectedApp(c))) return c.json({ error: "Medication settings are changed from a parent's own device" }, 403);
    // A saved scheme must be readable in both modes, the same bar as the app's editor.
    const failures = (body.customSchemes ?? []).flatMap(schemeContrastFailures);
    if (failures.length) return c.json({ error: `Not enough contrast. ${failures.join('. ')}.` }, 400);
    const writes = settingsWrites(c.env.DB, body);
    if (writes.length) await c.env.DB.batch(writes);
    emit(c, 'settings.changed', {});
    return c.json(await readSettings(c.env.DB), 200);
  },
);

// A wall screen or kid's device can't change family settings, but it can add a scheme to the
// family's list for itself to use (editing and deleting schemes stays with the settings PATCH).
settingsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/settings/color-schemes',
    tags: ['Settings'],
    summary: "Add one color scheme to the family's saved schemes (display keys may); it isn't selected for the family",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CustomSchemeSchema } } } },
    responses: {
      201: { description: 'added', content: { 'application/json': { schema: SettingsSchema } } },
      400: { description: 'invalid, too little contrast, or the family already has the most schemes', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'a scheme with that id exists', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const scheme = c.req.valid('json');
    const failures = schemeContrastFailures(scheme);
    if (failures.length) return c.json({ error: `Not enough contrast. ${failures.join('. ')}.` }, 400);
    if (scheme.emoji && !isSingleEmoji(scheme.emoji)) return c.json({ error: 'The emoji must be a single emoji' }, 400);
    // One conditional statement, so parallel posts can't both slip under the cap or repeat an id.
    const list = "CASE WHEN json_valid(settings.value) AND json_type(settings.value) = 'array' THEN settings.value ELSE '[]' END";
    const res = await c.env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES ('customSchemes', json_array(json(?))) ON CONFLICT(key) DO UPDATE SET value = json_insert(${list}, '$[#]', json(?)) ` +
        `WHERE json_array_length(${list}) < ? AND NOT EXISTS (SELECT 1 FROM json_each(${list}) WHERE json_extract(json_each.value, '$.id') = ?)`,
    ).bind(JSON.stringify(scheme), JSON.stringify(scheme), MAX_CUSTOM_SCHEMES, scheme.id).run();
    if (res.meta.changes === 0) {
      const current = (await readSettings(c.env.DB)).customSchemes ?? [];
      if (current.some((x) => x.id === scheme.id)) return c.json({ error: 'That scheme already exists' }, 409);
      return c.json({ error: `The family has ${MAX_CUSTOM_SCHEMES} saved schemes, the most it can keep` }, 400);
    }
    emit(c, 'settings.changed', {});
    return c.json(await readSettings(c.env.DB), 201);
  },
);
