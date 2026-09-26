// Shared zod-openapi schemas, reused across route files.
import { z } from '@hono/zod-openapi';
import { isSingleEmoji, isValidAvatar } from './emoji.ts';

export const ErrorSchema = z.object({ error: z.string() }).openapi('Error');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// The web app's color schemes (web/src/skins.ts), plus 'seasonal' (the scheme follows the date).
// 'meadow' is the default, shown as Peach; 'field' is the green one shown as Meadow.
export const COLOR_SCHEMES = ['meadow', 'field', 'autumn', 'winter', 'spring', 'summer', 'ocean', 'midnight', 'lavender', 'harvest', 'festive', 'seasonal'] as const;
const hex = () => z.string().regex(HEX_COLOR_RE, 'must be a hex color like #RRGGBB');
// Household custom colors layered on the scheme. The accent lives in `accent` (its default means
// "use the scheme's accent"), so only the surfaces are here.
const CustomColorsSchema = z.object({ bg: hex().optional(), card: hex().optional(), text: hex().optional() }).strict();
// A family's own saved color scheme: four picked colors per mode (the app derives the rest and
// checks contrast before it lets one be saved). Ids are 'custom-…' so they never clash with a skin.
export const CUSTOM_SCHEME_ID_RE = /^custom-[a-z0-9]{4,16}$/;
const PaletteSchema = z.object({ bg: hex(), card: hex(), text: hex(), accent: hex() }).strict();
export const CustomSchemeSchema = z
  .object({
    id: z.string().regex(CUSTOM_SCHEME_ID_RE),
    name: z.string().trim().min(1).max(30),
    emoji: z.string().max(16),
    light: PaletteSchema,
    dark: PaletteSchema,
  })
  .strict()
  .openapi('CustomScheme');
export const MAX_CUSTOM_SCHEMES = 10;
const ColorSchemeIdSchema = z.union([z.enum(COLOR_SCHEMES), z.string().regex(CUSTOM_SCHEME_ID_RE)]);
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const AvatarSchema = z.string().refine(isValidAvatar, 'must be a single emoji or a 1-2 letter initial');
export const EmojiSchema = z.string().refine(isSingleEmoji, 'must be a single emoji');

// YYYY-MM-DD, or --MM-DD when the year isn't known. Must be a real date (--02-29 is fine) and not in the future.
export function isValidBirthday(s: string): boolean {
  const m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [m[1] === '-' ? 2000 : Number(m[1]), Number(m[2]), Number(m[3])]; // 2000: a leap year
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && (m[1] === '-' || (y >= 1900 && s <= new Date().toISOString().slice(0, 10)));
}
export const BirthdaySchema = z.string().refine(isValidBirthday, 'must be YYYY-MM-DD or --MM-DD (year unknown)');

export const MemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    avatar: z.string().nullable(),
    birthday: z.string().nullable(), // YYYY-MM-DD, or --MM-DD when the year isn't known
    sort: z.number(),
    pointsToday: z.number(),
    pointsWeek: z.number(),
    balance: z.number(), // points left to spend: everything earned from chores, minus sticker purchases (+/- other ledger entries)
  })
  .openapi('Member');

export const MemberInputSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().min(1),
    avatar: AvatarSchema.nullable().optional(),
    birthday: BirthdaySchema.nullable().optional(),
    sort: z.number().optional(),
  })
  .openapi('MemberInput');

export const CategorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    emoji: z.string().nullable(),
    color: z.string(),
    keywords: z.array(z.string()),
    sort: z.number(),
    createdAt: z.string(),
  })
  .openapi('Category');

export const CategoryInputSchema = z
  .object({
    name: z.string().min(1),
    emoji: EmojiSchema.nullable().optional(),
    color: z.string().min(1),
    keywords: z.array(z.string()).optional(),
    sort: z.number().optional(),
  })
  .openapi('CategoryInput');

