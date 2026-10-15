// node --test test/ (npm test). Get stuff done mode (getStuffDone.ts): order, steps through the
// list, progress, all done, and a wall screen's pinned checklist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareItems, type ListItem } from '../src/types.ts'
import { allDone, choreItems, doOrder, listOrder, nextOpen, pinnedNow, progress, savedView, saveView, startAt, stayOn } from '../src/getStuffDone.ts'

const it = (id: string, sort: number, done = false, memberId: string | null = null) => ({ id, sort, done, memberId })
// Stored out of order: the list's own order is by sort.
const items = [it('c', 2), it('a', 0, true), it('d', 3), it('b', 1)]

test('doOrder: the list in its own order; listOrder puts ticked ones at the bottom', () => {
  assert.deepEqual(doOrder(items).map(i => i.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(listOrder(doOrder(items)).map(i => i.id), ['b', 'c', 'd', 'a'])
})

test('progress and allDone', () => {
  assert.deepEqual(progress(items), { done: 1, total: 4 })
  assert.equal(allDone(items), false)
  assert.equal(allDone(items.map(i => ({ ...i, done: true }))), true)
  assert.equal(allDone([]), false, 'an empty list is not a finished one')
})

test('startAt: the first open item, else the first', () => {
  assert.equal(startAt(doOrder(items)), 1)
  assert.equal(startAt([it('x', 0, true)]), 0)
  assert.equal(startAt([]), 0)
})

test('nextOpen: the next open item after this one, wrapping round; -1 when nothing else is open', () => {
  const o = doOrder([it('a', 0), it('b', 1, true), it('c', 2), it('d', 3, true)])
  assert.equal(nextOpen(o, 0), 2, 'skips a done one')
  assert.equal(nextOpen(o, 2), 0, 'wraps to a skipped one')
  assert.equal(nextOpen(o, 1), 2)
  assert.equal(nextOpen([it('a', 0), it('b', 1, true)], 0), -1, 'only this one open')
  assert.equal(nextOpen([it('a', 0, true)], 0), -1)
})

test('stayOn: the same item after a reload, even when another device moved things', () => {
  const o = doOrder(items)
  assert.equal(stayOn(o, 'c', 0), 2)
  assert.equal(stayOn(o, 'gone', 9), 3, 'deleted elsewhere: the nearest place left')
  assert.equal(stayOn([], 'x', 2), 0)
})

test('choreItems: a chore sees its person\'s items and nobody\'s; an Anyone chore sees them all', () => {
  const l = [it('mine', 0, false, 'm4'), it('shared', 1), it('sister', 2, false, 'm3')]
  assert.deepEqual(choreItems(l, 'm4').map(i => i.id), ['mine', 'shared'])
  assert.deepEqual(choreItems(l, null).map(i => i.id), ['mine', 'shared', 'sister'])
})

test('pinnedNow: the pinned list, all day or only inside its window (across midnight too)', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 3, h, m)
  assert.equal(pinnedNow({}, at(12)), null)
  assert.equal(pinnedNow({ pinList: 'l6' }, at(3)), 'l6', 'no window: always')
  const evening = { pinList: 'l6', pinFrom: '19:00', pinTo: '20:30' }
  assert.equal(pinnedNow(evening, at(19)), 'l6')
  assert.equal(pinnedNow(evening, at(20, 29)), 'l6')
  assert.equal(pinnedNow(evening, at(20, 30)), null, 'the end is outside')
  assert.equal(pinnedNow(evening, at(7)), null)
  const night = { pinList: 'l6', pinFrom: '21:00', pinTo: '07:30' }
  assert.equal(pinnedNow(night, at(23)), 'l6')
  assert.equal(pinnedNow(night, at(6)), 'l6')
  assert.equal(pinnedNow(night, at(12)), null)
  assert.equal(pinnedNow({ pinList: 'l6', pinFrom: '19:00' }, at(3)), 'l6', 'half a window is no window')
})

test('the last view is remembered on this device; blocked storage starts one at a time', () => {
  const store = new Map<string, string>()
  const g = globalThis as { localStorage?: unknown }
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } }
  try {
    assert.equal(savedView(), 'step')
    saveView('list')
    assert.equal(savedView(), 'list')
    saveView('step')
    assert.equal(savedView(), 'step')
    g.localStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    assert.equal(savedView(), 'step')
    saveView('list') // doesn't throw
  } finally { delete g.localStorage }
})

// A to-do the way the list holds it: only what compareItems reads.
const todo = (id: string, sort: number, more: Partial<ListItem> = {}) =>
  ({ id, sort, done: false, memberId: null, priority: 'normal', dueDate: null, eventId: null, createdAt: '2026-10-01T00:00:00Z', ...more }) as ListItem

test("doOrder follows the list's sort: due date, with a linked event's day standing in, and ticks don't move items", () => {
  const list = [
    todo('mow', 0),
    todo('books', 1, { priority: 'high', dueDate: '2026-10-10' }), // overdue
    todo('guards', 2, { eventId: 'soccer' }), // no due date, linked to today's practice
    todo('paint', 3, { dueDate: '2026-10-19' }),
  ]
  const eventDue = new Map([['soccer', '2026-10-15']])
  const due = compareItems('due', '2026-10-15', { keepChecked: true, eventDue })
  assert.deepEqual(doOrder(list, due).map(i => i.id), ['books', 'guards', 'paint', 'mow'])
  assert.deepEqual(doOrder(list, compareItems('due', '2026-10-15', { keepChecked: true })).map(i => i.id), ['books', 'paint', 'mow', 'guards'], 'without the event, undated goes last')
  const manual = compareItems('manual', '2026-10-15', { keepChecked: true })
  assert.deepEqual(doOrder(list, manual).map(i => i.id), ['books', 'mow', 'guards', 'paint'], 'manual: high priority first')
  const ticked = list.map(i => (i.id === 'books' ? { ...i, done: true } : i))
  assert.deepEqual(doOrder(ticked, manual).map(i => i.id), ['books', 'mow', 'guards', 'paint'], 'a tick keeps its place')
  assert.deepEqual(listOrder(doOrder(ticked, manual)).map(i => i.id), ['mow', 'guards', 'paint', 'books'])
})
