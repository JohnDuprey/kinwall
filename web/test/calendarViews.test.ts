// node --test test/ (npm test). The calendar's views: names and one-line hints for the phone's view sheet.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VIEW_MODES, viewHint, viewLabel } from '../src/calendarViews.ts'

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
