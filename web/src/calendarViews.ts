// The calendar's views, in switcher order, with the names and hints the view tabs and the phone's
// view sheet show.

export type ViewMode = 'week' | 'day' | 'month' | 'schedule' | 'board'

export const VIEW_MODES: readonly ViewMode[] = ['board', 'day', 'week', 'month', 'schedule']

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
