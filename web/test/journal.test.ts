// node --test test/ (npm test). Goal follow-up and the journal: times, messages, the week's goals.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVENING_TIMES, followupThanks, goalsThisWeek } from '../src/journal.ts'

test('EVENING_TIMES: noon to 11:30 PM in half hours', () => {
  assert.equal(EVENING_TIMES.length, 24)
  assert.equal(EVENING_TIMES[0], '12:00')
  assert.equal(EVENING_TIMES.at(-1), '23:30')
  assert.ok(EVENING_TIMES.includes('21:00'))
})

test('followupThanks: warm for yes, kind for partly and not today', () => {
  assert.equal(followupThanks('yes', 'Maya'), 'Nice work, Maya ✓')
  assert.match(followupThanks('partly', 'Maya'), /Maya/)
  assert.match(followupThanks('no', 'Leo'), /Leo/)
  assert.doesNotMatch(followupThanks('no', 'Leo'), /fail|bad|should/i)
})

test('goalsThisWeek: goals met out of goals set in the last 7 days (today counts)', () => {
  const day = (date: string, goal: string | null, outcome?: 'yes' | 'partly' | 'no', skipped = false) =>
    ({ date, entries: [], tempCheck: { sleep: null, feelings: null, goal, goalSkipped: skipped, followup: outcome ? { outcome, helped: null, hindered: null, next: null } : null } })
  const days = [
    day('2026-09-26', 'Read', 'yes'),
    day('2026-09-25', 'Tidy', 'partly'),
    day('2026-09-24', 'Walk', 'yes'),
    day('2026-09-23', null, undefined, true), // skipped: not counted
    day('2026-09-22', 'Piano'), // no answer: still a goal set
    { date: '2026-09-21', entries: [], tempCheck: null },
    day('2026-09-19', 'Old', 'yes'), // 8 days back: out of the week
  ]
  assert.deepEqual(goalsThisWeek(days, '2026-09-26'), { met: 2, of: 4 })
  assert.deepEqual(goalsThisWeek([], '2026-09-26'), { met: 0, of: 0 })
})
