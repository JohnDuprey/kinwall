// Home's views, in switcher order, with the names and hints the view tabs and the phone's view
// sheet show. The switcher has four tabs, Board | Calendar | Schedule | Newscast; Calendar holds
// Day, Week (3 Day on a phone) and Month, and remembers which of them this device used last.
// Newscast goes when the family turns it off (Settings → Features).

import { format } from 'date-fns'

export type ViewMode = 'week' | 'day' | 'month' | 'schedule' | 'board' | 'newscast'
export type ViewTab = 'board' | 'calendar' | 'schedule' | 'newscast'
export type CalendarView = 'day' | 'week' | 'month'

export const VIEW_MODES: readonly ViewMode[] = ['board', 'day', 'week', 'month', 'schedule', 'newscast']
export const VIEW_TABS: readonly ViewTab[] = ['board', 'calendar', 'schedule', 'newscast']
/** The tabs this family has: Newscast only while it's on. */
export const viewTabs = (newscast: boolean) => newscast ? VIEW_TABS : VIEW_TABS.filter(t => t !== 'newscast')
export const CALENDAR_VIEWS: readonly CalendarView[] = ['day', 'week', 'month']

/** A phone's Week view shows 3 days, so it says so. */
export const viewLabel = (v: ViewMode, isPhone: boolean) => v === 'week' ? (isPhone ? '3 Day' : 'Week') : v[0].toUpperCase() + v.slice(1)

const HINTS: Record<ViewMode, string> = {
  board: 'Today and the week ahead',
  day: 'One day, hour by hour',
  week: 'The whole week, hour by hour',
  month: 'The month at a glance',
  schedule: 'The next 30 days as a list',
  newscast: 'What the family did and shared',
}

export const viewHint = (v: ViewMode, isPhone: boolean) => v === 'week' && isPhone ? '3 days side by side, hour by hour' : HINTS[v]

export const isCalendarView = (v: unknown): v is CalendarView => CALENDAR_VIEWS.includes(v as CalendarView)

/** The tab a view sits under: Day, Week and Month are all Calendar. */
export const tabOf = (v: ViewMode): ViewTab => isCalendarView(v) ? 'calendar' : v

/** The view a tab opens: Calendar opens the last calendar view used, and tapping it again while
 * one is showing keeps that one, except a day opened from the Week or Month grid (`origin`), which
 * goes back to that grid. */
export const viewForTab = (tab: ViewTab, current: ViewMode, last: CalendarView, origin: CalendarView | null = null): ViewMode =>
  tab !== 'calendar' ? tab : current === 'day' && origin ? origin : isCalendarView(current) ? current : last

/** Where a day opened by tapping it in a grid goes back to: Week or Month, else nowhere. */
export const dayOrigin = (from: ViewMode): CalendarView | null => from === 'week' || from === 'month' ? from : null

/** A Month day's accessible name: "Thursday, October 1: 4 events". */
export const monthDayLabel = (d: Date, count: number) =>
  `${format(d, 'EEEE, MMMM d')}: ${count === 0 ? 'no events' : `${count} event${count === 1 ? '' : 's'}`}`

const LAST_KEY = 'kinwall.calendarView'

/** The calendar view this device used last (Week when none, or storage is blocked). */
export function lastCalendarView(): CalendarView {
  try { const v = localStorage.getItem(LAST_KEY); return isCalendarView(v) ? v : 'week' } catch { return 'week' }
}

export function rememberCalendarView(v: CalendarView) {
  try { localStorage.setItem(LAST_KEY, v) } catch { /* storage blocked: Calendar opens Week */ }
}
