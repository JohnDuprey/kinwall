// node --test test/ (npm test). Swipe-to-delete on a list item row: axis lock, offset and where it lands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { swipeAxis, swipeOffset, swipeEnd } from '../src/swipe.ts'

test('swipeAxis: undecided until 10px, then the bigger direction wins', () => {
  assert.equal(swipeAxis(5, 3), null)
  assert.equal(swipeAxis(-9, 9), null)
  assert.equal(swipeAxis(-12, 4), 'x')
  assert.equal(swipeAxis(4, 15), 'y')
  assert.equal(swipeAxis(-11, -11), 'y') // a tie scrolls: scrolling is the common case
})

test('swipeOffset: follows the finger left, never right of closed, never past the row', () => {
  assert.equal(swipeOffset(-30, false, 300), -30)
  assert.equal(swipeOffset(40, false, 300), 0)
  assert.equal(swipeOffset(-500, false, 300), -300)
  assert.equal(swipeOffset(20, true, 300, 96), -76) // open: starts from the revealed button
  assert.equal(swipeOffset(200, true, 300, 96), 0)
})

test('swipeEnd: a full swipe deletes, past half the button snaps open, else it closes', () => {
  assert.equal(swipeEnd(-200, 300), 'delete') // 60% of the row
  assert.equal(swipeEnd(-179, 300), 'open')
  assert.equal(swipeEnd(-49, 300, 96), 'open')
  assert.equal(swipeEnd(-47, 300, 96), 'closed')
  assert.equal(swipeEnd(0, 300), 'closed')
  assert.equal(swipeEnd(-150, 120, 96), 'delete') // a narrow row: past the button and past 60% deletes
})
