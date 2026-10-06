// node --test test/ (npm test). Activity chores: which seconds of an open activity count (Plugins.tsx).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUCKET_MS, playClock, ringFraction } from '../src/playtime.ts'

const S = BUCKET_MS / 1000
// Ticks once a second from `from` to `to` (exclusive of from), visible or not; returns seconds counted.
function run(clock: ReturnType<typeof playClock>, from: number, to: number, visible = true) {
  let counted = 0
  for (let t = from + 1000; t <= to; t += 1000) counted += clock.tick(t, visible)
  return counted
}

test('the step is 15 seconds', () => {
  assert.equal(BUCKET_MS, 15_000)
})

test('a step with an interaction in it counts in full, once it ends', () => {
  const clock = playClock(0)
  clock.interact(3000)
  assert.equal(run(clock, 0, 14_000), 0) // still in the step: nothing counted yet
  assert.equal(clock.pending(), 14) // but the chip can show it moving
  assert.equal(run(clock, 14_000, 16_000), S)
})

test('a step with no interaction counts nothing, launch included', () => {
  const clock = playClock(0)
  assert.equal(run(clock, 0, 60_000), 0)
  assert.equal(clock.pending(), 0)
})

test('each step needs its own interaction', () => {
  const clock = playClock(0)
  clock.interact(1000) // step 0
  clock.interact(31_000) // step 2; step 1 has none
  assert.equal(run(clock, 0, 46_000), 2 * S)
})

test('an interaction just after a step ends belongs to the next step', () => {
  const clock = playClock(0)
  clock.interact(2000)
  clock.interact(15_200) // arrives before the tick that closes step 0
  assert.equal(run(clock, 0, 31_000), 2 * S)
})

test('hidden seconds never count, even in a step with an interaction', () => {
  const clock = playClock(0)
  clock.interact(1000)
  let counted = 0
  for (let t = 1000; t <= 16_000; t += 1000) counted += clock.tick(t, t <= 5000) // hidden after 5 s
  assert.equal(counted, 5)
})

test('settle counts the current step now and starts it again from zero', () => {
  const clock = playClock(0)
  clock.interact(1000)
  run(clock, 0, 6000)
  assert.equal(clock.settle(), 6)
  assert.equal(clock.pending(), 0)
  assert.equal(run(clock, 6000, 16_000), 9) // the rest of the step still counts: 15 in all, never twice
})

test('the ring fills from 0 to 1 and never past it', () => {
  assert.equal(ringFraction(0, 600), 0)
  assert.equal(ringFraction(150, 600), 0.25)
  assert.equal(ringFraction(900, 600), 1)
  assert.equal(ringFraction(10, 0), 1)
})
