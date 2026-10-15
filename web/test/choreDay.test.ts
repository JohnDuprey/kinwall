// node --test test/ (npm test). A day of chores: whose points they are, and the order a column reads in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choreOrder, earnedText, isLate, pointsEarned, pointsGivenOut, waitsForOk } from '../src/choreDay.ts'

const done = (points: number, memberId: string | null, completedBy: string | null, completed = true) => ({ points, memberId, completedBy, completed })

test('pts today follow who got the points, not the column', () => {
  const day = [done(5, 'm4', 'm4'), done(5, null, 'm4'), done(10, null, 'm3'), done(5, null, null), done(5, 'm4', null, false)]
  assert.equal(pointsEarned(day, 'm4'), 10, "Leo's own chore and the Anyone chore he did")
  assert.equal(pointsEarned(day, 'm3'), 10)
  assert.equal(pointsGivenOut(day), 15, '"Nobody in particular" hands out nothing')
  assert.equal(pointsEarned([done(5, 'm4', null)], 'm4'), 5, 'an older completion without a name counts for its person')
})

test('a column reads undone first, by start time, the rest in their own order', () => {
  const c = (title: string, dueTime: string | null, completed = false, pending = false) => ({ title, dueTime, completed, pending })
  const order = choreOrder([c('Bedtime', '20:00'), c('Tidy toys', null), c('Fish', '08:00'), c('Bed made', null, true), c('Dog', '07:00', false, true), c('Read', null)])
  assert.deepEqual(order.map(x => x.title), ['Fish', 'Bedtime', 'Tidy toys', 'Read', 'Bed made', 'Dog'])
})

test('isLate: a start time that has gone by', () => {
  assert.equal(isLate('08:00', '10:25'), true)
  assert.equal(isLate('20:00', '10:25'), false)
  assert.equal(isLate(null, '10:25'), false)
  assert.equal(isLate('after dinner', '10:25'), false)
})

test('waitsForOk follows the server: parent devices never, a gone activity always, else chore then person', () => {
  assert.equal(waitsForOk({ needsApproval: true }, undefined, true), false)
  assert.equal(waitsForOk({ needsApproval: false, activity: { available: false } }, undefined, false), true)
  assert.equal(waitsForOk({ needsApproval: null }, { needsApproval: true }, false), true)
  assert.equal(waitsForOk({ needsApproval: false }, { needsApproval: true }, false), false)
  assert.equal(earnedText(5, 'Leo', false), '⭐ 5 points for Leo')
  assert.equal(earnedText(1, 'Leo', true), 'a grown-up will OK it, then Leo gets 1 point')
})
