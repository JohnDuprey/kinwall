// node --test test/ (npm test). A timer's label from the minutes typed in the Timers sheet (which
// takes decimals): it has to say how long the timer actually runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { durationLabel } from '../src/timers.ts'

test('durationLabel: never "1 hr 60 min" or "60 min"', () => {
  assert.equal(durationLabel(119.5), '2 hr')
  assert.equal(durationLabel(59.999), '1 hr')
  assert.equal(durationLabel(90.4), '1 hr 30 min')
})

test('durationLabel: part minutes under an hour keep their seconds (a 90-second timer is not "2 min")', () => {
  assert.equal(durationLabel(1.5), '1 min 30 sec')
  assert.equal(durationLabel(2.25), '2 min 15 sec')
  assert.equal(durationLabel(0.5), '30 sec')
  assert.equal(durationLabel(10), '10 min')
})
