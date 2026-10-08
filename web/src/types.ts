import type { CalendarFilter } from './calendarFilter.ts'
import type { BoardPreset } from './boardLayout.ts'
import type { DeviceKind } from './wallScreen.ts'
import type { CustomScheme } from './skins.ts'
import type { Meal } from './meal-types.ts'
import type { TransitionReminders } from './transitions.ts'
import type { SaverSource } from './useTheme.ts'
import type { ClockPos } from './nightClock.ts'
// Shapes mirror SPEC.md "API". Assumption: JSON keys are camelCase throughout
// (SPEC shows this explicitly for EventInstance / chores/day; applied consistently here).

export type ThemeMode = 'light' | 'dark' | 'auto' | 'scheduled'
export type BackgroundLight = 'warm' | 'white' | 'gray' | 'sage'
/** A skin id from skins.ts, or 'seasonal' (the scheme follows the date). */
export type ColorScheme = 'meadow' | 'field' | 'autumn' | 'winter' | 'spring' | 'summer' | 'ocean' | 'midnight' | 'lavender' | 'harvest' | 'festive' | 'slate' | 'ink' | 'sage' | 'eucalyptus' | 'peacock' | 'graphite' | 'berry' | 'seasonal' | `custom-${string}`
export type CustomColors = { accent?: string; bg?: string; card?: string; text?: string }
export type BackgroundDark = 'cocoa' | 'charcoal' | 'midnight'
export type TextScale = 's' | 'm' | 'l' | 'xl'
/** 'default' is Nunito; see typeface.ts. */
export type Typeface = 'default' | 'hyperlegible' | 'dyslexia' | 'modern' | 'playful' | 'storybook' | 'handwritten'
/** Clock times: 'auto' follows the device's locale; see timeFormat.ts. */
export type TimeFormat = 'auto' | '12' | '24'
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
  quietFrom: string | null // night hours, HH:MM (once called quiet hours); both null = no night hours
  quietTo: string | null
  nightRest?: boolean // wall screens show the Night screen during night hours; absent (older servers) = on
  nightHoldReminders?: boolean // reminders wait out the night hours (wallScreen.ts remindersHeld); absent = on
  darkWithNight?: boolean // scheduled dark mode uses the night hours (the server then reports them as darkFrom / darkTo)
  quietPin: boolean // a PIN is needed to wake a wall screen during night hours (never the PIN itself)
  accent: string // hex; DEFAULT_ACCENT (useTheme.ts) = the color scheme's own accent
  colorScheme: ColorScheme
  customColors: Omit<CustomColors, 'accent'> | null // legacy: household surfaces over the scheme (the app no longer sets these)
  customSchemes: CustomScheme[] // the family's saved schemes, pickable by id in colorScheme / a device's skin
  backgroundLight: BackgroundLight
  backgroundDark: BackgroundDark
  textScale: TextScale
  density: Density
  typeface: Typeface // the family's; a device can pick its own
  timeFormat: TimeFormat // the family's; a device can pick its own
  defaultCalendarId?: string | null // a parent's pick for new events; null: the server picks (CalendarEntry.default)
  defaultEventMinutes?: number // how long a new event lasts once its start is picked (60 unless changed)
  defaultReminderMinutes: number[]
  lateCompletionCredit: number // 0-100: % of points a chore earns when ticked off for a past day
  streakGraceDays: number // 0-3 missed days per rolling week a streak survives
  checkInPoints: number // daily check-in points (0 = off; 1, 2, 3, 5 or 10)
  leaderboardEnabled: boolean // false: hide the leaderboard, crowns and rank badges
  stickersEnabled: boolean // false: hide the sticker book (and the shop refuses purchases)
  rewardsEnabled: boolean // false: hide Rewards and reward goals (requests answer 403); needs features.chores (rewardsOn)
  stickerPriceScale: number // percent applied to sticker pack prices; 0 = all free
  location: WeatherLocation | null // for the snapshot's weather; null = no weather
  temperatureUnit: 'celsius' | 'fahrenheit'
  tidbits: TidbitSettings // the Board's quote / fact card
  nightLook: NightLook // what wall screens show during night hours unless a screen picks its own (saverSources.ts)
  boardPresets: BoardPreset[] // Board layouts a parent saved for the family (boardLayout.ts)
  features: Features // Settings → Features: what the family uses; off = hidden on every screen
  mealTimes: Record<'breakfast' | 'lunch' | 'dinner' | 'snack', string> // HH:MM each meal usually is; a meal without its own time uses it on the calendar
  aiHealthAccess: boolean // false (default): MCP and connected apps can't see or change the Health tracker
  medications: boolean // Medication reminders (off by default; only on with the Health tracker); off hides them everywhere, data kept
  medicationNamesOnWalls: boolean // shared wall screens show medicine names (off: "Meds")
  newscastNotFeatured?: string[] // members whose chores, photos, books and so on stay out of Newscast; absent (older servers) = none
  newscastPostingPaused?: string[] // members who can't post in Newscast for now (a parent turns it back on)
  googlePhotos?: GooglePhotosState // Google Photos for the Night screen and the Board (read-only)
}

