// node --test test/ (npm test). Fitting a Board card's rows to its space.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boardChores, boardItems, moreLabel, pollHost, slotLayout, rowsThatFit, chipFit, tileChips, tileColumns, todayOrder, chipWords } from '../src/boardFit.ts'

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

test('chipFit: names when every chip fits whole, else icon and count, else the toolbar buttons lose their words', () => {
  assert.equal(chipFit([153, 188], [70, 72], 349, 150), 'names', 'both whole, with the gap between them')
  assert.equal(chipFit([153, 188], [70, 72], 340, 150), 'short', 'not both: no names, rather than "G… 14"')
  assert.equal(chipFit([153], [70], 153, 150), 'names')
  assert.equal(chipFit([153], [70], 100, 150), 'short')
  assert.equal(chipFit([153], [70], 60, 150), 'tight', 'not even icon and count: Family wall and Polls go to their icons')
  assert.equal(chipFit([153, 188], [70, 72], 120, 150), 'tight')
})

test('chipFit: room is the toolbar with Family wall and Polls showing their words', () => {
  // Measured while tight, the spot is `freed` wider than it would be with the words back.
  assert.equal(chipFit([153], [70], 60 + 150, 150, 'tight'), 'tight', 'the words back would leave 60: stay tight')
  assert.equal(chipFit([153], [70], 90 + 150, 150, 'tight'), 'short', 'room for icon and count with the words back')
  assert.equal(chipFit([153], [70], 72 + 150, 150, 'tight'), 'tight', 'a few px short of leaving: no flip-flopping at the edge')
})

test('chipFit: not even tight: the chips take a row of their own, and come back with room to spare', () => {
  assert.equal(chipFit([153, 188], [70, 72], 20, 100), 'wrap', 'icons and counts need 150, the row has 120')
  assert.equal(chipFit([153, 188], [70, 72], 140, 100, 'wrap'), 'tight', 'measured from the toolbar row: room again')
  assert.equal(chipFit([153, 188], [70, 72], 52, 100, 'wrap'), 'wrap', 'a few px short of leaving: no flip-flopping at the edge')
})

test('todayOrder: on now first, then upcoming, then the finished ones folded away', () => {
  const t = (h: number, m = 0) => `2026-10-07T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
  const ev = (title: string, start: string, end: string, allDay = false) => ({ title, start, end, allDay })
  const events = [
    ev('Soccer', t(16), t(17, 30)),
    ev('Holiday', t(0), t(23, 59), true),
    ev('Piano', t(23, 55), t(23, 59)),
    ev('Meeting', t(16, 30), t(17)),
    ev('Reading', t(22, 25), t(23, 10)),
    ev('Late film', t(23, 0), t(23, 30)),
  ]
  const { shown, earlier } = todayOrder(events, Date.parse(t(22, 45)))
  assert.deepEqual(shown.map(e => e.title), ['Holiday', 'Reading', 'Late film', 'Piano'])
  assert.deepEqual(earlier.map(e => e.title), ['Soccer', 'Meeting'])
})

test('todayOrder: nothing over yet keeps the day in order', () => {
  const e = [{ title: 'b', start: '2026-10-07T10:00:00Z', end: '2026-10-07T11:00:00Z', allDay: false }, { title: 'a', start: '2026-10-07T09:00:00Z', end: '2026-10-07T09:30:00Z', allDay: false }]
  const r = todayOrder(e, Date.parse('2026-10-07T08:00:00Z'))
  assert.deepEqual(r.shown.map(x => x.title), ['a', 'b'])
  assert.equal(r.earlier.length, 0)
})

test('chipWords: the chips say what they count when that fits on their line, or on two beside one of the card rows', () => {
  assert.equal(chipWords(44, 44, 100, 200), true, 'one line either way')
  assert.equal(chipWords(44, 94, 300, 200), true, 'two lines still leave the card a row and More')
  assert.equal(chipWords(44, 94, 250, 200), false, 'two lines would crowd out the card: counts only')
})
