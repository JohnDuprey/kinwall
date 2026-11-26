import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chipsThatFit, stripFood } from '../src/pantry-strip.ts'

test('strip fits a prefix, reserving room for the remaining count only when needed', () => {
  assert.equal(chipsThatFit([60, 80, 70], 226, 40, 8), 3)
  assert.equal(chipsThatFit([60, 80, 70], 225, 40, 8), 2)
  assert.equal(chipsThatFit([60, 80, 70], 140, 40, 8), 1)
  assert.equal(chipsThatFit([200], 100, 40, 8), 0)
  assert.equal(chipsThatFit([], 100, 40, 8), 0)
})

test('strip food is soonest first and food past its date stays expired', () => {
  const items = [
    { id: 'later', title: 'Chicken', useBy: '2026-11-27', daysLeft: 1, status: 'soon' as const },
    { id: 'past', title: 'Spinach', useBy: '2026-11-24', daysLeft: -2, status: 'expired' as const },
    { id: 'today', title: 'Milk', useBy: '2026-11-26', daysLeft: 0, status: 'today' as const },
  ]
  const food = stripFood(items)
  assert.deepEqual(food.map(i => i.id), ['past', 'today', 'later'])
  assert.equal(food[0].status, 'expired')
  assert.equal(items[0].id, 'later')
})
