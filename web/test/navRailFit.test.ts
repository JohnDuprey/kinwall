import { test } from 'node:test'
import assert from 'node:assert/strict'
import { navRailFit } from '../src/navRailFit.ts'

test('a rail that fits keeps all destinations visible', () => {
  assert.equal(navRailFit(800, Array(10).fill(60), 4, 44), 10)
})
test('an overflowing iPad rail reserves a full More button and gap', () => {
  assert.equal(navRailFit(700, Array(14).fill(66), 4, 66), 10)
  assert.equal(navRailFit(300, Array(14).fill(44), 4, 44), 6)
})
test('large text and wrapped labels reduce capacity without scrolling navigation', () => {
  assert.equal(navRailFit(290, [55, 80, 90, 80, 55], 4, 55), 3)
  assert.equal(navRailFit(40, [55, 80], 4, 55), 1)
})
