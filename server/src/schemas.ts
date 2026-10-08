// Shared zod-openapi schemas, reused across route files.
import { z } from '@hono/zod-openapi';
import { MealSchema } from './meal-schemas.ts';
import { isSingleEmoji, isValidAvatar } from './emoji.ts';
import { pushEndpointAllowed } from './webpush.ts';
import { isPublicHttpsUrl } from './outbound.ts';

export const ErrorSchema = z.object({ error: z.string(), ref: z.string().optional().describe('For unexpected 500s: a short code that matches a line in the server log') }).openapi('Error');

// Contacts keep repeatable details as typed JSON arrays. A display key can read household
// contacts, with fields named in privateFields removed from its response.
export const ContactKindSchema = z.enum(['person', 'service', 'organization', 'place']);
export const ContactValueSchema = z.object({
  label: z.string().trim().max(50).default(''),
  value: z.string().trim().min(1).max(500),
  originalValue: z.string().trim().max(500).optional(),
  normalizedValue: z.string().trim().max(500).nullable().optional(),
  primary: z.boolean().default(false),
  emergency: z.boolean().default(false),
  wallVisible: z.boolean().default(false),
}).strict();
export const ContactAddressSchema = z.object({
  label: z.string().trim().max(50).default(''), street: z.string().max(500).default(''), city: z.string().max(200).default(''),
  region: z.string().max(200).default(''), postalCode: z.string().max(50).default(''), country: z.string().max(200).default(''),
}).strict();
export const ContactDateSchema = z.object({ label: z.string().trim().max(50).default(''), date: z.string().regex(/^(?:\d{4}-\d{2}-\d{2}|--\d{2}-\d{2})$/) }).strict();
export const ContactPrivateFieldSchema = z.enum(['organization', 'relationship', 'title', 'phones', 'emails', 'addresses', 'websites', 'dates', 'notes', 'tags', 'members']);
export const ContactInputSchema = z.object({
  kind: ContactKindSchema.default('person'),
  name: z.string().trim().min(1).max(200),
  organization: z.string().trim().max(200).nullable().optional(),
  relationship: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  givenName: z.string().trim().max(200).nullable().optional(),
  familyName: z.string().trim().max(200).nullable().optional(),
  nickname: z.string().trim().max(200).nullable().optional(),
  favorite: z.boolean().default(false), emergency: z.boolean().default(false),
  phones: z.array(ContactValueSchema).max(30).default([]),
  emails: z.array(ContactValueSchema).max(30).default([]),
  addresses: z.array(ContactAddressSchema).max(20).default([]),
  websites: z.array(ContactValueSchema).max(30).default([]),
  dates: z.array(ContactDateSchema).max(30).default([]),
  notes: z.string().max(10000).nullable().optional(),
  categoryIds: z.array(z.string().uuid()).max(30).default([]),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).default([]),
  memberIds: z.array(z.string()).max(50).default([]),
  serviceHours: z.string().max(500).nullable().optional(),
  serviceArea: z.string().max(500).nullable().optional(),
  alwaysOpen: z.boolean().default(false),
  wallVisible: z.boolean().default(false),
  emergencyVisible: z.boolean().default(false),
  phoneVisibleOnWall: z.boolean().default(false),
  addressVisibleOnWall: z.boolean().default(false),
  visibility: z.enum(['household', 'adults', 'selected_members', 'private']).default('household'),
  selectedMemberIds: z.array(z.string()).max(50).default([]),
  sourceMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
  privateFields: z.array(ContactPrivateFieldSchema).default([]),
}).strict().openapi('ContactInput');
export const ContactPatchSchema = z.object({
  kind: ContactKindSchema.optional(), name: z.string().trim().min(1).max(200).optional(),
  organization: z.string().trim().max(200).nullable().optional(), relationship: z.string().trim().max(200).nullable().optional(), title: z.string().trim().max(200).nullable().optional(), givenName: z.string().trim().max(200).nullable().optional(), familyName: z.string().trim().max(200).nullable().optional(), nickname: z.string().trim().max(200).nullable().optional(),
  favorite: z.boolean().optional(), emergency: z.boolean().optional(),
  phones: z.array(ContactValueSchema).max(30).optional(), emails: z.array(ContactValueSchema).max(30).optional(),
  addresses: z.array(ContactAddressSchema).max(20).optional(), websites: z.array(ContactValueSchema).max(30).optional(),
  dates: z.array(ContactDateSchema).max(30).optional(), notes: z.string().max(10000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(), memberIds: z.array(z.string()).max(50).optional(), serviceHours: z.string().max(500).nullable().optional(), serviceArea: z.string().max(500).nullable().optional(), alwaysOpen: z.boolean().optional(), wallVisible: z.boolean().optional(), emergencyVisible: z.boolean().optional(), phoneVisibleOnWall: z.boolean().optional(), addressVisibleOnWall: z.boolean().optional(),
  categoryIds: z.array(z.string().uuid()).max(30).optional(), visibility: z.enum(['household', 'adults', 'selected_members', 'private']).optional(), selectedMemberIds: z.array(z.string()).max(50).optional(), sourceMetadata: z.record(z.string(), z.unknown()).nullable().optional(),
  privateFields: z.array(ContactPrivateFieldSchema).optional(),
}).strict().openapi('ContactPatch');
export const ContactSchema = ContactInputSchema.extend({ id: z.string(), createdAt: z.string(), updatedAt: z.string() }).openapi('Contact');
export const ContactCategoryInputSchema = z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), sort: z.number().int().optional() }).strict().openapi('ContactCategoryInput');
export const ContactCategorySchema = ContactCategoryInputSchema.extend({ id: z.string(), color: z.string().nullable(), sort: z.number(), createdAt: z.string(), updatedAt: z.string() }).openapi('ContactCategory');

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
// The web app's color schemes (web/src/skins.ts), plus 'seasonal' (the scheme follows the date).
// 'peacock' is the default; 'meadow' is shown as Peach (the first default) and 'field' as Meadow.
export const COLOR_SCHEMES = ['meadow', 'field', 'autumn', 'winter', 'spring', 'summer', 'ocean', 'midnight', 'lavender', 'harvest', 'festive', 'slate', 'ink', 'sage', 'graphite', 'berry', 'eucalyptus', 'peacock', 'seasonal'] as const;
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
// The web app's typefaces (web/src/typeface.ts); 'default' is Nunito.
export const TYPEFACES = ['default', 'hyperlegible', 'dyslexia', 'modern', 'playful', 'storybook', 'handwritten'] as const;
// 12- or 24-hour clock times; 'auto' follows each device's locale (the server: the location's country, timeFormat.ts).
export const TIME_FORMATS = ['auto', '12', '24'] as const;
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

// Per-person transition reminders: pushes to that person's own devices before their events.
// Times = `minutes` plus every `repeat.every` min during the last `repeat.within` (deduped).
export const TransitionRemindersSchema = z
  .object({
    on: z.boolean(),
    minutes: z.array(z.number().int().min(1).max(120)).max(8).default([]).openapi({ description: 'Minutes before the event (or its leave-by time), 1-120, up to 8' }),
    repeat: z
      .object({ every: z.number().int().min(5).max(60), within: z.number().int().min(1).max(120) })
      .refine((r) => r.every <= r.within, { message: 'every must be at most within', path: ['every'] })
      .nullable()
      .default(null)
      .openapi({ description: 'Also remind every `every` minutes during the last `within` minutes' }),
    leaveBy: z.boolean().default(true).openapi({ description: 'Count to the leave-by time when the event has travel time' }),
  })
  .openapi('TransitionReminders');
export const TRANSITIONS_OFF = { on: false, minutes: [] as number[], repeat: null, leaveBy: true };

// Temp check (routes/temp-check.ts): which daily questions a person gets. Off by default.
export const TempCheckSettingsSchema = z
  .object({
    on: z.boolean(),
    sleep: z.boolean().default(true).openapi({ description: '"How did you sleep last night?"' }),
    feelings: z.boolean().default(true).openapi({ description: '"How are you feeling today?"' }),
    goal: z.boolean().default(true).openapi({ description: '"Goal for today"' }),
    showGoal: z.boolean().default(true).openapi({ description: "Show today's goal on the Board" }),
    evening: z.boolean().default(false).openapi({ description: 'Evening goal check: "Did you finish your goal?" at eveningTime on a day they set one' }),
    eveningTime: z.string().regex(/^([01]\d|2[0-3]):[03]0$/, 'eveningTime: HH:MM on the hour or half hour').default('21:00').openapi({ description: 'Household time, HH:00 or HH:30' }),
    journal: z.boolean().default(true).openapi({ description: 'Keep follow-up notes in their journal. Off: only yes / partly / no is kept.' }),
    battery: z.boolean().default(false).openapi({ description: 'Energy battery: a rough daily guess from sleep, feelings and how full their days are, with a heads-up before heavy days (GET /api/members/{id}/battery), and an evening "How drained do you feel?" (temp-check drained) that calibrates it. Private to them and parents.' }),
  })
  .openapi('TempCheckSettings');
