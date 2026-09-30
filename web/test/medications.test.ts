// node --test test/ (npm test). Medication reminders: schedule labels, card labels, the week grid.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASK_AFTER_MS, askWhenTaken, cardLabel, catchUpLabel, earlierInput, pickedTime, statusLabel, cheerLine, dayStartDue, doseTimeLabel, timeLabel, courseLabel, daysLabel, scheduleLabel, weekCells } from '../src/medications.ts'
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

test('catchUpLabel: a due dose gets "Taken", one past its window "Taken late"; marked or later ones get no buttons', () => {
  assert.equal(catchUpLabel('due'), 'Taken')
  assert.equal(catchUpLabel('missed'), 'Taken late')
  for (const s of ['taken', 'skipped', 'upcoming'] as const) assert.equal(catchUpLabel(s), null)
})

test('"When I start my day": its schedule label, and a dose that says when the day started', () => {
  setHour12(true)
  const wake = { wake: true as const, latest: '12:00' }
  assert.equal(timeLabel(wake), 'When I start my day (by 12:00 PM)')
  assert.equal(scheduleLabel({ times: [wake, '20:00'], days: [0, 1, 2, 3, 4, 5, 6] }), 'When I start my day (by 12:00 PM) and 8:00 PM · Every day')
  assert.equal(doseTimeLabel({ time: 'wake', startedAt: null }), 'When you start your day')
  assert.equal(doseTimeLabel({ time: 'wake', startedAt: new Date(2026, 8, 28, 9, 40).toISOString() }), 'Started at 9:40 AM')
  assert.equal(doseTimeLabel({ time: '08:00', startedAt: null }), '8:00 AM')
})

test("dayStartDue: once a day per person-owned device with medications on, a grown-up's own parent device too; never a shared one", () => {
  const own = { medications: true, parentDevice: false, ownerId: 'm4', ownerGrownUp: false, today: '2026-09-28' }
  assert.equal(dayStartDue(own, null), true)
  assert.equal(dayStartDue(own, '2026-09-27'), true)
  assert.equal(dayStartDue(own, '2026-09-28'), false, 'already today')
  assert.equal(dayStartDue({ ...own, parentDevice: true, ownerGrownUp: true }, null), true, "a grown-up's own phone starts their day")
  assert.equal(dayStartDue({ ...own, parentDevice: true }, null), false, "a parent's device never starts a kid's day")
  assert.equal(dayStartDue({ ...own, parentDevice: true, ownerId: null }, null), false, "a parent's device nobody owns")
  assert.equal(dayStartDue({ ...own, ownerId: null }, null), false, 'a shared wall')
  assert.equal(dayStartDue({ ...own, medications: false }, null), false)
})

test('askWhenTaken: Taken asks "When did you take it?" only past 15 minutes after the dose time', () => {
  const due = new Date(2026, 8, 29, 8, 0)
  assert.equal(ASK_AFTER_MS, 15 * 60_000)
  assert.equal(askWhenTaken(due.toISOString(), due.getTime() + 14 * 60_000), false, 'on time: one tap')
  assert.equal(askWhenTaken(due.toISOString(), due.getTime() + 15 * 60_000), false)
  assert.equal(askWhenTaken(due.toISOString(), due.getTime() + 16 * 60_000), true)
  assert.equal(askWhenTaken(due.toISOString(), due.getTime() - 60 * 60_000), false, 'early')
})

test('earlierInput: a time for today, from midnight to now; a date and time for yesterday, from its midnight', () => {
  const now = new Date(2026, 8, 29, 21, 30).getTime()
  assert.deepEqual(earlierInput('2026-09-29', '2026-09-29', new Date(2026, 8, 29, 8, 0).toISOString(), now), { type: 'time', min: '00:00', max: '21:30', value: '08:00' })
  assert.deepEqual(earlierInput('2026-09-28', '2026-09-29', new Date(2026, 8, 28, 20, 0).toISOString(), now), { type: 'datetime-local', min: '2026-09-28T00:00', max: '2026-09-29T21:30', value: '2026-09-28T20:00' })
  assert.equal(earlierInput('2026-09-29', '2026-09-29', new Date(2026, 8, 29, 22, 0).toISOString(), now).value, '21:30', 'never later than now')
})

test('pickedTime: the input back to an instant on the dose’s day', () => {
  assert.equal(pickedTime('07:45', '2026-09-29'), new Date(2026, 8, 29, 7, 45).toISOString())
  assert.equal(pickedTime('2026-09-28T20:05', '2026-09-28'), new Date(2026, 8, 28, 20, 5).toISOString())
  assert.equal(pickedTime('', '2026-09-28'), null)
})

test('statusLabel: a dose taken after its window says "Taken late"; a backdated one inside it "Taken"', () => {
  assert.equal(statusLabel({ status: 'taken', late: true }), 'Taken late')
  assert.equal(statusLabel({ status: 'taken', late: false }), 'Taken')
  assert.equal(statusLabel({ status: 'missed', late: false }), 'Not marked')
})
