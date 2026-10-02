// node --test test/ (npm test). The logo's heads follow the color scheme and stay visible.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SKINS } from '../src/skins.ts'
import { contrastRatio, logoHeads } from '../src/color.ts'

test('Peacock keeps the logo blue; every other scheme gets heads at 3:1 on its background', () => {
  assert.equal(logoHeads('peacock', '#6CB4EE', '#EEF3F8'), '#4C9FE1')
  for (const s of SKINS) for (const b of [s.light, s.dark]) {
    if (s.id === 'peacock') continue
    assert.ok(contrastRatio(logoHeads(s.id, s.dark.accent, b.bg), b.bg) >= 3, s.id)
  }
})