export const TEMP_CHECK_OFF = { on: false, sleep: true, feelings: true, goal: true, showGoal: true, evening: false, eveningTime: '21:00', journal: true, battery: false };
export const FOLLOWUP_OUTCOMES = ['yes', 'partly', 'no'] as const;
export const SLEEP_ANSWERS = ['great', 'good', 'ok', 'poorly', 'terrible'] as const;
export const FEELINGS = ['great', 'good', 'fine', 'ok', 'bad', 'awful', 'tired', 'sore'] as const; // built in; "Other" adds the person's own


export const MemberSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    avatar: z.string().nullable(),
    picture: z.string().nullable().openapi({ description: "Their profile picture's image url (GET it like a photo), or null. The avatar and color stay as the fallback and ring. Set with PUT /api/members/{id}/picture." }),
    birthday: z.string().nullable(), // YYYY-MM-DD, or --MM-DD when the year isn't known
    sort: z.number(),
    pointsToday: z.number(),
    pointsWeek: z.number(),
    balance: z.number(), // points left to spend: everything earned from chores, minus sticker purchases (+/- other ledger entries)
    grownUp: z.boolean().openapi({ description: "A parent or other adult. Their chores never wait for a parent's OK (needsApproval is always false)." }),
    needsApproval: z.boolean().openapi({ description: "Their chores need a parent's OK by default (a chore's own setting wins). Always false for a grown-up." }),
    transitionReminders: TransitionRemindersSchema,
    rewardGoal: z
      .object({ rewardId: z.string(), title: z.string(), emoji: z.string().nullable(), cost: z.number() })
      .nullable()
      .openapi({ description: 'The reward they are saving for (progress = balance / cost), or null.' }),
    tempCheck: TempCheckSettingsSchema,
    todayGoal: z.string().nullable().openapi({ description: "Their Temp check goal for today (household day), or null. Family content: the Board shows it when tempCheck.showGoal is on." }),
    privateJournal: z
      .object({ on: z.boolean(), allowed: z.boolean() })
      .openapi({ description: "Private journal: on = new entries are private (only their own devices read the words); allowed = always for a grown-up, for a kid when a parent allows it. Changed with PUT /api/members/{id}/journal/privacy." }),
  })
  .openapi('Member');

export const MemberInputSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().min(1),
    avatar: AvatarSchema.nullable().optional(),
    birthday: BirthdaySchema.nullable().optional(),
    sort: z.number().optional(),
    grownUp: z.boolean().optional().openapi({ description: 'Default false. true also turns needsApproval off.' }),
    needsApproval: z.boolean().optional().openapi({ description: 'Ignored for a grown-up (stays false).' }),
    transitionReminders: TransitionRemindersSchema.optional(),
    tempCheck: TempCheckSettingsSchema.optional(),
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
export const TIDBIT_SOURCES = ['quotes', 'facts', 'tips', 'onthisday', 'trivia'] as const;
export const TIP_CATEGORIES = ['routines', 'focus', 'organizing', 'feelings', 'sensory', 'communication'] as const;
export const FACT_CATEGORIES = ['animals', 'space', 'science', 'body', 'plants', 'words'] as const;
export const ON_THIS_DAY_KINDS = ['holidays', 'births', 'events'] as const;
export const TidbitSettingsSchema = z
  .object({
    sources: z.array(z.enum(TIDBIT_SOURCES)).max(TIDBIT_SOURCES.length), // [] = no card on the Board
    factCategories: z.array(z.enum(FACT_CATEGORIES)).max(FACT_CATEGORIES.length), // built-in facts; [] = every category
    tipCategories: z.array(z.enum(TIP_CATEGORIES)).max(TIP_CATEGORIES.length).default([]), // neurodivergent-friendly tips; [] = every category
    onThisDay: z.array(z.enum(ON_THIS_DAY_KINDS)).min(1).max(ON_THIS_DAY_KINDS.length), // Wikipedia's On this day
    birthsAfter: z.number().int().min(0).max(2100).nullable(), // birthdays only for people born in or after this year; null = any
    triviaCategories: z.array(z.number().int().min(9).max(32)).min(1).max(24), // Open Trivia DB category ids
    triviaDifficulties: z.array(z.enum(['easy', 'medium', 'hard'])).min(1).max(3), // any mix of the three
  })
  .openapi('TidbitSettings');

// The Board's layouts (web/src/boardLayout.ts): columns of cards, each with how much of its column's
// height it takes (s/m/l) and how big its text is. A family preset is one a parent saved for every
// screen to pick; a screen's own layout stays on the device.
export const BOARD_CARDS = ['clock', 'today', 'meals', 'photo', 'coming', 'due', 'chores', 'tidbit', 'tidbit2', 'tidbit3', 'checklist'] as const;
export const MAX_BOARD_PRESETS = 10;
export const BoardLayoutSchema = z
  .object({
    tiles: z.boolean().openapi({ description: 'The row of count tiles across the top' }),
    columns: z
      .array(z.array(z.object({
        id: z.enum(BOARD_CARDS), size: z.enum(['s', 'm', 'l']), density: z.enum(['big', 'normal', 'small']),
        listId: z.string().min(1).max(100).optional().openapi({ description: 'The Checklist card: the list it shows (absent: the first reusable list)' }),
      })).max(6))
      .min(1)
      .max(4),
  })
  .refine((l) => { const ids = l.columns.flat().map((c) => c.id); return new Set(ids).size === ids.length; }, 'a card can be on the Board once')
  .openapi('BoardLayout');
export const BoardPresetSchema = z
  .object({ id: z.string().regex(/^p_[a-z0-9_-]{1,40}$/), name: z.string().trim().min(1).max(40), layout: BoardLayoutSchema })
  .openapi('BoardPreset');

// Household feature switches (Settings -> For the whole family -> Features). Off hides the feature
// on every screen and stops its notifications; its data is kept and its API keeps answering.
export const FeaturesSchema = z
  .object({
    chores: z.boolean(), // Chores tab, points, rewards, sticker book (the leaderboard, sticker shop and rewards also have their own switches)
    lists: z.boolean(), // Lists tab, "Due soon", an event's linked items
    contacts: z.boolean().default(true), // Contacts tab and household contacts directory; older clients omit it
    paint: z.boolean(), // Activities -> Paint
    photos: z.boolean(), // Activities -> Photos and the Board's picture card
    notes: z.boolean(), // notes threads on events and list items
    messages: z.boolean(), // family messages: POST /api/notify answers 403 while off
    // Trackers, one switch per kind (the tab goes when all three are off). Defaults: clients from before they existed.
    trackersReading: z.boolean().default(true),
    trackersMemories: z.boolean().default(true),
    trackersHealth: z.boolean().default(true),
    meals: z.boolean().default(true), // Meals tab, the Board's meals card, meals in the daily summary
    newscast: z.boolean().default(true), // Home's Newscast tab: GET /api/newscast and its routes answer 404 while off
    polls: z.boolean().default(true), // Family polls: /api/polls and its routes answer 404 while off, no poll notifications
    checkIns: z.boolean().default(true), // Temp check, goal checks, the energy battery, journals, Insights: no check-in, goal or battery notifications and no check-in points while off
  })
  .openapi('Features');

// The family's Night screen (Settings -> For the whole family -> Night screen): what wall screens
// show during night hours unless a screen picks its own (a device setting in the app).
export const NIGHT_SOURCES = ['drawings', 'photos', 'google', 'art', 'nature'] as const;
export const NightLookSchema = z
  .object({
    sources: z.array(z.enum(NIGHT_SOURCES)).max(NIGHT_SOURCES.length).refine((l) => new Set(l).size === l.length, 'a source can be picked once')
      .openapi({ description: 'Pictures to take turns through, in order; empty = the plain clock' }),
    every: z.union([z.literal(2), z.literal(5), z.literal(10), z.literal(20)]).openapi({ description: 'Minutes between pictures' }),
    brightness: z.enum(['low', 'medium']),
    clock: z.boolean().openapi({ description: 'The small clock over the pictures' }),
    clockPosition: z.enum(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).nullable().openapi({ description: 'Where the clock stays; null = it moves around (guards against burn-in)' }),
  })
  .openapi('NightLook');

export const MealTimesSchema = z
  .object({ breakfast: z.string().regex(HHMM_RE, 'must be HH:MM'), lunch: z.string().regex(HHMM_RE, 'must be HH:MM'), dinner: z.string().regex(HHMM_RE, 'must be HH:MM'), snack: z.string().regex(HHMM_RE, 'must be HH:MM') })
  .openapi('MealTimes');

