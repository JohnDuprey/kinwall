// node --test test/ (npm test). The daily check-in row at the end of a person's day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkInFocus, checkInLabel, checkInState } from '../src/checkIn.ts'

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

test('checkInFocus: a check-in link lands on the Temp check, or the evening check once it\'s their evening time', () => {
  const tc = { on: true, sleep: true, feelings: true, goal: true, showGoal: true, evening: true, eveningTime: '20:30', journal: true }
  assert.equal(checkInFocus(tc, 8 * 60), 'temp')
  assert.equal(checkInFocus(tc, 20 * 60 + 29), 'temp')
  assert.equal(checkInFocus(tc, 20 * 60 + 30), 'evening')
  assert.equal(checkInFocus({ ...tc, evening: false }, 22 * 60), 'temp')
  assert.equal(checkInFocus({ ...tc, evening: false, battery: true }, 22 * 60), 'evening') // the battery's evening question
  assert.equal(checkInFocus({ ...tc, on: false }, 22 * 60), 'checkin') // no Temp check: the daily check-in
  assert.equal(checkInFocus(undefined, 22 * 60), 'checkin')
})
