// node --test test/ (npm test). Which meals a planned meal can swap with: the rest of its week.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { swapCandidates, swapWindow } from '../src/meal-date.ts'

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
