// node --test test/ (npm test). Which devices act as a wall screen, and when the night screen shows.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceKindOf, deviceKindValue, isWallScreen, nightScreenDue, parseDeviceKind, remoteNightAction, remoteNightKey, wallDefaultsOn, WAKE_MS } from '../src/wallScreen.ts'

test('isWallScreen: paired displays always are; other devices only with the switch on', () => {
  assert.equal(isWallScreen('display', {}), true)
  assert.equal(isWallScreen('display', { wallScreen: false }), true, 'a paired display cannot opt out')
  assert.equal(isWallScreen('admin', {}), false, 'a parent device is off by default')
  assert.equal(isWallScreen('admin', { wallScreen: true }), true)
  assert.equal(isWallScreen('', {}), false, 'scope not known yet')
})

test('device kinds: what a device is follows its owner, and round-trips through the picker', () => {
  const members = [{ id: 'alex', grownUp: true }, { id: 'leo' }]
  assert.equal(deviceKindOf({ kind: null, owner: 'shared' }, members), 'wall')
  assert.equal(deviceKindOf({ kind: null, owner: 'leo' }, members), 'kid')
  assert.equal(deviceKindOf({ owner: 'alex' }, members), 'grownup')
  assert.equal(deviceKindOf({ kind: 'kid', owner: 'leo' }, members), 'kid')
  assert.equal(deviceKindOf({ owner: null }, members), null, 'paired before owners')
  assert.equal(deviceKindValue({ owner: 'shared' }, members), 'wall')
  assert.equal(deviceKindValue({ owner: 'leo' }, members), 'kid:leo')
  assert.equal(deviceKindValue({ owner: null }, members), '')
  assert.equal(deviceKindValue({ owner: 'alex' }, members), '', "a paired grown-up's device needs a fix")
  assert.deepEqual(parseDeviceKind('wall'), { kind: 'wall' })
  assert.deepEqual(parseDeviceKind('kid:leo'), { kind: 'kid', owner: 'leo' })
})

test('wallDefaultsOn: keep awake / idle reset default on for wall screens and kids, off for parents', () => {
  assert.equal(wallDefaultsOn(false, {}), true)
  assert.equal(wallDefaultsOn(true, {}), false)
  assert.equal(wallDefaultsOn(true, { wallScreen: true }), true)
})

const at = (h: number, m = 0) => new Date(2026, 8, 29, h, m)
const quiet = { quietFrom: '22:00', quietTo: '06:00' }

test('nightScreenDue: only on a wall screen, inside quiet hours that wrap past midnight', () => {
  for (const [h, want] of [[21, false], [22, true], [23, true], [0, true], [5, true], [6, false], [12, false]] as const) {
    assert.equal(nightScreenDue({ wall: true, ...quiet, now: at(h, h === 5 ? 59 : 0), lastActive: 0 }), want, `${h}:00`)
  }
  assert.equal(nightScreenDue({ wall: false, ...quiet, now: at(23), lastActive: 0 }), false, 'not a wall screen')
})

test('nightScreenDue: a same-day window, and quiet hours off', () => {
  assert.equal(nightScreenDue({ wall: true, quietFrom: '13:00', quietTo: '15:00', now: at(14), lastActive: 0 }), true)
  assert.equal(nightScreenDue({ wall: true, quietFrom: '13:00', quietTo: '15:00', now: at(23), lastActive: 0 }), false)
  assert.equal(nightScreenDue({ wall: true, quietFrom: null, quietTo: null, now: at(23), lastActive: 0 }), false)
})

test('nightScreenDue: a tap wakes it until WAKE_MS without a touch', () => {
  const now = at(23)
  assert.equal(nightScreenDue({ wall: true, ...quiet, now, lastActive: now.getTime() - 1000 }), false)
  assert.equal(nightScreenDue({ wall: true, ...quiet, now, lastActive: now.getTime() - WAKE_MS - 1 }), true)
})

const on = (since: string) => ({ on: true, since, until: '2099-01-01T00:00:00Z' })

test('remoteNightAction: Home Assistant starts and wakes wall screens, once per change', () => {
  assert.equal(remoteNightAction(undefined, on('a'), true), 'start', 'on when the wall loads: start')
  assert.equal(remoteNightAction(undefined, null, true), null, 'off when the wall loads: leave it alone')
  assert.equal(remoteNightAction('a', on('a'), true), null, 'still on after a local wake: no re-sleep')
  assert.equal(remoteNightAction('a', on('b'), true), 'start', 'a new "on": sleep again')
  assert.equal(remoteNightAction('a', null, true), 'stop', 'off (or run out): wake')
  assert.equal(remoteNightAction('', null, true), null)
  assert.equal(remoteNightAction(undefined, undefined, true), null, 'not polled yet')
  assert.equal(remoteNightAction(undefined, on('a'), false), null, 'not a wall screen')
  assert.equal(remoteNightKey(on('a')), 'a')
  assert.equal(remoteNightKey(null), '')
})
