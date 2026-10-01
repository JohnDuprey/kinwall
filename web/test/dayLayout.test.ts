// node --test test/ (npm test). Where timed events go in the Day and Week grids (dayLayout.ts), and
// which events count for Now / Next and leave-by (leadTime.ts blocksTime).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeEvents, eventPeople, FREE_EDGE, layoutDay, newEventDay, newEventTimes } from '../src/dayLayout.ts'
import { blocksTime } from '../src/leadTime.ts'
import type { EventInstance } from '../src/types.ts'

const ev = (id: string, start: string, end: string, busy?: boolean) => ({ id, start, end, allDay: false, ...(busy === undefined ? {} : { busy }) }) as EventInstance

test('layoutDay: a free window never splits busy events into columns; they step in past its edge', () => {
  const window = ev('w', '2026-10-07T08:00:00Z', '2026-10-07T20:00:00Z', false)
  const soccer = ev('s', '2026-10-07T16:00:00Z', '2026-10-07T17:00:00Z')
  const early = ev('e', '2026-10-07T06:00:00Z', '2026-10-07T07:00:00Z')
  const out = layoutDay([soccer, window, early], 'UTC')
  assert.deepEqual(out.map(p => [p.ev.id, p.free, p.totalCols]), [['w', true, 1], ['e', false, 1], ['s', false, 1]], 'free first (drawn behind), each set packed on its own')
  assert.equal(out[0].width, 'calc((100% - 0px) / 1 - 4px)', 'the window keeps the full width')
  assert.ok(out[2].left.startsWith(`calc(${FREE_EDGE}px`), 'Soccer overlaps the window: inset')
  assert.ok(out[1].left.startsWith('calc(0px'), 'the early event does not overlap it: no inset')
  // Two busy events still share the column between themselves.
  const clash = layoutDay([soccer, ev('p', '2026-10-07T16:30:00Z', '2026-10-07T17:30:00Z'), window], 'UTC').filter(p => !p.free)
  assert.deepEqual(clash.map(p => p.totalCols), [2, 2])
})

test('blocksTime: timed busy events only, so Now / Next and leave-by skip free and all-day ones', () => {
  assert.equal(blocksTime({ allDay: false }), true, 'busy when not said')
  assert.equal(blocksTime({ allDay: false, busy: true }), true)
  assert.equal(blocksTime({ allDay: false, busy: false }), false)
  assert.equal(blocksTime({ allDay: true, busy: true }), false)
})

const full = (id: string, calendarId: string, title: string, start: string, end: string, memberIds: string[], extra: Partial<EventInstance> = {}) =>
  ({ id, calendarId, title, start, end, allDay: false, memberIds, ...extra }) as EventInstance

test('layoutDay: concurrent events on the shared Day timeline get side-by-side lanes', () => {
  const a = ev('a', '2026-10-07T16:00:00Z', '2026-10-07T17:30:00Z')
  const b = ev('b', '2026-10-07T16:30:00Z', '2026-10-07T17:00:00Z')
  const c = ev('c', '2026-10-07T16:45:00Z', '2026-10-07T18:00:00Z')
  const later = ev('d', '2026-10-07T19:00:00Z', '2026-10-07T20:00:00Z')
  const out = layoutDay([a, b, c, later], 'UTC')
  assert.deepEqual(out.map(p => [p.ev.id, p.col, p.totalCols]), [['a', 0, 3], ['b', 1, 3], ['c', 2, 3], ['d', 0, 1]], 'three lanes for the clash; a later event gets the full width')
})

test('dedupeEvents: one block per event, merging the same event from two calendars', () => {
  const at = ['2026-10-07T16:30:00Z', '2026-10-07T17:00:00Z'] as const
  const family = full('f', 'family', 'Team Meeting', ...at, ['m1'])
  const work = full('w', 'work', ' team  meeting ', ...at, ['m1', 'm2'])
  const out = dedupeEvents([family, work, family])
  assert.deepEqual(out.map(e => [e.id, e.memberIds]), [['f', ['m1', 'm2']]], 'same title/time on two calendars and a repeated id: shown once, people from both')
  // Same title and time on one calendar: two real events (Sam's and Leo's dentist), both kept.
  const sam = full('s', 'family', 'Dentist', ...at, ['m2']), leo = full('l', 'family', 'Dentist', ...at, ['m4'])
  assert.deepEqual(dedupeEvents([sam, leo]).map(e => e.id), ['s', 'l'])
  // A different time or title is a different event.
  assert.equal(dedupeEvents([family, full('x', 'work', 'Team Meeting', at[0], '2026-10-07T17:30:00Z', [])]).length, 2)
  assert.equal(dedupeEvents([family, full('y', 'work', 'Standup', ...at, [])]).length, 2)
  // Show hidden: the visible copy wins over a hidden one.
  const hidden = { ...family, hidden: 'event' } as EventInstance
  assert.deepEqual(dedupeEvents([hidden, work]).map(e => [e.id, e.hidden]), [['w', undefined]])
})

test('eventPeople: who an event is for, in family order', () => {
  const members = [{ id: 'm1', name: 'Alex' }, { id: 'm2', name: 'Sam' }, { id: 'm3', name: 'Maya' }, { id: 'm4', name: 'Leo' }]
  assert.deepEqual(eventPeople({ memberIds: ['m4', 'm1', 'gone'] }, members).map(m => m.name), ['Alex', 'Leo'])
  assert.deepEqual(eventPeople({ memberIds: [] }, members), [])
})

test('newEventDay / newEventTimes: + adds to the day on screen, at a sensible time', () => {
  const now = new Date(2026, 9, 1, 15, 40) // Thu Oct 1, 3:40 PM local
  const fri = new Date(2026, 9, 2), wed = new Date(2026, 8, 30)
  assert.equal(newEventDay([fri], now), fri, 'Day view on another day: that day')
  assert.equal(newEventDay([wed, new Date(2026, 9, 1), fri], now).getDate(), 1, 'Week with today in it: today')
  assert.equal(newEventDay([new Date(2026, 9, 4), new Date(2026, 9, 5)], now).getDate(), 4, 'Week paged ahead: its first day')
  const today = newEventTimes(new Date(2026, 9, 1), now)
  assert.deepEqual([new Date(today.start).getHours(), new Date(today.start).getMinutes()], [16, 0], 'today: the next half hour')
  assert.equal(new Date(newEventTimes(new Date(2026, 9, 1), new Date(2026, 9, 1, 9, 10)).start).getMinutes(), 30)
  const other = newEventTimes(fri, now)
  assert.equal(new Date(other.start).toString(), new Date(2026, 9, 2, 9).toString(), 'another day: 9 AM')
  assert.equal(Date.parse(other.end) - Date.parse(other.start), 3600000, 'an hour long')
})
