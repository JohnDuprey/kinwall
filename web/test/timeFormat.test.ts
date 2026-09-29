// node --test test/ (npm test). Clock times everywhere in the app: 12- or 24-hour, device first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deviceTimeFormat, formatTime, localeHour12, resolveHour12, setHour12 } from '../src/timeFormat.ts'

test('formatTime: HH:MM, midnight and noon, 12-hour', () => {
  setHour12(true)
  assert.equal(formatTime('00:00'), '12:00 AM')
  assert.equal(formatTime('00:30'), '12:30 AM')
  assert.equal(formatTime('12:00'), '12:00 PM')
  assert.equal(formatTime('15:40'), '3:40 PM')
  assert.equal(formatTime('7:05'), '7:05 AM')
  assert.equal(formatTime('15:00', undefined, { hourOnly: true }), '3 PM')
})

test('formatTime: HH:MM, midnight and noon, 24-hour', () => {
  setHour12(false)
  assert.equal(formatTime('00:00'), '00:00')
  assert.equal(formatTime('12:00'), '12:00')
  assert.equal(formatTime('15:40'), '15:40')
  assert.equal(formatTime('7:05'), '07:05')
  assert.equal(formatTime('15:00', undefined, { hourOnly: true }), '15:00')
  setHour12(true)
})

test('formatTime: an instant in the household timezone, or a local Date', () => {
  const iso = '2030-03-04T15:30:00Z'
  setHour12(true)
  assert.equal(formatTime(iso, 'UTC'), '3:30 PM')
  assert.equal(formatTime(iso, 'America/New_York'), '10:30 AM')
  assert.equal(formatTime('2030-03-04T00:00:00Z', 'UTC'), '12:00 AM')
  assert.equal(formatTime(new Date(2030, 2, 4, 12, 5)), '12:05 PM')
  setHour12(false)
  assert.equal(formatTime(new Date(iso), 'UTC'), '15:30')
  assert.equal(formatTime('2030-03-04T00:00:00Z', 'UTC'), '00:00')
  setHour12(true)
})

test('resolveHour12: this device, then the family, then the device locale', () => {
  assert.equal(resolveHour12('12', '24'), false)
  assert.equal(resolveHour12('24', '12'), true)
  assert.equal(resolveHour12('24', undefined), false)
  assert.equal(resolveHour12('12', undefined), true)
  assert.equal(resolveHour12('auto', undefined, 'en-US'), true)
  assert.equal(resolveHour12('auto', undefined, 'en-GB'), false)
  assert.equal(resolveHour12(undefined, undefined, 'de-DE'), false)
  assert.equal(resolveHour12('auto', '12', 'de-DE'), true)
})

test('localeHour12 and deviceTimeFormat', () => {
  assert.equal(localeHour12('en-US'), true)
  assert.equal(localeHour12('fr-FR'), false)
  assert.equal(deviceTimeFormat('24'), '24')
  for (const raw of [undefined, null, '', 'auto', 24]) assert.equal(deviceTimeFormat(raw), undefined, String(raw))
})
