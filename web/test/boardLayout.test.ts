// node --test test/ (npm test). Board layouts (boardLayout.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  columnRows, addCard, BUILT_IN_PRESETS, cardOn, CUSTOM, layoutAreas, layoutFor, MAX_PER_COLUMN, moveCard, normalizeLayout, removeCard, rowSpans,
  setColumnCount, unplaced, updateCard, type BoardLayout,
} from '../src/boardLayout.ts'

const L = (tiles: boolean, ...cols: string[][]): BoardLayout => ({ tiles, columns: cols.map(col => col.map(id => ({ id, size: 'm', density: 'normal' }))) } as BoardLayout)

test('row spans: a share of 12 rows by size, at least one each', () => {
  assert.deepEqual(rowSpans(['m']), [12])
  assert.deepEqual(rowSpans(['s', 'l']), [3, 9])
  assert.deepEqual(rowSpans(['m', 'm', 'm']), [4, 4, 4])
  const six = rowSpans(['s', 's', 's', 's', 's', 'l'])
  assert.equal(six.reduce((a, b) => a + b), 12)
  assert.ok(six.every(n => n >= 1))
})

test('areas: columns of cards, an empty or unavailable one closes up, tiles across the top', () => {
  const l = { tiles: true, columns: [[{ id: 'clock', size: 's', density: 'big' }, { id: 'photo', size: 'l', density: 'normal' }], [{ id: 'meals', size: 'm', density: 'normal' }], [{ id: 'today', size: 'm', density: 'small' }]] } as BoardLayout
  const a = layoutAreas(l, id => id !== 'meals')
  assert.deepEqual(a.shown, ['tiles', 'clock', 'photo', 'today'])
  assert.equal(a.style['--board-cols-3'], 'repeat(2, minmax(0, 1fr))', 'the meals column went (meals is off)')
  const rows = a.style['--board-areas-3'].split('" "').length
  assert.equal(rows, 13, 'the tiles row and 12 rows of cards')
  assert.ok(a.style['--board-areas-3'].startsWith('"tiles tiles" "clock today" "clock today" "clock today" "photo today"'))
  assert.equal(a.style['--board-rows-3'], 'auto repeat(12, 1fr)', "rows grow to the clock's minimum (styles.css), the others share the rest")
  assert.equal(a.style['--board-areas-1'], '"tiles" "clock" "photo" "today"')
  assert.equal(a.style['--board-areas-2'], '"tiles tiles" "clock photo" "today today"')
  assert.equal(a.density.get('clock'), 'big')
  assert.deepEqual(layoutAreas(l, id => id !== 'tiles').shown[0], 'clock', 'no tiles to show: no tiles row')
})

test('areas: two or more columns never close up to one; the one left splits in two', () => {
  const a = layoutAreas(L(false, ['clock', 'today', 'photo', 'tidbit'], ['tidbit3']), id => id !== 'tidbit3')
  assert.equal(a.style['--board-cols-3'], 'repeat(2, minmax(0, 1fr))', 'the quote card that has nothing to say took its column')
  assert.ok(a.style['--board-areas-3'].startsWith('"clock photo"'))
  assert.ok(a.style['--board-areas-3'].endsWith('"today tidbit"'))
  assert.deepEqual(a.shown, ['clock', 'today', 'photo', 'tidbit'], 'reading order stays')
  assert.equal(layoutAreas(L(true, ['clock', 'today', 'photo'], []), () => true).style['--board-cols-3'], 'repeat(2, minmax(0, 1fr))', 'a column left empty')
  const uneven = { tiles: false, columns: [[{ id: 'clock', size: 's' }, { id: 'today', size: 'l' }, { id: 'tidbit', size: 's' }], []] } as BoardLayout
  assert.ok(layoutAreas(uneven, () => true).style['--board-areas-3'].startsWith('"clock today"'), 'split by size: a tie keeps the first column shorter')
  assert.equal(layoutAreas(L(false, ['clock', 'today']), () => true).style['--board-cols-3'], 'repeat(1, minmax(0, 1fr))', 'a one-column layout stays one')
  assert.equal(layoutAreas(L(false, ['clock'], ['meals']), id => id !== 'meals').style['--board-cols-3'], 'repeat(1, minmax(0, 1fr))', 'one card left: one column')
})

