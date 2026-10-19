import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rruleToForm, formToRrule, scheduleDates, scheduleText, scheduleBody, validSchedule } from '../src/choreSchedule.ts'

test('custom schedules round trip without dropping interval, week boundary or end condition', () => {
  for (const rule of [
    'FREQ=DAILY;INTERVAL=3;COUNT=8',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR,SA,SU;WKST=MO',
    'FREQ=MONTHLY;BYDAY=-1SU;UNTIL=20271231',
    'FREQ=MONTHLY;BYMONTHDAY=15',
    'FREQ=YEARLY;INTERVAL=2',
  ]) {
    const parsed = rruleToForm(rule)
    assert.equal(parsed.custom, false, rule)
    assert.deepEqual(rruleToForm(formToRrule(parsed)), parsed, rule)
  }
})

test('unsupported rules are preserved, including timed UNTIL and daily weekday filters', () => {
  for (const rule of ['FREQ=MONTHLY;BYSETPOS=2;BYDAY=MO,TU', 'FREQ=DAILY;BYDAY=MO', 'FREQ=DAILY;UNTIL=20260601T090000Z', 'FREQ=YEARLY;BYMONTH=4', 'FREQ=WEEKLY;INTERVAL=0', 'FREQ=DAILY;COUNT=2;UNTIL=20260601']) {
    assert.equal(rruleToForm(rule).custom, true, rule)
  }
})

test('alternating daily duties cover whole weeks for Maya then Leo, including Sundays', () => {
  const rule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR,SA,SU;WKST=MO'
  const maya = scheduleDates(rule, '2026-10-19', '2026-10-19', 14)
  const leo = scheduleDates(rule, '2026-10-26', '2026-10-19', 14)
  assert.deepEqual(maya.slice(0, 7), ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'])
  assert.equal(maya[7], '2026-11-02')
  assert.equal(leo[0], '2026-10-26')
  assert.equal(leo[6], '2026-11-01')
  assert.equal(leo[7], '2026-11-09')
})

test('previews respect month ends, ordinal weekdays, leap days, COUNT and inclusive UNTIL', () => {
  assert.deepEqual(scheduleDates('FREQ=MONTHLY', '2026-01-31', '2026-01-31', 3), ['2026-01-31', '2026-03-31', '2026-05-31'])
  assert.deepEqual(scheduleDates('FREQ=MONTHLY;BYDAY=3SU', '2026-10-01', '2026-10-01', 2), ['2026-10-18', '2026-11-15'])
  assert.deepEqual(scheduleDates('FREQ=YEARLY', '2024-02-29', '2026-01-01', 2), ['2028-02-29', '2032-02-29'])
  assert.deepEqual(scheduleDates('FREQ=DAILY;COUNT=2', '2026-10-19', '2026-10-20', 3), ['2026-10-20'])
  assert.deepEqual(scheduleDates('FREQ=DAILY;UNTIL=20261020', '2026-10-19', '2026-10-19', 3), ['2026-10-19', '2026-10-20'])
})

test('labels distinguish every other week from daily and preserve unfamiliar rules', () => {
  assert.match(scheduleText('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR,SA,SU;WKST=MO'), /Every 2 weeks/)
  assert.match(scheduleText('FREQ=MONTHLY;BYDAY=-1SU'), /last/i)
  assert.equal(scheduleText('FREQ=YEARLY;BYMONTH=4'), 'Custom schedule')
})

test('saving unrelated edits keeps both the original rule and its start date', () => {
  const original = { rrule: 'FREQ=WEEKLY;INTERVAL=2', dueDate: '2026-10-19' }
  assert.deepEqual(scheduleBody(original, rruleToForm(original.rrule), false, '2026-10-19'), original)
  assert.deepEqual(scheduleBody({ rrule: 'FREQ=WEEKLY', dueDate: null }, rruleToForm('FREQ=WEEKLY'), false, ''), { rrule: 'FREQ=WEEKLY', dueDate: null })
})

test('incomplete and invalid controls cannot save or crash the summary', () => {
  const daily = rruleToForm('FREQ=DAILY')
  for (const interval of [0, -1, 1.5, 10000]) assert.equal(validSchedule({ ...daily, interval }, '2026-10-19'), false)
  assert.equal(validSchedule({ ...daily, end: 'on', until: '' }, '2026-10-19'), false)
  assert.doesNotThrow(() => scheduleText(formToRrule({ ...daily, end: 'on', until: '' })))
  assert.equal(validSchedule({ ...daily, end: 'on', until: '2026-10-18' }, '2026-10-19'), false)
  assert.equal(validSchedule({ ...daily, end: 'after', count: 0 }, '2026-10-19'), false)
  assert.equal(validSchedule(daily, '2026-02-30'), false)
  assert.equal(validSchedule(daily, ''), true, 'legacy creation-date anchors remain valid')
})
