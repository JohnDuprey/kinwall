import { test } from 'node:test'
import assert from 'node:assert/strict'
import { goalLabel, goalProgressLabel, validGoal } from '../src/choreGoal.ts'
import { choreOrder, pointsEarned } from '../src/choreDay.ts'
const goal = { times: 3, every: 1, unit: 'week' as const, weekStart: 1 }
test('flexible goal labels and once-per-day validation', () => {
  assert.equal(goalLabel(goal), '3 times per week')
  assert.equal(goalProgressLabel(goal, 1), '1 of 3 done this week')
  assert.equal(goalLabel({ ...goal, times: 2, every: 3, unit: 'day' }), '2 times every 3 days')
  assert.equal(validGoal(goal), true)
  for (const patch of [{ times: 0 }, { times: 1.5 }, { times: 8 }, { every: 0 }, { times: 2, unit: 'day' as const }, { times: 29, unit: 'month' as const }]) assert.equal(validGoal({ ...goal, ...patch }), false)
})
test('a reached goal sorts after open work and never earns fictional daily points', () => {
  const make = (title: string, completed = false, full = false) => ({ title, completed, goalProgress: { full }, dueTime: null, points: 5, completedBy: 'leo', memberId: 'leo' })
  const chores = [make('Goal reached', false, true), make('Tidy toys'), make('Dishes', true)]
  assert.deepEqual(choreOrder(chores).map(c => c.title), ['Tidy toys', 'Goal reached', 'Dishes'])
  assert.equal(pointsEarned(chores, 'leo'), 5)
})
