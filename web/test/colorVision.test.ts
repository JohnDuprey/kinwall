// node --test test/ (npm test). Color vision: simulating color blindness, and whether two people's colors look alike.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alikeUnder, deltaE, firstClash, looksAlike, simulate, suggestColor } from '../src/colorVision.ts'
import { MEMBER_PALETTE } from '../src/types.ts'

test('simulate: Machado 2009 in linear RGB, known values', () => {
  for (const t of ['protan', 'deutan', 'tritan'] as const) {
    assert.equal(simulate('#FFFFFF', t), '#FFFFFF', `${t}: white stays white`)
    assert.equal(simulate('#000000', t), '#000000', `${t}: black stays black`)
  }
  // Pure red: each row's first coefficient, clamped, back to sRGB.
  assert.equal(simulate('#FF0000', 'deutan'), '#A39000')
  assert.equal(simulate('#FF0000', 'protan'), '#6D5F00')
  assert.equal(simulate('#FF0000', 'tritan'), '#FF000F')
  assert.equal(simulate('#ff8fa3', 'deutan'), simulate('#FF8FA3', 'deutan'), 'case-insensitive')
})

test('deltaE: CIE76, 0 for the same color, about 100 from black to white', () => {
  assert.equal(deltaE('#7AB8FF', '#7AB8FF'), 0)
  assert.ok(Math.abs(deltaE('#000000', '#FFFFFF') - 100) < 0.1)
})

test('looksAlike: pink and green under deutan, blue and orange never', () => {
  assert.equal(alikeUnder('#FF8FA3', '#7ED9A6'), 'deutan') // the demo's Sam and Maya
  assert.equal(looksAlike('#FF8FA3', '#7ED9A6'), true)
  assert.equal(looksAlike('#7AB8FF', '#F5A65B'), false)
  assert.equal(alikeUnder('#7AB8FF', '#F5A65B'), null)
  assert.equal(alikeUnder('#FF9E7A', '#FF9F7B'), 'typical', 'close with typical vision too')
  assert.equal(alikeUnder('#888', '#888888'), null, 'not #RRGGBB: no guess')
})

test('suggestColor: a palette color that clashes with no one, or null', () => {
  const taken = ['#7AB8FF', '#FF8FA3', '#F5A65B'] // Alex, Sam, Leo; the pick is for Maya
  const pick = suggestColor(taken, MEMBER_PALETTE)
  assert.ok(pick && MEMBER_PALETTE.includes(pick))
  for (const t of taken) assert.equal(looksAlike(pick, t), false, `${pick} vs ${t}`)
  // Every family of up to 4 from the palette: whatever it suggests never clashes.
  for (const a of MEMBER_PALETTE) for (const b of MEMBER_PALETTE) for (const c of MEMBER_PALETTE) {
    const s = suggestColor([a, b, c], MEMBER_PALETTE)
    if (s) assert.ok([a, b, c].every(x => !looksAlike(s, x)), `${s} vs ${a} ${b} ${c}`)
  }
  assert.equal(suggestColor(MEMBER_PALETTE, MEMBER_PALETTE), null, 'nothing left that is far enough')
})

test('firstClash: the first pair in family order that looks alike, the later one to change', () => {
  const family = [{ name: 'Alex', color: '#7AB8FF' }, { name: 'Sam', color: '#FF8FA3' }, { name: 'Maya', color: '#7ED9A6' }, { name: 'Leo', color: '#F5A65B' }]
  const clash = firstClash(family)
  assert.deepEqual(clash && [clash[0].name, clash[1].name, clash[2]], ['Sam', 'Maya', 'deutan'])
  assert.equal(firstClash([family[0], family[1], family[3]]), null)
})

test('suggestColor: clearly different with typical vision first (the demo: Maya gets no pink)', () => {
  const others = ['#7AB8FF', '#FF8FA3', '#F5A65B'] // Alex, Sam, Leo
  const pick = suggestColor(others, MEMBER_PALETTE)!
  for (const o of others) {
    assert.ok(deltaE(pick, o) >= 25, `${pick} vs ${o}: ${deltaE(pick, o).toFixed(1)}`)
    assert.equal(looksAlike(pick, o), false)
  }
  assert.notEqual(pick, '#FFB6D9', 'not Rose, next to Sam\'s pink')
})
