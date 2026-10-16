import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBackStack } from '../src/backStack.ts'

test('backStack: Back closes the top overlay only, and says when nothing was open', () => {
  const s = createBackStack()
  const closed: string[] = []
  assert.equal(s.back(), false, 'nothing open: the app goes back itself')
  const offSheet = s.push(() => closed.push('sheet'))
  const offConfirm = s.push(() => closed.push('confirm'))
  assert.equal(s.back(), true)
  assert.deepEqual(closed, ['confirm'], 'the one on top')
  offConfirm()
  assert.equal(s.back(), true)
  assert.deepEqual(closed, ['confirm', 'sheet'])
  offSheet()
  offSheet() // twice (StrictMode) is harmless
  assert.equal(s.back(), false)
})

test("backStack: an overlay that stays open (unsaved changes) still takes Back", () => {
  const s = createBackStack()
  let asked = 0
  s.push(() => { asked++ }) // asks "Discard changes?" and stays
  assert.equal(s.back(), true)
  assert.equal(s.back(), true)
  assert.equal(asked, 2)
})
