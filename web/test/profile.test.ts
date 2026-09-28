// node --test test/ (npm test). The words and labels on a member's profile.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { birthdayText, chartLabels, compareText, duration, periodWord } from '../src/profile.ts'

test('compareText: only against your own earlier stretch, never scary', () => {
  assert.equal(compareText(12, { choresDone: 8 }, 'week', '2025-03-08'), '▲ 4 more than last week')
  assert.equal(compareText(8, { choresDone: 8 }, 'today', '2025-03-08'), 'Same as yesterday')
  assert.equal(compareText(3, { choresDone: 9 }, 'month', '2025-03-08'), '9 this time last month')
  assert.equal(compareText(3, { choresDone: 0 }, 'year', '2025-03-08'), '▲ 3 more than this time last year')
  assert.equal(compareText(40, null, 'all', '2025-03-08'), 'Since March 2025')
})

test('duration, birthdays and period words', () => {
  assert.deepEqual([duration(0), duration(59), duration(600), duration(3900)], ['0m', '0m', '10m', '1h 5m'])
  assert.equal(birthdayText({ daysUntil: 0, turning: 8 }), 'Birthday today! 🎂')
  assert.equal(birthdayText({ daysUntil: 1, turning: 8 }), 'Turns 8 tomorrow 🎂')
  assert.equal(birthdayText({ daysUntil: 37, turning: 8 }), 'Turns 8 in 37 days')
  assert.equal(birthdayText({ daysUntil: 37, turning: null }), 'Birthday in 37 days')
  assert.deepEqual(['today', 'week', 'month', 'year', 'all'].map(p => periodWord(p as never, '2026-09-26')), ['today', 'this week', 'in September', 'in 2026', 'since joining'])
})

test('chartLabels: sparse enough to read', () => {
  assert.deepEqual(chartLabels(['2026-09-20', '2026-09-21', '2026-09-22'], 'week'), ['S', 'M', 'T'])
  assert.deepEqual(chartLabels(['2026-09-01', '2026-09-02', '2026-09-08', '2026-09-15'], 'month'), ['1', '', '8', '15'])
  assert.deepEqual(chartLabels(['2026-01', '2026-02', '2026-12'], 'year'), ['J', 'F', 'D'])
  assert.deepEqual(chartLabels(['2025-12', '2026-01', '2026-02', '2026-07'], 'all'), ['Dec ’25', 'Jan ’26', '', 'Jul ’26'])
})
