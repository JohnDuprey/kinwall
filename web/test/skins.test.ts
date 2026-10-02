// node --test test/ (npm test). The Color scheme sheet's groups, descriptions and Seasonal line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SKIN_ID, SCHEME_BLURBS, SCHEME_GROUPS, SKINS, seasonalNote, tokensFor } from '../src/skins.ts'
import { contrastRatio } from '../src/color.ts'

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

test('every built-in skin passes WCAG AA for text, dim text and accent buttons', () => {
  for (const skin of SKINS) for (const dark of [false, true]) {
    const t = tokensFor(skin, dark)
    for (const [fg, bg] of [[t.text, t.bg], [t.text, t.bgAlt], [t.text, t.card], [t.textDim, t.bg], [t.textDim, t.bgAlt], [t.textDim, t.card], [t.accentInk, t.accentStrong]])
      assert.ok(contrastRatio(fg, bg) >= 4.5, `${skin.id} ${dark ? 'dark' : 'light'} ${fg} on ${bg}`)
  }
})

test('Modern schemes are tinted with their color, not plain gray', () => {
  // sRGB chroma (max channel minus min channel, 0-255): a gray is 0; the old washed-out look was 1-5.
  const chroma = (hex: string) => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); return Math.max(...c) - Math.min(...c) }
  const modern = SCHEME_GROUPS.find(g => g.label === 'Modern')!.ids
  for (const id of modern) for (const mode of ['light', 'dark'] as const) {
    const b = SKINS.find(s => s.id === id)![mode]
    for (const k of ['bg', 'bgAlt', 'border'] as const) assert.ok(chroma(b[k]) >= 8, `${id} ${mode} ${k} ${b[k]} looks gray`)
  }
})

test('Peacock is the default and leads Modern, then Eucalyptus, with the deep peacock as its light fill', () => {
  const modern = SCHEME_GROUPS.find(g => g.label === 'Modern')!.ids
  assert.deepEqual(modern.slice(0, 2), ['peacock', 'eucalyptus'])
  assert.equal(DEFAULT_SKIN_ID, 'peacock')
  const peacock = SKINS.find(s => s.id === 'peacock')!
  assert.equal(tokensFor(peacock, false).accentStrong, '#123857')
})
