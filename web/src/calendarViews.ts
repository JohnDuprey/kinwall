// The calendar's views, in switcher order, with the names and hints the view tabs and the phone's
// view sheet show. The switcher has three tabs, Board | Calendar | Schedule; Calendar holds Day,
// Week (3 Day on a phone) and Month, and remembers which of them this device used last.

export type ViewMode = 'week' | 'day' | 'month' | 'schedule' | 'board'
export type ViewTab = 'board' | 'calendar' | 'schedule'
export type CalendarView = 'day' | 'week' | 'month'

export const VIEW_MODES: readonly ViewMode[] = ['board', 'day', 'week', 'month', 'schedule']
export const VIEW_TABS: readonly ViewTab[] = ['board', 'calendar', 'schedule']
export const CALENDAR_VIEWS: readonly CalendarView[] = ['day', 'week', 'month']

/** A phone's Week view shows 3 days, so it says so. */
export const viewLabel = (v: ViewMode, isPhone: boolean) => v === 'week' ? (isPhone ? '3 Day' : 'Week') : v[0].toUpperCase() + v.slice(1)

const HINTS: Record<ViewMode, string> = {
  board: 'Today and the week ahead',
  day: 'One day, hour by hour',
  week: 'The whole week, hour by hour',
  month: 'The month at a glance',
  schedule: 'The next 30 days as a list',
}

export const viewHint = (v: ViewMode, isPhone: boolean) => v === 'week' && isPhone ? '3 days side by side, hour by hour' : HINTS[v]

export const isCalendarView = (v: unknown): v is CalendarView => CALENDAR_VIEWS.includes(v as CalendarView)

/** The tab a view sits under: Day, Week and Month are all Calendar. */
export const tabOf = (v: ViewMode): ViewTab => isCalendarView(v) ? 'calendar' : v

/** The view a tab opens: Calendar opens the last calendar view used, and tapping it again while
 * one is showing keeps that one. */
export const viewForTab = (tab: ViewTab, current: ViewMode, last: CalendarView): ViewMode =>
  tab !== 'calendar' ? tab : isCalendarView(current) ? current : last

const LAST_KEY = 'kinwall.calendarView'

/** The calendar view this device used last (Week when none, or storage is blocked). */
export function lastCalendarView(): CalendarView {
  try { const v = localStorage.getItem(LAST_KEY); return isCalendarView(v) ? v : 'week' } catch { return 'week' }
}

export function rememberCalendarView(v: CalendarView) {
  try { localStorage.setItem(LAST_KEY, v) } catch { /* storage blocked: Calendar opens Week */ }
}