/** The family's Night screen: pictures to take turns through (none = the plain clock) and the clock. */
export interface NightLook {
  sources: SaverSource[]
  every: 2 | 5 | 10 | 20 // minutes between pictures
  brightness: 'low' | 'medium'
  clock: boolean // the small clock over the pictures
  clockPosition: ClockPos | null // null = moves around (burn-in guard)
}

/** Household feature switches. Off hides the feature everywhere; its data is kept. */
export interface Features {
  chores: boolean // Chores tab, points, rewards, sticker book, chore nudges (the leaderboard, sticker shop and rewards have their own switches too)
  lists: boolean // Lists tab, "Due soon", an event's linked items, list-update notifications
  contacts: boolean // Contacts tab and household contacts directory
  paint: boolean // Activities → Paint
  photos: boolean // family photos (Activities → Photos, Newscast, memories, the Board and Night screen); Google Photos and nature still show
  notes: boolean // notes on events and list items
  messages: boolean // sending family messages (the bell's Send a message)
  // Trackers, one switch per kind; the Trackers tab goes when all three are off
  trackersReading: boolean
  trackersMemories: boolean
  trackersHealth: boolean
  meals: boolean // Meals tab, the Board's meals card, meals in the daily summary
  newscast: boolean // Home's Newscast tab (with its routes)
  polls: boolean // Family polls: the Board card, the Polls sheet, poll notifications (their routes answer 404 while off)
  checkIns: boolean // Temp check, goal checks, the energy battery, journals and Insights; check-in points need it too
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
  coverUrl?: string // public https; shown through GET /api/trackers/{id}/cover
  log?: ReadingDay[] // read each day (the server keeps it as progress changes)
  bookId?: string // started from a library book (LibraryBook)
}
/** The family's library (GET /api/library): books owned, apart from who's reading what. */
export type LibraryFormat = 'book' | 'audiobook' // each its own item: a paper copy and an audiobook of one title are two
export type LibraryShelf = 'kids' | 'grownups' | 'everyone' // everyone's books are on both shelves
export interface LibraryBook {
  id: string; format?: LibraryFormat; title: string; author: string | null; isbn: string | null; pages: number | null; coverUrl: string | null
  year: number | null; series: string | null; seriesNumber: string | null; lexile: number | null; description: string | null; genres: string[]
  workKey?: string | null; ratingsAverage?: number | null; ratingsCount?: number | null // from Open Library (looked up after it's added)
  lookedUpAt?: string | null // when its details were last looked up, found or not
  location: string | null; lentTo: string | null; lentOn: string | null // where it lives; who has it on loan, since when
  wanted?: boolean // on the wishlist: wanted, not had yet
  shelf?: LibraryShelf | null // who it's for, as a parent picked; null is Auto
  effectiveShelf?: LibraryShelf // the shelf it's on: its shelf, else the server's Auto (kids or grownups)
  borrowedFrom: string | null; dueOn: string | null; returnedOn: string | null // borrowed, not owned: who from, due back when; returned ones stay as history
  addedBy: Actor | null; readers: { entryId: string; memberId: string | null; status: ReadingStatus; readAt?: string | null; narrator?: string | null; minutesListened?: number | null; totalMinutes?: number | null }[]; createdAt: string; updatedAt: string
}
export type LibraryBookInput = Partial<Omit<LibraryBook, 'id' | 'addedBy' | 'readers' | 'createdAt' | 'updatedAt' | 'workKey' | 'ratingsAverage' | 'ratingsCount' | 'lookedUpAt' | 'effectiveShelf'>> & { workKey?: string }
export interface ReadingDay { date: string; amount: number } // pages for a book, minutes for an audiobook
/** A book lookup result (GET /api/books/search, from Open Library). */
export interface BookResult {
  title: string; author?: string; year?: number; pages?: number; coverId?: number; coverUrl?: string
  isbn?: string; series?: string; seriesNumber?: string; lexile?: number; genres?: string[]; workKey?: string
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
/** Rewards are on: their own switch (Family → Chores), and chores and points. */
export const rewardsOn = (s: Pick<Settings, 'features' | 'rewardsEnabled'>) => s.features.chores && s.rewardsEnabled
/** Create/edit body: data fields set to null are cleared on edit. */
export interface TrackerInput { kind?: TrackerKind; memberId?: string | null; date?: string; title?: string | null; photoId?: string | null; photoFamily?: boolean; data?: Record<string, unknown>
  logDay?: { date: string; amount: number } } // a book's reading on an earlier day (replaces that day; the page moves by the difference)

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
export type Appearance = Pick<Settings, 'themeMode' | 'darkFrom' | 'darkTo' | 'accent' | 'colorScheme' | 'customColors' | 'customSchemes' | 'backgroundLight' | 'backgroundDark' | 'textScale' | 'density' | 'typeface'>

export interface Member {
  id: string
  name: string
  color: string
  avatar: string
  picture?: string | null // their profile picture's image path (api.pictureUrl); avatar + color are the fallback and ring
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
  privateJournal?: { on: boolean; allowed: boolean } // new entries private (only their own devices read the words); allowed: grown-ups always, kids when a parent allows it
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
  followupHidden?: boolean // their goal-check notes are private and this device isn't theirs (followup has the outcome, notes null)
  followupOpen: boolean // showing now: on, a goal set today, past their eveningTime
  drained?: Drained | 'skip' | null // null on a shared wall or another member's device (private)
  drainedOpen?: boolean // showing now: battery on, past their eveningTime (or last night's, still open), their own device or a parent's
  lastNight?: { date: string; pending: boolean } | null // today's only: last night's check-in is still open (until noon, their morning Temp check or a skip); pending: something unanswered
}
export type TempCheckInput = Partial<{ sleep: string | null; feelings: string[] | null; goal: string | null; goalSkipped: boolean; custom: string[]; followup: { outcome: FollowupOutcome; helped?: string | null; hindered?: string | null; next?: string | null }; drained: Drained | 'skip'; lastNightSkipped: true }>

/** GET /api/members/{id}/journal: their own device and parents' devices only. */
/** text is null when the entry is private and this device isn't theirs (the mood still shows). */
export interface JournalEntry { id: string; memberId: string; date: string; text: string | null; mood: string | null; private?: boolean; createdAt: string; updatedAt: string }
export interface JournalDay {
  date: string
  tempCheck: { sleep: string | null; feelings: string[] | null; goal: string | null; goalSkipped: boolean; followup: GoalFollowup | null; followupHidden?: boolean } | null
  entries: JournalEntry[]
}
/** on: new entries are private; allowed: they may keep one; mine: this device is theirs; canChange: mine and allowed. */
export interface JournalPrivacy { on: boolean; allowed: boolean; mine: boolean; canChange: boolean }
export interface Journal { memberId: string; from: string; to: string; privacy?: JournalPrivacy; days: JournalDay[] }
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
/** lateWindow: how late a dose can be taken ('3h' default, 'evening' until 8 PM, 'endOfDay', 'none': the card stays 1 hour). */
export type LateWindow = '3h' | 'evening' | 'endOfDay' | 'none'
/** A dose time: 'HH:MM', or "When I start my day", due when their day starts (by `latest` at the latest). */
export type MedTime = string | { wake: true; latest: string }
/** Refill details (sealed with the medicine): where to ask (contactId: a contact), and what the message says. remindOn: a day that opens a refill request by itself. */
/** pharmacyContactId: a family contact as the pharmacy; pharmacy: its name typed, used when there's no contact. */
export interface MedicationRefill { contactId: string | null; pharmacyContactId: string | null; pharmacy: string; dateOfBirth: string | null; callback: string; remindOn: string | null }
/** An open "Request refill" to-do, since `at`. */
export interface RefillRequest { at: string; by: string | null }
export interface Medication { id: string; memberId: string; name: string; dose: string; times: MedTime[]; days: number[]; endDate: string | null; totalDoses: number | null; lateWindow: LateWindow; dosesLeft: number | null; refill: MedicationRefill; refillRequest: RefillRequest | null; createdAt: string; updatedAt: string }
export type MedicationInput = { memberId: string; name: string; dose: string; times: MedTime[]; days: number[]; endDate?: string | null; totalDoses?: number | null; lateWindow?: LateWindow; refill?: Partial<MedicationRefill> }
/** GET /api/medications/{id}/refill: the refill card, with the message filled in. */
export interface RefillCard { medicationId: string; memberId: string; contact: { id: string; name: string; phones: { label: string; number: string; steps: string; telUri: string | null }[]; websites: { label: string; url: string }[] } | null; pharmacy: { name: string; contactId: string | null; phone: string | null; telUri: string | null; address: string | null } | null; script: string; request: RefillRequest | null }
export type DoseStatus = 'taken' | 'skipped' | 'due' | 'missed' | 'upcoming'
/** GET /api/medications/due: the Take now cards. name/dose null on a shared wall with names off ("Meds"). */
/** time: 'HH:MM', or 'wake' for "When I start my day" (startedAt: when their day started, null if the latest time came first). until: when its late window closes. */
export interface DueDose { medicationId: string; memberId: string; date: string; time: string; dueAt: string; startedAt: string | null; until: string; name: string | null; dose: string | null }
export interface MedicationsDue { names: boolean; doses: DueDose[] }
export interface MedicationDose { medicationId: string; date: string; time: string; status: DoseStatus; startedAt: string | null; at: string | null; late: boolean; by: string | null; snoozedUntil: string | null }
/** GET /api/members/{id}/medications: their own device and parents' devices only. days oldest first. */
export interface MedicationHistory {
  memberId: string
  today: string
  medications: Medication[]
  days: { date: string; doses: { medicationId: string; time: string; dueAt: string; status: DoseStatus; startedAt: string | null; at: string | null; late: boolean; by: string | null }[] }[]
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
  default?: boolean // new events go here unless another is picked (settings.defaultCalendarId, or the server's fallback)
  lastSyncedAt: string | null
  lastError: string | null
  lastErrorCode?: string | null // 'revoked': Google or Microsoft turned down the sign-in; only reconnecting fixes it
  syncFailures?: number // failed syncs in a row; 0 after a good one
  needsReconnect?: boolean // imported placeholder: settings kept, not syncing until reconnected
  filter?: CalendarFilter // which events the family sees (calendarFilter.ts); absent = all
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
  busy?: boolean // Show as: false = free (never Now/Next, no leave-by or transition warnings); missing = busy
  prepAt?: string | null // a meal's event: when to start prep (server/src/prepBy.ts); GET /api/events only
  cookId?: string | null // a meal's event: who's cooking, the one the prep countdown is for
  /** The planned meal it's linked to (GET /api/events only), for the calendar's 🍽 marker; meal-date.ts mealEventStatus. */
  meal?: { id: string; status: 'planned' | 'prepared'; mealKind: 'recipe' | 'freeform' | 'dining_out'; restaurantId: string | null; eaterCount: number; orderCount: number } | null
  hidden?: 'event' | 'series' | 'filter' | null // why the family doesn't see it (only with includeHidden, on parents' devices)
}

/** GET /api/calendars/{id}/hidden: an event (or series) hidden from the family, for Show again. */
export interface HiddenEvent { id: string; calendarId: string; scope: 'occurrence' | 'series'; title: string; start: string; allDay: boolean; createdAt: string }

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
  dueTime: string | null // start time, "HH:MM"
  active: boolean
  sort: number
  listId: string | null // checklist: a list that must be fully ticked before the chore can be completed
  pluginId: string | null // activity: playing this plugin for pluginMinutes a day completes the chore
  pluginMinutes: number | null
  needsApproval?: boolean | null // ticks from wall screens and kids' devices wait for a parent's OK; null = the person's default
  approveTimedPlay?: boolean // activity chores: timed play waits for an OK too (auto-approves otherwise)
  libraryId?: string | null // made from this chore library item
  timerMinutes?: number | null // Start runs the app's timer this long (ChoreTimer.tsx)
}