export const SettingsSchema = z
  .object({
    familyName: z.string(),
    timezone: z.string().nullable(),
    weekStart: z.union([z.literal(0), z.literal(1)]),
    themeMode: z.enum(['light', 'dark', 'auto', 'scheduled']),
    darkFrom: z.string(),
    darkTo: z.string(),
    // Night hours (once called quiet hours): HH:MM, household-local. Both null = off.
    quietFrom: z.string().nullable().openapi({ description: 'Night hours start (HH:MM, household time); null = no night hours' }),
    quietTo: z.string().nullable().openapi({ description: 'Night hours end (HH:MM, household time)' }),
    nightRest: z.boolean().openapi({ description: 'Wall screens show the Night screen during night hours (on unless turned off)' }),
    nightHoldReminders: z.boolean().openapi({ description: 'Transition reminders, time cues, Live Activities, battery alerts and the morning check-in reminder wait out the night hours (on unless turned off). Event and medicine reminders and the evening goal check always come through.' }),
    darkWithNight: z.boolean().openapi({ description: "Scheduled dark mode uses the night hours; darkFrom / darkTo then read as the night hours (while they're set)" }),
    quietPin: z.boolean().openapi({ description: 'A PIN is needed to wake a wall screen during night hours (set with PUT /api/quiet-pin). Never the PIN itself.' }),
    accent: z.string(), // '#FF9E7A' (the default) = the color scheme's own accent; anything else is a custom accent
    colorScheme: ColorSchemeIdSchema, // a built-in scheme, 'seasonal', or a customSchemes id
    customColors: CustomColorsSchema.nullable(), // legacy: surfaces layered on the scheme (no longer set by the app)
    customSchemes: z.array(CustomSchemeSchema),
    // Legacy background presets: still applied under the Meadow scheme, no longer offered in the app.
    backgroundLight: z.enum(['warm', 'white', 'gray', 'sage']),
    backgroundDark: z.enum(['cocoa', 'charcoal', 'midnight']),
    textScale: z.enum(['s', 'm', 'l', 'xl']),
    density: z.enum(['comfortable', 'compact']),
    typeface: z.enum(TYPEFACES).openapi({ description: "The family's typeface; a device can pick its own. 'default' is Nunito." }),
    timeFormat: z.enum(TIME_FORMATS).openapi({ description: "Clock times as 12-hour ('3:40 PM') or 24-hour ('15:40'). 'auto' follows each device's locale; server-written text (notifications) goes by the location's country. A device can pick its own." }),
    defaultCalendarId: z.string().nullable().openapi({ description: "The calendar new events go on when none is named (a parent's pick). null: Kinwall picks (the family's own Kinwall calendar first). GET /api/calendars marks the one in use with default: true." }),
    defaultReminderMinutes: z.array(z.number()),
    lateCompletionCredit: z.number(), // percent of a chore's points earned when it's completed for a past day
    streakGraceDays: z.number(), // missed days per rolling 7 a streak survives (see computeStreak)
    checkInPoints: z.number(), // points for the daily check-in (reading your day to the end); 0 = off
    leaderboardEnabled: z.boolean(), // false: clients hide the leaderboard and rank badges (the API still answers)
    stickersEnabled: z.boolean(), // false: clients hide the sticker book and the shop refuses purchases
    rewardsEnabled: z.boolean().openapi({ description: 'Kids spend points on rewards (on unless turned off; needs features.chores). Off: clients hide Rewards and reward goals, Newscast leaves rewards out, and a reward request answers 403. Rewards and past requests are kept.' }),
    stickerPriceScale: z.number(), // percent applied to every sticker pack's price; 0 = all free
    location: LocationSchema.nullable(), // for the snapshot's weather; null = no weather
    temperatureUnit: z.enum(['celsius', 'fahrenheit']), // default: fahrenheit for a US location (or US timezone), else celsius
    tidbits: TidbitSettingsSchema,
    nightLook: NightLookSchema.openapi({ description: "What wall screens show during night hours, unless a screen picks its own on the device." }),
    boardPresets: z.array(BoardPresetSchema).openapi({ description: "Board layouts a parent saved for the family; each screen picks one (or a built-in one, or its own) on the device." }),
    features: FeaturesSchema,
    mealTimes: MealTimesSchema, // when each meal slot usually is; a meal without its own time uses it for its calendar event
    aiHealthAccess: z.boolean(), // false (default): MCP and connected apps' OAuth tokens never see or change the Health tracker
    medications: z.boolean().openapi({ description: 'Medication reminders (off by default). Off: the medication routes answer 404; the data is kept.' }),
    medicationNamesOnWalls: z.boolean().openapi({ description: 'Show medicine names and doses on shared wall screens (off by default: "Meds").' }),
    newscastNotFeatured: z.array(z.string()).openapi({ description: "Members whose chores, rewards, photos, books, memories and birthday stay out of Newscast (their own announcements still show)." }),
    newscastPostingPaused: z.array(z.string()).openapi({ description: 'Members who can\'t post announcements for now (a parent turns it back on). They still react.' }),
    googlePhotos: z.enum(['off', 'signing-in', 'choosing', 'ready', 'reconnect', 'refused']).optional().openapi({ description: "Google Photos for the Night screen and the Board (GET /api/google-photos). Read-only; not in the export." }),
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
    nightRest: z.boolean().optional(),
    nightHoldReminders: z.boolean().optional(),
    darkWithNight: z.boolean().optional(),
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
    typeface: z.enum(TYPEFACES).optional(),
    timeFormat: z.enum(TIME_FORMATS).optional(),
    defaultCalendarId: z.string().max(200).nullable().optional(), // null clears it
    defaultReminderMinutes: z.array(z.number()).optional(),
    lateCompletionCredit: z.number().int().min(0).max(100).optional(),
    streakGraceDays: z.number().int().min(0).max(3).optional(),
    checkInPoints: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(10)]).optional(),
    leaderboardEnabled: z.boolean().optional(),
    stickersEnabled: z.boolean().optional(),
    rewardsEnabled: z.boolean().optional(),
    stickerPriceScale: z.number().int().min(0).max(200).optional(),
    location: LocationSchema.nullable().optional(),
    temperatureUnit: z.enum(['celsius', 'fahrenheit']).optional(),
    tidbits: TidbitSettingsSchema.optional(),
    nightLook: NightLookSchema.optional(),
    boardPresets: z
      .array(BoardPresetSchema)
      .max(MAX_BOARD_PRESETS)
      .refine((l) => new Set(l.map((x) => x.id)).size === l.length, 'preset ids must be unique')
      .optional(), // the whole list
    features: FeaturesSchema.optional(), // admin keys only (a display key gets 403)
    mealTimes: MealTimesSchema.optional(),
    aiHealthAccess: z.boolean().optional(), // the family's own devices only: a connected app gets 403
    medications: z.boolean().optional(), // likewise
    medicationNamesOnWalls: z.boolean().optional(), // likewise
    newscastNotFeatured: z.array(z.string()).max(100).optional(), // the whole list
    newscastPostingPaused: z.array(z.string()).max(100).optional(), // the whole list
  })
  // Night hours are a pair: send both, and either both set or both cleared ('' / null).
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
  typeface: true,
}).openapi('Appearance');

export const AccountSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['google', 'microsoft', 'caldav']),
    name: z.string(),
    createdAt: z.string(),
  })
  .openapi('Account');

export const CalendarFilterSchema = z
  .object({
    mode: z.enum(['all', 'only', 'except']).openapi({ description: "'only': just the events that match; 'except': everything but them; 'all': no filter" }),
    keywords: z.array(z.string().trim().min(1).max(200)).max(200).openapi({ description: 'Words or phrases, matched as whole words in the title, ignoring case (like category keywords). An event matches with any of them' }),
    allDay: z.enum(['any', 'allDay', 'timed']).openapi({ description: 'An event matches only if it is all-day (allDay) or timed (timed)' }),
    categoryIds: z.array(z.string()).max(100).openapi({ description: 'An event matches only if it has one of these categories' }),
  })
  .openapi('CalendarFilter', { description: 'Which of a calendar\'s events the family sees. An event matches when every condition that is set holds; a filter with no conditions does nothing' });

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
    displayEdit: z.boolean(), // wall screens and kids' devices may change its events (admins always can)
    canEditEvents: z.boolean(), // whether the key asking may change its events (see auth.ts canChangeEvents)
    default: z.boolean().openapi({ description: "New events go here when no calendar is named: the family's pick (settings.defaultCalendarId), or Kinwall's while that's unset or can't take events. At most one is true." }),
    lastSyncedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    syncFailures: z.number().int().openapi({ description: 'Failed syncs in a row; 0 after a good one.' }),
    needsReconnect: z.boolean(), // imported placeholder: settings kept, not syncing until reconnected
    filter: CalendarFilterSchema,
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
    description: z.string().nullable().openapi({ description: "The event's notes, plain text with line breaks. Synced two-way with Google (description), Outlook (body) and CalDAV (DESCRIPTION); HTML from a provider arrives as text" }),
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
    busy: z.boolean().openapi({ description: "Show as busy (true, the default) or free (false). A free event isn't Now/Next, gets no transition warnings or leave-by and doesn't count as a busy hour; its own reminders still fire. Synced from Google (transparency), Outlook (showAs) and ICS (TRANSP)" }),
    linkedItemCount: z.number().optional(), // open list items linked to this event (GET /api/events only)
    noteCount: z.number().optional(), // notes in this event's thread (GET /api/events only)
    prepAt: z.string().nullable().optional().openapi({ description: "A meal's event: when to start prep (the meal time minus the recipe's total or prep time, 30 minutes when it has none). GET /api/events only" }),
    cookId: z.string().nullable().optional().openapi({ description: "A meal's event: who's cooking, the one its prep countdown is for. GET /api/events only" }),
    hidden: z.enum(['event', 'series', 'filter']).nullable().optional().openapi({ description: "Why the family doesn't see it: hidden on its own ('event'), with its series ('series'), or by its calendar's filter ('filter'). Set with includeHidden=true; null = shown" }),
  })
  .openapi('EventInstance');