test('which layout a screen shows', () => {
  const family = [{ id: 'fam1', name: 'Hallway', layout: L(false, ['today']) }]
  assert.equal(layoutFor(undefined, null, family), null, 'the default arrangement')
  assert.deepEqual(layoutFor('kids', null, family), BUILT_IN_PRESETS[0].layout)
  assert.deepEqual(layoutFor('fam1', null, family), L(false, ['today']))
  assert.equal(layoutFor('gone', null, family), null, 'a deleted preset: back to the default')
  assert.deepEqual(layoutFor(CUSTOM, L(true, ['coming']), family), L(true, ['coming']))
})

test('a stored layout is made safe', () => {
  const junk = { columns: [[{ id: 'today', size: 'huge' }, { id: 'today' }, { id: 'nope' }], [], [], [], [{ id: 'clock' }]] }
  assert.deepEqual(normalizeLayout(junk), { tiles: true, columns: [[{ id: 'today', size: 'm', density: 'normal' }], [], [], []] })
  assert.deepEqual(normalizeLayout('x'), { tiles: true, columns: [[]] })
})

test('the Checklist card keeps the list it shows; other cards and junk ids carry none', () => {
  const raw = { columns: [[{ id: 'checklist', size: 's', density: 'big', listId: 'l6' }, { id: 'today', listId: 'l6' }], [{ id: 'clock', listId: 7 }]] }
  assert.deepEqual(normalizeLayout(raw).columns, [[{ id: 'checklist', size: 's', density: 'big', listId: 'l6' }, { id: 'today', size: 'm', density: 'normal' }], [{ id: 'clock', size: 'm', density: 'normal' }]])
  assert.deepEqual(normalizeLayout({ columns: [[{ id: 'checklist', listId: 5 }]] }).columns, [[{ id: 'checklist', size: 'm', density: 'normal' }]])
  const l = updateCard(normalizeLayout(raw), { col: 0, i: 0 }, { listId: 'l4' })
  assert.equal(l.columns[0][0].listId, 'l4')
})

test('editing: move, add, remove, resize, column count', () => {
  let l = L(true, ['clock', 'today'], ['coming'])
  l = moveCard(l, { col: 0, i: 1 }, { col: 1, i: 0 })
  assert.deepEqual(l.columns.map(col => col.map(x => x.id)), [['clock'], ['today', 'coming']])
  l = moveCard(l, { col: 1, i: 0 }, { col: 1, i: 5 })
  assert.deepEqual(l.columns[1].map(x => x.id), ['coming', 'today'], 'past the end: to the bottom')
  l = addCard(l, 'meals')
  assert.deepEqual(l.columns[0].map(x => x.id), ['clock', 'meals'], 'to the emptiest column')
  assert.equal(addCard(l, 'meals'), l, 'never twice')
  l = updateCard(l, { col: 0, i: 1 }, { size: 'l', density: 'big' })
  assert.deepEqual(l.columns[0][1], { id: 'meals', size: 'l', density: 'big' })
  l = removeCard(l, { col: 0, i: 0 })
  assert.ok(unplaced(l).includes('clock'))
  l = setColumnCount(l, 3)
  assert.equal(l.columns.length, 3)
  l = setColumnCount(l, 1)
  assert.deepEqual(l.columns.map(col => col.map(x => x.id)), [['meals', 'coming', 'today']], 'fewer: the cards move over')
  const full = L(true, Array(MAX_PER_COLUMN).fill('x').map((_, i) => ['clock', 'today', 'meals', 'photo', 'coming', 'due'][i]), ['chores'])
  assert.equal(moveCard(full, { col: 1, i: 0 }, { col: 0, i: 0 }), full, 'a full column takes no more')
})

test('cardOn: Meals, Due soon, Chores and Checklist go with their features; the picture card stays', () => {
  const off = { meals: false, lists: false, chores: false }
  assert.deepEqual(unplaced({ tiles: true, columns: [] }).filter(id => !cardOn(id, off)), ['meals', 'due', 'chores', 'checklist'])
  assert.equal(cardOn('photo', off), true)
  assert.equal(cardOn('meals', { ...off, meals: true }), true)
})

test('cast columns: a short tip takes its content height and leaves trivia the remaining room', () => {
  const col = normalizeLayout({ columns: [[{ id: 'tidbit', size: 'l' }, { id: 'tidbit2', size: 'm' }]] }).columns[0]
  assert.equal(columnRows(col, new Set(['tidbit'])), 'auto minmax(auto,2fr)')
  assert.equal(columnRows(col, new Set()), 'minmax(auto,3fr) minmax(auto,2fr)')
  const l = L(false, ['clock', 'today'], ['tidbit', 'tidbit2'])
  assert.deepEqual(layoutAreas(l, () => true).columns, l.columns, 'render each column independently')
})
