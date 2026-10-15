// node --test test/ (npm test). Splitting a reward: the default shares and how they read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evenSplit, movePoints, shareText } from '../src/rewardSplit.ts'

test('evenSplit: even when everyone can, capped by balances, remainder to whoever has room', () => {
  assert.deepEqual(evenSplit(300, [{ id: 'sam', balance: 500 }, { id: 'leo', balance: 500 }]), { sam: 150, leo: 150 })
  assert.deepEqual(evenSplit(300, [{ id: 'sam', balance: 500 }, { id: 'leo', balance: 100 }]), { sam: 200, leo: 100 })
  const three = evenSplit(100, [{ id: 'a', balance: 99 }, { id: 'b', balance: 99 }, { id: 'c', balance: 99 }])
  assert.equal(Object.values(three).reduce((n, x) => n + x, 0), 100)
  assert.deepEqual(evenSplit(300, [{ id: 'sam', balance: 100 }, { id: 'leo', balance: 50 }]), { sam: 100, leo: 50 }, "can't cover it together")
})

test('shareText', () => {
  assert.equal(shareText([{ memberId: 'm1', points: 200 }, { memberId: 'm2', points: 100 }], id => (id === 'm1' ? 'Sam' : 'Leo')), 'Sam 200 + Leo 100')
})

test('movePoints: −/+ moves points between people and keeps the total', () => {
  const people = [{ id: 'leo', balance: 18 }, { id: 'maya', balance: 42 }]
  const cost = 40
  // Leo 18 + Maya 22: + on Leo can't go past his balance; − on Leo hands the point to Maya.
  assert.deepEqual(movePoints({ leo: 18, maya: 22 }, people, 'leo', 1, cost), { leo: 18, maya: 22 })
  assert.deepEqual(movePoints({ leo: 18, maya: 22 }, people, 'leo', -5, cost), { leo: 13, maya: 27 })
  assert.deepEqual(movePoints({ leo: 13, maya: 27 }, people, 'maya', -1, cost), { leo: 14, maya: 26 })
  // Nobody below 1.
  assert.deepEqual(movePoints({ leo: 1, maya: 39 }, people, 'leo', -1, cost), { leo: 1, maya: 39 })
  assert.deepEqual(movePoints({ leo: 2, maya: 38 }, people, 'maya', 5, cost), { leo: 1, maya: 39 })
  // Short (nobody had room): + just adds; over: − just takes.
  assert.deepEqual(movePoints({ leo: 10, maya: 20 }, people, 'leo', 1, cost), { leo: 11, maya: 20 })
  assert.deepEqual(movePoints({ leo: 18, maya: 30 }, people, 'maya', -5, cost), { leo: 18, maya: 25 })
  // Three: + takes from whoever gives the most.
  const three = [...people, { id: 'sam', balance: 30 }]
  assert.deepEqual(movePoints({ leo: 10, maya: 20, sam: 10 }, three, 'sam', 2, cost), { leo: 10, maya: 18, sam: 12 })
})
