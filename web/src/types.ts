import type { CustomScheme } from './skins.ts'
import type { Meal } from './meal-types.ts'
import type { TransitionReminders } from './transitions.ts'
// Shapes mirror SPEC.md "API". Assumption: JSON keys are camelCase throughout
// (SPEC shows this explicitly for EventInstance / chores/day; applied consistently here).

export type ThemeMode = 'light' | 'dark' | 'auto' | 'scheduled'
export type BackgroundLight = 'warm' | 'white' | 'gray' | 'sage'
/** A skin id from skins.ts, or 'seasonal' (the scheme follows the date). */
export type ColorScheme = 'meadow' | 'field' | 'autumn' | 'winter' | 'spring' | 'summer' | 'ocean' | 'midnight' | 'lavender' | 'harvest' | 'festive' | 'slate' | 'ink' | 'sage' | 'graphite' | 'berry' | 'seasonal' | `custom-${string}`
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
  checkInPoints: number // daily check-in points (0 = off; 1, 2, 3, 5 or 10)
  leaderboardEnabled: boolean // false: hide the leaderboard, crowns and rank badges
  stickersEnabled: boolean // false: hide the sticker book (and the shop refuses purchases)
  stickerPriceScale: number // percent applied to sticker pack prices; 0 = all free
  location: WeatherLocation | null // for the snapshot's weather; null = no weather
  temperatureUnit: 'celsius' | 'fahrenheit'
  tidbits: TidbitSettings // the Board's quote / fact card
  features: Features // Settings → Features: what the family uses; off = hidden on every screen
  mealTimes: Record<'breakfast' | 'lunch' | 'dinner' | 'snack', string> // HH:MM each meal usually is; a meal without its own time uses it on the calendar
  aiHealthAccess: boolean // false (default): MCP and connected apps can't see or change the Health tracker
  medications: boolean // Medication reminders (off by default; only on with the Health tracker); off hides them everywhere, data kept
  medicationNamesOnWalls: boolean // shared wall screens show medicine names (off: "Meds")
}

/** Household feature switches. Off hides the feature everywhere; its data is kept. */
export interface Features {
  chores: boolean // Chores tab, points, leaderboard, sticker book, chore nudges
  lists: boolean // Lists tab, "Due soon", an event's linked items, list-update notifications
  contacts: boolean // Contacts tab and household contacts directory
  paint: boolean // Activities → Paint
  photos: boolean // Activities → Photos and the Board's picture card
  notes: boolean // notes on events and list items
  messages: boolean // sending family messages (the bell's Send a message)
  // Trackers, one switch per kind; the Trackers tab goes when all three are off
  trackersReading: boolean
  trackersMemories: boolean
  trackersHealth: boolean
  meals: boolean // Meals tab, the Board's meals card, meals in the daily summary
}

