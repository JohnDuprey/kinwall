// Shapes mirror SPEC.md "API". Assumption: JSON keys are camelCase throughout
// (SPEC shows this explicitly for EventInstance / chores/day; applied consistently here).

export type ThemeMode = 'light' | 'dark' | 'auto' | 'scheduled'
export type BackgroundLight = 'warm' | 'white' | 'gray' | 'sage'
export type BackgroundDark = 'cocoa' | 'charcoal' | 'midnight'
export type TextScale = 's' | 'm' | 'l' | 'xl'
export type Density = 'comfortable' | 'compact'

export interface Settings {
  familyName: string
  timezone: string | null
  weekStart: 0 | 1
  themeMode: ThemeMode
  darkFrom: string // HH:MM, household timezone
  darkTo: string // HH:MM, household timezone
  accent: string // hex
  backgroundLight: BackgroundLight
  backgroundDark: BackgroundDark
  textScale: TextScale
  density: Density
  defaultReminderMinutes: number[]
}

/** Subset of Settings the pre-pairing screen can read with no key — see GET /api/appearance. */
export type Appearance = Pick<Settings, 'themeMode' | 'darkFrom' | 'darkTo' | 'accent' | 'backgroundLight' | 'backgroundDark' | 'textScale' | 'density'>

export interface Member {
  id: string
  name: string
  color: string
  avatar: string
  sort: number
  pointsToday: number
  pointsWeek: number
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
  reminders: number[] | null // minutes-before; effective value (own, or the household default)
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
  const m = Math.min(...minutes)
  if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? '' : 's'} before`
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} before`
  return `${m} min before`
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
}

export interface ChoreDay extends Chore {
  completed: boolean
  completedAt: string | null
  completedBy: string | null
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
}

export interface Passkey {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
}

export interface Me {
  scope: KeyScope
  keyName: string
  kind: 'api' | 'session'
  version?: string
}

export interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  createdAt: string
}

export type ListKind = 'todo' | 'shopping' | 'reusable'
export type ListGroupBy = 'store' | 'category' | 'none'

export interface List {
  id: string
  name: string
  emoji: string | null
  color: string | null
  kind: ListKind
  memberIds: string[] // owners; [] = whole family
  groupBy: ListGroupBy
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
  done: boolean
  doneAt: string | null
  doneBy: string | null
  sort: number
  createdAt: string
  updatedAt: string
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
}

export const LIST_EMOJI = ['📝', '🛒', '✅', '🧳', '🎒', '📋', '🧺', '🍽️', '🧹', '🎁']

export const MEMBER_PALETTE = [
  '#FF9E7A', '#FFD166', '#7ED9A6', '#7AB8FF', '#B39DFF',
  '#FF8FA3', '#8FE0D6', '#FFB6D9', '#C7E27A', '#A0AEC0',
]

export const MEMBER_EMOJI = ['🦊', '🐻', '🐱', '🐶', '🐰', '🦁', '🐼', '🦄', '🐨', '🐵']

export const CATEGORY_EMOJI = ['🎂', '🏥', '⚽', '🏫', '✈️', '🎉', '🎵', '📅', '❤️', '⭐']

// 6-8 accent presets incl. the current default orange. Custom accents come from a native
// <input type="color"> in Settings, so this list stays short.
export const ACCENT_PRESETS = [
  '#FF9E7A', // current default orange
  '#FF6B6B', // coral red
  '#FFD166', // amber
  '#6FCF97', // green
  '#4DA3FF', // blue
  '#B39DFF', // violet
  '#FF8FA3', // pink
  '#2FBFB0', // teal
]

export const BACKGROUND_LIGHT_PRESETS: { key: 'warm' | 'white' | 'gray' | 'sage'; label: string; preview: string }[] = [
  { key: 'warm', label: 'Warm', preview: '#FFFBF5' },
  { key: 'white', label: 'White', preview: '#FFFFFF' },
  { key: 'gray', label: 'Gray', preview: '#F1F2F4' },
  { key: 'sage', label: 'Sage', preview: '#F3F6F1' },
]

export const BACKGROUND_DARK_PRESETS: { key: 'cocoa' | 'charcoal' | 'midnight'; label: string; preview: string }[] = [
  { key: 'cocoa', label: 'Cocoa', preview: '#1C1712' },
  { key: 'charcoal', label: 'Charcoal', preview: '#191A1C' },
  { key: 'midnight', label: 'Midnight', preview: '#0F1420' },
]

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

export interface PushSubscription {
  id: string
  deviceName: string
  memberIds: string[]
  prefs: PushSubscriptionPrefs
  createdAt: string
  lastSuccessAt: string | null
}
