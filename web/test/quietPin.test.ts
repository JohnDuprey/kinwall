// node --test test/ (npm test). The Night PIN keypad: what a key press does, and how long a
// screen waits after wrong tries.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PIN_RE, pinWaitMs, pressPinKey } from '../src/quietPin.ts'

test('pinWaitMs: 4 wrong tries are free, the 5th waits a minute, then each wait doubles up to 30 min', () => {
  assert.deepEqual([0, 1, 4].map(pinWaitMs), [0, 0, 0])
  assert.equal(pinWaitMs(5), 60_000)
  assert.equal(pinWaitMs(6), 120_000)
  assert.equal(pinWaitMs(7), 240_000)
  assert.equal(pinWaitMs(20), 30 * 60_000)
})

test('pressPinKey: digits up to 8, back deletes one, anything else is ignored', () => {
  assert.equal(pressPinKey('', '4'), '4')
  assert.equal(pressPinKey('1234567', '8'), '12345678')
  assert.equal(pressPinKey('12345678', '9'), '12345678', 'no more than 8')
  assert.equal(pressPinKey('123', 'back'), '12')
  assert.equal(pressPinKey('', 'back'), '')
  assert.equal(pressPinKey('12', 'x'), '12')
})

test('PIN_RE: 4 to 8 digits', () => {
  for (const ok of ['1234', '12345678']) assert.ok(PIN_RE.test(ok), ok)
  for (const bad of ['123', '123456789', '12a4', '']) assert.ok(!PIN_RE.test(bad), bad)
})
