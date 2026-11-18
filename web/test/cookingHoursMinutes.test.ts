// node --test test/ (npm test). Cooking mode's timers for a time in hours and minutes: "Bake 1 hour
// 15 minutes" is one 75-minute timer, not a 1-hour one and a 15-minute one (either leaves it underdone).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDurations, stepTimers } from '../src/cooking.ts'

test('findDurations: hours and minutes together are one timer', () => {
  assert.deepEqual(findDurations('Bake for 1 hour 15 minutes, until golden.'), [{ label: '1 hr 15 min', seconds: 4500 }])
  assert.deepEqual(findDurations('Roast 2 hrs and 30 mins.'), [{ label: '2 hr 30 min', seconds: 9000 }])
  assert.deepEqual(findDurations('Braise 1 hr 5 min, then rest 10 minutes.'), [{ label: '1 hr 5 min', seconds: 3900 }, { label: '10 min', seconds: 600 }])
  // Still apart when they're about different things.
  assert.deepEqual(findDurations('Chill 1 hour. A 10-minute rest.'), [{ label: '1 hr', seconds: 3600 }, { label: '10 min', seconds: 600 }])
})

test('stepTimers: a combined time keeps the name of what it times, and matches a meal kit\'s timer', () => {
  assert.deepEqual(stepTimers({ text: 'Bake for 1 hour 15 minutes.', bullets: [] }), [{ label: 'Bake · 1 hr 15 min', seconds: 4500 }])
  assert.deepEqual(stepTimers({ text: 'Bake for 1 hour 15 minutes.', bullets: [], timers: [{ minutes: 75 }] } as never), [{ label: 'Bake · 1 hr 15 min', seconds: 4500 }])
})

test('stepTimers: "2 hrs and 30 mins" is named for its verb, not split at the "and"', () => {
  assert.deepEqual(stepTimers({ text: 'Roast 2 hrs and 30 mins, then rest 10 minutes.', bullets: [] }), [{ label: 'Roast · 2 hr 30 min', seconds: 9000 }, { label: 'Rest · 10 min', seconds: 600 }])
})
