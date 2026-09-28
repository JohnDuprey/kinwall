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
  const bday = (daysUntil: number, turning: number | null, date = turning === null ? '--09-13' : '2015-09-13') => birthdayText({ date, daysUntil, turning })
  assert.equal(bday(0, 8), 'Birthday today! 🎂')
  assert.equal(bday(1, 8), 'Turns 8 tomorrow 🎂')
  assert.equal(bday(37, 8), 'Turns 8 in 37 days')
  assert.equal(bday(37, null), 'Birthday in 37 days')
  assert.equal(bday(60, 8), 'Turns 8 in 60 days', 'the countdown starts 60 days out')
  // Just had one: say so for two weeks instead of counting down a whole year.
  assert.equal(bday(354, 11), 'Turned 10 on Sep 13 🎂')
  assert.equal(bday(351, 11), 'Turned 10 on Sep 13 🎂', '14 days after')
  assert.equal(bday(354, null), 'Birthday was Sep 13 🎂')
  // The rest of the year: just their age (nothing without a birth year).
  assert.equal(bday(350, 11), '10 years old')
  assert.equal(bday(61, 11), '10 years old')
  assert.equal(bday(1, 1, '2025-09-13'), 'Turns 1 tomorrow 🎂')
  assert.equal(bday(200, 1), 'Under 1 year old')
  assert.equal(bday(200, null), null)
  assert.deepEqual(['today', 'week', 'month', 'year', 'all'].map(p => periodWord(p as never, '2026-09-26')), ['today', 'this week', 'in September', 'in 2026', 'since joining'])
})

test('chartLabels: sparse enough to read', () => {
  assert.deepEqual(chartLabels(['2026-09-20', '2026-09-21', '2026-09-22'], 'week'), ['S', 'M', 'T'])
  assert.deepEqual(chartLabels(['2026-09-01', '2026-09-02', '2026-09-08', '2026-09-15'], 'month'), ['1', '', '8', '15'])
  assert.deepEqual(chartLabels(['2026-01', '2026-02', '2026-12'], 'year'), ['J', 'F', 'D'])
  assert.deepEqual(chartLabels(['2025-12', '2026-01', '2026-02', '2026-07'], 'all'), ['Dec ’25', 'Jan ’26', '', 'Jul ’26'])
})