export const EventInputSchema = z
  .object({
    calendarId: z.string().optional().openapi({ description: 'Left out: the default calendar (GET /api/calendars default: true)' }),
    title: z.string().min(1),
    start: z.string(),
    end: z.string(),
    allDay: z.boolean(),
    location: z.string().optional(),
    description: z.string().optional().openapi({ description: 'Notes, plain text (line breaks kept); "" clears them. Written through to Google, Outlook and CalDAV only when sent' }),
    memberIds: z.array(z.string()).optional(),
    rrule: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    reminders: z.array(z.number().int().min(0).max(40320)).nullable().optional(), // [] = none; null = default (household, or the Google calendar's own). Written through to Google/Outlook
    travelMinutes: z.number().int().min(0).max(600).nullable().optional(), // Kinwall-only, works on any calendar (even read-only)
    remindBeforeLeave: z.boolean().optional(),
    busy: z.boolean().optional().openapi({ description: 'Show as: true = busy (default), false = free. Written through to Google, Outlook and CalDAV' }),
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
    pluginId: z.string().nullable().openapi({ description: 'Activity: an installed plugin whose play counts toward this chore; it completes once pluginMinutes of play are in for the day.' }),
    pluginMinutes: z.number().nullable().openapi({ description: 'Minutes of active play the activity needs (1-60), when pluginId is set.' }),
    needsApproval: z.boolean().nullable().openapi({ description: "Ticks from wall screens and kids' devices wait for a parent's OK. null follows the person's default (Member.needsApproval)." }),
    approveTimedPlay: z.boolean().openapi({ description: "Activity chores: completion by timed play also waits for a parent's OK (it auto-approves otherwise)." }),
    libraryId: z.string().nullable().openapi({ description: 'The chore library item it was made from (see /api/chore-library), if any. Its completions count as that item\'s "last done".' }),
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
    pluginId: z.string().nullable().optional().openapi({ description: "Activity plugin id (see GET /api/plugins); null to unlink. Kinwall's player completes the chore once the day's play reaches pluginMinutes." }),
    pluginMinutes: z.number().int().min(1).max(60).optional().openapi({ description: 'Minutes of active play needed, 1-60 (default 5).' }),
    needsApproval: z.boolean().nullable().optional().openapi({ description: "true/false overrides the person's default; null follows it." }),
    approveTimedPlay: z.boolean().optional(),
    libraryId: z.string().nullable().optional().openapi({ description: 'Create only: the chore library item this chore is made from (e.g. a repeating version of it).' }),
  })
  .openapi('ChoreInput');

// Progress on an activity-linked chore for one day. doneSeconds is the assignee's play; for an
// Anyone chore, whoever has played most.
export const ActivityProgressSchema = z.object({
  pluginId: z.string(),
  name: z.string().nullable(),
  emoji: z.string().nullable(),
  available: z.boolean(),
  needSeconds: z.number(),
  doneSeconds: z.number(),
});

export const ChoreDaySchema = ChoreSchema.extend({
  completed: z.boolean().openapi({ description: "Done and counted (a completion waiting for a parent's OK is pending instead)." }),
  pending: z.boolean().openapi({ description: "Ticked from a wall screen or kid's device, waiting for a parent's OK: no points yet." }),
  rejection: z.object({ note: z.string().nullable(), at: z.string() }).nullable().openapi({ description: "A parent's \"Not yet\" for this day, until it's ticked again." }),
  completedAt: z.string().nullable(),
  completedBy: z.string().nullable(),
  checklist: z.object({ listId: z.string(), name: z.string(), total: z.number(), done: z.number() }).nullable().openapi({ description: 'Progress on the linked checklist, when the chore has one.' }),
  activity: ActivityProgressSchema.nullable().openapi({ description: "The linked activity and the day's play, when the chore has one. available is false when the plugin was removed or turned off (the chore is then a plain one)." }),
}).openapi('ChoreDay');

// manual: open items by priority (urgent, high, normal, low), overdue first within each, then the
// hand-set order. priority: the same, then soonest due. added: newest first. due: soonest first,
// undated last. alpha: A-Z, case-insensitive. aisle (shopping lists): by store, then aisle - the
// store's own aisle order when set, else natural order ("Aisle 2" before "Aisle 10") - items with
// no aisle last, then A-Z. The default for new shopping lists.
export const ListSortBySchema = z.enum(['manual', 'added', 'due', 'priority', 'alpha', 'aisle']);
export const ListGroupBySchema = z.enum(['store', 'category', 'aisle', 'none']);
const KeepCheckedDoc = 'Checked items stay in place, crossed off, until Checkout (or Reset on a reusable list). Default: on for shopping and reusable lists, off for to-do lists (which move checked items to a Done section).';
export const ListItemPrioritySchema = z.enum(['low', 'normal', 'high', 'urgent']);
// A shopping list's type (0076): groceries or other shopping, each with its own catalog. kind stays 'shopping' for both.
export const ListCatalogSchema = z.enum(['groceries', 'shopping']).openapi({
  description: "A shopping list's type: groceries (food and household groceries; meals add ingredients here) or shopping (hardware store, department store...). Each has its own catalog of remembered items, places and categories. Given on shopping lists only (null on others); a new shopping list without one is groceries when its name looks like groceries (Groceries, Grocery, Food, Supermarket, Market, Produce, Pantry), else shopping.",
});

/** Who did something on a list: a family member (memberId), or a device or app that is nobody's
 * (label: a wall screen's name such as "Kitchen wall", an automation key's name, or "Assistant" for an
 * AI connector). Exactly one of the two is set; the field is null when nobody is known. */
export const ActorSchema = z
  .object({ memberId: z.string().optional(), label: z.string().optional() })
  .openapi('Actor', { description: 'Who did it: a family member (memberId) or a named device or app (label, e.g. "Kitchen wall", "Assistant"). Exactly one is set.' });

export const ListSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    emoji: z.string().nullable(),
    color: z.string().nullable(),
    kind: z.enum(['todo', 'shopping', 'reusable']),
    memberIds: z.array(z.string()),
    groupBy: ListGroupBySchema,
    sortBy: ListSortBySchema, // item order within each group
    keepChecked: z.boolean().openapi({ description: KeepCheckedDoc }),
    catalog: ListCatalogSchema.nullable(),
    isDefault: z.boolean().openapi({ description: "The family's default list for its shopping type (catalog): what barcode scans, meal ingredients, widgets, Siri and tiles use. At most one per type; false on other lists." }),
    sort: z.number(),
    archived: z.boolean(),
    createdAt: z.string(),
    itemCount: z.number(),
    openCount: z.number(),
    overdueCount: z.number().openapi({ description: 'Items not done whose due date is before today (household timezone).' }),
    itemsRev: z.number().openapi({ description: "Goes up whenever this list's items or their steps change. Sync clients compare it to skip refetching an unchanged list's detail." }),
    lastDoneAt: z.string().nullable().openapi({ description: 'Reusable lists: when it was last reset with something checked (Reset, or its chore done). Null until then.' }),
    lastDoneBy: ActorSchema.nullable().openapi({ description: 'Reusable lists: who last did it (whoever reset it, or did its chore). Null when unknown.' }),
  })
  .openapi('List');

export const ListInputSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(['todo', 'shopping', 'reusable']),
    emoji: EmojiSchema.nullable().optional(),
    color: z.string().max(50).nullable().optional(),
    memberIds: z.array(z.string()).max(100).optional(),
    groupBy: ListGroupBySchema.optional(),
    sortBy: ListSortBySchema.optional(),
    keepChecked: z.boolean().optional().openapi({ description: KeepCheckedDoc }),
    catalog: ListCatalogSchema.optional(),
  })
  .openapi('ListInput');

