// node --test test/ (npm test). The Insights page's chart helpers: weekly buckets, scales and words.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chartMax, confidenceLabel, keepCheckingIn, shortDate, sleepPath, weekly } from '../src/insights.ts'
import type { InsightDay } from '../src/types.ts'

const day = (date: string, p: Partial<InsightDay> = {}): InsightDay => ({
  date, checkedIn: false, sleep: null, feelings: [], goalSet: false, goalOutcome: null, journalEntries: 0, journalMoods: [],
  chores: 0, points: 0, activityMinutes: 0, booksFinished: 0, events: 0, lastEventEnd: null, ...p,
})
const days = (n: number, f: (i: number) => Partial<InsightDay> = () => ({})) =>
  Array.from({ length: n }, (_, i) => day(new Date(Date.parse('2026-09-01T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10), f(i)))

test('weekly: whole weeks ending on the last day, with goal outcomes, chores, activity and feelings', () => {
  const w = weekly(days(14, i => ({
    goalSet: i < 5, goalOutcome: i < 2 ? 'yes' : i === 2 ? 'partly' : i === 3 ? 'no' : null,
    chores: i % 2, activityMinutes: 10, feelings: i === 0 ? ['Tired', 'good'] : i === 8 ? ['tired'] : [],
  })))
  assert.deepEqual(w.map(x => [x.from, x.to]), [['2026-09-01', '2026-09-07'], ['2026-09-08', '2026-09-14']])
  assert.deepEqual(w[0].goals, { set: 5, met: 2, partly: 1, no: 1, open: 1 })
  assert.deepEqual([w[0].chores, w[1].chores, w[0].activityMinutes], [3, 4, 70])
  assert.deepEqual([w[0].feelings.tired, w[0].feelings.good, w[1].feelings.tired], [1, 1, 1])
  // A range that isn't whole weeks: the first week is the short one.
  assert.deepEqual(weekly(days(9)).map(x => x.days.length), [2, 7])
  assert.deepEqual(weekly([]), [])
})

test('chartMax: a round top for the scale, never 0', () => {
  assert.deepEqual([0, 1, 3, 4, 7, 11, 38, 120, 480].map(chartMax), [1, 1, 3, 4, 7, 15, 40, 150, 500])
})

test('sleepPath: to scale, great at the top, gaps break the line', () => {
  const d = days(5, i => ({ sleep: (['great', 'terrible', null, 'ok', 'good'] as const)[i] }))
  // 5 days across 100 wide (each in the middle of its slot), 40 high: great = 0, terrible = 40.
  assert.equal(sleepPath(d, 100, 40), 'M10 0L30 40M70 20L90 10')
  assert.equal(sleepPath(days(3, i => ({ sleep: i === 1 ? 'good' : null })), 30, 40), 'M15 10L15 10', 'a lone night is a dot')
  assert.equal(sleepPath(days(2), 10, 10), '')
})

test('words: dates, confidence and the wait for connections', () => {
  assert.equal(shortDate('2026-09-03'), 'Sep 3')
  assert.equal(confidenceLabel('early'), 'Early sign')
  assert.equal(confidenceLabel('clear'), 'Clear pattern')
  assert.equal(keepCheckingIn(12), 'Keep checking in: patterns show up after about 3 weeks (12 days so far).')
  assert.equal(keepCheckingIn(1), 'Keep checking in: patterns show up after about 3 weeks (1 day so far).')
})
