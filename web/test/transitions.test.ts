// node --test test/ (npm test). Transition times: picked minutes plus the repeat, deduped.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { warningTimes } from '../src/transitions.ts'

test('warning times', () => {
  assert.deepEqual(warningTimes(), [])
  assert.deepEqual(warningTimes([5, 10]), [10, 5])
  assert.deepEqual(warningTimes([10], { every: 5, within: 30 }), [30, 25, 20, 15, 10, 5])
  assert.deepEqual(warningTimes([1, 7], { every: 3, within: 10 }), [9, 7, 6, 3, 1])
  assert.deepEqual(warningTimes([], { every: 1, within: 3 }), [3, 2, 1])
})
