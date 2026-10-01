// node --test test/ (npm test). Which meals a planned meal can swap with: the rest of its week.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byMealTime, swapCandidates, swapWindow } from '../src/meal-date.ts'

test('swapWindow: from today (or the week start) to the end of the meal\'s week; none once it is over', () => {
  assert.deepEqual(swapWindow('2026-10-01', '2026-09-29', 0), { from: '2026-09-29', to: '2026-10-03' })
  assert.deepEqual(swapWindow('2026-10-08', '2026-09-29', 0), { from: '2026-10-04', to: '2026-10-10' })
  assert.deepEqual(swapWindow('2026-10-04', '2026-09-29', 1), { from: '2026-09-29', to: '2026-10-04' }) // Monday weeks
  assert.equal(swapWindow('2026-09-20', '2026-09-29', 0), null)
})

test('swapCandidates: other meals by day, then slot', () => {
  const m = (id: string, date: string, slot: 'breakfast' | 'lunch' | 'dinner' | 'snack') => ({ id, date, slot })
  const meals = [m('a', '2026-10-02', 'breakfast'), m('self', '2026-10-01', 'dinner'), m('b', '2026-10-01', 'snack'), m('c', '2026-10-01', 'lunch')]
  assert.deepEqual(swapCandidates(meals, 'self').map(x => x.id), ['c', 'b', 'a'])
})

test('byMealTime: today\'s meals run by their time, slot breaks ties and fills in a missing time', () => {
  const mealTimes = { breakfast: '07:30', lunch: '12:00', dinner: '18:00', snack: '15:00' }
  const meal = (id: string, slot: 'breakfast' | 'lunch' | 'dinner' | 'snack', plannedTime: string | null = null) => ({ id, slot, plannedTime })
  const order = byMealTime([meal('dinner', 'dinner', '18:00'), meal('snack', 'snack', '15:30'), meal('lunch', 'lunch'), meal('late', 'breakfast', '18:00'), meal('breakfast', 'breakfast')], mealTimes)
  assert.deepEqual(order.map(m => m.id), ['breakfast', 'lunch', 'snack', 'late', 'dinner'])
})
