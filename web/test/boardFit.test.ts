// node --test test/ (npm test). Fitting a Board card's rows to its space.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moreLabel, rowsThatFit } from '../src/boardFit.ts'

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