export const CategoryReorderSchema = z.object({ ids: z.array(z.string()) }).openapi('CategoryReorder');

export const LocationSchema = z
  .object({
    name: z.string().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    countryCode: z.string().length(2).optional(),
  })
  .openapi('Location');

// The Board's quote / fact card (Settings -> For the whole family -> Quotes & facts).
export const TIDBIT_SOURCES = ['quotes', 'facts', 'onthisday', 'trivia'] as const;
export const FACT_CATEGORIES = ['animals', 'space', 'science', 'body', 'plants', 'words'] as const;
export const ON_THIS_DAY_KINDS = ['holidays', 'births', 'events'] as const;
export const TidbitSettingsSchema = z
  .object({
    sources: z.array(z.enum(TIDBIT_SOURCES)).max(TIDBIT_SOURCES.length), // [] = no card on the Board
    factCategories: z.array(z.enum(FACT_CATEGORIES)).max(FACT_CATEGORIES.length), // built-in facts; [] = every category
    onThisDay: z.array(z.enum(ON_THIS_DAY_KINDS)).min(1).max(ON_THIS_DAY_KINDS.length), // Wikipedia's On this day
    birthsAfter: z.number().int().min(0).max(2100).nullable(), // birthdays only for people born in or after this year; null = any
    triviaCategories: z.array(z.number().int().min(9).max(32)).min(1).max(24), // Open Trivia DB category ids
    triviaDifficulty: z.enum(['easy', 'medium', 'hard', 'any']),
  })
  .openapi('TidbitSettings');

export const SettingsSchema = z
  .object({
    familyName: z.string(),
    timezone: z.string().nullable(),
    weekStart: z.union([z.literal(0), z.literal(1)]),
    themeMode: z.enum(['light', 'dark', 'auto', 'scheduled']),
    darkFrom: z.string(),
    darkTo: z.string(),
    // Quiet hours for paired displays (HH:MM, household-local). Both null = off.
    quietFrom: z.string().nullable(),
    quietTo: z.string().nullable(),
    accent: z.string(), // '#FF9E7A' (the default) = the color scheme's own accent; anything else is a custom accent
    colorScheme: ColorSchemeIdSchema, // a built-in scheme, 'seasonal', or a customSchemes id
    customColors: CustomColorsSchema.nullable(), // legacy: surfaces layered on the scheme (no longer set by the app)
    customSchemes: z.array(CustomSchemeSchema),
    // Legacy background presets: still applied under the Meadow scheme, no longer offered in the app.
    backgroundLight: z.enum(['warm', 'white', 'gray', 'sage']),
    backgroundDark: z.enum(['cocoa', 'charcoal', 'midnight']),
    textScale: z.enum(['s', 'm', 'l', 'xl']),
    density: z.enum(['comfortable', 'compact']),
    defaultReminderMinutes: z.array(z.number()),
    lateCompletionCredit: z.number(), // percent of a chore's points earned when it's completed for a past day
    streakGraceDays: z.number(), // missed days per rolling 7 a streak survives (see computeStreak)
    leaderboardEnabled: z.boolean(), // false: clients hide the leaderboard and rank badges (the API still answers)
    stickersEnabled: z.boolean(), // false: clients hide the sticker book and the shop refuses purchases
    stickerPriceScale: z.number(), // percent applied to every sticker pack's price; 0 = all free
    location: LocationSchema.nullable(), // for the snapshot's weather; null = no weather
    temperatureUnit: z.enum(['celsius', 'fahrenheit']), // default: fahrenheit for a US location (or US timezone), else celsius
    tidbits: TidbitSettingsSchema,
  })
  .openapi('Settings');

