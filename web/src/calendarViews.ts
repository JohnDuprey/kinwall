// Home and Calendar's views, with the names and hints their switchers and the phone's view sheet
// show. Home (#/home) is Board | Newscast (Newscast goes when the family turns it off, Settings →
// Features). Calendar (#/calendar/<view>) is Day | Week (3 Day on a phone) | Month | Schedule, and
// remembers which of them this device used last.

import { LONG_DAY, formatDate, msg, t, tm, tn } from './i18n.ts'

export type HomeView = 'board' | 'newscast'
export type CalendarView = 'day' | 'week' | 'month' | 'schedule'
export type ViewMode = HomeView | CalendarView

export const HOME_VIEWS: readonly HomeView[] = ['board', 'newscast']
export const CALENDAR_VIEWS: readonly CalendarView[] = ['day', 'week', 'month', 'schedule']
export const VIEW_MODES: readonly ViewMode[] = [...HOME_VIEWS, ...CALENDAR_VIEWS]

/** A phone's Week view shows 3 days, so it says so. */
const LABELS: Record<ViewMode, string> = {
  board: msg('Board'), newscast: msg('Newscast'), day: msg('Day'), week: msg('Week'), month: msg('Month'), schedule: msg('Schedule'),
}
export const viewLabel = (v: ViewMode, isPhone: boolean) => v === 'week' && isPhone ? t('3 Day') : tm(LABELS[v])

const HINTS: Record<ViewMode, string> = {
  board: msg('Today and the week ahead'),
  day: msg('One day, hour by hour'),
  week: msg('The whole week, hour by hour'),
  month: msg('The month at a glance'),
  schedule: msg('The next 30 days as a list'),
  newscast: msg('What the family did and shared'),
}

export const viewHint = (v: ViewMode, isPhone: boolean) => v === 'week' && isPhone ? t('3 days side by side, hour by hour') : tm(HINTS[v])

export const isCalendarView = (v: unknown): v is CalendarView => CALENDAR_VIEWS.includes(v as CalendarView)
export const isHomeView = (v: unknown): v is HomeView => HOME_VIEWS.includes(v as HomeView)

/** Where a day opened by tapping it in a grid goes back to: Week or Month, else nowhere. */
export const dayOrigin = (from: ViewMode): 'week' | 'month' | null => from === 'week' || from === 'month' ? from : null

/** A Month day's accessible name: "Thursday, October 1: 4 events". */
export const monthDayLabel = (d: Date, count: number) =>
  count === 0 ? t('{day}: no events', { day: formatDate(d, LONG_DAY) }) : tn(count, '{day}: {n} event', '{day}: {n} events', { day: formatDate(d, LONG_DAY) })

const LAST_KEY = 'kinwall.calendarView'

/** The calendar view this device used last; before it has one (or with storage blocked), Schedule
 * on a phone and Week anywhere bigger. */
export function lastCalendarView(isPhone = false): CalendarView {
  const first = isPhone ? 'schedule' : 'week'
  try { const v = localStorage.getItem(LAST_KEY); return isCalendarView(v) ? v : first } catch { return first }
}

export function rememberCalendarView(v: CalendarView) {
  try { localStorage.setItem(LAST_KEY, v) } catch { /* storage blocked: Calendar opens its first view */ }
}

/** The view a Calendar link names (#/calendar/month), or null. */
export const linkedCalendarView = (hash: string): CalendarView | null => {
  const v = hash.split('?')[0].split('/')[2]
  return isCalendarView(v) ? v : null
}

/** Where a screen rests (idle reset, the Night screen, a link to a feature that's off): Home, or
 * Calendar on a display locked to one of its views (Calendar takes Home's spot there). */
export const restingHash = (lock: ViewMode | undefined) => isCalendarView(lock) ? '#/calendar' : '#/home'

/** A display with Lock view can't be bumped into another view: locked to Board or Newscast it has
 * no Calendar, and locked to a calendar view Calendar takes Home's place. */
export const lockedOut = (key: string, lock: ViewMode | undefined) =>
  isHomeView(lock) ? key === 'calendar' : isCalendarView(lock) ? key === 'home' : false

/** A nav item's to-approve badge (parent devices). Chores' To approve holds reward requests too, but
 * they count once: on Rewards (or the More that holds it) while Rewards is in the nav. */
export const navBadgeCount = (key: string, keys: string[], toApprove: number, rewardRequests: number) =>
  key === 'rewards' ? rewardRequests
    : key === 'chores' ? toApprove - (keys.includes('rewards') ? rewardRequests : 0)
    : 0

/** Where "Me" goes in the nav (an index into `keys`): after Chores on a kid's device, so it stays on
 * the phone's bottom bar; after Lists on a grown-up's own phone, where it heads the More list. */
export const meSlot = (keys: string[], kid: boolean) => {
  const after = kid ? keys.indexOf('chores') : Math.max(keys.indexOf('lists'), keys.indexOf('chores'))
  return after < 0 ? 1 : after + 1
}
