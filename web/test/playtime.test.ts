// node --test test/ (npm test). Activity chores: which seconds of an open activity count (Plugins.tsx).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDLE_MS, countsNow, ringFraction } from '../src/playtime.ts'

test('play counts from launch, with no save from the activity', () => {
  const launched = 1_000_000
  assert.equal(countsNow(true, launched, launched + 1000), true)
  assert.equal(countsNow(true, launched, launched + IDLE_MS - 1000), true)
})

test('play stops counting after the idle period with nothing the player can see', () => {
  const last = 1_000_000
  assert.equal(countsNow(true, last, last + IDLE_MS), false)
  assert.equal(countsNow(true, last + IDLE_MS, last + IDLE_MS + 1000), true) // a tap, save or word starts it again
})

test('a hidden page never counts', () => {
  assert.equal(countsNow(false, 1000, 2000), false)
})

test('the idle period is generous but bounded', () => {
  assert.ok(IDLE_MS >= 2 * 60_000 && IDLE_MS <= 10 * 60_000)
})

test('the ring fills from 0 to 1 and never past it', () => {
  assert.equal(ringFraction(0, 600), 0)
  assert.equal(ringFraction(150, 600), 0.25)
  assert.equal(ringFraction(900, 600), 1)
  assert.equal(ringFraction(10, 0), 1)
})