export const SettingsPatchSchema = z
  .object({
    familyName: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
    theme: z.enum(['light', 'dark']).optional(), // legacy - mapped into themeMode
    themeMode: z.enum(['light', 'dark', 'auto', 'scheduled']).optional(),
    darkFrom: z.string().regex(HHMM_RE, 'must be HH:MM').optional(),
    darkTo: z.string().regex(HHMM_RE, 'must be HH:MM').optional(),
    quietFrom: z.union([z.string().regex(HHMM_RE, 'must be HH:MM'), z.literal(''), z.null()]).optional(),
    quietTo: z.union([z.string().regex(HHMM_RE, 'must be HH:MM'), z.literal(''), z.null()]).optional(),
    accent: z.string().regex(HEX_COLOR_RE, 'must be a hex color like #RRGGBB').optional(),
    colorScheme: ColorSchemeIdSchema.optional(),
    customColors: CustomColorsSchema.nullable().optional(),
    customSchemes: z
      .array(CustomSchemeSchema)
      .max(MAX_CUSTOM_SCHEMES)
      .refine((l) => new Set(l.map((x) => x.id)).size === l.length, 'scheme ids must be unique')
      .optional(),
    backgroundLight: z.enum(['warm', 'white', 'gray', 'sage']).optional(),
    backgroundDark: z.enum(['cocoa', 'charcoal', 'midnight']).optional(),
    textScale: z.enum(['s', 'm', 'l', 'xl']).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    defaultReminderMinutes: z.array(z.number()).optional(),
    lateCompletionCredit: z.number().int().min(0).max(100).optional(),
    streakGraceDays: z.number().int().min(0).max(3).optional(),
    leaderboardEnabled: z.boolean().optional(),
    stickersEnabled: z.boolean().optional(),
    stickerPriceScale: z.number().int().min(0).max(200).optional(),
    location: LocationSchema.nullable().optional(),
    temperatureUnit: z.enum(['celsius', 'fahrenheit']).optional(),
    tidbits: TidbitSettingsSchema.optional(),
  })
  // Quiet hours are a pair: send both, and either both set or both cleared ('' / null).
  .refine((p) => (p.quietFrom === undefined) === (p.quietTo === undefined) && !p.quietFrom === !p.quietTo, {
    message: 'quietFrom and quietTo must be set (or cleared) together',
    path: ['quietTo'],
  })
  .openapi('SettingsPatch');

// Subset of Settings safe to expose with no auth, for the pre-pairing screen / setup wizard
// (which have no API key yet) — no familyName or anything else household-identifying.
export const AppearanceSchema = SettingsSchema.pick({
  themeMode: true,
  darkFrom: true,
  darkTo: true,
  accent: true,
  colorScheme: true,
  customColors: true,
  customSchemes: true,
  backgroundLight: true,
  backgroundDark: true,
  textScale: true,
  density: true,
}).openapi('Appearance');

export const AccountSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['google', 'microsoft', 'caldav']),
    name: z.string(),
    createdAt: z.string(),
  })
  .openapi('Account');

export const CalendarSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['local', 'ics', 'google', 'microsoft', 'caldav']),
    accountId: z.string().nullable(),
    remoteId: z.string().nullable(),
    name: z.string(),
    color: z.string().nullable(),
    memberId: z.string().nullable(),
    memberIds: z.array(z.string()),
    categoryId: z.string().nullable(), // default category for events with no override/keyword match
    writable: z.boolean(),
    enabled: z.boolean(),
    lastSyncedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    needsReconnect: z.boolean(), // imported placeholder: settings kept, not syncing until reconnected
  })
  .openapi('Calendar');

export const CalendarInputSchema = z
  .object({
    kind: z.enum(['local', 'ics', 'google', 'microsoft', 'caldav']),
    name: z.string().min(1),
    color: z.string().nullable().optional(),
    memberId: z.string().nullable().optional(), // legacy - use memberIds
    memberIds: z.array(z.string()).optional(),
    categoryId: z.string().nullable().optional(),
    accountId: z.string().nullable().optional(),
    remoteId: z.string().nullable().optional(),
    url: z.string().url().optional(),
    writable: z.boolean().optional(), // false marks a provider calendar read-only (can only lower access)
  })
  .openapi('CalendarInput');

