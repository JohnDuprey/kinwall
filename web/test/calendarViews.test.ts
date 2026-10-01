// node --test test/ (npm test). The calendar's views: names and one-line hints for the phone's view sheet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CALENDAR_VIEWS, VIEW_MODES, VIEW_TABS, dayOrigin, lastCalendarView, monthDayLabel, rememberCalendarView, tabOf, viewForTab, viewHint, viewLabel, viewTabs } from '../src/calendarViews.ts'

test('views run Board, Day, Week, Month, Schedule, Newscast; Week is 3 Day on a phone', () => {
  assert.deepEqual(VIEW_MODES.map(v => viewLabel(v, false)), ['Board', 'Day', 'Week', 'Month', 'Schedule', 'Newscast'])
  assert.deepEqual(VIEW_MODES.map(v => viewLabel(v, true)), ['Board', 'Day', '3 Day', 'Month', 'Schedule', 'Newscast'])
})

test('every view has a short hint, and 3 Day says three days', () => {
  for (const v of VIEW_MODES) for (const phone of [true, false]) {
    const h = viewHint(v, phone)
    assert.ok(h.length > 0 && h.length <= 40, `${v}: ${h}`)
  }
  assert.match(viewHint('week', true), /3 days/)
  assert.match(viewHint('week', false), /week/)
})

test('four tabs, Board | Calendar | Schedule | Newscast; Day, Week and Month sit under Calendar', () => {
  assert.deepEqual(VIEW_TABS, ['board', 'calendar', 'schedule', 'newscast'])
  assert.deepEqual(VIEW_MODES.map(tabOf), ['board', 'calendar', 'calendar', 'calendar', 'schedule', 'newscast'])
  assert.deepEqual(viewTabs(true), VIEW_TABS)
  assert.deepEqual(viewTabs(false), ['board', 'calendar', 'schedule'], 'Newscast turned off: no tab')
  assert.equal(viewForTab('newscast', 'week', 'month'), 'newscast')
  assert.deepEqual(CALENDAR_VIEWS, ['day', 'week', 'month'])
})

test('Calendar opens the last calendar view, and tapping it again keeps the one showing', () => {
  assert.equal(viewForTab('calendar', 'board', 'month'), 'month')
  assert.equal(viewForTab('calendar', 'schedule', 'day'), 'day')
  assert.equal(viewForTab('calendar', 'week', 'month'), 'week') // already open: no jump
  assert.equal(viewForTab('board', 'week', 'month'), 'board')
  assert.equal(viewForTab('schedule', 'day', 'day'), 'schedule')
})

test('the last calendar view is kept per device; Week when none, junk or blocked storage', () => {
  const store = new Map<string, string>()
  const g = globalThis as { localStorage?: unknown }
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  try {
    assert.equal(lastCalendarView(), 'week')
    rememberCalendarView('month')
    assert.equal(lastCalendarView(), 'month')
    store.set('kinwall.calendarView', 'board')
    assert.equal(lastCalendarView(), 'week')
    g.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    rememberCalendarView('day')
    assert.equal(lastCalendarView(), 'week')
  } finally { delete g.localStorage }
})

test('a day opened from the Week or Month grid remembers where it came from', () => {
  assert.equal(dayOrigin('month'), 'month')
  assert.equal(dayOrigin('week'), 'week')
  assert.equal(dayOrigin('day'), null)
  assert.equal(dayOrigin('schedule'), null)
  assert.equal(dayOrigin('board'), null)
})

test('the Calendar tab on a day opened from Month goes back to Month; a picked Day stays', () => {
  assert.equal(viewForTab('calendar', 'day', 'month', 'month'), 'month')
  assert.equal(viewForTab('calendar', 'day', 'week', 'week'), 'week')
  assert.equal(viewForTab('calendar', 'day', 'day', null), 'day')
  assert.equal(viewForTab('calendar', 'month', 'month', null), 'month')
  assert.equal(viewForTab('board', 'day', 'month', 'month'), 'board')
})

test('a month day reads as its date and how many events it has', () => {
  const thu = new Date(2026, 9, 1)
  assert.equal(monthDayLabel(thu, 4), 'Thursday, October 1: 4 events')
  assert.equal(monthDayLabel(thu, 1), 'Thursday, October 1: 1 event')
  assert.equal(monthDayLabel(thu, 0), 'Thursday, October 1: no events')
})
