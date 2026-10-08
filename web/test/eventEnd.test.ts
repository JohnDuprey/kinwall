// node --test test/ (npm test). The event sheet's end following its start (eventEnd.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMinutes, endAfterStartMove } from '../src/eventEnd.ts'

test('endAfterStartMove: an end nobody picked is the start plus the default length', () => {
  const from = { date: '2027-03-10', time: '09:00' }, end = { date: '2027-03-10', time: '10:00' }
  assert.deepEqual(endAfterStartMove(from, end, { date: '2027-03-10', time: '14:15' }, 30, false), { date: '2027-03-10', time: '14:45' })
  assert.deepEqual(endAfterStartMove(from, end, { date: '2027-03-12', time: '09:00' }, 90, false), { date: '2027-03-12', time: '10:30' })
})

test('endAfterStartMove: a picked end keeps its length when the start moves', () => {
  const from = { date: '2027-03-10', time: '09:00' }, end = { date: '2027-03-10', time: '11:30' }
  assert.deepEqual(endAfterStartMove(from, end, { date: '2027-03-10', time: '13:00' }, 60, true), { date: '2027-03-10', time: '15:30' })
  // An end before the start has no length to keep: the default again.
  assert.deepEqual(endAfterStartMove(from, { date: '2027-03-10', time: '08:00' }, { date: '2027-03-10', time: '13:00' }, 60, true), { date: '2027-03-10', time: '14:00' })
})

test('endAfterStartMove: crossing midnight moves the end to the next day', () => {
  const from = { date: '2027-03-10', time: '20:00' }, end = { date: '2027-03-10', time: '22:00' }
  assert.deepEqual(endAfterStartMove(from, end, { date: '2027-03-10', time: '23:30' }, 60, false), { date: '2027-03-11', time: '00:30' })
  assert.deepEqual(endAfterStartMove(from, end, { date: '2027-03-10', time: '23:00' }, 60, true), { date: '2027-03-11', time: '01:00' })
  assert.deepEqual(addMinutes({ date: '2027-12-31', time: '23:45' }, 180), { date: '2028-01-01', time: '02:45' })
})
