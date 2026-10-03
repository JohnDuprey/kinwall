// node --test test/ (npm test). Bonus points: what a parent typed as a whole number in range, and
// the short lines the profile and toast show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bonusLine, bonusPoints, gaveText } from '../src/bonus.ts'

test('bonusPoints: a whole number from 1 to 500, else null', () => {
  assert.equal(bonusPoints('10'), 10)
  assert.equal(bonusPoints(' 25 '), 25)
  assert.equal(bonusPoints('500'), 500)
  for (const bad of ['', '0', '-3', '501', '2.5', 'ten', '1e2']) assert.equal(bonusPoints(bad), null, bad)
})

test('bonusLine: points, the note when there is one, and who it was from', () => {
  assert.equal(bonusLine({ points: 10, note: 'Helped carry groceries' }), '+10 · Helped carry groceries · from a parent')
  assert.equal(bonusLine({ points: 1, note: null }), '+1 · from a parent')
})

test('gaveText: the toast after giving', () => {
  assert.equal(gaveText('Maya', 10), 'Gave Maya 10 points')
  assert.equal(gaveText('Leo', 1), 'Gave Leo 1 point')
})
