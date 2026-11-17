import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csv, groups, kidTotals, weekOf } from '../src/school.ts'
import type { SchoolLog } from '../src/types.ts'

const log = (p: Partial<SchoolLog>): SchoolLog => ({
  id: p.id ?? 'x', groupId: 'g', memberId: 'maya', subjectId: 'ss-math', date: '2026-11-16', minutes: 30, title: null, notes: null,
  pending: false, createdBy: null, createdAt: '2026-11-16T10:00:00.000Z', updatedAt: '', ...p,
})

test('school: a week starts on the family’s first day', () => {
  assert.deepEqual(weekOf('2026-11-18', 0), { from: '2026-11-15', to: '2026-11-21' }) // Wednesday, weeks from Sunday
  assert.deepEqual(weekOf('2026-11-18', 1), { from: '2026-11-16', to: '2026-11-22' })
  assert.deepEqual(weekOf('2026-11-15', 1), { from: '2026-11-09', to: '2026-11-15' }) // a Sunday ends a Monday week
})

test('school: one save for two kids shows once, with both kids', () => {
  const g = groups([log({ id: 'a', memberId: 'maya' }), log({ id: 'b', memberId: 'leo', pending: true }), log({ id: 'c', groupId: 'h', date: '2026-11-17' })])
  assert.deepEqual(g.map(x => [x.groupId, x.memberIds, x.pending]), [['h', ['maya'], false], ['g', ['maya', 'leo'], true]])
  const gone = groups([log({ id: 'x', groupId: 'r', memberId: null, formerMember: 'Leo' })])
  assert.deepEqual([gone[0].memberIds, gone[0].removed], [[], ['Leo']], 'a removed member stays by name')
})

test('school: totals by kid and subject leave out time waiting for approval', () => {
  const totals = kidTotals([log({ minutes: 30 }), log({ minutes: 15, subjectId: 'ss-art' }), log({ minutes: 45 }), log({ memberId: 'leo', minutes: 20, pending: true })])
  assert.deepEqual(totals, [{ memberId: 'maya', total: 90, bySubject: [{ subjectId: 'ss-math', minutes: 75 }, { subjectId: 'ss-art', minutes: 15 }] }])
})

test('school: the CSV quotes what needs it', () => {
  const out = csv([log({ title: 'Fractions, with pizza', notes: 'Said "yum"' })], l => (l.memberId === 'maya' ? 'Maya' : '?'), () => 'Math', ['Date', 'Kid', 'Subject', 'Minutes', 'What you did', 'Notes', 'Waiting for approval'], ['Yes', 'No'])
  assert.equal(out, 'Date,Kid,Subject,Minutes,What you did,Notes,Waiting for approval\r\n2026-11-16,Maya,Math,30,"Fractions, with pizza","Said ""yum""",No\r\n')
})

test('school: which days a school calendar event falls on', async () => {
  const { onDay } = await import('../src/school.ts')
  const allDay = { allDay: true, start: '2026-11-18', end: '2026-11-20' } // two days, end exclusive
  assert.deepEqual(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(d => onDay(allDay, d, 'America/New_York')), [false, true, true, false])
  const evening = { allDay: false, start: '2026-11-19T00:30:00.000Z', end: '2026-11-19T01:30:00.000Z' } // 7:30 PM on the 18th in New York
  assert.equal(onDay(evening, '2026-11-18', 'America/New_York'), true)
  assert.equal(onDay(evening, '2026-11-19', 'America/New_York'), false)
})

test('school: a school year from its own start day', async () => {
  const { schoolYearOf, schoolYearRange } = await import('../src/school.ts')
  assert.deepEqual(schoolYearRange(2026, '08-24'), { from: '2026-08-24', to: '2027-08-23' })
  assert.deepEqual(schoolYearRange(2027, '03-01'), { from: '2027-03-01', to: '2028-02-29' }, 'a leap year')
  assert.deepEqual([schoolYearOf('2026-08-23', '08-24'), schoolYearOf('2026-08-24', '08-24'), schoolYearOf('2026-11-17')], [2025, 2026, 2026])
})


test('school: year choices include older records and both kids’ current years', async () => {
  const { schoolYears } = await import('../src/school.ts')
  const years = schoolYears('2026-08-20')
  assert.equal(years[0], 2026)
  assert.ok(years.includes(2025), 'a kid starting August 24 is still in 2025–26')
  assert.ok(years.includes(2018), 'older records can be opened')
  assert.equal(years.at(-1), 2000)
})
