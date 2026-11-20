import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allDayBarTimes, dedupeEvents, eventTimeOnDate, isAllDayOnDate, isLongTimed, layoutAllDayRow, timedEventRange } from '../src/dayLayout.ts'
import { formatTime, setHour12 } from '../src/timeFormat.ts'
import { formatDate, DAY, setLang } from '../src/i18n.ts'
import type { EventInstance } from '../src/types.ts'

const event = (id: string, start: string, end: string, allDay = true): EventInstance => ({
  id, calendarId: 'family', title: id, start, end, allDay, memberIds: ['m3', 'm4'], color: '#7ED9A6',
}) as EventInstance
const week = Array.from({ length: 7 }, (_, i) => `2026-11-${15 + i}`)

for (const allDay of [true, false]) {
  test(`calendar deduplication followed by bar layout preserves distinct ${allDay ? 'all-day' : 'long timed'} events`, () => {
    const start = allDay ? '2026-11-20' : '2026-11-20T16:00:00Z'
    const end = allDay ? '2026-11-22' : '2026-11-22T16:00:00Z'
    const title = allDay ? 'Family picnic' : 'Kitchen renovation'
    const copy = (id: string, calendarId: string, memberId: string) => ({
      ...event(id, start, end, allDay), title, calendarId, memberIds: [memberId],
    })
    // Two separate events on each calendar, with a synced copy of each on the other.
    // Interleaving keeps one representative from each calendar after the initial merge.
    const interleaved = [copy('a1', 'family', 'm1'), copy('b1', 'shared', 'm2'),
      copy('b2', 'shared', 'm3'), copy('a2', 'family', 'm4')]
    // Grouped calendars can also retain different representatives when a hidden copy is replaced.
    const hiddenCopy = [interleaved[0], { ...interleaved[3], hidden: 'event' as const }, interleaved[1], interleaved[2]]
    for (const input of [interleaved, hiddenCopy]) {
      // CalendarView merges copies before filtering and passing visible events to WeekView.
      const visible = dedupeEvents(input)
      assert.deepEqual(visible.map(ev => [ev.id, [...ev.memberIds].sort()]), [['a1', ['m1', 'm2']], ['b2', ['m3', 'm4']]])
      assert.ok(visible.every(ev => !ev.hidden), 'visible copies win when merging hidden events')
      const { bars, lanes } = layoutAllDayRow(visible, ['2026-11-20', '2026-11-21', '2026-11-22'], 'UTC')
      assert.equal(bars.length, 2, 'bar count agrees with the day header and other calendar views')
      assert.equal(lanes, 2, 'separate overlapping events each have a lane')
      assert.deepEqual(bars.map(bar => [bar.ev.id, bar.ev.memberIds]), visible.map(ev => [ev.id, ev.memberIds]))
      for (const ev of visible) assert.ok(bars.some(bar => bar.ev === ev), 'each event opens its original representative')
    }
  })
}

