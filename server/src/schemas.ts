// Shared zod-openapi schemas, reused across route files.
import { z } from '@hono/zod-openapi';
import { isSingleEmoji, isValidAvatar } from './emoji.ts';

export const ErrorSchema = z.object({ error: z.string() }).openapi('Error');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const AvatarSchema = z.string().refine(isValidAvatar, 'must be a single emoji or a 1-2 letter initial');
export const EmojiSchema = z.string().refine(isSingleEmoji, 'must be a single emoji');

export const MemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    avatar: z.string().nullable(),
    sort: z.number(),
    pointsToday: z.number(),
    pointsWeek: z.number(),
  })
  .openapi('Member');

export const MemberInputSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().min(1),
    avatar: AvatarSchema.nullable().optional(),
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

export const SettingsSchema = z
  .object({
    familyName: z.string(),
    timezone: z.string().nullable(),
    weekStart: z.union([z.literal(0), z.literal(1)]),
    themeMode: z.enum(['light', 'dark', 'auto', 'scheduled']),
    darkFrom: z.string(),
    darkTo: z.string(),
    accent: z.string(),
    backgroundLight: z.enum(['warm', 'white', 'gray', 'sage']),
    backgroundDark: z.enum(['cocoa', 'charcoal', 'midnight']),
    textScale: z.enum(['s', 'm', 'l', 'xl']),
    density: z.enum(['comfortable', 'compact']),
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
    accent: z.string().regex(HEX_COLOR_RE, 'must be a hex color like #RRGGBB').optional(),
    backgroundLight: z.enum(['warm', 'white', 'gray', 'sage']).optional(),
    backgroundDark: z.enum(['cocoa', 'charcoal', 'midnight']).optional(),
    textScale: z.enum(['s', 'm', 'l', 'xl']).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
  })
  .openapi('SettingsPatch');

// Subset of Settings safe to expose with no auth, for the pre-pairing screen / setup wizard
// (which have no API key yet) — no familyName or anything else household-identifying.
export const AppearanceSchema = SettingsSchema.pick({
  themeMode: true,
  darkFrom: true,
  darkTo: true,
  accent: true,
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
  })
  .openapi('ChoreInput');

export const ChoreDaySchema = ChoreSchema.extend({
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
}).openapi('ChoreDay');

export const ListSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    emoji: z.string().nullable(),
    color: z.string().nullable(),
    kind: z.enum(['todo', 'shopping', 'reusable']),
    memberIds: z.array(z.string()),
    groupBy: z.enum(['store', 'category', 'none']),
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
    sort: z.number().optional(),
    archived: z.boolean().optional(),
  })
  .openapi('ListPatch');

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
    done: z.boolean(),
    doneAt: z.string().nullable(),
    doneBy: z.string().nullable(),
    sort: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
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
    done: z.boolean().optional(),
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
  })
  .openapi('ApiKey');

export const ApiKeyCreatedSchema = z
  .object({ id: z.string(), name: z.string(), scope: z.enum(['admin', 'display']), key: z.string() })
  .openapi('ApiKeyCreated');

export const MeSchema = z.object({ scope: z.enum(['admin', 'display']), keyName: z.string(), kind: z.enum(['api', 'session']), version: z.string() }).openapi('Me');

export const WebhookSchema = z
  .object({ id: z.string(), url: z.string(), events: z.array(z.string()), enabled: z.boolean(), createdAt: z.string() })
  .openapi('Webhook');

export const WebhookInputSchema = z
  .object({ url: z.string().url(), events: z.array(z.string()), secret: z.string().optional(), enabled: z.boolean().optional() })
  .openapi('WebhookInput');

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