export const ListPatchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    emoji: EmojiSchema.nullable().optional(),
    color: z.string().max(50).nullable().optional(),
    kind: z.enum(['todo', 'shopping', 'reusable']).optional(),
    memberIds: z.array(z.string()).max(100).optional(),
    groupBy: ListGroupBySchema.optional(),
    sortBy: ListSortBySchema.optional(),
    keepChecked: z.boolean().optional().openapi({ description: KeepCheckedDoc }),
    catalog: ListCatalogSchema.optional(),
    sort: z.number().optional(),
    archived: z.boolean().optional(),
    isDefault: z.boolean().optional().openapi({ description: "true makes this shopping list its type's default (the previous one stops being it); false clears it. Parent devices only." }),
  })
  .openapi('ListPatch');


export const ListItemStepSchema = z
  .object({
    id: z.string(), title: z.string(), done: z.boolean(), sort: z.number(),
    addedBy: ActorSchema.nullable().openapi({ description: 'Who added the step; null when unknown.' }),
    checkedBy: ActorSchema.nullable().openapi({ description: 'Who ticked the step; null when not done or unknown.' }),
  })
  .openapi('ListItemStep');

const StepTitleSchema = z.string().min(1).max(500).refine((s) => s.trim().length > 0, 'must not be empty');

export const ListItemStepInputSchema = z.object({ title: StepTitleSchema }).openapi('ListItemStepInput');

export const ListItemStepPatchSchema = z
  .object({ title: StepTitleSchema.optional(), done: z.boolean().optional(), sort: z.number().optional() })
  .openapi('ListItemStepPatch');

export const ListItemStepReorderSchema = z.object({ stepIds: z.array(z.string()).max(500) }).openapi('ListItemStepReorder');

export const ListItemSchema = z
  .object({
    id: z.string(),
    listId: z.string(),
    title: z.string(),
    notes: z.string().nullable(),
    quantity: z.string().nullable(),
    store: z.string().nullable(),
    category: z.string().nullable(),
    aisle: z.string().nullable().openapi({ description: 'Where in the store, e.g. "Aisle 4" or "Back wall".' }),
    memberId: z.string().nullable(),
    dueDate: z.string().nullable(),
    eventId: z.string().nullable(), // linked calendar event (series id for a recurring local event)
    priority: ListItemPrioritySchema, // open urgent/high items sort first, low last (see ListSortBySchema)
    done: z.boolean(),
    doneAt: z.string().nullable(),
    doneBy: z.string().nullable().openapi({ description: 'The member who checked it off (checkedBy.memberId); null when not done, unknown or not a person. Kept for older clients: checkedBy also names wall screens and apps.' }),
    addedBy: ActorSchema.nullable().openapi({ description: 'Who added the item; null when unknown (items from before this was kept).' }),
    checkedBy: ActorSchema.nullable().openapi({ description: 'Who checked it off; null when not done or unknown. Cleared by untick and Reset.' }),
    sort: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
    // Ordered sub-steps. An item with steps is done exactly when all of them are.
    steps: z.array(ListItemStepSchema),
    stepsDone: z.number(),
    stepsTotal: z.number(),
    noteCount: z.number().optional(), // notes in this item's thread (GET /api/lists/{id} only)
    meals: z.array(z.string()).optional().openapi({ description: 'Planned meals this item was added for (GET /api/lists/{id} only).' }),
    places: z
      .array(z.object({ store: z.string().nullable(), aisle: z.string().nullable() }))
      .optional()
      .openapi({ description: 'Where the family has kept this item, newest first: one entry per store with its aisle there (GET /api/lists/{id} only). The first store is where it was last bought.' }),
  })
  .openapi('ListItem');

export const BarcodeSchema = z.string().regex(/^\d{8,14}$/, 'must be 8 to 14 digits (EAN or UPC)');
const ListItemInputSchema = z.object({
  // Optional client-made id (a UUID): an app that adds items offline replays the add without duplicating it.
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(500).refine((s) => s.trim().length > 0, 'must not be empty'),
  notes: z.string().max(5000).nullable().optional(),
  quantity: z.string().max(200).nullable().optional(),
  store: z.string().max(200).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  aisle: z.string().max(60).nullable().optional(),
  memberId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  eventId: z.string().nullable().optional(),
  priority: ListItemPrioritySchema.optional(),
  steps: z.array(StepTitleSchema).max(100).optional(), // step titles, in order
  // Scanned (shopping lists): remembered as this item's name for the barcode, not stored on the item.
  barcode: BarcodeSchema.optional(),
});

// POST /api/lists/:id/items accepts a single item or an array (always returns an array).
export const ListItemInputBodySchema = z.union([ListItemInputSchema, z.array(ListItemInputSchema).max(1000)]).openapi('ListItemInputBody');

export const ListItemPatchSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .max(500)
      .refine((s) => s.trim().length > 0, 'must not be empty')
      .optional(),
    notes: z.string().max(5000).nullable().optional(),
    quantity: z.string().max(200).nullable().optional(),
    store: z.string().max(200).nullable().optional(),
    category: z.string().max(200).nullable().optional(),
    aisle: z.string().max(60).nullable().optional(),
    aisleStore: z.string().min(1).optional().openapi({
      description: 'Shopping trip: the store `aisle` is at, when that is not (or not yet) the item\'s store. The aisle is remembered for that store; the item takes it only if its store is that one or empty (its store is left as is).',
    }),
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

// GET /api/lists/{id}?store=X: the list as shopped at that store.
export const ListTripSchema = z
  .object({
    store: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        quantity: z.string().nullable(),
        done: z.boolean(),
        store: z.string().nullable(),
        aisle: z.string().nullable(),
        section: z.enum(['aisle', 'unknown', 'other']),
        listId: z.string().optional().openapi({ description: 'Set on an item from another list (alsoAtStore): tick it there.' }),
        listName: z.string().optional(),
      }),
    ),
  })
  .openapi({ description: "Items in walking order at `store`: those planned for it or for anywhere by that store's aisles (its custom order, else natural), each with its aisle there; then 'unknown' (no aisle known there); then 'other' (planned for a different store)." })
  .openapi('ListTrip');

export const ListDetailSchema = z
  .object({
    list: ListSchema,
    items: z.array(ListItemSchema),
    groups: z.array(ListGroupSchema),
    // Household-wide values (items on any list, plus remembered ones) for the item pickers.
    suggestions: z.object({
      stores: z.array(z.string()),
      categories: z.array(z.string()),
      aisles: z.array(z.object({ store: z.string().nullable(), aisle: z.string() })),
      // Shopping lists: names to autocomplete, most used first (up to 300) - remembered from past adds
      // on lists of the same type (catalog), then, on Groceries, recipe ingredients (uses 0). key is the matching key; place is
      // where it goes at ?store=, else its newest store.
      items: z
        .array(
          z.object({
            title: z.string(),
            key: z.string(),
            uses: z.number(),
            category: z.string().optional(),
            place: z.object({ store: z.string(), aisle: z.string().nullable() }).optional(),
          }),
        )
        .optional(),
    }),
    // Stores whose aisles have a custom walking order (aisle sort and grouping follow it).
    aisleOrder: z.array(z.object({ store: z.string().nullable(), aisles: z.array(z.string()) })),
    trip: ListTripSchema.optional(),
    alsoAtStore: z
      .array(ListItemSchema.extend({ listName: z.string(), places: z.array(z.object({ store: z.string().nullable(), aisle: z.string().nullable() })) }))
      .optional()
      .openapi({
        description:
          "With ?store= on a shopping list: items on the other type's shopping lists (a Groceries trip gets Shopping lists' items, and the other way round) planned for that store, or for anywhere and found there before, with the place there. Each has its listId and listName: tick and check them out on that list. Archived lists are left out.",
      }),
  })
  .openapi('ListDetail');

// Rename (to: a name) or remove (to: null) a store, category or aisle everywhere: items on every
// list, remembered places, group and aisle orders. An aisle is per store (store: null = no store).
export const ListValueRenameSchema = z
  .object({
    field: z.enum(['store', 'category', 'aisle']),
    from: z.string().min(1),
    to: z.string().trim().min(1).max(60).nullable(),
    store: z.string().nullable().optional(),
    catalog: ListCatalogSchema.optional().openapi({ description: 'field category only: rename the department in this catalog only (items on lists of this type and their remembered places). Stores and aisles are shared by both types.' }),
  })
  .openapi('ListValueRename');

// A catalog (groceries or shopping): a remembered item, where it's found per store, and edits to it.
export const RememberedItemSchema = z
  .object({
    key: z.string().openapi({ description: 'Matching key (case, spacing and simple plurals ignored); use it in /api/lists/remembered/{key}.' }),
    title: z.string(),
    uses: z.number().openapi({ description: 'Times added to a shopping list (0: added to the catalog only).' }),
    lastUsed: z.string().nullable(),
    category: z.string().nullable().openapi({ description: 'Department, e.g. "Produce".' }),
    places: z.array(z.object({ store: z.string(), aisle: z.string().nullable(), updatedAt: z.string() })).openapi({ description: 'Stores it is found at (by name), each with its aisle there.' }),
    lastStore: z.string().nullable().openapi({ description: 'Where it was last bought or planned: a new add goes there.' }),
    tags: z.array(z.string()).openapi({ description: 'The family\'s own categories for it, e.g. "Breakfast", "Lunchbox" (not its store department).' }),
  })
  .openapi('RememberedItem');

