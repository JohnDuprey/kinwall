// node --test test/ (npm test). Get stuff done mode (getStuffDone.ts): order, steps through the
// list, progress, all done, and a wall screen's pinned checklist.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allDone, choreItems, doOrder, listOrder, nextOpen, pinnedNow, progress, savedView, saveView, startAt, stayOn } from '../src/getStuffDone.ts'

const it = (id: string, sort: number, done = false, memberId: string | null = null) => ({ id, sort, done, memberId })
// Stored out of order: the list's own order is by sort.
const items = [it('c', 2), it('a', 0, true), it('d', 3), it('b', 1)]

test('doOrder: the list in its own order; listOrder puts ticked ones at the bottom', () => {
  assert.deepEqual(doOrder(items).map(i => i.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(listOrder(items).map(i => i.id), ['b', 'c', 'd', 'a'])
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
