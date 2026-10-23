import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routineHomeMembers, routineHomeStatus, routineChild } from '../src/routineHome.ts'
import type { RoutineState } from '../src/routineMode.ts'
const now = Date.parse('2026-10-23T16:00:00Z')
const state = { enabled: true, locked: true, reason: 'routine', checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 3600000).toISOString(), remaining: [{ id: 'read', title: 'Read', completed: false, pending: true }] } as RoutineState
const members = [{ id: 'alex', grownUp: true }, { id: 'maya', grownUp: false }, { id: 'leo', grownUp: false }]
test('Home free time status follows the server decision and never infers unlock from ordinary chore counts', () => {
  assert.equal(routineHomeStatus(state, false, now), 'locked')
  assert.equal(routineHomeStatus({ ...state, reason: 'ready', locked: false, remaining: [] }, false, now), 'ready')
  assert.equal(routineHomeStatus({ ...state, reason: 'bedtime', remaining: [] }, false, now), 'bedtime')
  assert.equal(routineHomeStatus({ ...state, reason: 'bedtime', validUntil: new Date(now - 1000).toISOString() }, false, now), 'bedtime')
  assert.equal(routineHomeStatus({ ...state, reason: 'scheduled', locked: false }, false, now), 'scheduled')
  assert.equal(routineHomeStatus({ ...state, enabled: false }, false, now), null)
})
test('offline, stale and expired grants cannot claim that free time is available', () => {
  const ready = { ...state, locked: false, reason: 'ready', remaining: [] }
  assert.equal(routineHomeStatus(ready, true, now), 'unknown')
  assert.equal(routineHomeStatus(ready, false, now + 91000), 'unknown')
  assert.equal(routineHomeStatus({ ...ready, validUntil: new Date(now).toISOString() }, false, now), 'unknown')
  assert.equal(routineHomeStatus({ ...ready, checkedAt: 'invalid' }, false, now), 'unknown')
})
test('Home requests only children allowed for this device and respects the chosen person', () => {
  assert.deepEqual(routineHomeMembers(members, true, null, null, null).map(m => m.id), ['maya', 'leo'])
  assert.deepEqual(routineHomeMembers(members, true, null, 'leo', null).map(m => m.id), ['leo'])
  assert.deepEqual(routineHomeMembers(members, false, 'maya', null, null).map(m => m.id), ['maya'])
  assert.deepEqual(routineHomeMembers(members, false, 'maya', 'leo', null), [])
  assert.deepEqual(routineHomeMembers(members, false, null, null, null), [])
  assert.deepEqual(routineHomeMembers(members, true, null, null, 'maya').map(m => m.id), ['maya'])
})
test('Free time links select the matching child without accepting an unknown member', () => {
  assert.equal(routineChild(members.filter(m => !m.grownUp), null, 'leo'), 'leo')
  assert.equal(routineChild(members.filter(m => !m.grownUp), 'maya', 'unknown'), 'maya')
  assert.equal(routineChild(members.filter(m => !m.grownUp), null, 'alex'), 'maya')
})
