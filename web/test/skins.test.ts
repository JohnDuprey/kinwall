// node --test test/ (npm test). The Color scheme sheet's groups, descriptions and Seasonal line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEME_BLURBS, SCHEME_GROUPS, SKINS, seasonalNote } from '../src/skins.ts'

test('every built-in skin is in exactly one group and has a short description', () => {
  const grouped = SCHEME_GROUPS.flatMap(g => g.ids).filter(id => id !== 'seasonal')
  assert.deepEqual([...grouped].sort(), SKINS.map(s => s.id).sort())
  for (const s of SKINS) assert.ok(SCHEME_BLURBS[s.id] && SCHEME_BLURBS[s.id].length <= 60, s.id)
})

test('seasonalNote names the skin Seasonal uses on that date', () => {
  assert.equal(seasonalNote(new Date(2026, 8, 29)), 'Changes with the season. Now: Autumn')
  assert.equal(seasonalNote(new Date(2026, 10, 20)), 'Changes with the season. Now: Harvest')
  assert.equal(seasonalNote(new Date(2026, 11, 20)), 'Changes with the season. Now: Festive')
  assert.equal(seasonalNote(new Date(2027, 1, 1)), 'Changes with the season. Now: Winter')
})
