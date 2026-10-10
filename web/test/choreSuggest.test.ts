// node --test test/ (npm test). Suggesting a chore: picked days <-> repeat rule, the plain-words
// schedule, and the points stepper's range.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysText, pointsMax, pointsStart, rruleWeekdays, suggestionDetails, weekdaysRrule } from '../src/choreSuggest.ts'

test('weekdaysRrule and rruleWeekdays round-trip', () => {
  assert.equal(weekdaysRrule([]), null)
  assert.equal(weekdaysRrule([5, 1, 3]), 'FREQ=WEEKLY;BYDAY=MO,WE,FR')
  assert.equal(weekdaysRrule([0, 1, 2, 3, 4, 5, 6]), 'FREQ=DAILY')
  assert.deepEqual(rruleWeekdays('FREQ=WEEKLY;BYDAY=MO,WE,FR'), [1, 3, 5])
  assert.deepEqual(rruleWeekdays('FREQ=DAILY'), [0, 1, 2, 3, 4, 5, 6])
  assert.deepEqual(rruleWeekdays('FREQ=MONTHLY;BYMONTHDAY=1'), [])
  assert.deepEqual(rruleWeekdays(null), [])
})

test('daysText says the schedule in plain words', () => {
  assert.equal(daysText(null), null)
  assert.equal(daysText('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'Mon–Fri')
  assert.equal(daysText('FREQ=WEEKLY;BYDAY=MO,WE,FR'), 'Mon, Wed, Fri')
  assert.equal(daysText('FREQ=WEEKLY;BYDAY=SA,SU'), 'Sun, Sat')
  assert.equal(daysText('FREQ=DAILY'), 'Every day')
  assert.equal(daysText('FREQ=MONTHLY'), 'Repeats')
})

test('the points stepper follows the family\'s chores', () => {
  assert.equal(pointsMax([]), 10)
  assert.equal(pointsMax([5, 10, 15]), 30)
  assert.equal(pointsMax([500]), 100)
  assert.equal(pointsStart([]), 5)
  assert.equal(pointsStart([2, 5, 5, 10, 15]), 5)
})

test('suggestionDetails lists what a parent needs to see', () => {
  assert.match(suggestionDetails({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', dueTime: '16:00', timerMinutes: 20, done: false }), /^Mon–Fri · 4:00\s?PM · 20 min timer$/)
  assert.equal(suggestionDetails({ rrule: null, dueTime: null, timerMinutes: null, done: true }), 'Already done')
})
