// node --test test/ (npm test). Timers on this device (timers.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { added, checksDue, clock, due, durationLabel, paused, phase, remaining, resumed, timerWords, untilNext, wasReset, type Timer } from '../src/timers.ts'

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

test('a range timer: counts to the check, then on to the end', () => {
  let ts: Timer[] = added([], { label: '5–6 min', seconds: 360, check: 300, key: 'r1:2:5–6 min' }, 0)
  const at = (ms: number) => ts[0] && { phase: phase(ts[0], ms), next: untilNext(ts[0], ms), words: timerWords(ts[0], ms) }
  assert.deepEqual(at(60_000), { phase: 'counting', next: 240_000, words: ['Check at 5 min · done by 6'] })
  assert.deepEqual(checksDue(ts, 299_999), [])
  assert.deepEqual(checksDue(ts, 300_000).length, 1, 'chimes at the low end')
  assert.deepEqual(at(300_000), { phase: 'check', next: 60_000, words: ['Check it', 'Up to 1 min more'] })
  assert.deepEqual(due(ts, 300_000), [], 'it keeps running')
  ts = ts.map(t => ({ ...t, checked: true }))
  assert.deepEqual(checksDue(ts, 310_000), [], 'chimes once')
  assert.deepEqual(due(ts, 360_000).length, 1, 'rings at the high end')
  assert.equal(phase({ ...ts[0], done: true }, 360_000), 'done')

  ts = wasReset(ts, ts[0].id, 400_000)
  assert.equal(ts[0].checked, false, 'reset: it chimes again')
  assert.equal(phase(ts[0], 400_000), 'counting')
  ts = paused(ts, ts[0].id, 730_000)
  assert.deepEqual(checksDue(ts, 999_999), [], 'a paused one never chimes')
  assert.equal(phase(ts[0], 999_999), 'check', 'paused in the check part stays there')

  const late = added([], { label: '5–6 min', seconds: 360, check: 300 }, 0)
  assert.deepEqual(checksDue(late, 400_000), [], 'both ends passed (a reload after a while): only the end rings')
})

test('range words: named, hours and seconds, long ranges; a single time is as before', () => {
  const t = (label: string, seconds: number, check?: number): Timer => ({ id: 1, label, seconds, check, endsAt: seconds * 1000, done: false })
  assert.deepEqual(timerWords(t('Veggies · 15–20 min', 1200, 900), 0), ['Veggies · Check at 15 min · done by 20'])
  assert.deepEqual(timerWords(t('Veggies · 15–20 min', 1200, 900), 900_000), ['Veggies · Check it', 'Up to 5 min more'])
  assert.deepEqual(timerWords(t('1–1.5 hr', 5400, 3600), 0), ['Check at 1 hr · done by 1.5'])
  assert.deepEqual(timerWords(t('1–1.5 hr', 5400, 3600), 3_600_000), ['Check it', 'Up to 30 min more'])
  assert.deepEqual(timerWords(t('30–45 sec', 45, 30), 30_000), ['Check it', 'Up to 15 sec more'])
  assert.deepEqual(timerWords(t('25–35 min', 2100, 1500), 0), ['Check at 25 min · done by 35'])
  assert.deepEqual(timerWords(t('Rice · 15 min', 900), 0), ['Rice · 15 min'])
  assert.equal(untilNext(t('Rice · 15 min', 900), 100_000), 800_000)
  // Saved before ranges (a reload mid-cook): no check, so exactly as before.
  const old = JSON.parse('{"id":5,"label":"5–7 min","seconds":300,"endsAt":300000,"done":false}') as Timer
  assert.deepEqual([phase(old, 100_000), untilNext(old, 100_000), timerWords(old, 100_000)], ['counting', 200_000, ['5–7 min']])
  assert.deepEqual(checksDue([old], 299_000), [])
})
