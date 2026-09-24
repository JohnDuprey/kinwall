// Shapes mirror SPEC.md "API". Assumption: JSON keys are camelCase throughout
// (SPEC shows this explicitly for EventInstance / chores/day; applied consistently here).

export type Theme = 'light' | 'dark'

export interface Settings {
  familyName: string
  timezone: string | null
  weekStart: 0 | 1
  theme: Theme
}

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
  memberId: string | null
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
}

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

export type KeyScope = 'admin' | 'display'

export interface ApiKey {
  id: string
  name: string
  prefix: string
  scope: KeyScope
  createdAt: string
  lastUsedAt: string | null
}

export interface Me {
  scope: KeyScope
  keyName: string
}

export interface Webhook {
  id: string
  url: string
  events: string[]
  enabled: boolean
  createdAt: string
}

export const MEMBER_PALETTE = [
  '#FF9E7A', '#FFD166', '#7ED9A6', '#7AB8FF', '#B39DFF',
  '#FF8FA3', '#8FE0D6', '#FFB6D9', '#C7E27A', '#A0AEC0',
]

export const MEMBER_EMOJI = ['🦊', '🐻', '🐱', '🐶', '🐰', '🦁', '🐼', '🦄', '🐨', '🐵']

/** First palette color not already in use (by members/calendars), so a new calendar with no
 * explicit color doesn't fall back to the server's grey #888. Cycles back to the first color
 * once the palette is exhausted. */
export function nextPaletteColor(usedColors: (string | null | undefined)[]): string {
  const taken = new Set(usedColors.filter(Boolean))
  return MEMBER_PALETTE.find(c => !taken.has(c)) ?? MEMBER_PALETTE[0]
}
