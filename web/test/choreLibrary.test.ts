// node --test test/ (npm test). The chore library's "due-ish" order, its status line and the
// Today / Tomorrow / This weekend picks.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agoText, intervalRrule, intervalText, libraryStatus, repeatText, sortLibrary, whenDate } from '../src/choreLibrary.ts'
import type { LibraryChore } from '../src/types.ts'

const today = '2026-10-01' // a Thursday
const item = (title: string, extra: Partial<LibraryChore> = {}): LibraryChore => ({
  id: title, title, emoji: '🧽', points: 5, listId: null, memberId: null, everyN: null, everyUnit: null, needsApproval: null, notes: null,
  createdAt: '2026-01-01T00:00:00.000Z', lastDone: null, lastMemberId: null, timesAssigned: 0, open: null, ...extra,
})
const done = (date: string) => ({ date, memberId: 'm4' })

test('intervalText and intervalRrule: plain words, and the matching repeat rule', () => {
  assert.equal(intervalText(1, 'month'), 'every month')
  assert.equal(intervalText(4, 'week'), 'every 4 weeks')
  assert.equal(intervalText(2, 'day'), 'every 2 days')
  assert.equal(intervalText(null, null), null)
  assert.equal(intervalRrule(1, 'month'), 'FREQ=MONTHLY')
  assert.equal(intervalRrule(4, 'week'), 'FREQ=WEEKLY;INTERVAL=4')
  assert.equal(intervalRrule(null, null), 'FREQ=WEEKLY')
})

test('repeatText: interval rules in words, anything else as written', () => {
  assert.deepEqual(['FREQ=WEEKLY;INTERVAL=4', 'FREQ=MONTHLY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=MONTHLY;BYMONTHDAY=1', null].map(repeatText),
    ['every 4 weeks', 'every month', 'every 3 days', 'FREQ=MONTHLY;BYMONTHDAY=1', ''])
})

test('agoText: days, then weeks, then months', () => {
  assert.deepEqual(['2026-10-01', '2026-09-30', '2026-09-26', '2026-09-17', '2026-08-27', '2026-07-01', '2025-06-01'].map(d => agoText(d, today)),
    ['today', 'yesterday', '5 days ago', '2 weeks ago', '5 weeks ago', '3 months ago', 'over a year ago'])
})

test('libraryStatus: last done with the usual interval, never done, or still to do', () => {
  const names = (id: string | null) => (id === 'm4' ? 'Leo' : id === null ? 'Anyone' : 'Someone')
  assert.equal(libraryStatus(item('Car', { lastDone: done('2026-08-27'), everyN: 4, everyUnit: 'week' }), today, names), 'Last done 5 weeks ago · usually every 4 weeks')
  assert.equal(libraryStatus(item('Car', { lastDone: done('2026-09-30') }), today, names), 'Last done yesterday')
  assert.equal(libraryStatus(item('Fridge', { everyN: 2, everyUnit: 'month' }), today, names), 'Not done yet · usually every 2 months')
  assert.equal(libraryStatus(item('Leaves'), today, names), 'Not done yet')
  assert.equal(libraryStatus(item('Car', { open: { choreId: 'c', dueDate: '2026-10-03', memberId: 'm4', repeats: false } }), today, names), 'To do: Leo, Sat')
  assert.equal(libraryStatus(item('Car', { open: { choreId: 'c', dueDate: '2026-10-01', memberId: null, repeats: false } }), today, names), 'To do: Anyone, today')
  assert.equal(libraryStatus(item('Car', { open: { choreId: 'c', dueDate: '2026-09-01', memberId: 'm4', repeats: true } }), today, names), 'Repeats for Leo')
})

test('sortLibrary: due-ish first (most overdue on top), then the rest A-Z', () => {
  const list = [
    item('Wash the windows', { everyN: 3, everyUnit: 'month', lastDone: done('2026-09-01') }), // a month into 3: not yet
    item('Clean out the car', { everyN: 4, everyUnit: 'week', lastDone: done('2026-08-27') }), // 5 weeks into 4: due-ish
    item('Flip the mattress', { everyN: 6, everyUnit: 'month', lastDone: done('2025-12-01') }), // 10 months into 6: most overdue
    item('Baseboards', { everyN: 2, everyUnit: 'month', lastDone: done('2026-08-05') }), // 57 days of ~60: close enough
    item('Rake leaves'), // no interval: never nudges
    item('Deep-clean the fridge', { everyN: 1, everyUnit: 'month', lastDone: done('2026-07-01'), open: { choreId: 'c', dueDate: '2026-10-02', memberId: 'm4', repeats: false } }), // already handed out
    item('Air filter', { everyN: 3, everyUnit: 'month' }), // never done: not nagged
  ]
  const sorted = sortLibrary(list, today)
  assert.deepEqual(sorted.map(s => [s.item.title, s.dueIsh]), [
    ['Flip the mattress', true],
    ['Clean out the car', true],
    ['Baseboards', true],
    ['Air filter', false],
    ['Deep-clean the fridge', false],
    ['Rake leaves', false],
    ['Wash the windows', false],
  ])
})

test('whenDate: today, tomorrow, and this weekend (Saturday, or today on a weekend)', () => {
  const thu = new Date(2026, 9, 1), sat = new Date(2026, 9, 3), sun = new Date(2026, 9, 4)
  assert.deepEqual(['today', 'tomorrow', 'weekend'].map(w => whenDate(w as never, thu)), ['2026-10-01', '2026-10-02', '2026-10-03'])
  assert.equal(whenDate('weekend', sat), '2026-10-03')
  assert.equal(whenDate('weekend', sun), '2026-10-04')
  assert.equal(whenDate('tomorrow', new Date(2026, 9, 31)), '2026-11-01')
})
