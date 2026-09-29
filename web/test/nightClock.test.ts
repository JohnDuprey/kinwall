// node --test test/ (npm test). Where the quiet-hours clock sits, and where "Moves around" sends it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLOCK_SPOTS, nextSpot, type Spot } from '../src/nightClock.ts'

const inBounds = (s: Spot) => s.x >= 0 && s.x <= 100 && s.y >= 0 && s.y <= 100
const same = (a: Spot, b: Spot) => a.x === b.x && a.y === b.y
const corner = (s: Spot) => (s.x === 0 || s.x === 100) && (s.y === 0 || s.y === 100)

test('nextSpot: always on screen, never the same spot twice in a row', () => {
  for (const corners of [false, true]) {
    let spot: Spot | undefined
    for (let i = 0; i < 500; i++) {
      const next = nextSpot(spot, corners)
      assert.ok(inBounds(next), `in bounds: ${JSON.stringify(next)}`)
      if (spot) assert.ok(!same(next, spot), 'moved')
      if (corners) assert.ok(corner(next), 'over a slideshow it keeps to the corners')
      spot = next
    }
  }
})

test('nextSpot: every spot is reachable, the edges of random() included', () => {
  const from = CLOCK_SPOTS.center
  const seen = new Set<string>()
  for (let r = 0; r < 1; r += 0.01) seen.add(JSON.stringify(nextSpot(from, false, () => r)))
  assert.equal(seen.size, 8, 'the other eight of the 3 × 3 grid')
  assert.ok(!seen.has(JSON.stringify(from)))
  assert.ok(inBounds(nextSpot(from, false, () => 0.999999)))
})

test('CLOCK_SPOTS: the fixed choices are on screen', () => {
  for (const s of Object.values(CLOCK_SPOTS)) assert.ok(inBounds(s))
})