/** A saved chore in the chore library (server: routes/chore-library.ts). Parent devices only. */
export type LibraryUnit = 'day' | 'week' | 'month'
export interface LibraryChore {
  id: string
  title: string
  emoji: string | null
  points: number
  listId: string | null
  memberId: string | null // suggested person
  everyN: number | null // "about every everyN everyUnit": a soft interval for nudges, not a schedule
  everyUnit: LibraryUnit | null
  needsApproval: boolean | null
  notes: string | null
  createdAt: string
  lastDone: { date: string; memberId: string | null } | null
  lastMemberId: string | null // who the last chore made from it went to ("Again")
  timesAssigned: number
  open: { choreId: string; dueDate: string | null; memberId: string | null; repeats: boolean } | null
}
export type LibraryChoreInput = Partial<Pick<LibraryChore, 'title' | 'emoji' | 'points' | 'listId' | 'memberId' | 'everyN' | 'everyUnit' | 'needsApproval' | 'notes'>> & { fromChoreId?: string }

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
/** Bonus points a parent gave outside a chore (reason 'bonus' in the points ledger). */
export interface PointAward { id: string; memberId: string; points: number; note: string | null; date: string; at: string }
/** One points-ledger row (GET /api/members/{id}/points): a bonus, a check-in, a sticker pack or reward (negative). */
export interface PointEntry { id: string; memberId: string; amount: number; reason: string; ref: string | null; at: string; note?: string | null }

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
  drawing?: boolean // a Paint drawing saved to the family photos
}
/** One of the family's own coloring pages for Paint (server: routes/photos.ts): line art, a PNG at `url`. */
export interface FamilyColoringPage {
  id: string
  name: string
  width: number
  height: number
  createdAt: string
  url: string
}
/** Newscast (server: routes/newscast.ts): what the family did and shared, one item per person per kind per day. */
export type NewscastKind = 'post' | 'chores' | 'reward' | 'photos' | 'drawings' | 'book' | 'memory' | 'birthday'
export type NewscastReaction = '👏' | '❤️' | '🎉'
export interface NewscastItem {
  key: string // stable: post:<id>, chores:<member>:<date>, ...
  kind: NewscastKind
  date: string // household day
  at: string | null
  memberId: string | null // who it's about or who posted; null = the family
  emoji: string
  title: string // one plain sentence; a post's text
  detail: string | null
  count: number // chores, photos or drawings it groups; 1 otherwise
  photos: { id: string; url: string }[]
  post: { id: string; text: string | null; emoji: string | null; audience: 'everyone' | 'grownups'; removed: boolean } | null
  reactions: { emoji: NewscastReaction; memberIds: string[] }[]
}
export interface Newscast { today: string; from: string; to: string; earlier: boolean; items: NewscastItem[] }
export interface NewscastPostInput { text: string; emoji?: string | null; photoId?: string | null; audience?: 'everyone' | 'grownups'; memberId?: string }
/** count and bytes include memoryPhotos (memories' own photos count toward storage too). */
export type GooglePhotosState = 'off' | 'signing-in' | 'choosing' | 'ready' | 'reconnect' | 'refused'
/** GET /api/google-photos. Codes and links only on parent devices. */
export interface GooglePhotos {
  available: boolean // this server has a Google Photos client
  state: GooglePhotosState
  flow?: 'web' | 'device' // web: the Calendar client's consent page (authUrl); device: a code at verificationUrl
  authUrl?: string
  userCode?: string // signing-in: entered at verificationUrl
  verificationUrl?: string
  codeExpiresAt?: string
  settingsUri?: string // Google Photos' page for picking this family's albums
  photos?: number
  account?: { name: string | null; email: string } // parent devices: the Google account it's connected to (missing on older connections)
}

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
  kind?: DeviceKind | 'widgets' | null // what the device is (wallScreen.ts deviceKindOf); null when nobody's said
  parentKeyId?: string | null // widgets: the key that made them (wallScreen.ts widgetParent)
  parentGrantId?: string | null // widgets: the Kinwall app sign-in that made them
}

