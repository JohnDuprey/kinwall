import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAllDayOnDate, layoutAllDayRow } from '../src/dayLayout.ts'
import type { EventInstance } from '../src/types.ts'

const event = (id: string, start: string, end: string, allDay = true): EventInstance => ({
  id, calendarId: 'family', title: id, start, end, allDay, memberIds: ['m3', 'm4'], color: '#7ED9A6',
}) as EventInstance
const week = Array.from({ length: 7 }, (_, i) => `2026-11-${15 + i}`)

for (const tz of ['Pacific/Auckland', 'Europe/Berlin', 'America/New_York', 'UTC']) {
  test(`all-day bars span dates, reuse lanes, clip and deduplicate (${tz})`, () => {
    process.env.TZ = tz
    const stay = event("At Sam's", '2026-11-12', '2026-11-21')
    const monday = event('Family picnic', '2026-11-16', '2026-11-17')
    const next = event('Family trip', '2026-11-20', '2026-11-24')
    const input = [stay, monday, next]
    const result = layoutAllDayRow([...input, stay, { ...stay, id: 'copy', calendarId: 'shared', memberIds: ['m2'] }], week, tz)
    assert.equal(result.lanes, 2)
    assert.deepEqual(result.bars.map(({ ev, ...bar }) => ({ id: ev.id, ...bar })), [
      { id: stay.id, from: 0, to: 5, lane: 0, continuesBefore: true, continuesAfter: false },
      { id: monday.id, from: 1, to: 1, lane: 1, continuesBefore: false, continuesAfter: false },
      { id: next.id, from: 5, to: 6, lane: 1, continuesBefore: false, continuesAfter: true },
    ])
    assert.deepEqual(result.bars[0].ev.memberIds, ['m3', 'm4', 'm2'])
    assert.deepEqual(layoutAllDayRow(input, week, tz), layoutAllDayRow([...input].reverse(), week, tz))
    assert.deepEqual(layoutAllDayRow(input, ['2026-11-20'], tz).bars.map(b => [b.from, b.to, b.lane, b.continuesBefore, b.continuesAfter]), [
      [0, 0, 0, true, false], [0, 0, 1, false, true],
    ])
    assert.equal(isAllDayOnDate(stay, '2026-11-21'), false, 'end is exclusive')
    assert.deepEqual(layoutAllDayRow(input, [], tz), { bars: [], lanes: 0 })
    assert.deepEqual(layoutAllDayRow(input, ['2026-11-25'], tz), { bars: [], lanes: 0 })
  })

  test(`all-day bars sort by visible span, start, title and stable identity (${tz})`, () => {
    const input = [event('Sam', '2026-11-15', '2026-11-17'), event('Alex', '2026-11-15', '2026-11-17'),
      event('Leo', '2026-11-15', '2026-11-18'), event('Maya', '2026-11-14', '2026-11-17')]
    const result = layoutAllDayRow(input, week, tz)
    assert.deepEqual(result.bars.map(b => b.ev.id), ['Leo', 'Maya', 'Alex', 'Sam'])
    assert.deepEqual(result, layoutAllDayRow([...input].reverse(), week, tz))
    const twin = { ...input[0], id: 'Sam2' }
    assert.deepEqual(layoutAllDayRow([twin, input[0]], week, tz), layoutAllDayRow([input[0], twin], week, tz))
  })
}
