// node --test test/ (npm test). Medication reminders: schedule labels, card labels, the week grid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardLabel, cheerLine, courseLabel, daysLabel, scheduleLabel, weekCells } from '../src/medications.ts'
import { setHour12 } from '../src/timeFormat.ts'

test('daysLabel: every day, weekdays, weekends, or the days in order', () => {
  assert.equal(daysLabel([0, 1, 2, 3, 4, 5, 6]), 'Every day')
  assert.equal(daysLabel([1, 2, 3, 4, 5]), 'Weekdays')
  assert.equal(daysLabel([0, 6]), 'Weekends')
  assert.equal(daysLabel([5, 1, 3]), 'Mon, Wed, Fri')
})

test('scheduleLabel: times for people, then the days', () => {
  setHour12(true)
  assert.equal(scheduleLabel({ times: ['08:00', '20:30'], days: [0, 1, 2, 3, 4, 5, 6] }), '8:00 AM and 8:30 PM · Every day')
  assert.equal(scheduleLabel({ times: ['07:15'], days: [2] }), '7:15 AM · Tue')
  setHour12(false)
  assert.equal(scheduleLabel({ times: ['08:00', '20:30'], days: [0, 1, 2, 3, 4, 5, 6] }), '08:00 and 20:30 · Every day')
  setHour12(true)
})

test('cardLabel: the name and dose where names show, "Meds" on a shared screen without them', () => {
  assert.equal(cardLabel({ name: 'Allergy medicine', dose: '1 tablet' }), 'Allergy medicine · 1 tablet')
  assert.equal(cardLabel({ name: 'Allergy medicine', dose: '' }), 'Allergy medicine')
  assert.equal(cardLabel({ name: null, dose: null }), 'Meds')
})

test('weekCells: one cell per day, oldest first, the worst of the day wins; days with nothing stay empty', () => {
  const days = [
    { date: '2026-09-26', doses: [] },
    { date: '2026-09-27', doses: [{ medicationId: 'a', time: '08:00', status: 'taken' as const, at: null, by: null }, { medicationId: 'a', time: '20:00', status: 'missed' as const, at: null, by: null }] },
    { date: '2026-09-28', doses: [{ medicationId: 'a', time: '08:00', status: 'taken' as const, at: null, by: null }, { medicationId: 'b', time: '08:00', status: 'skipped' as const, at: null, by: null }] },
  ]
  assert.deepEqual(weekCells(days, 'a'), [{ date: '2026-09-26', status: null }, { date: '2026-09-27', status: 'missed' }, { date: '2026-09-28', status: 'taken' }])
  assert.deepEqual(weekCells(days, 'b').map(c => c.status), [null, null, 'skipped'])
})

test('courseLabel: until an end date, doses left, or done', () => {
  assert.equal(courseLabel({ endDate: null, totalDoses: null, dosesLeft: null }), '')
  assert.equal(courseLabel({ endDate: '2026-10-05', totalDoses: null, dosesLeft: null }), 'Until Mon, Oct 5')
  assert.equal(courseLabel({ endDate: null, totalDoses: 20, dosesLeft: 7 }), '7 of 20 doses left')
  assert.equal(courseLabel({ endDate: null, totalDoses: 20, dosesLeft: 1 }), '1 of 20 doses left')
  assert.equal(courseLabel({ endDate: null, totalDoses: 20, dosesLeft: 0 }), 'Done: all 20 doses taken')
  assert.equal(scheduleLabel({ times: ['08:00'], days: [0, 1, 2, 3, 4, 5, 6], endDate: '2026-10-05', totalDoses: null, dosesLeft: null }), '8:00 AM · Every day · Until Mon, Oct 5')
})

test('cheerLine: names the person, and never repeats the last cheer', () => {
  const seq = [0, 0, 0.5]
  const r = () => seq.shift() ?? 0.5
  const first = cheerLine('Leo', undefined, () => 0)
  assert.match(first, /Leo/)
  assert.notEqual(cheerLine('Leo', first, r), first)
})