export interface Passkey {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  transports?: string[] // as reported by the authenticator at registration
  owner?: string | null // the grown-up it belongs to (its sign-ins read their private journal)
}

export interface Me {
  scope: KeyScope
  keyName: string
  kind: 'api' | 'session' | 'oauth'
  owner?: string | null // who this device belongs to (see ApiKey.owner); set by an admin only
  locked?: boolean // the owner locks the family filter (everyday access only; a parent's device never is)
  deviceKind?: DeviceKind | 'widgets' | null // what an admin says this device is (ApiKey.kind)
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
  skipped: { passkeys: number; webhooks: number; grownUp?: { id: string; name: string }[] } // grownUp: kept as grown-ups (only they can mark themselves a kid)
}

/** One line of Settings → Access → Security activity (GET /api/security-events). */
export interface SecurityEvent {
  id: string
  at: string
  kind: string // 'passkey.added', 'signin.recovery', 'device.paired', …
  summary: string
  by: Actor | null
  device: string | null
  detail: Record<string, string | number | boolean | null> | null
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
/** A shopping list's type (and its catalog): Groceries or other Shopping. */
export type ListCatalog = 'groceries' | 'shopping'
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
  catalog?: ListCatalog | null // shopping lists: Groceries or Shopping, each with its own catalog (older servers leave it out: groceries)
  isDefault?: boolean // the family's default list for its type: barcode scans, meal ingredients, widgets, Siri and tiles use it
  sort: number
  archived: boolean
  createdAt: string
  itemCount: number // computed
  openCount: number // computed
  overdueCount?: number // computed: open items due before today (older servers leave it out)
  lastDoneAt?: string | null // reusable lists: last reset with something ticked, or its chore done (older servers leave it out)
  lastDoneBy?: Actor | null
}