// Trackers (server: routes/trackers.ts). `data` holds the kind's fields; health never reaches a display key.
export type TrackerKind = 'reading' | 'memory' | 'health'
export type ReadingStatus = 'want' | 'reading' | 'finished'
export type ReadingFormat = 'book' | 'audiobook'
/** No format = a book (entries from before audiobooks). Pages are for books, minutes for audiobooks. */
export interface ReadingData {
  format?: ReadingFormat; author?: string; narrator?: string; status: ReadingStatus
  pagesRead?: number; totalPages?: number; minutesListened?: number; totalMinutes?: number
  finishedOn?: string; rating?: number; notes?: string
}
export interface MemoryData { text: string; mood?: string }
export type HealthType = 'checkup' | 'dentist' | 'specialist' | 'vaccine' | 'sick' | 'other'
export interface Measure<U extends string> { value: number; unit: U }
export interface HealthData {
  type: HealthType; time?: string; provider?: string; notes?: string; followUp?: string; eventId?: string
  height?: Measure<'in' | 'cm'>; weight?: Measure<'lb' | 'kg'>; temperature?: Measure<'F' | 'C'>
}
export interface TrackerEntry<D = ReadingData | MemoryData | HealthData> {
  id: string
  kind: TrackerKind
  memberId: string | null // null = the whole family, or a removed member (formerMember)
  formerMember: string | null // name of the removed member this belonged to
  date: string // YYYY-MM-DD: a book's start, a memory's day, a visit's day
  title: string | null // the book, a memory's headline, a visit's reason
  photoId: string | null // a memory's one photo
  photoOwned: boolean // added for this memory (not picked from the family photos)
  photoFamily: boolean | null // also a family photo; null = no photo
  data: D
  createdAt: string
  updatedAt: string
}
/** The Trackers kinds this family has on, as #/trackers/<sub> keys, in tab order (App's nav, Trackers' tabs). */
export function trackerKinds(s: Settings): string[] {
  return ([['reading', s.features.trackersReading], ['memories', s.features.trackersMemories], ['health', s.features.trackersHealth]] as const).filter(([, on]) => on).map(([k]) => k)
}
/** Create/edit body: data fields set to null are cleared on edit. */
export interface TrackerInput { kind?: TrackerKind; memberId?: string | null; date?: string; title?: string | null; photoId?: string | null; photoFamily?: boolean; data?: Record<string, unknown> }

export type TidbitSource = 'quotes' | 'facts' | 'tips' | 'onthisday' | 'trivia'
export type TipCategory = 'routines' | 'focus' | 'organizing' | 'feelings' | 'sensory' | 'communication'
export type FactCategory = 'animals' | 'space' | 'science' | 'body' | 'plants' | 'words'
export type OnThisDayKind = 'holidays' | 'births' | 'events'
export interface TidbitSettings {
  sources: TidbitSource[] // [] = no card on the Board
  factCategories: FactCategory[] // built-in facts; [] = every category
  tipCategories: TipCategory[] // neurodivergent-friendly tips; [] = every category
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
  grownUp?: boolean // a parent or other adult: their chores never wait for an OK (needsApproval stays false)
  needsApproval?: boolean // their chores need a parent's OK by default (a chore's own setting wins)
  transitionReminders?: TransitionReminders // pushes to their own devices before their events (admin sets)
  rewardGoal?: { rewardId: string; title: string; emoji: string | null; cost: number } | null // the reward they're saving for
  tempCheck?: TempCheckSettings // their daily questions (a parent sets them)
  todayGoal?: string | null // their Temp check goal for today
}

export interface TempCheckSettings {
  on: boolean; sleep: boolean; feelings: boolean; goal: boolean; showGoal: boolean
  evening: boolean // evening goal check: "Did you finish your goal?" at eveningTime
  eveningTime: string // HH:MM, household time, on the hour or half hour
  journal: boolean // keep the follow-up notes (off: only yes / partly / no)
  battery?: boolean // energy battery (docs/using/battery.md): private to them and parents
}
export interface TempCheckAnswered { sleep: boolean; feelings: boolean; goal: boolean; followup: boolean; drained?: boolean }
/** The energy battery's evening "How drained do you feel?" (skip: asked, not answered). */
export type Drained = 'full' | 'ok' | 'low' | 'empty'
export type FollowupOutcome = 'yes' | 'partly' | 'no'
export interface GoalFollowup { outcome: FollowupOutcome; helped: string | null; hindered: string | null; next: string | null }
/** GET/PUT /api/members/{id}/temp-check. private: sleep and feelings are withheld from this device (a shared wall). */
export interface TempCheck {
  memberId: string
  date: string
  settings: TempCheckSettings
  private: boolean
  sleep: string | null
  feelings: string[] | null
  goal: string | null
  goalSkipped: boolean
  answered: TempCheckAnswered
  custom: string[] | null // their own feelings ("Other")
  followup: GoalFollowup | null // the evening goal check (null on a shared wall: private)
  followupOpen: boolean // showing now: on, a goal set today, past their eveningTime
  drained?: Drained | 'skip' | null // null on a shared wall or another member's device (private)
  drainedOpen?: boolean // showing now: battery on, past their eveningTime, their own device or a parent's
}
export type TempCheckInput = Partial<{ sleep: string | null; feelings: string[] | null; goal: string | null; goalSkipped: boolean; custom: string[]; followup: { outcome: FollowupOutcome; helped?: string | null; hindered?: string | null; next?: string | null }; drained: Drained | 'skip' }>

