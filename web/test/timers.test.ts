// node --test test/ (npm test). Timers on this device (timers.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { added, clock, due, durationLabel, paused, remaining, resumed, wasReset, type Timer } from '../src/timers.ts'

test('clock and duration labels', () => {
  assert.equal(clock(65_000), '1:05')
  assert.equal(clock(3_725_000), '1:02:05')
  assert.equal(clock(-5), '0:00')
  assert.equal(clock(59_001), '1:00', 'rounds up: a timer never shows 0:00 before it rings')
  assert.deepEqual([0.5, 5, 60, 90].map(durationLabel), ['30 sec', '5 min', '1 hr', '1 hr 30 min'])
})

test('start, pause, resume, reset and ring', () => {
  let ts: Timer[] = added([], { label: 'Homework · 10 min', seconds: 600 }, 1000)
  ts = added(ts, { label: 'Rice · 15 min', seconds: 900, title: 'Tuesday Tacos', detail: 'Step 2', key: 'r1:1:Rice · 15 min' }, 1000)
  const [a, b] = ts
  assert.notEqual(a.id, b.id, 'two started in the same millisecond still get their own ids')
  assert.equal(remaining(a, 500), 600_000, 'never more than its full time')
  assert.equal(remaining(a, 61_000), 540_000)

  ts = paused(ts, a.id, 61_000)
  assert.equal(ts[0].left, 540_000)
  assert.equal(remaining(ts[0], 999_999), 540_000, 'a paused timer holds')
  assert.deepEqual(due(ts, 10_000_000).map(t => t.id), [b.id], 'a paused timer never rings')

  ts = resumed(ts, a.id, 100_000)
  assert.equal(ts[0].endsAt, 640_000)
  assert.equal(ts[0].left, undefined)

  ts = wasReset(ts, a.id, 200_000)
  assert.equal(ts[0].endsAt, 800_000, 'reset: the full time again from now')
  ts = paused(ts, a.id, 300_000)
  ts = wasReset(ts, a.id, 400_000)
  assert.equal(ts[0].left, 600_000, 'a paused timer stays paused at its full time')

  assert.deepEqual(due(ts, 901_000).map(t => t.label), ['Rice · 15 min'])
  assert.deepEqual(due(ts, 900_000), [], 'not before its end')
})
