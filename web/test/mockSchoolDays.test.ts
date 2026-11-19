import { test } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) }
const { mock } = await import('../src/mock.ts')
const { dateKey } = await import('../src/date.ts')
const { addDayKeys } = await import('../src/library.ts')
import type { SchoolDays } from '../src/types.ts'

test('demo school days: half-day titles win over closure words and other calendar events', async () => {
  const settings = await mock.getSettings()
  await mock.updateSettings({ features: { ...settings.features, school: true } })
  const { mockSchoolRequest } = await import('../src/mock-school.ts')
  const calendar = await mock.createCalendar({ kind: 'local', name: 'School' })
  const from = dateKey(new Date())
  await mockSchoolRequest('api/school/kids/m3', { method: 'PUT', body: JSON.stringify({ mode: 'enrolled', calendarIds: [calendar.id], schoolDays: [0, 1, 2, 3, 4, 5, 6], lastDay: null }) })
  const titles = ['Holiday Recess Begins - 1/2 Day', '½ Day - Professional Development In-Service', 'No School - Holiday Recess']
  for (const [i, title] of titles.entries()) {
    const start = addDayKeys(from, i), end = addDayKeys(start, 1)
    await mock.createEvent({ calendarId: calendar.id, title, start, end, allDay: true })
    if (i < 2) await mock.createEvent({ calendarId: calendar.id, title: 'Holiday Event', start, end, allDay: true })
  }
  const result = await mockSchoolRequest(`api/school/days?from=${from}&to=${addDayKeys(from, 2)}`, {}) as SchoolDays
  assert.deepEqual(result.days.filter(d => d.memberId === 'm3').map(d => d.kind), ['half', 'half', 'off'])
})

test('demo Chores counts include visible schoolwork and hide it when School is off', async () => {
  const date = '2030-11-18'
  const settings = await mock.getSettings()
  await mock.updateSettings({ features: { ...settings.features, school: true } })
  await mock.createChore({ title: 'Reading homework', memberId: 'm3', dueDate: date, schoolSubjectId: 'ss-reading', schoolKind: 'homework' })
  const { countChoreDay, sumChoreCounts } = await import('../src/choreCounts.ts')
  const day = await mock.getChoresDay(date)
  assert.ok(day.some(c => c.title === 'Reading homework'))
  const count = sumChoreCounts(await mock.getChoreCounts(date, date), 'm3', true)
  assert.deepEqual(count, countChoreDay(day, 'm3', true))
  await mock.updateSettings({ features: { ...settings.features, school: false } })
  const withoutSchool = await mock.getChoresDay(date)
  assert.equal(withoutSchool.some(c => c.schoolKind), false)
  const hiddenCount = sumChoreCounts(await mock.getChoreCounts(date, date), 'm3', true)
  assert.deepEqual(hiddenCount, countChoreDay(withoutSchool, 'm3', true))
  assert.ok(hiddenCount.total < count.total)
})