export const EventInstanceSchema = z
  .object({
    id: z.string(),
    calendarId: z.string(),
    title: z.string(),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    location: z.string().nullable(),
    description: z.string().nullable(),
    memberIds: z.array(z.string()),
    color: z.string(),
    rrule: z.string().nullable(),
    occurrenceStart: z.string().nullable(),
    readOnly: z.boolean(),
    seriesId: z.string().nullable(),
    memberScope: z.enum(['occurrence', 'series', 'calendar', 'none']),
    categoryId: z.string().nullable(),
    categorySource: z.enum(['event', 'series', 'keyword', 'calendar']).nullable(),
    reminders: z.array(z.number()).nullable(), // minutes-before in effect: the event's own, else the household default
    reminderSource: z.enum(['event', 'default']).nullable(), // where `reminders` came from; null = no reminders at all
    travelMinutes: z.number().nullable(), // Kinwall-only travel time; never sent to the provider
    leaveAt: z.string().nullable(), // start - travelMinutes; null when no travel time or all-day
    remindBeforeLeave: z.boolean(), // reminders count back from leaveAt instead of start
    linkedItemCount: z.number().optional(), // open list items linked to this event (GET /api/events only)
    noteCount: z.number().optional(), // notes in this event's thread (GET /api/events only)
  })
  .openapi('EventInstance');

export const EventInputSchema = z
  .object({
    calendarId: z.string(),
    title: z.string().min(1),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    location: z.string().optional(),
    description: z.string().optional(),
    memberIds: z.array(z.string()).optional(),
    rrule: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    reminders: z.array(z.number().int().min(0).max(40320)).nullable().optional(), // [] = none; null = default (household, or the Google calendar's own). Written through to Google/Outlook
    travelMinutes: z.number().int().min(0).max(600).nullable().optional(), // Kinwall-only, works on any calendar (even read-only)
    remindBeforeLeave: z.boolean().optional(),
  })
  .openapi('EventInput');

export const ChoreSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    emoji: z.string().nullable(),
    memberId: z.string().nullable(),
    points: z.number(),
    rrule: z.string().nullable(),
    dueDate: z.string().nullable(),
    dueTime: z.string().nullable(),
    active: z.boolean(),
    sort: z.number(),
    listId: z.string().nullable().openapi({ description: 'Checklist: a list that must be fully ticked before the chore can be completed.' }),
  })
  .openapi('Chore');

export const ChoreInputSchema = z
  .object({
    title: z.string().min(1),
    emoji: EmojiSchema.nullable().optional(),
    memberId: z.string().nullable().optional(),
    points: z.number().optional(),
    rrule: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    dueTime: z.string().nullable().optional(),
    active: z.boolean().optional(),
    sort: z.number().optional(),
    listId: z.string().nullable().optional().openapi({ description: 'Checklist list id; null to unlink. A reusable list resets when the chore is completed.' }),
  })
  .openapi('ChoreInput');

export const ChoreDaySchema = ChoreSchema.extend({
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
  checklist: z.object({ listId: z.string(), name: z.string(), total: z.number(), done: z.number() }).nullable().openapi({ description: 'Progress on the linked checklist, when the chore has one.' }),
}).openapi('ChoreDay');

// manual: open items by priority (urgent, high, normal, low), overdue first within each, then the
// hand-set order. priority: the same, then soonest due. added: newest first. due: soonest first,
// undated last. alpha: A-Z, case-insensitive.
export const ListSortBySchema = z.enum(['manual', 'added', 'due', 'priority', 'alpha']);
export const ListItemPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);

export const ListSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    emoji: z.string().nullable(),
    color: z.string().nullable(),
    kind: z.enum(['todo', 'shopping', 'reusable']),
    memberIds: z.array(z.string()),
    groupBy: z.enum(['store', 'category', 'none']),
    sortBy: ListSortBySchema, // item order within each group
    sort: z.number(),
    archived: z.boolean(),
    createdAt: z.string(),
    itemCount: z.number(),
    openCount: z.number(),
  })
  .openapi('List');