/** Who did something on a list: a family member, or a device or app that is nobody's ("Kitchen wall", "Assistant"). */
export type Actor = { memberId?: string; label?: string }

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
  forMemberIds?: string[] // who it's for (a gift, a watch band); [] = everyone. Optional: cached items from before 0108 lack it
  dueDate: string | null // YYYY-MM-DD
  eventId: string | null // linked calendar event (series id for a recurring local event)
  priority: ListItemPriority // open urgent/high items sort first, low last (see compareItems)
  done: boolean
  doneAt: string | null
  doneBy: string | null // the member who checked it off (checkedBy says more)
  addedBy?: Actor | null // who added it / checked it off; older servers and older items leave them out
  checkedBy?: Actor | null
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
  addedBy?: Actor | null
  checkedBy?: Actor | null
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

/** The grocery catalog (GET /api/lists/remembered): an item the family has added before, its
 * department and where it's found at each store. key is its matching key (itemSuggest.ts itemKey). */
export interface RememberedItem {
  key: string
  title: string
  uses: number // adds to a shopping list; 0 = only in the catalog
  lastUsed: string | null
  category: string | null // department
  places: { store: string; aisle: string | null; updatedAt: string }[] // A-Z by store
  lastStore: string | null // where a new add goes
  tags: string[] // the family's own categories ("Breakfast", "Lunchbox"), not the department
}
/** PUT /api/lists/remembered/{key} (and POST, with title): only given fields change; places replaces its stores. */
export interface RememberedItemInput {
  title?: string
  category?: string | null
  places?: { store: string; aisle: string | null }[]
  tags?: string[] // replaces its categories
}

