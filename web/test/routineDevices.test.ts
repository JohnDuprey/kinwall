import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routineDeviceDelivery } from '../src/routineDevices.ts'

const now = Date.parse('2026-10-23T12:00:00Z')
const device = { id: 'demo-ipad', name: 'Maya iPad', authorized: true, appliedRevision: 2, locked: true, lastSeenAt: new Date(now - 10000).toISOString() }
test('device delivery distinguishes authorization, pending choices and stale reports', () => {
  assert.equal(routineDeviceDelivery(device, 2, now), 'received')
  assert.equal(routineDeviceDelivery({ ...device, authorized: false }, 2, now), 'authorization')
  assert.equal(routineDeviceDelivery(device, 3, now), 'pending')
  assert.equal(routineDeviceDelivery({ ...device, lastSeenAt: new Date(now - 121000).toISOString() }, 2, now), 'offline')
  assert.equal(routineDeviceDelivery({ ...device, lastSeenAt: 'invalid' }, 2, now), 'offline')
  assert.equal(routineDeviceDelivery(device, 0, now), 'choices')
})

test('all-app mode does not ask for choices when no exceptions were saved', () => {
  assert.equal(routineDeviceDelivery(device, 0, now, false), 'authorized')
  assert.equal(routineDeviceDelivery({ ...device, authorized: false }, 0, now, false), 'authorization')
  assert.equal(routineDeviceDelivery({ ...device, lastSeenAt: 'invalid' }, 0, now, false), 'offline')
  assert.equal(routineDeviceDelivery(device, 3, now, false), 'pending')
})
