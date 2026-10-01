// node --test test/ (npm test). Timezone picker: offsets, local times, names and order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clockTimeZone, offsetLabel, tzCity, tzInfo, tzOrder } from '../src/timezone.ts'
import { setHour12 } from '../src/timeFormat.ts'

test('offsetLabel: GMT offsets read as UTC with a real minus sign', () => {
  assert.equal(offsetLabel('GMT-4'), 'UTC−4')
  assert.equal(offsetLabel('GMT+5:45'), 'UTC+5:45')
  assert.equal(offsetLabel('GMT'), 'UTC')
  assert.equal(offsetLabel('GMT+0'), 'UTC', 'newer ICU (Node 26) says GMT+0 for UTC')
})

test('tzInfo: local time and offset at a moment, daylight saving included', () => {
  const summer = new Date('2026-07-01T00:04:00Z'), winter = new Date('2026-01-01T01:04:00Z')
  setHour12(true)
  assert.deepEqual(tzInfo('America/New_York', summer), { time: '8:04 PM', offset: 'UTC−4' })
  assert.deepEqual(tzInfo('America/New_York', winter), { time: '8:04 PM', offset: 'UTC−5' })
  assert.deepEqual(tzInfo('Asia/Kathmandu', summer), { time: '5:49 AM', offset: 'UTC+5:45' })
  assert.deepEqual(tzInfo('UTC', summer), { time: '12:04 AM', offset: 'UTC' })
  setHour12(false)
  assert.deepEqual(tzInfo('America/New_York', summer), { time: '20:04', offset: 'UTC−4' })
  setHour12(true)
})

test('tzCity: the last part, with spaces', () => {
  assert.equal(tzCity('America/New_York'), 'New York')
  assert.equal(tzCity('America/Argentina/Buenos_Aires'), 'Buenos Aires')
  assert.equal(tzCity('UTC'), 'UTC')
})

test('tzOrder: this device and the current zone first, once each', () => {
  const all = ['UTC', 'America/Chicago', 'America/New_York', 'Europe/Paris']
  assert.deepEqual(tzOrder(all, 'America/New_York', 'Europe/Paris'), ['America/New_York', 'Europe/Paris', 'UTC', 'America/Chicago'])
  assert.deepEqual(tzOrder(all, 'America/New_York', 'America/New_York'), ['America/New_York', 'UTC', 'America/Chicago', 'Europe/Paris'])
  // A saved zone the list lacks (an old alias like US/Eastern) still shows, so the row never lies.
  assert.deepEqual(tzOrder(all, 'America/Chicago', 'US/Eastern'), ['America/Chicago', 'US/Eastern', 'UTC', 'America/New_York', 'Europe/Paris'])
})

test("the clock shows the family's zone unless this device picks its own", () => {
  assert.equal(clockTimeZone('America/New_York', {}, 'America/Los_Angeles'), 'America/New_York')
  assert.equal(clockTimeZone('America/New_York', { clockZone: 'device' }, 'America/Los_Angeles'), 'America/Los_Angeles')
  assert.equal(clockTimeZone(null, {}, 'America/Los_Angeles'), undefined, 'no family zone yet: the browser decides')
})
