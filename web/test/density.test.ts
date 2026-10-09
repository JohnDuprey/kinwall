import { test } from 'node:test'
import assert from 'node:assert/strict'
import { effectiveDensity } from '../src/density.ts'

const fam = { density: 'comfortable' as const, textScale: 'm' as const }

test('a parent phone runs compact unless this device picked something', () => {
  assert.equal(effectiveDensity(fam, {}, true), 'compact')
  assert.equal(effectiveDensity(fam, { density: 'comfortable' }, true), 'comfortable')
  assert.equal(effectiveDensity(fam, { density: 'icons' }, true), 'icons')
})

test('everything else follows the family', () => {
  assert.equal(effectiveDensity(fam, {}, false), 'comfortable')
  assert.equal(effectiveDensity({ ...fam, density: 'compact' }, {}, false), 'compact')
})

test('big text and low stimulation keep the roomier layout on a parent phone', () => {
  assert.equal(effectiveDensity({ ...fam, textScale: 'l' }, {}, true), 'comfortable')
  assert.equal(effectiveDensity(fam, { textScale: 'xl' }, true), 'comfortable')
  assert.equal(effectiveDensity(fam, { lowStim: true }, true), 'comfortable')
  assert.equal(effectiveDensity(fam, { lowStim: true, density: 'compact' }, false), 'comfortable')
})