export const ListInputSchema = z
  .object({
    name: z.string().min(1),
    kind: z.enum(['todo', 'shopping', 'reusable']),
    emoji: EmojiSchema.nullable().optional(),
    color: z.string().nullable().optional(),
    memberIds: z.array(z.string()).optional(),
    groupBy: z.enum(['store', 'category', 'none']).optional(),
    sortBy: ListSortBySchema.optional(),
  })
  .openapi('ListInput');

export const ListPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    emoji: EmojiSchema.nullable().optional(),
    color: z.string().nullable().optional(),
    kind: z.enum(['todo', 'shopping', 'reusable']).optional(),
    memberIds: z.array(z.string()).optional(),
    groupBy: z.enum(['store', 'category', 'none']).optional(),
    sortBy: ListSortBySchema.optional(),
    sort: z.number().optional(),
    archived: z.boolean().optional(),
  })
  .openapi('ListPatch');


export const ListItemStepSchema = z
  .object({ id: z.string(), title: z.string(), done: z.boolean(), sort: z.number() })
  .openapi('ListItemStep');

const StepTitleSchema = z.string().min(1).refine((s) => s.trim().length > 0, 'must not be empty');

export const ListItemStepInputSchema = z.object({ title: StepTitleSchema }).openapi('ListItemStepInput');

export const ListItemStepPatchSchema = z
  .object({ title: StepTitleSchema.optional(), done: z.boolean().optional(), sort: z.number().optional() })
  .openapi('ListItemStepPatch');

export const ListItemStepReorderSchema = z.object({ stepIds: z.array(z.string()) }).openapi('ListItemStepReorder');

export const ListItemSchema = z
  .object({
    id: z.string(),
    listId: z.string(),
    title: z.string(),
    notes: z.string().nullable(),
    quantity: z.string().nullable(),
    store: z.string().nullable(),
    category: z.string().nullable(),
    memberId: z.string().nullable(),
    dueDate: z.string().nullable(),
    eventId: z.string().nullable(), // linked calendar event (series id for a recurring local event)
    priority: ListItemPrioritySchema, // open urgent/high items sort first, low last (see ListSortBySchema)
    done: z.boolean(),
    doneAt: z.string().nullable(),
    doneBy: z.string().nullable(),
    sort: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // Ordered sub-steps. An item with steps is done exactly when all of them are.
    steps: z.array(ListItemStepSchema),
    stepsDone: z.number(),
    stepsTotal: z.number(),
    noteCount: z.number().optional(), // notes in this item's thread (GET /api/lists/{id} only)
  })
  .openapi('ListItem');

const ListItemInputSchema = z.object({
  title: z.string().min(1).refine((s) => s.trim().length > 0, 'must not be empty'),
  notes: z.string().nullable().optional(),
  quantity: z.string().nullable().optional(),
  store: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  memberId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  priority: ListItemPrioritySchema.optional(),
  steps: z.array(StepTitleSchema).max(100).optional(), // step titles, in order
});

// POST /api/lists/:id/items accepts a single item or an array (always returns an array).
export const ListItemInputBodySchema = z.union([ListItemInputSchema, z.array(ListItemInputSchema)]).openapi('ListItemInputBody');

export const ListItemPatchSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .refine((s) => s.trim().length > 0, 'must not be empty')
      .optional(),
    notes: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
    store: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    memberId: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    eventId: z.string().nullable().optional(),
    priority: ListItemPrioritySchema.optional(),
    done: z.boolean().optional(), // also ticks (or unticks) every step
    doneBy: z.string().nullable().optional(),
  })
  .openapi('ListItemPatch');

export const ListGroupSchema = z
  .object({
    kind: z.enum(['store', 'category']),
    name: z.string(),
    sort: z.number(),
  })
  .openapi('ListGroup');

