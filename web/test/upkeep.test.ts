import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueLabel, dueSections, historyYears, lines, money, parseCents, repeatLabel, thingSections, warrantyLabel } from '../src/upkeep.ts'
import type { UpkeepEntry, UpkeepJob, UpkeepThing } from '../src/types.ts'

const TODAY = '2026-10-21'
const job = (p: Partial<UpkeepJob>): UpkeepJob => ({
  id: p.title ?? 'x', title: 'x', emoji: null, thingId: null, areaId: null, repeatKind: 'after', every: 3, unit: 'month', onMonths: [], onDay: null, startOn: null, dueOn: null,
  headsUpDays: 7, snoozedUntil: null, skippedUntil: null, memberId: null, contactId: null, usualCostCents: null, steps: [], supplies: [], suppliesListId: null, suppliesDays: 7,
  chorePoints: null, handedChoreId: null, calendarEventId: null, calendarEventStart: null, wallVisible: true, libraryKey: null, archived: false, createdAt: '', updatedAt: '',
  nextDue: TODAY, status: 'due', lastDone: null, ...p,
})
const thing = (p: Partial<UpkeepThing>): UpkeepThing => ({
  id: p.name ?? 'x', name: 'x', emoji: null, areaId: null, room: null, brand: null, model: null, serial: null, partNotes: null, boughtOn: null, priceCents: null, warrantyUntil: null,
  manualUrl: null, contactId: null, notes: null, archived: false, createdAt: '', updatedAt: '', files: [], ...p,
})
const entry = (doneOn: string, costCents: number | null): UpkeepEntry => ({ id: doneOn, jobId: null, thingId: null, title: 'x', doneOn, memberId: null, contactId: null, costCents, reading: null, readingUnit: null, notes: null, choreId: null, createdBy: null, createdAt: '', files: [] })

test('dueLabel: late in days then weeks, today, tomorrow, soon, a date', () => {
  assert.equal(dueLabel({ nextDue: '2026-10-18', status: 'overdue' }, TODAY), '3 days late')
  assert.equal(dueLabel({ nextDue: '2026-10-20', status: 'overdue' }, TODAY), '1 day late')
  assert.equal(dueLabel({ nextDue: '2026-09-30', status: 'overdue' }, TODAY), '3 weeks late')
  assert.equal(dueLabel({ nextDue: TODAY, status: 'due' }, TODAY), 'Due today')
  assert.equal(dueLabel({ nextDue: '2026-10-22', status: 'soon' }, TODAY), 'Due tomorrow')
  assert.equal(dueLabel({ nextDue: '2026-10-26', status: 'soon' }, TODAY), 'Due in 5 days')
  assert.equal(dueLabel({ nextDue: '2027-03-15', status: 'later' }, TODAY), 'Due Mar 15')
  assert.equal(dueLabel({ nextDue: null, status: 'done' }, TODAY), 'Done')
})

test('repeatLabel: every N units, fixed dates, once', () => {
  assert.equal(repeatLabel(job({ every: 3, unit: 'month' })), 'Every 3 months')
  assert.equal(repeatLabel(job({ every: 1, unit: 'year' })), 'Every year')
  assert.equal(repeatLabel(job({ every: 2, unit: 'week' })), 'Every 2 weeks')
  assert.equal(repeatLabel(job({ repeatKind: 'on', onMonths: [4, 10], onDay: 15 })), 'Every Apr 15 and Oct 15')
  assert.equal(repeatLabel(job({ repeatKind: 'on', onMonths: [11], onDay: 1 })), 'Every Nov 1')
  assert.equal(repeatLabel(job({ repeatKind: 'once', dueOn: '2026-11-05' })), 'Once, on Nov 5')
})

test('dueSections: late, due soon, later, done, empty ones left out', () => {
  const s = dueSections([job({ title: 'a', status: 'later' }), job({ title: 'b', status: 'overdue' }), job({ title: 'c', status: 'soon' }), job({ title: 'd', status: 'due' })])
  assert.deepEqual(s.map(x => [x.key, x.jobs.map(j => j.title)]), [['overdue', ['b']], ['soon', ['c', 'd']], ['later', ['a']]])
})

test('thingSections: by area in order, the rest under Other things', () => {
  const areas = [{ id: 'ua-heating', name: 'Heating & cooling', emoji: '🌡' }, { id: 'ua-cars', name: 'Cars & bikes', emoji: '🚗' }]
  const s = thingSections([thing({ name: 'Van', areaId: 'ua-cars' }), thing({ name: 'Furnace', areaId: 'ua-heating' }), thing({ name: 'Shed' }), thing({ name: 'AC', areaId: 'ua-heating' })], areas)
  assert.deepEqual(s.map(x => [x.title, x.things.map(t => t.name)]), [['🌡 Heating & cooling', ['AC', 'Furnace']], ['🚗 Cars & bikes', ['Van']], ['Other things', ['Shed']]])
})

test('warrantyLabel, money and parseCents', () => {
  assert.equal(warrantyLabel('2028-03-01', TODAY), 'Warranty until Mar 2028')
  assert.equal(warrantyLabel('2026-11-02', TODAY), 'Warranty ends in 12 days')
  assert.equal(warrantyLabel('2026-10-01', TODAY), 'Warranty ended')
  assert.equal(warrantyLabel(null, TODAY), null)
  assert.equal(money(5400), '$54')
  assert.equal(money(5499), '$54.99')
  assert.equal(parseCents('$54.99'), 5499)
  assert.equal(parseCents('1,200'), 120000)
  assert.equal(parseCents(''), null)
  assert.equal(parseCents('abc'), undefined)
})

test('historyYears: newest year first, with what it cost', () => {
  const y = historyYears([entry('2026-10-01', 5400), entry('2026-03-02', null), entry('2025-11-11', 12000)])
  assert.deepEqual(y.map(x => [x.year, x.entries.length, x.costCents, x.priced]), [['2026', 2, 5400, 1], ['2025', 1, 12000, 1]])
  assert.deepEqual(lines(' a \n\n b\n'), ['a', 'b'])
})
