// node --test test/ (npm test). An all-day event's last day in the event details (Calendar.tsx).
// East of UTC (all of Europe, Asia, Australia, New Zealand) local midnight is the previous day in
// UTC, which used to make every one-day event read "Tue, Nov 10 – Tue, Nov 10 · All day".
process.env.TZ = 'Pacific/Auckland'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allDayLastDay } from '../src/date.ts'

for (const tz of ['Pacific/Auckland', 'Europe/Berlin', 'America/New_York', 'UTC']) {
  test(`allDayLastDay: a one-day event has no range, a longer one ends the day before its end (${tz})`, () => {
    process.env.TZ = tz
    assert.equal(allDayLastDay('2026-11-10', '2026-11-11'), null)
    assert.equal(allDayLastDay('2026-11-10', '2026-11-13'), '2026-11-12')
    assert.equal(allDayLastDay('2026-12-31', '2027-01-01'), null, 'over a year end')
    assert.equal(allDayLastDay('2028-02-28', '2028-03-01'), '2028-02-29', 'leap day')
    assert.equal(allDayLastDay('2026-03-28', '2026-03-30'), '2026-03-29', 'over a DST change (Europe)')
    assert.equal(allDayLastDay('2026-11-10', '2026-11-10'), null, 'an empty end is one day')
  })
}
