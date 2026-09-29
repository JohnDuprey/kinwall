// node --test test/ (npm test). The colors the page hands the iPhone/Android app for its frame.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { surfaces } from '../src/native.ts'
import { SKINS } from '../src/skins.ts'

const peach = SKINS.find(s => s.id === 'meadow')!

test('surfaces: the scheme\'s own bg and card, light and dark', () => {
  assert.deepEqual(surfaces(peach, {}), {
    light: { bg: '#FFFBF5', card: '#FFFFFF' },
    dark: { bg: '#1C1712', card: '#2A221B' },
  })
})

test('surfaces: custom colors win in both modes', () => {
  const s = surfaces(peach, { bg: '#0F1420', accent: '#123456' })
  assert.equal(s.light.bg, '#0F1420')
  assert.equal(s.dark.bg, '#0F1420')
  assert.equal(s.dark.card, '#2A221B')
})