/** GET /api/lists/{id} response. suggestions are the store/category/aisle values known anywhere
 * in the household (items and remembered places), for the item sheet's pickers. */
export interface ListDetail {
  list: List
  items: ListItem[]
  groups: ListGroup[]
  suggestions: { stores: string[]; categories: string[]; aisles: { store: string | null; aisle: string }[]; items?: ItemSuggestion[] }
  aisleOrder: { store: string | null; aisles: string[] }[] // stores with a custom aisle walking order
  /** With ?store= (a one-store trip): the other type's shopping lists' items for that store, walked on
   * the same trip; tick and check them out on their own list (listId). */
  alsoAtStore?: (ListItem & { listName: string })[]
}

/** POST /api/lists/{id}/items body shape - store/category are OMITTED (not sent) unless the
 * user explicitly set them, so the server can fill them in from a remembered matching title. */
export interface ListItemInput {
  id?: string // client-made (a UUID): a retried add doesn't duplicate; also lets a tick follow the add
  title: string
  notes?: string | null
  quantity?: string | null
  store?: string | null
  category?: string | null
  aisle?: string | null
  memberId?: string | null
  forMemberIds?: string[] // who it's for; [] = everyone
  dueDate?: string | null
  eventId?: string | null
  priority?: ListItemPriority
  steps?: string[] // step titles, in order
  barcode?: string // scanned: remembered as this item's name for the barcode (shopping lists)
}
/** GET /api/lists/{id}/barcodes/{code}: what the family called it last time, else Open Food Facts. */
export interface BarcodeLookup { title: string; source: 'family' | 'openfoodfacts' | 'openproductsfacts' | 'openbeautyfacts' | 'openpetfoodfacts' }

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
 * explicit color doesn't fall back to the server's gray #888. Cycles back to the first color
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
  kind: 'reminder' | 'summary' | 'chore' | 'list' | 'message' | 'goal' | 'medication' | 'privacy' | 'meal' | 'poll'
  title: string
  body: string | null
  url: string | null // '/#/calendar?event=…', '/chores', '/lists', '/' - same deep link a push opens
  memberIds: string[]
  source: string | null
  removable?: boolean // may this device remove it (older servers don't say)
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
export interface TimedChore { id: string; title: string; emoji: string | null; memberId: string | null; dueTime: string | null; timerMinutes: number | null; done: boolean; pending: boolean }