export const ListDetailSchema = z
  .object({
    list: ListSchema,
    items: z.array(ListItemSchema),
    groups: z.array(ListGroupSchema),
    suggestions: z.object({ stores: z.array(z.string()), categories: z.array(z.string()) }),
  })
  .openapi('ListDetail');

export const ListReorderSchema = z.object({ itemIds: z.array(z.string()) }).openapi('ListReorder');

export const ListGroupsInputSchema = z
  .object({ groups: z.array(z.object({ kind: z.enum(['store', 'category']), name: z.string() })) })
  .openapi('ListGroupsInput');

export const LeaderboardEntrySchema = z
  .object({
    memberId: z.string(),
    name: z.string(),
    color: z.string(),
    avatar: z.string().nullable(),
    points: z.number(),
    completed: z.number(),
    streak: z.number(),
    rank: z.number(),
  })
  .openapi('LeaderboardEntry');

export const ApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    scope: z.enum(['admin', 'display']),
    createdAt: z.string(),
    lastUsedAt: z.string().nullable(),
    owner: z.string().nullable().openapi({ description: "Who the device belongs to: 'shared' (the whole family), a member id, or null (paired before owners; the device picks)" }),
  })
  .openapi('ApiKey');

export const ApiKeyCreatedSchema = z
  .object({ id: z.string(), name: z.string(), scope: z.enum(['admin', 'display']), key: z.string() })
  .openapi('ApiKeyCreated');

export const MeSchema = z.object({ scope: z.enum(['admin', 'display']), keyName: z.string(), kind: z.enum(['api', 'session', 'oauth']), owner: z.string().nullable().optional(), version: z.string(), hostPortalUrl: z.string().optional() }).openapi('Me');

export const WebhookSchema = z
  .object({ id: z.string(), url: z.string(), events: z.array(z.string()), enabled: z.boolean(), createdAt: z.string() })
  .openapi('Webhook');

export const WebhookInputSchema = z
  .object({ url: z.string().url(), events: z.array(z.string()), secret: z.string().optional(), enabled: z.boolean().optional() })
  .openapi('WebhookInput');

// Only returned by create and rotate: the plain signing secret, shown once.
export const WebhookCreatedSchema = WebhookSchema.extend({ secret: z.string() }).openapi('WebhookCreated');

const SourceSchema = z.enum(['env', 'ui']).nullable();

export const ProviderStatusSchema = z
  .object({ configured: z.boolean(), source: SourceSchema, clientId: z.string().optional(), tenant: z.string().optional(), secretSet: z.boolean() })
  .openapi('ProviderStatus');

export const ProvidersSchema = z
  .object({
    publicUrl: z.object({ value: z.string().optional(), source: SourceSchema }),
    redirectUris: z.object({ google: z.string(), microsoft: z.string() }),
    google: ProviderStatusSchema,
    microsoft: ProviderStatusSchema,
  })
  .openapi('Providers');

export const ProviderInputSchema = z
  .object({ clientId: z.string().min(1), clientSecret: z.string().min(1).optional(), tenant: z.string().min(1).optional() })
  .openapi('ProviderInput');

export const PublicUrlInputSchema = z.object({ value: z.string().min(1) }).openapi('PublicUrlInput');
export const PublicUrlResultSchema = z.object({ value: z.string(), warning: z.string().optional() }).openapi('PublicUrlResult');

export const PushSubscriptionPrefsSchema = z
  .object({
    eventReminders: z.boolean(),
    dailySummary: z.boolean(),
    summaryTime: z.string().regex(HHMM_RE),
    choreNudge: z.boolean(),
    choreNudgeTime: z.string().regex(HHMM_RE),
    listUpdates: z.boolean(),
  })
  .openapi('PushSubscriptionPrefs');

