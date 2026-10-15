// node --test test/ (npm test). Home's and Calendar's views, where a screen rests, and the nav's lock and "Me" rules.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CALENDAR_VIEWS, HOME_VIEWS, VIEW_MODES, dayOrigin, lastCalendarView, linkedCalendarView, lockedOut, meSlot, navBadgeCount, monthDayLabel, rememberCalendarView, restingHash, viewHint, viewLabel } from '../src/calendarViews.ts'

test('Home is Board | Newscast; Calendar is Day | Week | Month | Schedule, Week is 3 Day on a phone', () => {
  assert.deepEqual(HOME_VIEWS, ['board', 'newscast'])
  assert.deepEqual(CALENDAR_VIEWS.map(v => viewLabel(v, false)), ['Day', 'Week', 'Month', 'Schedule'])
  assert.deepEqual(CALENDAR_VIEWS.map(v => viewLabel(v, true)), ['Day', '3 Day', 'Month', 'Schedule'])
})

test('every view has a short hint, and 3 Day says three days', () => {
  for (const v of VIEW_MODES) for (const phone of [true, false]) {
    const h = viewHint(v, phone)
    assert.ok(h.length > 0 && h.length <= 40, `${v}: ${h}`)
  }
  assert.match(viewHint('week', true), /3 days/)
  assert.match(viewHint('week', false), /week/)
})

test('the last calendar view is kept per device, Schedule too; first Schedule on a phone, Week elsewhere', () => {
  const store = new Map<string, string>()
  const g = globalThis as { localStorage?: unknown }
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  try {
    assert.equal(lastCalendarView(), 'week')
    assert.equal(lastCalendarView(true), 'schedule')
    rememberCalendarView('month')
    assert.equal(lastCalendarView(true), 'month')
    rememberCalendarView('schedule')
    assert.equal(lastCalendarView(false), 'schedule')
    store.set('kinwall.calendarView', 'board')
    assert.equal(lastCalendarView(), 'week')
    g.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    rememberCalendarView('day')
    assert.equal(lastCalendarView(), 'week')
    assert.equal(lastCalendarView(true), 'schedule')
  } finally { delete g.localStorage }
})

test('a Calendar link can name its view', () => {
  assert.equal(linkedCalendarView('#/calendar/month'), 'month')
  assert.equal(linkedCalendarView('#/calendar/schedule?event=e1'), 'schedule')
  assert.equal(linkedCalendarView('#/calendar'), null)
  assert.equal(linkedCalendarView('#/calendar?event=e1&at=2026-10-13'), null)
  assert.equal(linkedCalendarView('#/calendar/board'), null)
  assert.equal(linkedCalendarView('#/home'), null)
})

test('a screen rests on Home, or on Calendar when it is locked to a calendar view', () => {
  assert.equal(restingHash(undefined), '#/home')
  assert.equal(restingHash('board'), '#/home')
  assert.equal(restingHash('newscast'), '#/home')
  for (const v of CALENDAR_VIEWS) assert.equal(restingHash(v), '#/calendar')
})

test('Lock view: Board or Newscast hides Calendar; a calendar view hides Home; off hides nothing', () => {
  assert.equal(lockedOut('calendar', 'board'), true)
  assert.equal(lockedOut('calendar', 'newscast'), true)
  assert.equal(lockedOut('home', 'board'), false)
  assert.equal(lockedOut('home', 'week'), true)
  assert.equal(lockedOut('home', 'schedule'), true)
  assert.equal(lockedOut('calendar', 'month'), false)
  assert.equal(lockedOut('chores', 'day'), false)
  assert.equal(lockedOut('home', undefined), false)
  assert.equal(lockedOut('calendar', undefined), false)
})

test('Me sits after Chores on a kid\'s device and after Lists on a grown-up\'s own phone', () => {
  const keys = ['home', 'calendar', 'chores', 'lists', 'contacts', 'settings']
  assert.equal(meSlot(keys, true), 3) // Home, Calendar, Chores, Me | More
  assert.equal(meSlot(keys, false), 4) // Home, Calendar, Chores, Lists | More: Me first
  assert.equal(meSlot(['home', 'calendar', 'chores', 'settings'], false), 3, 'Lists off: after Chores')
  assert.equal(meSlot(['home', 'calendar', 'settings'], true), 1, 'Chores off too: after Home')
})

test('a day opened from the Week or Month grid remembers where it came from', () => {
  assert.equal(dayOrigin('month'), 'month')
  assert.equal(dayOrigin('week'), 'week')
  assert.equal(dayOrigin('day'), null)
  assert.equal(dayOrigin('schedule'), null)
  assert.equal(dayOrigin('board'), null)
})

test('a month day reads as its date and how many events it has', () => {
  const thu = new Date(2026, 9, 1)
  assert.equal(monthDayLabel(thu, 4), 'Thursday, October 1: 4 events')
  assert.equal(monthDayLabel(thu, 1), 'Thursday, October 1: 1 event')
  assert.equal(monthDayLabel(thu, 0), 'Thursday, October 1: no events')
})

test('navBadgeCount: reward requests count on Rewards, not on Chores too', () => {
  const keys = ['home', 'chores', 'lists', 'rewards']
  // 1 chore idea + 2 reward requests waiting: Chores 1, Rewards 2 (3 things, not 5).
  assert.deepEqual(['chores', 'rewards', 'lists'].map(k => navBadgeCount(k, keys, 3, 2)), [1, 2, 0])
  // Rewards off: whatever Chores' To approve holds stays on Chores.
  assert.equal(navBadgeCount('chores', ['home', 'chores'], 3, 2), 3)
})