/** GET /api/members/{id}/journal: their own device and parents' devices only. */
export interface JournalEntry { id: string; memberId: string; date: string; text: string; mood: string | null; createdAt: string; updatedAt: string }
export interface JournalDay {
  date: string
  tempCheck: { sleep: string | null; feelings: string[] | null; goal: string | null; goalSkipped: boolean; followup: GoalFollowup | null } | null
  entries: JournalEntry[]
}
export interface Journal { memberId: string; from: string; to: string; days: JournalDay[] }
/** GET /api/members/{id}/insights (server/src/insights.ts InsightDay): one person's household day. */
export interface InsightDay {
  date: string; checkedIn: boolean; sleep: 'great' | 'good' | 'ok' | 'poorly' | 'terrible' | null; feelings: string[]; goalSet: boolean; goalOutcome: FollowupOutcome | null
  journalEntries: number; journalMoods: string[]; chores: number; points: number; activityMinutes: number; booksFinished: number
  events: number; lastEventEnd: string | null // HH:MM household time; '24:00' past midnight
}
export type InsightRange = '4w' | '3m' | '1y'
export type InsightTally = { hit: number; n: number }
export interface InsightConnection { id: string; text: string; detail: string; confidence: 'early' | 'clear'; a: InsightTally; b: InsightTally }
export interface Insights {
  memberId: string; range: InsightRange; from: string; to: string; days: InsightDay[]
  summary: { id: string; text: string }[]; topFeelings: { feeling: string; days: number }[]
  connections: { ready: boolean; daysWithCheckIns: number; needed: number; list: InsightConnection[] }
}

/** GET /api/members/{id}/battery (server/src/battery.ts): their own device and parents' devices only. */
export interface BatteryReason { text: string; points: number }
export interface BatteryDay { date: string; forecast: boolean; start: number; drain: number; level: number; reasons: BatteryReason[]; lowBefore: string | null; felt?: Drained | null }
export interface BatteryWarning { date: string; text: string; suggestions: string[] }
export interface Battery { memberId: string; on: boolean; today: string; days: BatteryDay[]; warnings: BatteryWarning[] }

/** GET /api/medications: a person's medicine. days: weekdays, 0 = Sunday. Parents' devices and their own. */
/** endDate / totalDoses: an optional end to a course (e.g. an antibiotic); dosesLeft is null without totalDoses. */
export interface Medication { id: string; memberId: string; name: string; dose: string; times: string[]; days: number[]; endDate: string | null; totalDoses: number | null; dosesLeft: number | null; createdAt: string; updatedAt: string }
export type MedicationInput = { memberId: string; name: string; dose: string; times: string[]; days: number[]; endDate?: string | null; totalDoses?: number | null }
export type DoseStatus = 'taken' | 'skipped' | 'due' | 'missed' | 'upcoming'
/** GET /api/medications/due: the Take now cards. name/dose null on a shared wall with names off ("Meds"). */
export interface DueDose { medicationId: string; memberId: string; date: string; time: string; dueAt: string; name: string | null; dose: string | null }
export interface MedicationsDue { names: boolean; doses: DueDose[] }
export interface MedicationDose { medicationId: string; date: string; time: string; status: DoseStatus; at: string | null; by: string | null; snoozedUntil: string | null }
/** GET /api/members/{id}/medications: their own device and parents' devices only. days oldest first. */
export interface MedicationHistory {
  memberId: string
  today: string
  medications: Medication[]
  days: { date: string; doses: { medicationId: string; time: string; status: DoseStatus; at: string | null; by: string | null }[] }[]
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
  displayEdit?: boolean // wall screens and kids' devices may change its events (admins always can)
  canEditEvents?: boolean // this device may change its events (server-decided; absent = yes)
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
  pluginId: string | null // activity: playing this plugin for pluginMinutes a day completes the chore
  pluginMinutes: number | null
  needsApproval?: boolean | null // ticks from wall screens and kids' devices wait for a parent's OK; null = the person's default
  approveTimedPlay?: boolean // activity chores: timed play waits for an OK too (auto-approves otherwise)
}

