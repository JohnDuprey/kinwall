import type { CustomScheme } from './skins.ts'
// Shapes mirror SPEC.md "API". Assumption: JSON keys are camelCase throughout
// (SPEC shows this explicitly for EventInstance / chores/day; applied consistently here).

export type ThemeMode = 'light' | 'dark' | 'auto' | 'scheduled'
export type BackgroundLight = 'warm' | 'white' | 'gray' | 'sage'
/** A skin id from skins.ts, or 'seasonal' (the scheme follows the date). */
export type ColorScheme = 'meadow' | 'field' | 'autumn' | 'winter' | 'spring' | 'summer' | 'ocean' | 'midnight' | 'lavender' | 'harvest' | 'festive' | 'seasonal' | `custom-${string}`
export type CustomColors = { accent?: string; bg?: string; card?: string; text?: string }
export type BackgroundDark = 'cocoa' | 'charcoal' | 'midnight'
export type TextScale = 's' | 'm' | 'l' | 'xl'
export type Density = 'comfortable' | 'compact'
/** Per-device only: the server's household density is comfortable/compact. */
export type DeviceDensity = Density | 'icons'

export interface Settings {
  familyName: string
  timezone: string | null
  weekStart: 0 | 1
  themeMode: ThemeMode
  darkFrom: string // HH:MM, household timezone
  darkTo: string // HH:MM, household timezone
  quietFrom: string | null // HH:MM; both null = no quiet hours (paired displays only)
  quietTo: string | null
  accent: string // hex; DEFAULT_ACCENT (useTheme.ts) = the color scheme's own accent
  colorScheme: ColorScheme
  customColors: Omit<CustomColors, 'accent'> | null // legacy: household surfaces over the scheme (the app no longer sets these)
  customSchemes: CustomScheme[] // the family's saved schemes, pickable by id in colorScheme / a device's skin
  backgroundLight: BackgroundLight
  backgroundDark: BackgroundDark
  textScale: TextScale
  density: Density
  defaultReminderMinutes: number[]
  lateCompletionCredit: number // 0-100: % of points a chore earns when ticked off for a past day
  streakGraceDays: number // 0-3 missed days per rolling week a streak survives
  leaderboardEnabled: boolean // false: hide the leaderboard, crowns and rank badges
  stickersEnabled: boolean // false: hide the sticker book (and the shop refuses purchases)
  stickerPriceScale: number // percent applied to sticker pack prices; 0 = all free
  location: WeatherLocation | null // for the snapshot's weather; null = no weather
  temperatureUnit: 'celsius' | 'fahrenheit'
  tidbits: TidbitSettings // the Board's quote / fact card
}

export type TidbitSource = 'quotes' | 'facts' | 'onthisday' | 'trivia'
export type FactCategory = 'animals' | 'space' | 'science' | 'body' | 'plants' | 'words'
export type OnThisDayKind = 'holidays' | 'births' | 'events'
export interface TidbitSettings {
  sources: TidbitSource[] // [] = no card on the Board
  factCategories: FactCategory[] // built-in facts; [] = every category
  onThisDay: OnThisDayKind[]
  birthsAfter: number | null // birthdays only for people born in or after this year; null = any
  triviaCategories: number[] // Open Trivia DB category ids
  triviaDifficulties: ('easy' | 'medium' | 'hard')[] // one or more
}
/** Today's online tidbits (GET /api/tidbits); sources that are off come back empty. */
export interface OnlineTidbits {
  date: string
  onThisDay: { kind: OnThisDayKind; text: string; year: number | null }[]
  trivia: { question: string; answer: string; choices: string[]; category: string }[]
}

export interface WeatherLocation { name: string; lat: number; lon: number; countryCode?: string }
export interface GeocodeResult extends WeatherLocation { label: string }

/** Subset of Settings the pre-pairing screen can read with no key — see GET /api/appearance. */
export type Appearance = Pick<Settings, 'themeMode' | 'darkFrom' | 'darkTo' | 'accent' | 'colorScheme' | 'customColors' | 'customSchemes' | 'backgroundLight' | 'backgroundDark' | 'textScale' | 'density'>