const CatalogValue = z.string().trim().min(1).max(60);
const CatalogTag = z.string().trim().min(1).max(40);
export const RememberedTagRenameSchema = z
  .object({ from: z.string().min(1), to: CatalogTag.nullable().openapi({ description: 'New name, or null to remove it from every item.' }) })
  .openapi('RememberedTagRename');
export const RememberedItemPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional().openapi({ description: 'New spelling. A different name moves it (409 if that name is already in the catalog).' }),
    category: CatalogValue.nullable().optional(),
    places: z
      .array(z.object({ store: CatalogValue, aisle: CatalogValue.nullable().optional() }))
      .max(50)
      .refine((ps) => new Set(ps.map((p) => p.store)).size === ps.length, 'each store once')
      .optional()
      .openapi({ description: 'Replaces its stores: each with its aisle there (null = not known). Stores left out are forgotten.' }),
    tags: z
      .array(CatalogTag)
      .max(10)
      .optional()
      .openapi({ description: 'Replaces its categories (up to 10, 40 characters each). Trimmed and deduped ignoring case; a category the family already has keeps its spelling. [] clears them.' }),
  })
  .openapi('RememberedItemPatch');
export const RememberedItemInputSchema = RememberedItemPatchSchema.extend({ title: z.string().trim().min(1).max(200) }).openapi('RememberedItemInput');

export const StoreAislesSchema = z
  .object({ store: z.string().nullable(), aisles: z.array(z.string().min(1).max(60)).max(200) })
  .openapi('StoreAisles');

// Checkout / Reset: only these items (still checked) when given, else every checked item.
// store (Checkout at the end of a shopping trip): remembered as where these items were last bought.
export const ListCheckedSchema = z.object({ itemIds: z.array(z.string()).max(1000).optional(), store: z.string().min(1).optional() }).openapi('ListChecked');

export const ListItemMoveSchema = z
  .object({ itemIds: z.array(z.string()).min(1).max(1000), toListId: z.string().min(1).openapi({ description: 'Another list of the same type.' }) })
  .openapi('ListItemMove');

export const ListReorderSchema = z.object({ itemIds: z.array(z.string()).max(1000) }).openapi('ListReorder');

export const ListOrderSchema = z
  .object({ ids: z.array(z.string()).max(1000).openapi({ description: 'List ids in the order to show them. Lists left out keep their order, after these.' }) })
  .openapi('ListOrder');

export const ListGroupsInputSchema = z
  .object({ groups: z.array(z.object({ kind: z.enum(['store', 'category']), name: z.string().max(200) })).max(500) })
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
    owner: z.string().nullable().openapi({ description: "Who the device belongs to: 'shared' (the whole family), a member id it's pinned to, or null (paired before owners; the device picks)" }),
    kind: z.enum(['wall', 'kid', 'grownup', 'widgets']).nullable().openapi({ description: "What the device is: 'wall' (a wall screen), 'kid' (a kid's own device), 'grownup' (a grown-up's own device), 'widgets' (the Kinwall app's widgets or Watch, made with POST /api/device-keys), or null (not said: a shared full-access key)" }),
    parentKeyId: z.string().nullable().openapi({ description: "Widgets: the key that made them (a phone's key, or the widgets' key for a Watch). Removing it removes them. Null when made by the Kinwall app's sign-in (parentGrantId) or before Kinwall linked them" }),
    parentGrantId: z.string().nullable().openapi({ description: "Widgets: the Kinwall app's sign-in (GET /api/authorizations id) that made them. Disconnecting it removes them" }),
  })
  .openapi('ApiKey');

export const ApiKeyCreatedSchema = z
  .object({ id: z.string(), name: z.string(), scope: z.enum(['admin', 'display']), key: z.string() })
  .openapi('ApiKeyCreated');

export const MeSchema = z
  .object({
    householdId: z.string().openapi({ description: 'A stable, non-secret id for this household, the same for every key: tells a device whether two keys open the same family' }),
    scope: z.enum(['admin', 'display']),
    keyName: z.string(),
    kind: z.enum(['api', 'session', 'oauth']),
    owner: z.string().nullable().optional().openapi({ description: "Whose device this is: 'shared', a member id, or null. On a full-access key it's only for personal defaults" }),
    deviceKind: z.enum(['wall', 'kid', 'grownup', 'widgets']).nullable().optional().openapi({ description: "What this device is, when an admin said so (see ApiKey.kind)" }),
    locked: z.boolean().openapi({ description: "The owner locks this device's family filter (everyday-access keys with an owner: a member id pins it, 'shared' shows everyone). Never true for full access" }),
    version: z.string(),
    hostPortalUrl: z.string().optional(),
  })
  .openapi('Me');

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
    medicationNames: z.boolean().openapi({ description: 'Medicine names and doses in medication reminders on this device (off: "Time for Leo\'s medicine" only; push text shows on lock screens).' }),
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
      endpoint: z.string().url().refine(pushEndpointAllowed, 'must be an https address on a browser push service (Apple, Google, Microsoft or Mozilla)').openapi({ description: "The browser's push endpoint, from pushManager.subscribe(): https on Apple's, Google's, Microsoft's or Mozilla's push service only." }),
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
    kind: z.enum(['reminder', 'summary', 'chore', 'list', 'message', 'goal', 'medication', 'privacy', 'meal', 'poll']),
    title: z.string(),
    body: z.string().nullable(),
    url: z.string().nullable(),
    memberIds: z.array(z.string()),
    source: z.string().nullable(),
    removable: z.boolean().openapi({ description: "Whether the key making this request may remove the note (DELETE /api/notifications/{id}): admin keys for ordinary notes; for a privacy note only a device of the person it's about that was theirs before the note." }),
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

// Trackers (routes/trackers.ts): one table, three kinds. `date` is the entry's day (a book's start
// date, a memory's day, a visit's day); `title` is the book, a memory's headline or a visit's reason.
export const TRACKER_KINDS = ['reading', 'memory', 'health'] as const;
export const TrackerKindSchema = z.enum(TRACKER_KINDS);
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const Text = (max: number) => z.string().max(max);
const Measure = <U extends [string, ...string[]]>(units: U) => z.object({ value: z.number().positive().max(1000), unit: z.enum(units) });
export const ReadingDataSchema = z
  .object({
    format: z.enum(['book', 'audiobook']).default('book'), // entries from before audiobooks have none: a book
    author: Text(200).nullable().optional(),
    narrator: Text(200).nullable().optional(), // audiobooks
    status: z.enum(['want', 'reading', 'finished']).default('reading'),
    pagesRead: z.number().int().min(0).max(100000).nullable().optional(), // books
    totalPages: z.number().int().min(1).max(100000).nullable().optional(),
    minutesListened: z.number().int().min(0).max(100000).nullable().optional(), // audiobooks
    totalMinutes: z.number().int().min(1).max(100000).nullable().optional(),
    finishedOn: DateOnly.nullable().optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(), // stars
    notes: Text(4000).nullable().optional(),
    bookId: z.string().max(100).nullable().optional(), // started from a library book (routes/library.ts)
    // Read each day, kept by the server as progress changes (server/src/reading.ts logReading); a client's copy is ignored.
    log: z.array(z.object({ date: DateOnly, amount: z.number().int().min(0).max(100000) })).max(400).optional(),
    // A cover photo's address (public https), served through GET /api/trackers/{id}/cover
    coverUrl: z.string().max(2000).refine(isPublicHttpsUrl, 'must be a public https address').nullable().optional(),
  })
  .strict()
  .openapi('ReadingData');
export const MemoryDataSchema = z
  .object({
    text: Text(4000).default(''),
    mood: Text(16).nullable().optional(), // one emoji
  })
  .strict()
  .openapi('MemoryData');
export const HEALTH_TYPES = ['checkup', 'dentist', 'specialist', 'vaccine', 'sick', 'other'] as const;
export const HealthDataSchema = z
  .object({
    time: z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM').nullable().optional(),
    type: z.enum(HEALTH_TYPES).default('checkup'),
    provider: Text(200).nullable().optional(),
    notes: Text(4000).nullable().optional(),
    height: Measure(['in', 'cm']).nullable().optional(),
    weight: Measure(['lb', 'kg']).nullable().optional(),
    temperature: Measure(['F', 'C']).nullable().optional(),
    followUp: DateOnly.nullable().optional(),
    eventId: z.string().nullable().optional(), // the calendar event made by "Add to calendar"
  })
  .strict()
  .openapi('HealthData');
export const TRACKER_DATA = { reading: ReadingDataSchema, memory: MemoryDataSchema, health: HealthDataSchema } as const;