export interface ChoreDay extends Chore {
  completed: boolean // done and counted
  pending?: boolean // ticked on a wall screen or kid's device, waiting for a parent's OK (no points yet)
  rejection?: { note: string | null; at: string } | null // a parent's "Not yet", until it's ticked again
  completedAt: string | null
  completedBy: string | null
  checklist: { listId: string; name: string; total: number; done: number } | null
  // The linked activity and the day's play; available false = removed or turned off (a plain chore then).
  activity: { pluginId: string; name: string | null; emoji: string | null; available: boolean; needSeconds: number; doneSeconds: number } | null
}

/** A chore ticked on a wall screen or kid's device, waiting for a parent's OK (GET /api/chores/pending). */
export interface PendingApproval { choreId: string; title: string; emoji: string | null; date: string; memberId: string | null; completedAt: string; points: number }

/** One of a player's activity chores due today (POST /api/plugins/{id}/playtime). */
export interface ActivityChoreProgress {
  choreId: string
  title: string
  emoji: string | null
  needSeconds: number
  doneSeconds: number
  completed: boolean
  justCompleted: boolean
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

export interface RewardLimit { count: number; period: 'day' | 'week' }
/** Something a parent set up that a member spends points on (server: routes/rewards.ts). */
export interface Reward {
  id: string
  title: string
  emoji: string | null
  cost: number
  memberIds: string[] // empty = everyone
  needsApproval: boolean
  limit: RewardLimit | null
  active: boolean // false = archived
  sort: number
  createdAt: string
  used?: number // with ?memberId=: how much of the limit they've used this day/week
}
export type RedemptionStatus = 'pending' | 'approved' | 'declined' | 'given'
export interface Redemption {
  id: string
  rewardId: string | null
  memberId: string
  title: string
  emoji: string | null
  cost: number
  status: RedemptionStatus
  note: string | null
  date: string
  requestedAt: string
  decidedAt: string | null
  givenAt: string | null
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
  family?: boolean // false = a memory's own photo (never in GET /api/photos)
}
/** count and bytes include memoryPhotos (memories' own photos count toward storage too). */
export interface PhotoQuota { count: number; bytes: number; memoryPhotos: number; maxCount: number; maxBytes: number; maxPhotoBytes: number }

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
  kind: 'api' | 'session' | 'oauth'
  owner?: string | null // who this device belongs to (see ApiKey.owner); set by an admin only
  locked?: boolean // the owner locks the family filter (everyday access only; a parent's device never is)
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
export type ListGroupBy = 'store' | 'category' | 'aisle' | 'none' // aisle: shopping lists only
export type ListSortBy = 'manual' | 'added' | 'due' | 'priority' | 'alpha' | 'aisle' // aisle: shopping lists only

export interface List {
  id: string
  name: string
  emoji: string | null
  color: string | null
  kind: ListKind
  memberIds: string[] // owners; [] = whole family
  groupBy: ListGroupBy
  sortBy: ListSortBy // item order within each group
  keepChecked: boolean // checked items stay in place, crossed off, until Checkout / Reset
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
  aisle: string | null // per store: "Aisle 4", "Produce", "Back wall"
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
  meals?: string[] // planned meals it was added for (list detail only)
  places?: { store: string | null; aisle: string | null }[] // where it's been kept, per store, newest first (shopping list detail only)
  pending?: boolean // client only: changed on this device, not on the server yet (offline)
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

/** Store -> its custom aisle walking order ('' = no store). */
export type AisleOrder = Map<string, string[]>
export const aisleOrderMap = (d: Pick<ListDetail, 'aisleOrder'>): AisleOrder => new Map((d.aisleOrder ?? []).map(o => [o.store ?? '', o.aisles]))
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Aisles within one store: its custom order first (when set), then natural order ("Aisle 2"
 * before "Aisle 10"); no aisle last. Same as the server's compareAisles. */
export function compareAisles(store: string | null, a: string | null, b: string | null, order: AisleOrder): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0
  const custom = order.get(store ?? '') ?? []
  const ia = custom.indexOf(a), ib = custom.indexOf(b)
  if (ia >= 0 || ib >= 0) return ia < 0 ? 1 : ib < 0 ? -1 : ia - ib
  return natural(a, b)
}

/** The server's item order (server/src/routes/lists.ts compareItems - keep in step). manual: open
 * items by priority, overdue first within each, then the hand-set order; priority: the same, then
 * soonest due; added: newest first; due: soonest, undated last; alpha: A-Z, ignoring case; aisle:
 * by store, then aisle (compareAisles), then A-Z. `today` is YYYY-MM-DD. A done item gets no
 * priority/overdue boost - unless keepChecked (checked items stay in place). */
export function compareItems(sortBy: ListSortBy, today: string, opts: { keepChecked?: boolean; aisleOrder?: AisleOrder } = {}) {
  const isDone = (i: ListItem) => i.done && !opts.keepChecked
  const rank = (i: ListItem) => (isDone(i) ? 2 : PRIORITY_RANK[i.priority] ?? 2)
  const overdue = (i: ListItem) => (!isDone(i) && i.dueDate && i.dueDate < today ? 0 : 1)
  const due = (a: ListItem, b: ListItem) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
  const manual = (a: ListItem, b: ListItem) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)
  const alpha = (a: ListItem, b: ListItem) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  const store = (a: ListItem, b: ListItem) => (a.store ?? '\uffff').localeCompare(b.store ?? '\uffff') // no store last
  return (a: ListItem, b: ListItem): number => {
    if (sortBy === 'added') return b.createdAt.localeCompare(a.createdAt) || b.sort - a.sort
    if (sortBy === 'due') return due(a, b) || manual(a, b)
    if (sortBy === 'alpha') return alpha(a, b) || manual(a, b)
    if (sortBy === 'aisle') return store(a, b) || compareAisles(a.store, a.aisle ?? null, b.aisle ?? null, opts.aisleOrder ?? new Map()) || alpha(a, b) || manual(a, b)
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

/** A name to autocomplete on a shopping list (remembered from past adds household-wide, or a recipe
 * ingredient with uses 0), most used first. key is the matching key (itemSuggest.ts itemKey). */
export interface ItemSuggestion {
  title: string
  key: string
  uses: number
  category?: string
  place?: { store: string; aisle: string | null }
}

/** GET /api/lists/{id} response. suggestions are the store/category/aisle values known anywhere
 * in the household (items and remembered places), for the item sheet's pickers. */
export interface ListDetail {
  list: List
  items: ListItem[]
  groups: ListGroup[]
  suggestions: { stores: string[]; categories: string[]; aisles: { store: string | null; aisle: string }[]; items?: ItemSuggestion[] }
  aisleOrder: { store: string | null; aisles: string[] }[] // stores with a custom aisle walking order
}

/** POST /api/lists/{id}/items body shape - store/category are OMITTED (not sent) unless the
 * user explicitly set them, so the server can fill them in from a remembered matching title. */
export interface ListItemInput {
  title: string
  notes?: string | null
  quantity?: string | null
  store?: string | null
  category?: string | null
  aisle?: string | null
  memberId?: string | null
  dueDate?: string | null
  eventId?: string | null
  priority?: ListItemPriority
  steps?: string[] // step titles, in order
}

/** PATCH /api/lists/{id}/items/{itemId}. aisleStore: on a shopping trip, the store `aisle` is at
 * (remembered there; the item takes it only if planned for that store or for anywhere). */
export type ListItemPatch = Partial<ListItem> & { aisleStore?: string }

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
  medicationNames: boolean // medicine names in medication reminders on this device (off: generic text)
}

/** One row of the in-app notification feed (GET /api/notifications). */
export interface AppNotification {
  id: string
  at: string
  kind: 'reminder' | 'summary' | 'chore' | 'list' | 'message' | 'goal' | 'medication'
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
export interface SnapshotChore { id: string; title: string; emoji: string | null; points: number; dueTime: string | null; date: string; done: boolean; pending?: boolean; doneBy: string | null; shared: boolean }
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
  meals: Meal[] // [] while Meals is off
  tomorrow: { date: string; events: SnapshotEvent[]; items: SnapshotItem[]; birthdays: SnapshotBirthday[]; meals: Meal[] } | null
  checkedIn: boolean // checked in today
  checkInPoints: number // what checking in earns; 0 = off
}
/** GET /api/board?days=N - the whole family's bulletin board, today through `to`. */
export interface Board {
  today: string
  to: string
  generatedAt: string
  weather: Weather | null // as /api/weather, days limited to the range
  events: SnapshotEvent[] // everyone's, sorted by start
  items: SnapshotItem[] // open items due by `to` (overdue first), plus urgent/high ones with no date
  chores: { memberId: string | null; name: string | null; avatar: string | null; color: string | null; remaining: number; total: number; pending?: number }[]
  birthdays: SnapshotBirthday[]
  meals: Meal[] // today through `to`; [] while Meals is off
}

/** A reviewed plugin, pinned to a version (GET /api/plugins/catalog). */
export interface PluginCatalogEntry {
  id: string
  repo: string // 'owner/repo'
  version: string
  name: string
  description: string
  emoji: string
  color?: string
  categories: string[]
  ages?: { min: number; max?: number }
}

/** An installed activity plugin (GET /api/plugins; server/src/routes/plugins.ts). */
export interface Plugin {
  id: string
  name: string
  version: string
  description: string
  entry: string
  emoji: string
  color?: string
  categories: string[]
  ages?: { min: number; max?: number }
  author?: string
  homepage?: string
  source: string | null // 'owner/repo' on GitHub, or null for an uploaded package
  enabled: boolean
  installedAt: string
  updatedAt: string
  url: string // /plugins/<id>/<entry>
}

/** GET /api/members/{id}/stats: a member profile's numbers (server/src/schemas.ts MemberStatsSchema). */
export type StatsPeriod = 'today' | 'week' | 'month' | 'year' | 'all'
export interface MemberStats {
  memberId: string
  period: StatsPeriod
  from: string
  to: string
  joined: string
  choresDone: number
  pointsEarned: number // chores plus daily check-ins
  checkIns: number // daily check-ins in the period
  previous: { from: string; to: string; choresDone: number; pointsEarned: number } | null
  pointsSpent: { stickers: number; rewards: number }
  streak: { current: number; best: number }
  chart: { key: string; count: number }[]
  busiestWeekday: number | null
  favoriteChore: { choreId: string; title: string; emoji: string | null; count: number } | null
  books: {
    finished: number
    pages: number
    minutesListened: number
    shelfScope: 'year' | 'all'
    shelf: { id: string; title: string; pages: number | null; minutes: number | null; rating: number | null; finishedOn: string }[]
    reading: { id: string; title: string; percent: number | null }[]
  }
  stickers: { packsOwned: number; packsTotal: number; placed: number }
  activities: { pluginId: string; name: string; emoji: string | null; seconds: number }[]
  badges: { id: string; emoji: string; title: string; earned: boolean }[]
  birthday: { date: string; daysUntil: number; turning: number | null } | null
}