for (const tz of ['Pacific/Auckland', 'Europe/Berlin', 'America/New_York', 'UTC']) {
  test(`all-day bars span dates, reuse lanes and clip calendar-deduplicated events (${tz})`, () => {
    process.env.TZ = tz
    const stay = event("At Sam's", '2026-11-12', '2026-11-21')
    const monday = event('Family picnic', '2026-11-16', '2026-11-17')
    const next = event('Family trip', '2026-11-20', '2026-11-24')
    const input = [stay, monday, next]
    const visible = dedupeEvents([...input, stay, { ...stay, id: 'copy', calendarId: 'shared', memberIds: ['m2'] }])
    const result = layoutAllDayRow(visible, week, tz)
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

// Build local fixtures in each household zone, while passing UTC instants to the helpers.
const at = (day: number, hour = 0, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString()
for (const tz of ['Pacific/Auckland', 'Europe/Berlin', 'America/New_York', 'UTC']) {
  test(`long timed events and mixed spanning lanes (${tz})`, () => {
    process.env.TZ = tz
    const start = at(15)
    assert.equal(isLongTimed(event('Maya', start, new Date(Date.parse(start) + 86340000).toISOString(), false), tz), false)
    assert.equal(isLongTimed(event('Maya', start, new Date(Date.parse(start) + 86400000).toISOString(), false), tz), true)
    assert.equal(isLongTimed(event('Leo', at(15, 20), at(16, 8), false), tz), false)
    assert.equal(isLongTimed(event('Alex', '2026-11-15', '2026-11-20'), tz), false)
    assert.equal(isLongTimed(event('Sam', at(15), at(20, 15), false), tz), true)
    const stay = event("At Sam's", at(12), at(20, 15), false)
    const monday = event('Family picnic', '2026-11-16', '2026-11-17')
    const next = event('Family trip', at(20, 15), at(23, 15), false)
    const input = [stay, monday, next, event('Soccer', at(16, 16), at(16, 17), false)]
    const result = layoutAllDayRow(input, week, tz)
    assert.equal(result.lanes, 2)
    assert.deepEqual(result.bars.map(b => [b.ev.id, b.from, b.to, b.lane, b.continuesBefore, b.continuesAfter]), [
      [stay.id, 0, 5, 0, true, false], [monday.id, 1, 1, 1, false, false], [next.id, 5, 6, 1, false, true],
    ])
    assert.deepEqual(result, layoutAllDayRow([...input].reverse(), week, tz))
    const midnight = event('Maya', at(19, 18), at(21), false)
    assert.equal(layoutAllDayRow([midnight], week, tz).bars[0].to, 5)
    assert.equal(layoutAllDayRow([midnight], week, tz).bars[0].continuesAfter, false)
    const single = layoutAllDayRow([stay], ['2026-11-20'], tz).bars[0]
    assert.deepEqual([single.from, single.to, single.continuesBefore, single.continuesAfter], [0, 0, true, false])
  })

  test(`per-day time labels, bar endpoints and spoken range (${tz})`, async () => {
    process.env.TZ = tz
    setHour12(true)
    const stay = event("At Sam's", at(15, 18), at(20, 15), false)
    assert.equal(eventTimeOnDate(stay, week[0], tz), 'From 6:00 PM')
    assert.equal(eventTimeOnDate(stay, week[1], tz), 'All day')
    assert.equal(eventTimeOnDate(stay, week[5], tz), 'Until 3:00 PM')
    assert.equal(eventTimeOnDate(event('Soccer', at(15, 16), at(15, 17), false), week[0], tz), '4:00 PM')
    const overnight = event('Leo', at(15, 20), at(16, 8), false)
    assert.equal(eventTimeOnDate(overnight, week[0], tz), 'From 8:00 PM')
    assert.equal(eventTimeOnDate(overnight, week[1], tz), 'Until 8:00 AM')
    const midnight = event('Sam', at(15), at(17), false)
    assert.equal(eventTimeOnDate(midnight, week[0], tz), 'All day')
    assert.equal(eventTimeOnDate(midnight, week[1], tz), 'All day')
    assert.deepEqual(allDayBarTimes(stay, week, tz), { from: 'From 6:00 PM', until: 'Until 3:00 PM' })
    assert.deepEqual(allDayBarTimes(stay, ['2026-11-20'], tz), { from: null, until: 'Until 3:00 PM' })
    assert.deepEqual(allDayBarTimes(stay, ['2026-11-15'], tz), { from: 'From 6:00 PM', until: null })
    assert.deepEqual(allDayBarTimes(stay, ['2026-11-16'], tz), { from: null, until: null })
    assert.deepEqual(allDayBarTimes(midnight, week, tz), { from: null, until: null })
    assert.deepEqual(allDayBarTimes(event('Family trip', '2026-11-15', '2026-11-20'), week, tz), { from: null, until: null })
    const endpoint = (iso: string) => `${formatDate(new Date(iso), DAY, tz)}, ${formatTime(iso, tz)}`
    assert.equal(timedEventRange(stay, tz), `${endpoint(stay.start)} – ${endpoint(stay.end)}`)
    setHour12(false)
    assert.equal(eventTimeOnDate(stay, week[5], tz), 'Until 15:00')
    await setLang('de', async () => ({ 'From {time}': 'Ab {time}', 'Until {time}': 'Bis {time}', 'All day': 'Ganztägig' }))
    assert.equal(eventTimeOnDate(stay, week[0], tz), 'Ab 18:00')
    assert.equal(eventTimeOnDate(stay, week[1], tz), 'Ganztägig')
    await setLang('en')
    setHour12(true)
  })
}

for (const [tz, month, day] of [['Pacific/Auckland', 8, 27], ['Europe/Berlin', 2, 29], ['America/New_York', 2, 8]] as const) {
  test(`a whole spring-forward day is long even at 23 hours (${tz})`, () => {
    process.env.TZ = tz
    const start = new Date(2026, month, day).toISOString(), end = new Date(2026, month, day + 1).toISOString()
    assert.equal(Date.parse(end) - Date.parse(start), 23 * 3600000)
    assert.equal(isLongTimed(event('Maya', start, end, false), tz), true)
    assert.equal(isLongTimed(event('Maya', new Date(Date.parse(start) + 1000).toISOString(), end, false), tz), false, 'a second after midnight is not a whole day')
    assert.equal(isLongTimed(event('Leo', start, new Date(Date.parse(end) - 1).toISOString(), false), tz), false)
    assert.equal(isLongTimed(event('Sam', new Date(Date.parse(start) - 1800000).toISOString(), end, false), tz), true, 'may start before the whole short day')
    // Device zone is independent of the calendar zone.
    process.env.TZ = 'UTC'
    assert.equal(isLongTimed(event('Maya', start, end, false), tz), true)
  })
}

for (const [tz, key, start, end] of [
  ['America/Santiago', '2026-09-06', '2026-09-06T04:00:00Z', '2026-09-07T03:00:00Z'],
  ['America/Havana', '2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
  ['Africa/Cairo', '2026-04-24', '2026-04-23T22:00:00Z', '2026-04-24T21:00:00Z'],
] as const) {
  test(`a whole day whose midnight is skipped belongs in the all-day row (${tz})`, () => {
    setHour12(true)
    const ev = event('Kitchen renovation', start, end, false)
    assert.equal(Date.parse(end) - Date.parse(start), 23 * 3600000)
    assert.equal(formatTime(start, tz), '1:00 AM', 'the first instant of this day is not 00:00')
    for (const deviceZone of ['UTC', 'Pacific/Auckland']) {
      process.env.TZ = deviceZone
      assert.equal(isLongTimed(ev, tz), true, `a whole family day, independent of the device zone (${deviceZone})`)
      const { bars, lanes } = layoutAllDayRow([ev], [key], tz)
      assert.equal(lanes, 1)
      assert.deepEqual(bars.map(bar => [bar.from, bar.to, bar.continuesBefore, bar.continuesAfter]), [[0, 0, false, false]])
      assert.equal(bars[0].ev, ev, 'opening the bar retains the timed event')
      assert.equal(isLongTimed({ ...ev, start: new Date(Date.parse(start) + 1).toISOString() }, tz), false, 'a millisecond late misses the beginning of the day')
      assert.equal(isLongTimed({ ...ev, end: new Date(Date.parse(end) - 1).toISOString() }, tz), false, 'the full day must reach its ending boundary')
      assert.equal(isLongTimed({ ...ev, start: new Date(Date.parse(start) - 1800000).toISOString() }, tz), true, 'a shorter-than-24-hour event may begin before the whole day')
    }
    const ordinaryDay = { ...ev, start: new Date(Date.parse(end) + 3600000).toISOString(), end: new Date(Date.parse(end) + 86400000).toISOString() }
    assert.equal(isLongTimed(ordinaryDay, tz), false, '01:00 on the next, ordinary day is not its beginning')
  })
}

test('a short event starting after a skipped date does not cover a whole day', () => {
  const ev = event('Family picnic', '2011-12-30T10:00:00Z', '2011-12-30T22:00:00Z', false)
  assert.equal(isLongTimed(ev, 'Pacific/Apia'), false, 'a 12-hour event on December 31 does not cover the skipped December 30')
})
