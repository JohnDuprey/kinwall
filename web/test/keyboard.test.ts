import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coveredPx, keyboardUp, typesText } from '../src/keyboard.ts'

test('only fields you type into bring the keyboard up', () => {
  assert.equal(typesText({ tagName: 'INPUT', type: 'text' }), true)
  assert.equal(typesText({ tagName: 'INPUT', type: 'search' }), true)
  assert.equal(typesText({ tagName: 'INPUT', type: '' }), true) // no type attribute
  assert.equal(typesText({ tagName: 'TEXTAREA' }), true)
  assert.equal(typesText({ tagName: 'IFRAME' }), true) // an activity's own fields
  assert.equal(typesText({ tagName: 'DIV', isContentEditable: true }), true)
  for (const type of ['checkbox', 'radio', 'range', 'button', 'color', 'file'])
    assert.equal(typesText({ tagName: 'INPUT', type }), false, type)
  assert.equal(typesText({ tagName: 'BUTTON' }), false)
  assert.equal(typesText({ tagName: 'SELECT' }), false)
  assert.equal(typesText(null), false)
})

test('the keyboard is up when typing and the visible height fell below 75% of the tallest', () => {
  assert.equal(keyboardUp(true, 330, 690), true) // Android tablet on its side: the page shrank
  assert.equal(keyboardUp(true, 420, 820), true) // iPad: only the visual viewport shrank
  assert.equal(keyboardUp(true, 640, 690), false) // a system bar, not a keyboard
  assert.equal(keyboardUp(false, 330, 690), false) // a hardware keyboard dismissed it; nothing focused
})

test('covered px: what the keyboard hides at the bottom of the page', () => {
  assert.equal(coveredPx(820, 0, 420), 400) // iPad: overlay
  assert.equal(coveredPx(820, 60, 420), 340) // iPad, the visual viewport scrolled down
  assert.equal(coveredPx(330, 0, 330), 0) // Android: the page itself shrank
  assert.equal(coveredPx(330, 0, 331), 0)
})