export interface Member {
  id: string
  name: string
  color: string
  avatar: string
  birthday: string | null // YYYY-MM-DD, or --MM-DD when the year isn't known
  sort: number
  pointsToday: number
  pointsWeek: number
  balance: number // points left to spend on stickers (earned - spent); pointsToday/pointsWeek stay earned
}

export type CalendarKind = 'local' | 'ics' | 'google' | 'microsoft' | 'caldav'

export interface CalendarEntry {
  id: string
  kind: CalendarKind
  accountId: string | null
  remoteId: string | null
  name: string
  color: string | null
  memberId: string | null // legacy - first element of memberIds, kept for compat
  memberIds: string[]
  categoryId: string | null // default category for events with no override/keyword match
  writable: boolean
  enabled: boolean
  lastSyncedAt: string | null
  lastError: string | null
  needsReconnect?: boolean // imported placeholder: settings kept, not syncing until reconnected
}

export interface EventInstance {
  id: string
  calendarId: string
  title: string
  start: string // ISO UTC, or YYYY-MM-DD when allDay
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  memberIds: string[]
  color: string
  rrule: string | null
  occurrenceStart: string | null
  readOnly: boolean
  seriesId: string | null // set for occurrences of a recurring synced event
  memberScope: 'occurrence' | 'series' | 'calendar' | 'none' // where memberIds came from
  categoryId: string | null
  categorySource: 'event' | 'series' | 'keyword' | 'calendar' | null // where categoryId came from
  reminders: number[] | null // minutes-before in effect (the event's own, or the household default)
  reminderSource?: 'event' | 'default' | null
  linkedItemCount?: number // open list items linked to this event (GET /api/events only)
  noteCount?: number // notes in this event's thread (GET /api/events only)
  travelMinutes: number | null // Kinwall-only travel time, never sent to Google/Outlook
  leaveAt: string | null // start - travelMinutes (ISO); null when no travel time or all-day
  remindBeforeLeave: boolean // reminders count back from leaveAt instead of start
}

/** Reminder select options shared by the event edit sheet and Settings' household default. */
export const REMINDER_OPTIONS: { value: string; label: string; minutes: number[] }[] = [
  { value: 'none', label: 'None', minutes: [] },
  { value: '5', label: '5 minutes', minutes: [5] },
  { value: '10', label: '10 minutes', minutes: [10] },
  { value: '15', label: '15 minutes', minutes: [15] },
  { value: '30', label: '30 minutes', minutes: [30] },
  { value: '60', label: '1 hour', minutes: [60] },
  { value: '1440', label: '1 day', minutes: [1440] },
]