export const TrackerEntrySchema = z
  .object({
    id: z.string(),
    kind: TrackerKindSchema,
    memberId: z.string().nullable(), // null = the whole family, or a removed member (formerMember)
    formerMember: z.string().nullable(), // the name of the member this belonged to, after they were removed
    date: z.string(),
    title: z.string().nullable(),
    photoId: z.string().nullable(), // a memory's one photo (routes/photos.ts)
    photoOwned: z.boolean(), // the photo was added for this memory (not picked from the family photos)
    photoFamily: z.boolean().nullable(), // the photo is also a family photo; null = no photo
    data: z.record(z.string(), z.unknown()), // ReadingData | MemoryData | HealthData, by kind
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('TrackerEntry');

export const TrackerInputSchema = z
  .object({
    kind: TrackerKindSchema,
    memberId: z.string().nullable().optional(),
    date: DateOnly.optional(), // default: today in the household's timezone
    title: Text(200).nullable().optional(), // required for reading (the book)
    photoId: z.string().nullable().optional(), // one photo, memories only
    photoFamily: z.boolean().optional(), // a memory's own photo: also show it in the family photos
    data: z.record(z.string(), z.unknown()).default({}),
  })
  .openapi('TrackerInput');

export const TrackerPatchSchema = z
  .object({
    memberId: z.string().nullable().optional(),
    date: DateOnly.optional(),
    title: Text(200).nullable().optional(),
    photoId: z.string().nullable().optional(),
    photoFamily: z.boolean().optional(),
    data: z.record(z.string(), z.unknown()).optional(), // merged over the entry's data; null clears a field
    logDay: z.object({ date: DateOnly, amount: z.number().int().min(0).max(100000) }).optional().openapi({
      description: "A book's reading on an earlier day (today back to about a year): pages, or minutes for an audiobook. It replaces that day's amount (0 takes the day out) and moves the place in the book by the difference; progress sent in data alongside it is ignored.",
    }),
  })
  .openapi('TrackerPatch');

export const ReadingSummarySchema = z
  .object({
    year: z.number(),
    members: z.array(
      z.object({
        memberId: z.string().nullable(),
        formerMember: z.string().nullable(),
        finished: z.number(), // books and audiobooks finished this year
        pages: z.number(), // pages of those books, plus pages read so far in books in progress
        minutes: z.number(), // the same for audiobooks: their length, plus minutes so far in ones in progress
        reading: z.array(z.object({ id: z.string(), title: z.string().nullable(), percent: z.number().nullable() })),
      }),
    ),
  })
  .openapi('ReadingSummary');

export const PointEntrySchema = z
  .object({
    id: z.string(), memberId: z.string(), amount: z.number(), reason: z.string(), ref: z.string().nullable(), at: z.string(),
    note: z.string().max(80).nullable().optional().openapi({ description: "A bonus's note (reason 'bonus', ref = the day it counts on)." }),
  })
  .openapi('PointEntry');

export const PointsSchema = z
  .object({
    balance: z.number(),
    earnedTotal: z.number(), // chore points + positive ledger entries, all time
    spentTotal: z.number(), // sticker purchases (and other negative entries), as a positive number
    entries: z.array(PointEntrySchema), // newest first, last 50
  })
  .openapi('Points');

export const BONUS_MAX = 500;
export const BONUS_NOTE_MAX = 80;
export const PointAwardInputSchema = z
  .object({
    memberId: z.string(),
    points: z.number().int().min(1).max(BONUS_MAX),
    note: z.string().max(BONUS_NOTE_MAX).optional().openapi({ description: 'e.g. "Helped carry groceries". Blank is none.' }),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().openapi({ description: 'The household day it counts on (YYYY-MM-DD, not in the future). Default: today.' }),
  })
  .openapi('PointAwardInput');
export const PointAwardSchema = z
  .object({ id: z.string(), memberId: z.string(), points: z.number(), note: z.string().nullable(), date: z.string(), at: z.string() })
  .openapi('PointAward');

export const REWARD_PERIODS = ['day', 'week'] as const;
export const RewardLimitSchema = z
  .object({ count: z.number().int().min(1).max(20), period: z.enum(REWARD_PERIODS) })
  .nullable()
  .openapi('RewardLimit', { description: "Up to `count` per member per household day or week (declined ones don't count); null = no limit." });
export const REDEMPTION_STATUSES = ['pending', 'approved', 'declined', 'given'] as const;

export const RewardSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    emoji: z.string().nullable(),
    cost: z.number().openapi({ description: 'Points it costs.' }),
    memberIds: z.array(z.string()).openapi({ description: 'Who can redeem it; empty = everyone.' }),
    needsApproval: z.boolean().openapi({ description: "Redeeming waits for a parent's OK (points are held meanwhile). A parent's own device is approved at once." }),
    limit: RewardLimitSchema,
    active: z.boolean().openapi({ description: 'false = archived: hidden from kids, kept for history.' }),
    sort: z.number(),
    createdAt: z.string(),
    used: z.number().optional().openapi({ description: "With ?memberId=: how many of this reward's limit they've used this day/week (not declined)." }),
  })
  .openapi('Reward');

export const RewardInputSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    emoji: EmojiSchema.nullable().optional(),
    cost: z.number().int().min(1).max(100000),
    memberIds: z.array(z.string()).optional(),
    needsApproval: z.boolean().optional(),
    limit: RewardLimitSchema.optional(),
    active: z.boolean().optional(),
    sort: z.number().optional(),
  })
  .openapi('RewardInput');

export const RedemptionSchema = z
  .object({
    id: z.string(),
    rewardId: z.string().nullable().openapi({ description: 'null once the reward is deleted (title/emoji/cost are kept).' }),
    memberId: z.string(),
    title: z.string(),
    emoji: z.string().nullable(),
    cost: z.number(),
    status: z.enum(REDEMPTION_STATUSES),
    note: z.string().nullable().openapi({ description: "A parent's note when declining." }),
    date: z.string().openapi({ description: 'Household day it was redeemed (YYYY-MM-DD).' }),
    requestedAt: z.string(),
    decidedAt: z.string().nullable(),
    givenAt: z.string().nullable(),
  })
  .openapi('Redemption');

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

export const BookResultSchema = z
  .object({
    title: z.string(), author: z.string().optional(), year: z.number().optional(), pages: z.number().optional(),
    coverId: z.number().optional(), // the thumbnail: GET /api/books/covers/{coverId}
    coverUrl: z.string().optional(), // what to save as the entry's coverUrl
    isbn: z.string().optional(), // an ISBN-13 when there is one (else ISBN-10)
    series: z.string().optional(), seriesNumber: z.string().optional(), // "Warriors", "1"
    lexile: z.number().optional(), // reading level, e.g. 660 (660L)
    genres: z.array(z.string()).optional(), // up to five, picked out of Open Library's subjects (books.ts genresFrom)
    workKey: z.string().optional(), // Open Library's work, e.g. /works/OL116250W: adding it to the library fetches its description
    ratingsAverage: z.number().optional(), ratingsCount: z.number().optional(), // Open Library readers' ratings: 4.2 of 5, from 120
  })
  .openapi('BookResult');

