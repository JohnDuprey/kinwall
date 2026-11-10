// node --test test/ (npm test). An event's reminders in its details (Calendar.tsx). Google's "At
// time of event" notification arrives as 0 minutes, which read "🔔 0 days before".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reminderLabel } from '../src/types.ts'

test('reminderLabel: minutes, hours and days before', () => {
  assert.equal(reminderLabel([10]), '10 min before')
  assert.equal(reminderLabel([60, 1440]), '1 hour, 1 day before')
  assert.equal(reminderLabel([]), null)
  assert.equal(reminderLabel(null), null)
})

test('reminderLabel: a reminder at the start time says so, never "0 days before"', () => {
  assert.equal(reminderLabel([0]), 'At the start')
  assert.equal(reminderLabel([0, 0]), 'At the start')
  assert.equal(reminderLabel([10, 0]), 'At the start and 10 min before')
})
