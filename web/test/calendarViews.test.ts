// node --test test/ (npm test). The calendar's views: names and one-line hints for the phone's view sheet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CALENDAR_VIEWS, VIEW_MODES, VIEW_TABS, lastCalendarView, rememberCalendarView, tabOf, viewForTab, viewHint, viewLabel } from '../src/calendarViews.ts'

test('views run Board, Day, Week, Month, Schedule; Week is 3 Day on a phone', () => {
  assert.deepEqual(VIEW_MODES.map(v => viewLabel(v, false)), ['Board', 'Day', 'Week', 'Month', 'Schedule'])
  assert.deepEqual(VIEW_MODES.map(v => viewLabel(v, true)), ['Board', 'Day', '3 Day', 'Month', 'Schedule'])
})

test('every view has a short hint, and 3 Day says three days', () => {
  for (const v of VIEW_MODES) for (const phone of [true, false]) {
    const h = viewHint(v, phone)
    assert.ok(h.length > 0 && h.length <= 40, `${v}: ${h}`)
  }
  assert.match(viewHint('week', true), /3 days/)
  assert.match(viewHint('week', false), /week/)
})

test('three tabs, Board | Calendar | Schedule; Day, Week and Month sit under Calendar', () => {
  assert.deepEqual(VIEW_TABS, ['board', 'calendar', 'schedule'])
  assert.deepEqual(VIEW_MODES.map(tabOf), ['board', 'calendar', 'calendar', 'calendar', 'schedule'])
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
