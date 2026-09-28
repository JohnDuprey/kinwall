// node --test test/ (npm test). Temp check: the daily questions at the end of a person's day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardGoals, calendarGoal, feelingOptions, tempCheckDone, toggleFeeling } from '../src/tempCheck.ts'

const on = { on: true, sleep: true, feelings: true, goal: true, showGoal: true }
const m = (id: string, tempCheck: typeof on, todayGoal: string | null) => ({ id, name: id, tempCheck, todayGoal })

test('boardGoals: only people with the goal question on who chose to show it and set one today', () => {
  const members = [
    m('maya', on, 'Finish my book report'),
    m('leo', { ...on, showGoal: false }, 'Build the lego ship'),
    m('sam', on, null),
    m('alex', { ...on, on: false }, 'Stale'),
    m('kid', { ...on, goal: false }, 'Stale'),
  ]
  assert.deepEqual(boardGoals(members).map(g => [g.id, g.todayGoal]), [['maya', 'Finish my book report']])
  assert.deepEqual(boardGoals(members, 'leo'), [], 'a display pinned to Leo shows only Leo')
})

test('calendarGoal: the person the calendar shows, whether or not they share it on the Board', () => {
  const members = [m('maya', on, 'Read 20 pages'), m('leo', { ...on, showGoal: false }, 'Tidy up')]
  assert.equal(calendarGoal(members, 'maya'), 'Read 20 pages')
  assert.equal(calendarGoal(members, 'leo'), 'Tidy up')
  assert.equal(calendarGoal(members, null), null)
  assert.equal(calendarGoal([m('maya', { ...on, on: false }, 'x')], 'maya'), null)
})

test('feelingOptions: the built-ins, then their own (no duplicates, any case)', () => {
  assert.deepEqual(feelingOptions(['excited', 'Tired']), ['great', 'good', 'fine', 'ok', 'bad', 'awful', 'tired', 'sore', 'excited'])
})

test('toggleFeeling: tap to add, tap again to remove (any case)', () => {
  assert.deepEqual(toggleFeeling(['good'], 'tired'), ['good', 'tired'])
  assert.deepEqual(toggleFeeling(['good', 'Tired'], 'tired'), ['good'])
})

test('tempCheckDone: every question they get has an answer (a skipped goal counts)', () => {
  const answered = { sleep: true, feelings: true, goal: false }
  assert.equal(tempCheckDone(on, answered), false)
  assert.equal(tempCheckDone({ ...on, goal: false }, answered), true)
  assert.equal(tempCheckDone(on, { ...answered, goal: true }), true)
  assert.equal(tempCheckDone({ ...on, sleep: false, feelings: false, goal: false }, { sleep: false, feelings: false, goal: false }), false, 'no questions: nothing to be done with')
})