// The family's library (routes/library.ts): books owned, with who has read them (reading entries
// started from the book carry data.bookId).
const LibraryIsbn = z.string().regex(/^(\d{9}[\dXx]|\d{13})$/, 'an ISBN-10 or ISBN-13, digits only');
const LibraryFormat = z.enum(['book', 'audiobook']);
const LibraryShelf = z.enum(['kids', 'grownups', 'everyone']);
const LibraryCover = z.string().max(2000).refine(isPublicHttpsUrl, 'must be a public https address');
export const LibraryBookSchema = z
  .object({
    id: z.string(), title: z.string(), author: z.string().nullable(), isbn: z.string().nullable(), pages: z.number().nullable(),
    format: LibraryFormat.default('book').openapi({ description: 'A book or an audiobook: each its own item, so a paper copy and an audiobook of one title are two.' }),
    coverUrl: z.string().nullable(), year: z.number().nullable(), series: z.string().nullable(), seriesNumber: z.string().nullable(),
    lexile: z.number().nullable().openapi({ description: 'Reading level (Lexile), e.g. 660 for 660L.' }), description: z.string().nullable(),
    genres: z.array(z.string()).openapi({ description: 'Up to five, e.g. Fantasy, Animals.' }),
    workKey: z.string().nullable().openapi({ description: 'The Open Library work its details came from, e.g. /works/OL116250W (https://openlibrary.org + workKey).' }),
    ratingsAverage: z.number().nullable().openapi({ description: "Open Library readers' average rating, of 5." }), ratingsCount: z.number().nullable(),
    lookedUpAt: z.string().nullable().openapi({ description: 'When its details were last looked up on Open Library (found or not); null when never.' }),
    location: z.string().nullable().openapi({ description: 'Where it lives, e.g. "Maya\'s room".' }),
    lentTo: z.string().nullable().openapi({ description: 'Who has it on loan (free text); null when it\'s home.' }),
    lentOn: z.string().nullable().openapi({ description: 'YYYY-MM-DD it was lent; null when home.' }),
    borrowedFrom: z.string().nullable().openapi({ description: 'Borrowed, not owned: who from (e.g. "Town library"); null for the family\'s own books.' }),
    dueOn: z.string().nullable().openapi({ description: 'YYYY-MM-DD a borrowed book is due back.' }),
    returnedOn: z.string().nullable().openapi({ description: 'YYYY-MM-DD a borrowed book went back; kept as history.' }),
    wanted: z.boolean().openapi({ description: "On the wishlist: wanted, not had yet. Left out of the library unless asked for (wanted=1)." }),
    shelf: LibraryShelf.nullable().default(null).openapi({ description: "Who it's for, as a parent picked: kids, grownups or everyone (on both shelves); null is Auto (effectiveShelf)." }),
    effectiveShelf: LibraryShelf.default('grownups').openapi({ description: "The shelf it's on: its shelf, else Auto: kids when its genres say children's, young adult or picture book, its reading level is under 1000L, it has 48 pages or fewer, or only kids have read it; otherwise grownups." }),
    addedBy: ActorSchema.nullable(),
    readers: z.array(z.object({
      entryId: z.string(), memberId: z.string().nullable(), status: z.enum(['want', 'reading', 'finished']),
      readAt: z.string().nullable().openapi({ description: 'YYYY-MM-DD of their latest reading: the day they finished, else the last day logged, else when the entry last changed; null for want to read with nothing logged.' }),
      narrator: z.string().nullable().optional(), minutesListened: z.number().nullable().optional(), totalMinutes: z.number().nullable().optional(),
    })).openapi({ description: "Reading entries started from this book (data.bookId), newest first. An audiobook entry's narrator, minutesListened and totalMinutes come along." }),
    createdAt: z.string(), updatedAt: z.string(),
  })
  .openapi('LibraryBook');
export const LibraryBookInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional().openapi({ description: 'Leave out with an isbn to look the book up (Open Library).' }),
    format: LibraryFormat.optional().openapi({ description: 'book (the default) or audiobook.' }),
    author: z.string().max(200).nullable().optional(), isbn: LibraryIsbn.nullable().optional(), pages: z.number().int().min(1).max(100000).nullable().optional(),
    coverUrl: LibraryCover.nullable().optional(), year: z.number().int().min(0).max(3000).nullable().optional(),
    series: z.string().max(200).nullable().optional(), seriesNumber: z.string().max(20).nullable().optional(),
    lexile: z.number().int().min(-500).max(2500).nullable().optional(), description: z.string().max(4000).nullable().optional(),
    genres: z.array(z.string().trim().min(1).max(40)).max(5).optional(),
    location: z.string().trim().max(80).nullable().optional(),
    lentTo: z.string().trim().max(80).nullable().optional().openapi({ description: 'Lend it (who has it); null when it comes back.' }),
    lentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().openapi({ description: 'When it was lent; today (household timezone) when left out.' }),
    borrowedFrom: z.string().trim().max(80).nullable().optional().openapi({ description: 'Borrowed from (e.g. "Town library"); null makes it the family\'s own.' }),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().openapi({ description: 'When a borrowed book is due back.' }),
    returnedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().openapi({ description: 'Returned (a borrowed book), kept as history; null to borrow it again.' }),
    wanted: z.boolean().optional().openapi({ description: 'On the wishlist (not had yet); false when you get it. Borrowing it (borrowedFrom) takes it off.' }),
    shelf: LibraryShelf.nullable().optional().openapi({ description: "Who it's for: kids, grownups or everyone; null for Auto. Parent devices only." }),
    workKey: z.string().regex(/^\/works\/OL\d+W$/).optional().openapi({ description: "A search result's workKey: its description is fetched (once)." }),
  })
  .openapi('LibraryBookInput');
export const LibraryBookPatchSchema = LibraryBookInputSchema.omit({ workKey: true }).extend({ title: z.string().trim().min(1).max(300).optional() }).openapi('LibraryBookPatch');

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
      z.object({ id: z.string(), title: z.string(), emoji: z.string().nullable(), points: z.number(), dueTime: z.string().nullable(), date: z.string(), done: z.boolean(), pending: z.boolean(), doneBy: z.string().nullable(), shared: z.boolean() }), // pending: ticked, waiting for a parent's OK (not done). doneBy: member credited (null = nobody, or not done)
    ),
    items: z.array(SnapshotItemSchema), // assigned to them, open, due by `to` or high/urgent
    birthdays: z.array(SnapshotBirthdaySchema),
    meals: z.array(MealSchema),
    tomorrow: z
      .object({ date: z.string(), events: z.array(SnapshotEventSchema), items: z.array(SnapshotItemSchema), birthdays: z.array(SnapshotBirthdaySchema), meals: z.array(MealSchema) })
      .nullable(), // day range only
    checkedIn: z.boolean(), // the member checked in today (household day)
    checkInPoints: z.number(), // what checking in earns now; 0 = check-ins are off
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
      z.object({ memberId: z.string().nullable(), name: z.string().nullable(), avatar: z.string().nullable(), color: z.string().nullable(), remaining: z.number(), total: z.number(), pending: z.number() }), // pending: of remaining, ticked and waiting for a parent's OK
    ),
    birthdays: z.array(SnapshotBirthdaySchema),
    meals: z.array(MealSchema),
    booksDue: z.array(z.object({ id: z.string(), title: z.string(), borrowedFrom: z.string(), dueOn: z.string(), date: z.string(), overdue: z.boolean() })), // borrowed library books due by `to`; date: the board day (an overdue one shows today)
  })
  .openapi('Board');

export const TidbitsSchema = z
  .object({
    date: z.string(), // household-local YYYY-MM-DD these are for
    onThisDay: z.array(z.object({ kind: z.enum(ON_THIS_DAY_KINDS), text: z.string(), year: z.number().nullable() })),
    trivia: z.array(z.object({ question: z.string(), answer: z.string(), choices: z.array(z.string()), category: z.string() })),
  })
  .openapi('Tidbits');


// GET /api/members/{id}/stats: a member profile's numbers. Periods are household days
// (timezone, week start). previous is the same stretch just before, for "vs your own last week".
export const StatsPeriodSchema = z.enum(['today', 'week', 'month', 'year', 'all']);
export const MemberStatsSchema = z
  .object({
    memberId: z.string(),
    period: StatsPeriodSchema,
    from: z.string(), // YYYY-MM-DD, inclusive; for all, the earlier of joining and the first chore done
    to: z.string(), // today
    joined: z.string(), // the day the member was added
    choresDone: z.number(), // approved completions, including chores deleted since
    pointsEarned: z.number(), // chores plus daily check-ins and bonus points
    checkIns: z.number(), // daily check-ins in the period
    previous: z.object({ from: z.string(), to: z.string(), choresDone: z.number(), pointsEarned: z.number() }).nullable(), // null for all
    pointsSpent: z.object({ stickers: z.number(), rewards: z.number() }), // rewards net of refunds
    streak: z.object({ current: z.number(), best: z.number() }), // the leaderboard's rule, grace days included
    chart: z.array(z.object({ key: z.string(), count: z.number() })).openapi({ description: 'Chores done per day for the whole week or month (YYYY-MM-DD), or per month (year: January to December, all: from the first month; YYYY-MM). Days and months still ahead are 0. Empty for today.' }),
    busiestWeekday: z.number().int().min(0).max(6).nullable(), // 0 = Sunday
    favoriteChore: z.object({ choreId: z.string(), title: z.string(), emoji: z.string().nullable(), count: z.number() }).nullable(),
    books: z.object({
      finished: z.number(), // in the period, books and audiobooks
      pages: z.number(), // of those books
      minutesListened: z.number(), // of those audiobooks
      shelfScope: z.enum(['year', 'all']), // the shelf is this year's books, or every book for all
      shelf: z.array(z.object({ id: z.string(), title: z.string(), pages: z.number().nullable(), minutes: z.number().nullable(), rating: z.number().nullable(), finishedOn: z.string() })),
      reading: z.array(z.object({ id: z.string(), title: z.string(), percent: z.number().nullable() })),
    }),
    stickers: z.object({ packsOwned: z.number(), packsTotal: z.number(), placed: z.number() }),
    activities: z.array(z.object({ pluginId: z.string(), name: z.string(), emoji: z.string().nullable(), seconds: z.number() })), // in the period, most first
    badges: z.array(z.object({ id: z.string(), emoji: z.string(), title: z.string(), earned: z.boolean() })),
    birthday: z.object({ date: z.string(), daysUntil: z.number(), turning: z.number().nullable() }).nullable(), // turning is null without a birth year
  })
  .openapi('MemberStats');
