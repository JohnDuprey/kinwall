// node --test test/ (npm test). The daily check-in row at the end of a person's day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkInLabel, checkInState } from '../src/checkIn.ts'

test('checkInState: only on the day view, only while check-ins are on, unlocked at the end', () => {
  const day = { range: 'day' as const, checkInPoints: 3, checkedIn: false }
  assert.equal(checkInState(null, true), 'hidden')
  assert.equal(checkInState({ ...day, range: 'week' }, true), 'hidden')
  assert.equal(checkInState({ ...day, checkInPoints: 0 }, true), 'hidden')
  assert.equal(checkInState({ ...day, checkInPoints: 0, checkedIn: true }, true), 'hidden') // turned off later
  assert.equal(checkInState(day, false), 'locked')
  assert.equal(checkInState(day, true), 'ready')
  assert.equal(checkInState({ ...day, checkedIn: true }, false), 'done')
})

test('checkInLabel: short and warm', () => {
  assert.equal(checkInLabel('locked', 3), 'Read to the end to check in')
  assert.equal(checkInLabel('ready', 3), "I'm all caught up ✓ · +3 points")
  assert.equal(checkInLabel('ready', 1), "I'm all caught up ✓ · +1 point")
  assert.equal(checkInLabel('done', 3), 'Checked in today ✓')
})