export const PushSubscriptionSchema = z
  .object({
    id: z.string(),
    deviceName: z.string(),
    memberIds: z.array(z.string()),
    prefs: PushSubscriptionPrefsSchema,
    createdAt: z.string(),
    lastSuccessAt: z.string().nullable(),
  })
  .openapi('PushSubscription');

export const PushSubscriptionInputSchema = z
  .object({
    subscription: z.object({
      endpoint: z.string().url(),
      keys: z.object({ p256dh: z.string(), auth: z.string() }),
    }),
    deviceName: z.string().min(1),
    memberIds: z.array(z.string()).optional(),
    prefs: PushSubscriptionPrefsSchema.partial().optional(),
  })
  .openapi('PushSubscriptionInput');

export const PushSubscriptionPatchSchema = z
  .object({
    deviceName: z.string().min(1).optional(),
    memberIds: z.array(z.string()).optional(),
    prefs: PushSubscriptionPrefsSchema.partial().optional(),
  })
  .openapi('PushSubscriptionPatch');

export const NotifyInputSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
    memberIds: z.array(z.string()).optional(),
    url: z.string().optional(),
  })
  .openapi('NotifyInput');

export const NotificationSchema = z
  .object({
    id: z.string(),
    at: z.string(),
    kind: z.enum(['reminder', 'summary', 'chore', 'list', 'message']),
    title: z.string(),
    body: z.string().nullable(),
    url: z.string().nullable(),
    memberIds: z.array(z.string()),
    source: z.string().nullable(),
  })
  .openapi('Notification');

// Notes threads on an event or a list item. `target` is "event:<id>" or "list_item:<id>".
export const NoteTargetSchema = z.string().regex(/^(event|list_item):.+$/, 'must be event:<id> or list_item:<id>');
const NoteBodySchema = z.string().max(2000).refine((s) => s.trim().length > 0, 'must not be empty');

export const NoteSchema = z
  .object({
    id: z.string(),
    targetType: z.enum(['event', 'list_item']),
    targetId: z.string(),
    memberId: z.string().nullable(), // who posted; null = "Someone"
    body: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Note');

export const NoteInputSchema = z
  .object({ target: NoteTargetSchema, body: NoteBodySchema, memberId: z.string().nullable().optional() })
  .openapi('NoteInput');

export const NotePatchSchema = z.object({ body: NoteBodySchema }).openapi('NotePatch');

export const PointEntrySchema = z
  .object({ id: z.string(), memberId: z.string(), amount: z.number(), reason: z.string(), ref: z.string().nullable(), at: z.string() })
  .openapi('PointEntry');

export const PointsSchema = z
  .object({
    balance: z.number(),
    earnedTotal: z.number(), // chore points + positive ledger entries, all time
    spentTotal: z.number(), // sticker purchases (and other negative entries), as a positive number
    entries: z.array(PointEntrySchema), // newest first, last 50
  })
  .openapi('Points');

export const StickerPackSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    cover: z.string(),
    stickers: z.array(z.string()),
    basePrice: z.number(),
    price: z.number(), // after the household's stickerPriceScale
    unlocked: z.boolean(), // for ?memberId= (free-from-the-start packs are always unlocked)
  })
  .openapi('StickerPack');

export const StickerPlacementSchema = z
  .object({
    id: z.string(),
    memberId: z.string(),
    sticker: z.string(),
    x: z.number(),
    y: z.number(),
    scale: z.number(),
    rotation: z.number(),
    z: z.number(),
    placedAt: z.string(),
  })
  .openapi('StickerPlacement');

const Fraction = z.number().min(0).max(1);
export const StickerPlacementPatchSchema = z
  .object({ x: Fraction, y: Fraction, scale: z.number().min(0.3).max(4), rotation: z.number().min(-360).max(360), z: z.number().int() })
  .partial()
  .openapi('StickerPlacementPatch');

export const StickerPlacementInputSchema = StickerPlacementPatchSchema.extend({ sticker: z.string().min(1).max(32) }).openapi('StickerPlacementInput');

const WeatherDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD, household-local
  code: z.number(), // WMO weather code
  emoji: z.string(),
  text: z.string(),
  high: z.number(),
  low: z.number(),
  rainChance: z.number().nullable(), // percent
});

export const WeatherSchema = z
  .object({
    location: z.string(),
    unit: z.enum(['celsius', 'fahrenheit']),
    now: z.object({ temp: z.number(), code: z.number(), emoji: z.string(), text: z.string(), rainChance: z.number().nullable() }).nullable(),
    days: z.array(WeatherDaySchema),
  })
  .openapi('Weather');

export const GeocodeResultSchema = z
  .object({ name: z.string(), label: z.string(), lat: z.number(), lon: z.number(), countryCode: z.string().optional() })
  .openapi('GeocodeResult');

const SnapshotEventSchema = EventInstanceSchema.extend({ date: z.string() }); // the household-local day it's listed under
const SnapshotItemSchema = ListItemSchema.extend({ listName: z.string(), listEmoji: z.string().nullable(), overdue: z.boolean() });
const SnapshotBirthdaySchema = z.object({
  memberId: z.string().nullable(), // null: from a Birthdays-category calendar event
  eventId: z.string().nullable(),
  name: z.string(),
  avatar: z.string().nullable(),
  date: z.string(),
  age: z.number().nullable(), // the age they turn; null when the year isn't known
});

export const SnapshotSchema = z
  .object({
    greeting: z.string(),
    member: z.object({ id: z.string(), name: z.string(), color: z.string(), avatar: z.string().nullable(), birthday: z.string().nullable() }),
    range: z.enum(['day', 'week']),
    from: z.string(), // first day (today), YYYY-MM-DD
    to: z.string(), // last day, inclusive
    generatedAt: z.string(),
    weather: WeatherSchema.nullable(), // null: no location set, or the forecast couldn't be fetched
    events: z.array(SnapshotEventSchema), // theirs + everyone's (untagged), sorted by start
    chores: z.array(
      z.object({ id: z.string(), title: z.string(), emoji: z.string().nullable(), points: z.number(), dueTime: z.string().nullable(), date: z.string(), done: z.boolean(), doneBy: z.string().nullable(), shared: z.boolean() }), // doneBy: member credited (null = nobody, or not done)
    ),
    items: z.array(SnapshotItemSchema), // assigned to them, open, due by `to` or high/urgent
    birthdays: z.array(SnapshotBirthdaySchema),
    tomorrow: z
      .object({ date: z.string(), events: z.array(SnapshotEventSchema), items: z.array(SnapshotItemSchema), birthdays: z.array(SnapshotBirthdaySchema) })
      .nullable(), // day range only
  })
  .openapi('Snapshot');

export const BoardSchema = z
  .object({
    today: z.string(), // YYYY-MM-DD, household tz
    to: z.string(), // last day, inclusive
    generatedAt: z.string(),
    weather: WeatherSchema.nullable(),
    events: z.array(SnapshotEventSchema), // every member's events + untagged, today..to, sorted by start
    items: z.array(SnapshotItemSchema), // anyone's open items due by `to` (incl. overdue), plus undated urgent/high
    chores: z.array(
      z.object({ memberId: z.string().nullable(), name: z.string().nullable(), avatar: z.string().nullable(), color: z.string().nullable(), remaining: z.number(), total: z.number() }),
    ),
    birthdays: z.array(SnapshotBirthdaySchema),
  })
  .openapi('Board');

export const TidbitsSchema = z
  .object({
    date: z.string(), // household-local YYYY-MM-DD these are for
    onThisDay: z.array(z.object({ kind: z.enum(ON_THIS_DAY_KINDS), text: z.string(), year: z.number().nullable() })),
    trivia: z.array(z.object({ question: z.string(), answer: z.string(), choices: z.array(z.string()), category: z.string() })),
  })
  .openapi('Tidbits');