export function reminderLabel(minutes: number[] | null | undefined): string | null {
  if (!minutes || minutes.length === 0) return null
  const one = (m: number) => m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} min`
  return [...new Set(minutes)].sort((a, b) => a - b).map(one).join(', ') + ' before'
}

export interface Category {
  id: string
  name: string
  emoji: string | null
  color: string // overrides the assigned member's color on the calendar
  keywords: string[] // literal phrases, case-insensitive whole-word/phrase match against the event title
  sort: number
  createdAt: string
}

/** One-tap starter presets offered by "Add category" in Settings - prefill the edit sheet, don't
 * create anything until the user saves. */
export const CATEGORY_PRESETS: { name: string; emoji: string; keywords: string[] }[] = [
  { name: 'Birthdays', emoji: '🎂', keywords: ['birthday', 'bday', 'b-day'] },
  { name: 'Appointments', emoji: '🏥', keywords: ['dentist', 'doctor', 'appt', 'appointment', 'orthodontist'] },
  { name: 'Sports', emoji: '⚽', keywords: ['practice', 'game', 'soccer', 'baseball', 'basketball', 'swim'] },
  { name: 'School', emoji: '🏫', keywords: ['school', 'pta', 'conference', 'field trip'] },
  { name: 'Travel', emoji: '✈️', keywords: ['flight', 'trip', 'hotel', 'vacation'] },
]

export interface Chore {
  id: string
  title: string
  emoji: string
  memberId: string | null
  points: number
  rrule: string | null
  dueDate: string | null
  dueTime: string | null
  active: boolean
  sort: number
  listId: string | null // checklist: a list that must be fully ticked before the chore can be completed
}

export interface ChoreDay extends Chore {
  completed: boolean
  completedAt: string | null
  completedBy: string | null
  checklist: { listId: string; name: string; total: number; done: number } | null
}

export type LeaderboardPeriod = 'today' | 'week' | 'month'

export interface LeaderboardEntry {
  memberId: string
  name: string
  color: string
  avatar: string | null
  points: number
  completed: number
  streak: number
  rank: number
}

export interface StickerPack {
  id: string
  name: string
  cover: string
  stickers: string[]
  basePrice: number
  price: number // after the household's stickerPriceScale
  unlocked: boolean
}

/** A sticker on a member's scrapbook page. x/y: the sticker's center as 0-1 fractions of the page. */
export interface StickerPlacement {
  id: string
  memberId: string
  sticker: string
  x: number
  y: number
  scale: number
  rotation: number
  z: number
  placedAt: string
}
/** A family photo (server: routes/photos.ts). Its bytes are at `url`; see api.photoImageUrl for an <img src>. */
export interface Photo {
  id: string
  caption: string | null
  mime: string
  width: number
  height: number
  bytes: number
  memberId: string | null
  createdAt: string
  url: string
}
export interface PhotoQuota { count: number; bytes: number; maxCount: number; maxBytes: number; maxPhotoBytes: number }

export type StickerPatch = Partial<Pick<StickerPlacement, 'x' | 'y' | 'scale' | 'rotation' | 'z'>>

export type AccountKind = 'google' | 'microsoft' | 'caldav'

export interface Account {
  id: string
  kind: AccountKind
  name: string
  createdAt: string
}

export interface RemoteCalendar {
  remoteId: string
  name: string
  color: string | null
  writable: boolean
}

export type ProviderSource = 'env' | 'ui' | null

export interface ProviderStatus {
  configured: boolean
  source: ProviderSource
  clientId?: string
  tenant?: string
  secretSet: boolean
}

export interface Providers {
  publicUrl: { value?: string; source: ProviderSource }
  redirectUris: { google: string; microsoft: string }
  google: ProviderStatus
  microsoft: ProviderStatus
}

export type KeyScope = 'admin' | 'display'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  scope: KeyScope
  createdAt: string
  lastUsedAt: string | null
  owner?: string | null // devices: 'shared', a member id, or null (paired before owners; the device picks)
}

export interface Passkey {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  transports?: string[] // as reported by the authenticator at registration
}

export interface Me {
  scope: KeyScope
  keyName: string
  kind: 'api' | 'session'
  owner?: string | null // who this device belongs to (see ApiKey.owner); set by an admin only
  version?: string
  hostPortalUrl?: string // set by a host serving this family (HOST_PORTAL_URL)
}

export interface ImportResult {
  imported: {
    members: number; categories: number; calendars: number; events: number; eventMemberOverrides: number; eventCategoryOverrides: number
    eventTravelOverrides: number; eventSeriesMemberOverrides: number; eventSeriesCategoryOverrides: number
    chores: number; choreCompletions: number; lists: number; listItems: number; listItemSteps?: number
  }
  needsReconnect: { id: string; kind: string; name: string }[]
  skipped: { passkeys: number; webhooks: number }
}

export interface HostEvent {
  id: string
  at: string
  action: string
  detail: string | null
}

export interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  createdAt: string
}

/** Create/rotate response: the plain signing secret, returned only this once. */
export type WebhookWithSecret = Webhook & { secret: string }

export type ListKind = 'todo' | 'shopping' | 'reusable'
export type ListGroupBy = 'store' | 'category' | 'none'
export type ListSortBy = 'manual' | 'added' | 'due' | 'priority' | 'alpha'

export interface List {
  id: string
  name: string
  emoji: string | null
  color: string | null
  kind: ListKind
  memberIds: string[] // owners; [] = whole family
  groupBy: ListGroupBy
  sortBy: ListSortBy // item order within each group
  sort: number
  archived: boolean
  createdAt: string
  itemCount: number // computed
  openCount: number // computed
}

export interface ListItem {
  id: string
  listId: string
  title: string
  notes: string | null
  quantity: string | null // free text: "2", "1 lb", "x3"
  store: string | null
  category: string | null
  memberId: string | null // assignee
  dueDate: string | null // YYYY-MM-DD
  eventId: string | null // linked calendar event (series id for a recurring local event)
  priority: ListItemPriority // open urgent/high items sort first, low last (see compareItems)
  done: boolean
  doneAt: string | null
  doneBy: string | null
  sort: number
  createdAt: string
  updatedAt: string
  steps: ListItemStep[] // ordered; an item with steps is done exactly when all of them are
  stepsDone: number
  stepsTotal: number
  noteCount?: number // notes in this item's thread (list detail only)
}

/** A note in the thread on an event or list item. target = "event:<id>" | "list_item:<id>". */
export type NoteTarget = `event:${string}` | `list_item:${string}`
export interface Note {
  id: string
  targetType: 'event' | 'list_item'
  targetId: string
  memberId: string | null // who posted; null = "Someone"
  body: string
  createdAt: string
  updatedAt: string
}

export type ListItemPriority = 'low' | 'normal' | 'high' | 'urgent'

const PRIORITY_RANK: Record<ListItemPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** The server's item order (server/src/routes/lists.ts compareItems - keep in step). manual: open
 * items by priority, overdue first within each, then the hand-set order; priority: the same, then
 * soonest due; added: newest first; due: soonest, undated last; alpha: A-Z, ignoring case.
 * `today` is YYYY-MM-DD. A done item gets no priority/overdue boost. */
export function compareItems(sortBy: ListSortBy, today: string) {
  const rank = (i: ListItem) => (i.done ? 2 : PRIORITY_RANK[i.priority] ?? 2)
  const overdue = (i: ListItem) => (!i.done && i.dueDate && i.dueDate < today ? 0 : 1)
  const due = (a: ListItem, b: ListItem) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
  const manual = (a: ListItem, b: ListItem) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)
  return (a: ListItem, b: ListItem): number => {
    if (sortBy === 'added') return b.createdAt.localeCompare(a.createdAt) || b.sort - a.sort
    if (sortBy === 'due') return due(a, b) || manual(a, b)
    if (sortBy === 'alpha') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || manual(a, b)
    return rank(a) - rank(b) || overdue(a) - overdue(b) || (sortBy === 'priority' ? due(a, b) : 0) || manual(a, b)
  }
}

export interface ListItemStep {
  id: string
  title: string
  done: boolean
  sort: number
}

/** User ordering of stores/categories within a list (drives group-header sort). */
export interface ListGroup {
  kind: 'store' | 'category'
  name: string
  sort: number
}

/** GET /api/lists/{id} response. suggestions are distinct store/category values used anywhere
 * in the household, for <datalist> autocomplete on the item sheet. */
export interface ListDetail {
  list: List
  items: ListItem[]
  groups: ListGroup[]
  suggestions: { stores: string[]; categories: string[] }
}

/** POST /api/lists/{id}/items body shape - store/category are OMITTED (not sent) unless the
 * user explicitly set them, so the server can fill them in from a remembered matching title. */
export interface ListItemInput {
  title: string
  notes?: string | null
  quantity?: string | null
  store?: string | null
  category?: string | null
  memberId?: string | null
  dueDate?: string | null
  eventId?: string | null
  priority?: ListItemPriority
  steps?: string[] // step titles, in order
}

export const LIST_EMOJI = ['📝', '🛒', '✅', '🧳', '🎒', '📋', '🧺', '🍽️', '🧹', '🎁']

export const MEMBER_PALETTE = [
  '#FF9E7A', '#FFD166', '#7ED9A6', '#7AB8FF', '#B39DFF',
  '#FF8FA3', '#8FE0D6', '#FFB6D9', '#C7E27A', '#A0AEC0',
]

export const MEMBER_EMOJI = ['🦊', '🐻', '🐱', '🐶', '🐰', '🦁', '🐼', '🦄', '🐨', '🐵']

export const CATEGORY_EMOJI = ['🎂', '🏥', '⚽', '🏫', '✈️', '🎉', '🎵', '📅', '❤️', '⭐']

/** First palette color not already in use (by members/calendars), so a new calendar with no
 * explicit color doesn't fall back to the server's grey #888. Cycles back to the first color
 * once the palette is exhausted. */
export function nextPaletteColor(usedColors: (string | null | undefined)[]): string {
  const taken = new Set(usedColors.filter(Boolean))
  return MEMBER_PALETTE.find(c => !taken.has(c)) ?? MEMBER_PALETTE[0]
}

export interface PushSubscriptionPrefs {
  eventReminders: boolean
  dailySummary: boolean
  summaryTime: string // HH:MM, household timezone
  choreNudge: boolean
  choreNudgeTime: string
  listUpdates: boolean
}

/** One row of the in-app notification feed (GET /api/notifications). */
export interface AppNotification {
  id: string
  at: string
  kind: 'reminder' | 'summary' | 'chore' | 'list' | 'message'
  title: string
  body: string | null
  url: string | null // '/#/calendar?event=…', '/chores', '/lists', '/' - same deep link a push opens
  memberIds: string[]
  source: string | null
}

export interface PushSubscription {
  id: string
  deviceName: string
  memberIds: string[]
  prefs: PushSubscriptionPrefs
  createdAt: string
  lastSuccessAt: string | null
}

export interface WeatherDay { date: string; code: number; emoji: string; text: string; high: number; low: number; rainChance: number | null }
export interface Weather {
  location: string
  unit: 'celsius' | 'fahrenheit'
  now: { temp: number; code: number; emoji: string; text: string; rainChance: number | null } | null
  days: WeatherDay[]
}
export type SnapshotEvent = EventInstance & { date: string } // the household-local day it's listed under
export type SnapshotItem = ListItem & { listName: string; listEmoji: string | null; overdue: boolean }
export interface SnapshotBirthday { memberId: string | null; eventId: string | null; name: string; avatar: string | null; date: string; age: number | null }
export interface SnapshotChore { id: string; title: string; emoji: string | null; points: number; dueTime: string | null; date: string; done: boolean; doneBy: string | null; shared: boolean }
/** GET /api/snapshot - one member's day or next 7 days. */
export interface Snapshot {
  greeting: string
  member: { id: string; name: string; color: string; avatar: string | null; birthday: string | null }
  range: 'day' | 'week'
  from: string
  to: string
  generatedAt: string
  weather: Weather | null
  events: SnapshotEvent[]
  chores: SnapshotChore[]
  items: SnapshotItem[]
  birthdays: SnapshotBirthday[]
  tomorrow: { date: string; events: SnapshotEvent[]; items: SnapshotItem[]; birthdays: SnapshotBirthday[] } | null
}
/** GET /api/board?days=N - the whole family's bulletin board, today through `to`. */
export interface Board {
  today: string
  to: string
  generatedAt: string
  weather: Weather | null // as /api/weather, days limited to the range
  events: SnapshotEvent[] // everyone's, sorted by start
  items: SnapshotItem[] // open items due by `to` (overdue first), plus urgent/high ones with no date
  chores: { memberId: string | null; name: string | null; avatar: string | null; color: string | null; remaining: number; total: number }[]
  birthdays: SnapshotBirthday[]
}
