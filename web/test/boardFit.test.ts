// node --test test/ (npm test). Fitting a Board card's rows to its space.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardChores, boardItems, moreLabel, pollHost, slotLayout, rowsThatFit, tileColumns } from '../src/boardFit.ts'

const rows = (...bottoms: number[]) => bottoms.map(bottom => ({ bottom }))

test('rowsThatFit: everything fits, no More', () => {
  assert.equal(rowsThatFit(rows(40, 80, 120), 120, 50), 3)
  assert.equal(rowsThatFit([], 0, 50), 0)
})

test('rowsThatFit: leaves room for the More button', () => {
  assert.equal(rowsThatFit(rows(40, 80, 120, 160), 150, 50), 2) // 100px for rows: 40 and 80 fit
  assert.equal(rowsThatFit(rows(40, 80, 120, 160), 60, 50), 0) // not even one: just More
})

test('rowsThatFit: never ends on a heading', () => {
  const r = [{ bottom: 20, heading: true }, { bottom: 60 }, { bottom: 80, heading: true }, { bottom: 120 }, { bottom: 160 }]
  assert.equal(rowsThatFit(r, 140, 50), 2) // 90px: heading 2 fits but its row doesn't, so it goes too
})

test('moreLabel: counts rows, not headings', () => {
  const r = [{ heading: true }, {}, { heading: true }, {}, {}]
  assert.equal(moreLabel(r, 2), '+2 more')
  assert.equal(moreLabel(r, 5), 'More')
  assert.equal(moreLabel(r, 0), 'Show 3') // nothing fit above the button
})

const chore = (memberId: string | null, remaining: number) => ({ memberId, name: memberId, avatar: null, color: null, remaining, total: remaining })
const chores = [chore('maya', 2), chore('leo', 1), chore(null, 1)]

test("boardChores: a kid's device counts only their chores, plus Anyone's unless hidden", () => {
  assert.deepEqual(boardChores(chores, null, null, true), chores)
  assert.deepEqual(boardChores(chores, 'maya', 'maya', true).map(c => c.memberId), ['maya', null])
  assert.deepEqual(boardChores(chores, 'maya', 'maya', false).map(c => c.memberId), ['maya'])
  // A parent's filter (not a pinned device) keeps Anyone's, like the Chores tab.
  assert.deepEqual(boardChores(chores, 'leo', null, false).map(c => c.memberId), ['leo', null])
})

test("boardItems: Due soon follows the person picked, like their chores", () => {
  const lists = [{ id: 'family', memberIds: [] }, { id: 'maya', memberIds: ['maya'] }, { id: 'alex', memberIds: ['alex'] }]
  const item = (id: string, listId: string, memberId: string | null) => ({ id, listId, memberId })
  const items = [item('a', 'family', 'maya'), item('b', 'family', 'alex'), item('c', 'family', null), item('d', 'maya', null), item('e', 'alex', null), item('f', 'alex', 'maya')]
  const ids = (sel: string | null, focus: string | null = null, shared = true) => boardItems(items, lists, sel, focus, shared).map(i => i.id)
  assert.deepEqual(ids(null), ['a', 'b', 'c', 'd', 'e', 'f'], 'everyone: everything')
  assert.deepEqual(ids('maya'), ['a', 'c', 'd', 'f'], "theirs (assigned, or unassigned on their list) and the family's unassigned")
  assert.deepEqual(ids('maya', 'maya', false), ['a', 'd', 'f'], "a display pinned to them can hide the family's")
  assert.deepEqual(boardItems([item('g', 'gone', null)], [], 'maya', 'maya', true), [], 'an unassigned item on a list not loaded yet waits')
})

test('boardChores: also narrows reward requests to the person picked', () => {
  const reqs = [{ memberId: 'maya' }, { memberId: 'leo' }]
  assert.equal(boardChores(reqs, 'maya', 'maya', true).length, 1)
  assert.equal(boardChores(reqs, null, null, true).length, 2)
})

test('tileColumns: one row when every tile gets room, else balanced rows', () => {
  assert.equal(tileColumns(1238, 6), 6, 'wall: one row')
  assert.equal(tileColumns(713, 6), 3, 'tablet portrait: 3 + 3, not six slivers')
  assert.equal(tileColumns(896, 6), 3, 'tablet landscape: 3 + 3, not 4 + 2')
  assert.equal(tileColumns(713, 5), 3, '3 + 2')
  assert.equal(tileColumns(713, 4), 4, 'four still fit in a row')
  assert.equal(tileColumns(100, 3), 1)
})

test('pollHost: Today, else Coming up, else a strip above the cards', () => {
  assert.equal(pollHost(['clock', 'today', 'coming']), 'today')
  assert.equal(pollHost(['clock', 'coming', 'photo']), 'coming')
  assert.equal(pollHost(['clock', 'photo']), 'strip')
})

test("slotLayout: the card's rows first, then each item whole in order while it fits", () => {
  const items = [{ full: 100, row: 40 }, { full: 80, row: 40 }, { full: 150, row: 50 }]
  const whole = (o: Parameters<typeof slotLayout>[0]) => slotLayout(o).whole
  assert.deepEqual(whole({ fixed: true, rows: 200, space: 900, items }), [true, true, true])
  // 130 rows + 200 left over: the first goes whole (+60), the second too (+40), not the third (+100)
  assert.deepEqual(whole({ fixed: true, rows: 200, space: 460, items }), [true, true, false])
  // a later, smaller item can still fit after a big one didn't
  assert.deepEqual(whole({ fixed: true, rows: 200, space: 380, items: [{ full: 200, row: 40 }, { full: 60, row: 40 }] }), [false, true])
  // a busy day: rows only, the card's rows go behind More
  assert.deepEqual(slotLayout({ fixed: true, rows: 500, space: 300, items, chips: 50 }), { chips: false, whole: [false, false, false] })
  // a phone or a scrolling board: rows
  assert.deepEqual(slotLayout({ fixed: false, rows: 0, space: 9999, items, chips: 50 }), { chips: false, whole: [false, false, false] })
})

test('slotLayout: one line of chips when the rows would leave the card no room of its own', () => {
  const items = [{ full: 100, row: 50 }, { full: 80, row: 50 }, { full: 150, row: 50 }]
  assert.equal(slotLayout({ fixed: true, rows: 300, space: 180, items, chips: 52 }).chips, true) // 150 of rows, 30 left: not even More
  assert.equal(slotLayout({ fixed: true, rows: 300, space: 200, items, chips: 52 }).chips, false) // 50 left: More fits
  assert.equal(slotLayout({ fixed: true, rows: 20, space: 175, items, chips: 52 }).chips, false) // a short day's one row fits
  assert.equal(slotLayout({ fixed: true, rows: 300, space: 100, items: [items[0]], chips: 52 }).chips, false) // one item stays a row
})
