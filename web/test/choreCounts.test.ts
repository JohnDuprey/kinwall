import { test } from 'node:test'
import assert from 'node:assert/strict'
import { countChoreDay, sumChoreCounts, choreCountLabel } from '../src/choreCounts.ts'
const count = (memberId: string | null, remaining: number) => ({ date: '2026-10-19', memberId, total: 2, remaining, pending: remaining ? 1 : 0 })
test('date indicators follow member filtering, including Anyone and pinned displays', () => {
  const rows = [count('maya', 1), count('leo', 2), count(null, 0)]
  assert.deepEqual(sumChoreCounts(rows, null, true), { total: 6, remaining: 3, pending: 2 })
  assert.deepEqual(sumChoreCounts(rows, 'maya', true), { total: 4, remaining: 1, pending: 1 })
  assert.deepEqual(sumChoreCounts(rows, 'maya', false), { total: 2, remaining: 1, pending: 1 })
})
test('optimistic selected-day counts keep waiting ticks unfinished and omit blocked flexible goals', () => {
  const rows = [
    { memberId: 'maya', completed: true, pending: false },
    { memberId: 'maya', completed: false, pending: true, goalProgress: { full: true } },
    { memberId: 'maya', completed: false, pending: false, goalProgress: { full: true } },
    { memberId: null, completed: false, pending: false },
  ]
  assert.deepEqual(countChoreDay(rows, null, true), { total: 3, remaining: 2, pending: 1 })
  assert.deepEqual(countChoreDay(rows, 'maya', false), { total: 2, remaining: 1, pending: 1 })
})
test('date labels distinguish unknown, no chores, all done, and waiting for approval', () => {
  assert.equal(choreCountLabel({ total: 0, remaining: 0, pending: 0 }), 'No chores')
  assert.equal(choreCountLabel({ total: 2, remaining: 0, pending: 0 }), 'All chores done')
  assert.match(choreCountLabel({ total: 3, remaining: 2, pending: 1 }), /2 chores left/)
  assert.match(choreCountLabel({ total: 3, remaining: 2, pending: 1 }), /1 waiting for OK/)
})

test('optional ongoing responsibilities do not add unfinished daily work', () => {
  assert.deepEqual(countChoreDay([{ memberId: null, completed: false, ongoing: true }, { memberId: null, completed: true }], null, true), { total: 1, remaining: 0, pending: 0 })
})
