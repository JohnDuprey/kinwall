// node --test test/ (npm test). Help → "Help with this page" picks the docs page for the open screen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { helpPath } from '../src/helpPage.ts'

test('a screen opens its own docs page', () => {
  assert.equal(helpPath(''), 'using/calendar', 'Home')
  assert.equal(helpPath('#/home'), 'using/calendar')
  assert.equal(helpPath('#/meals'), 'using/meals')
  assert.equal(helpPath('#/recipes/r1'), 'using/meals')
  assert.equal(helpPath('#/profile/m3'), 'using/profiles')
  assert.equal(helpPath('#/lists/l2?shop=1'), 'using/lists')
})

test('Settings opens the docs for its tab', () => {
  assert.equal(helpPath('#/settings'), 'settings/general')
  assert.equal(helpPath('#/settings?tab=access&section=paired-devices'), 'settings/access')
  assert.equal(helpPath('#/settings?tab=nope'), 'settings/general')
})

test('a screen without its own page has none', () => {
  assert.equal(helpPath('#/authorize'), null)
})