export interface Board {
  today: string
  to: string
  generatedAt: string
  weather: Weather | null // as /api/weather, days limited to the range
  events: SnapshotEvent[] // everyone's, sorted by start
  items: SnapshotItem[] // open items due by `to` (overdue first), plus urgent/high ones with no date
  chores: { memberId: string | null; name: string | null; avatar: string | null; color: string | null; remaining: number; total: number; pending?: number }[]
  timedChores?: TimedChore[] // today's chores with a start time or a timer: rows of their own on Today
  birthdays: SnapshotBirthday[]
  meals: Meal[] // today through `to`; [] while Meals is off
  booksDue: { id: string; title: string; borrowedFrom: string; dueOn: string; date: string; overdue: boolean }[] // borrowed library books due back; date: the board day (overdue ones show today)
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
  actions?: Record<string, { description: string; input: { type: 'object'; properties: Record<string, { type: string; description?: string }>; required: string[] } }>
  source: string | null // 'owner/repo' on GitHub, or null for an uploaded package
  enabled: boolean
  reviewed?: boolean // from the reviewed catalog: updates only to its versions, never once taken off it
  installedAt: string
  updatedAt: string
  url: string // /plugins/<id>/<entry>
}

/** A queued plugin action (GET /api/plugins/{id}/actions/pending): what another app asked the plugin to do. */
export interface PluginActionItem { id: string; action: string; input: Record<string, unknown>; member: string; createdAt: string }

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

// Family polls (server: routes/polls.ts). A choice is a typed idea, a recipe or a restaurant from the
// binder; votes: the member ids who picked it.
export interface PollOption { id: string; label: string; recipeId: string | null; restaurantId: string | null; sort: number; votes: string[] }
export interface Poll {
  id: string; question: string; date: string | null; slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null
  status: 'open' | 'closed'; winnerOptionId: string | null; mealId: string | null
  createdBy: string | null; createdAt: string; closedAt: string | null; options: PollOption[]
}
export interface PollInput { question: string; date?: string | null; slot?: Poll['slot']; options: { label?: string; recipeId?: string; restaurantId?: string }[] }
