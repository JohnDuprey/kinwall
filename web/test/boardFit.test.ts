// node --test test/ (npm test). Fitting a Board card's rows to its space.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardChores, boardItems, moreLabel, pollHost, slotLayout, rowsThatFit, chipNamesFit, tileChips, tileColumns } from '../src/boardFit.ts'

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
  assert.deepEqual(slotLayout({ fixed: true, rows: 500, space: 300, items, chips: 50 }), { chips: false, whole: [false, false, false], need: 130 })
  // a phone or a scrolling board: rows
  assert.deepEqual(slotLayout({ fixed: false, rows: 0, space: 9999, items, chips: 50 }), { chips: false, whole: [false, false, false], need: 0 })
})

test("slotLayout: Today keeps one of its own rows, two when it can, beside the items (chips when rows would crowd them out)", () => {
  const items = [{ full: 100, row: 50 }, { full: 80, row: 50 }, { full: 150, row: 50 }] // 150 as rows
  const keep: [number, number] = [110, 170] // one event + More, two events + More
  const chips = (space: number, its = items) => slotLayout({ fixed: true, rows: 400, space, items: its, chips: 52, keep }).chips
  assert.equal(chips(330), false, 'rows leave 180: two events fit beside them')
  assert.equal(chips(300), true, 'rows leave 150 (one event), chips leave 248: two events')
  assert.equal(chips(250), true, 'rows leave 100, room for More but not one event: chips, never a bare "Show 8"')
  assert.equal(chips(200), true, 'rows leave nothing: chips (148: one event)')
  assert.equal(chips(270, [items[0], items[1]]), false, 'rows leave 170: two events beside the rows')
  assert.equal(chips(180), true, 'too tight for even one event beside chips: still the smallest slot')
  assert.equal(slotLayout({ fixed: true, rows: 400, space: 180, items, chips: 52, keep }).need, 162, '...and the card grows to one event + More + chips')
  assert.equal(chips(100, [items[0]]), false, 'one item stays a row')
  assert.equal(slotLayout({ fixed: true, rows: 400, space: 100, items: [items[0]], chips: 52, keep }).need, 160, '...one event + More + the row')
  assert.equal(slotLayout({ fixed: false, rows: 400, space: 100, items, chips: 52, keep }).need, 0, 'a scrolling board grows by itself')
  assert.equal(slotLayout({ fixed: true, rows: 20, space: 175, items, chips: 52, keep: [20, 20] }).chips, false, "a short day's one row fits beside the rows")
})

test('tileChips: one or two list or Rewards tiles go on the toolbar, three or more keep the row', () => {
  assert.equal(tileChips(['groceries'], true), true, 'one tile')
  assert.equal(tileChips(['shopping', 'rewards'], true), true, 'two tiles')
  assert.equal(tileChips(['groceries', 'shopping', 'rewards'], true), false, 'three keep the row')
  assert.equal(tileChips([], true), false, 'nothing to show')
  assert.equal(tileChips(['groceries'], false), false, 'no toolbar (a phone, or a locked view)')
  assert.equal(tileChips(['chores', 'groceries'], true), false, 'Chores, Due soon and Take now stay tiles')
  assert.equal(tileChips(['meds'], true), false)
})

test('chipNamesFit: names only when every chip fits whole, else icon and count', () => {
  assert.equal(chipNamesFit([153, 188], 349), true, 'both whole, with the gap between them')
  assert.equal(chipNamesFit([153, 188], 340), false, 'not both: no names, rather than "G… 14"')
  assert.equal(chipNamesFit([153], 153), true)
  assert.equal(chipNamesFit([153], 100), false)
})
