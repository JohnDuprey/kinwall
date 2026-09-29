// node --test test/ (npm test). The energy battery's meter helpers: reasons, words and day labels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { batteryOn, dayLabel, DRAINED, drainedOf, levelWord, points, reasonLine } from '../src/battery.ts'

test('reasonLine: every reason with its points, a real minus sign, nothing hidden', () => {
  assert.equal(reasonLine([{ text: 'Sleep: ok', points: 60 }, { text: '3 events', points: -30 }, { text: 'Late evening yesterday', points: -10 }]),
    'Sleep: ok (+60) · 3 events (−30) · Late evening yesterday (−10)')
  assert.equal(reasonLine([]), '')
  assert.equal(reasonLine([{ text: 'Sleep: ok', points: 60 }, { text: 'Learning: 4 of 10 check-ins', points: 0 }]), 'Sleep: ok (+60) · Learning: 4 of 10 check-ins', 'a note, no points')
  assert.deepEqual([points(5), points(-5), points(0)], ['+5', '−5', '0'])
})

test('levelWord: calm words, never scary', () => {
  assert.deepEqual([100, 75, 74, 50, 49, 25, 24, 0].map(levelWord), ['Full', 'Full', 'Good', 'Good', 'Getting low', 'Getting low', 'Running low', 'Running low'])
})

test('dayLabel: today, tomorrow, then short weekdays', () => {
  assert.equal(dayLabel('2026-09-26', '2026-09-26'), 'Today')
  assert.equal(dayLabel('2026-09-27', '2026-09-26'), 'Tomorrow')
  assert.equal(dayLabel('2026-09-28', '2026-09-26'), 'Mon')
  assert.equal(dayLabel('2026-09-25', '2026-09-26'), 'Fri')
  assert.equal(dayLabel('2026-09-27', '2026-09-26', true), 'Sun', 'short, for the strip')
})

test('batteryOn: needs their Temp check on too', () => {
  assert.equal(batteryOn(undefined), false)
  assert.equal(batteryOn({ on: true, battery: true }), true)
  assert.equal(batteryOn({ on: false, battery: true }), false)
  assert.equal(batteryOn({ on: true }), false)
})

test('DRAINED: Full to Empty with calm faces, and how each reads back', () => {
  assert.deepEqual(DRAINED.map(d => d.label), ['Full', 'OK', 'Low', 'Empty'])
  assert.ok(DRAINED.every(d => d.emoji))
  assert.equal(drainedOf('low')?.label, 'Low')
  assert.equal(drainedOf('skip'), undefined)
  assert.equal(drainedOf(null), undefined)
})
