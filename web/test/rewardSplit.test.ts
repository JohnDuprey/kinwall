// node --test test/ (npm test). Splitting a reward: the default shares and how they read.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evenSplit, shareText } from '../src/rewardSplit.ts'

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
