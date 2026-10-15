// scripts/i18n-check.mjs: the translation check run by scripts/check.sh.
import { test } from 'node:test'
import assert from 'node:assert/strict'
// @ts-expect-error a plain .mjs script, no types
import { checkTranslation, compareBaseline, lowerBaseline, scanSource } from '../scripts/i18n-check.mjs'

const scan = (code: string, file = 'X.tsx') => scanSource(file, `import { msg, t, tc, tm, tn } from './i18n.ts'\n${code}`)

test('collects every literal key: t, tn (both forms), tc (with its context), msg and ? : between literals', () => {
  const r = scan(`
    const TABS = [{ label: msg('Board') }]
    export function A({ n, on }: { n: number; on: boolean }) {
      return <p title={t('Hi {name}', { name: 'Leo' })}>{tn(n, '{n} day', '{n} days')} {tc('now-next', 'Next')} {t(on ? 'On' : 'Off')} {tm(TABS[0].label)}</p>
    }`)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.keys.map((k: { key: string }) => k.key).sort(), ['Board', 'Hi {name}', 'Off', 'On', 'now-next|Next', '{n} day', '{n} days'].sort())
})

test('refuses a non-literal key and t() at module level; tm() and msg() are fine where they belong', () => {
  const r = scan(`
    const label = 'Board'
    const early = t('Frozen in English')
    export const A = () => <p>{t(label)}{tc('ctx', label)}{tm(label)}</p>`)
  assert.equal(r.errors.length, 3)
  assert.match(r.errors[0].message, /module level/)
  assert.match(r.errors[1].message, /literal English text/)
  assert.match(r.errors[2].message, /literal English text/)
  assert.match(scan('const x = tm(y)').errors[0].message, /module level/)
})

test('looks inside what a skipped call is called on: [t(...), `x ${y}`].join(...)', () => {
  const r = scan(`export const A = ({ who }: { who: string }) => <p aria-label={[t('Idea from {who}', { who }), \`done by \${who}\`].filter(Boolean).join(', ')} />`)
  assert.deepEqual(r.keys.map((k: { key: string }) => k.key), ['Idea from {who}'])
  assert.equal(r.hardcoded, 1)
})

test("only i18n.ts's functions count: a file's own t() or msg() is left alone", () => {
  const r = scanSource('Library.tsx', `const msg = (e: unknown, s: string) => s\nexport const f = (e: unknown) => msg(e, "Couldn't load the library")`)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.keys, [])
})

test('counts hard-coded copy, not text inside t() or code strings', () => {
  const r = scan(`export const A = () => <div className="a b" aria-label="Open the list">Hello there {t('Already wrapped text')}<input placeholder="Add an item" /></div>
    const sql = 'SELECT id FROM members'`)
  assert.equal(r.hardcoded, 3)
  assert.deepEqual(r.spots.map((s: { text: string }) => s.text), ['Open the list', 'Hello there', 'Add an item'])
})

test('a translation may only have English keys, non-empty, with the same placeholders', () => {
  const en = { 'Hi {name}': 'Hi {name}', '{n} day': '{n} day', '{n} days': '{n} days', Board: 'Board' }
  assert.deepEqual(checkTranslation(en, { 'Hi {name}': 'Hallo {name}', '{n} days#few': '{n} dni', Board: 'Board' }, 'de'), [])
  const errors = checkTranslation(en, { 'Hi {name}': 'Hallo {nome}', 'Gone text': 'Weg', Board: ' ', '{n} days#few': 'dni' }, 'de')
  assert.equal(errors.length, 4)
  assert.match(errors.join('\n'), /Hallo \{nome\}|\{nome\}/)
  assert.match(errors.join('\n'), /"Gone text" isn't in en\.json/)
  assert.match(errors.join('\n'), /"Board" is empty/)
})

test('the ratchet: a file may not gain hard-coded strings; --write only lowers the baseline', () => {
  assert.deepEqual(compareBaseline({ 'A.tsx': 3 }, { 'A.tsx': 3, 'B.tsx': 0 }), [])
  assert.match(compareBaseline({ 'A.tsx': 3 }, { 'A.tsx': 4 })[0], /A\.tsx: 4 hard-coded strings, the baseline allows 3/)
  assert.match(compareBaseline({}, { 'New.tsx': 1 })[0], /New\.tsx/)
  assert.deepEqual(lowerBaseline({ 'A.tsx': 3, 'B.tsx': 2, 'C.tsx': 5 }, { 'A.tsx': 1, 'B.tsx': 4, 'D.tsx': 2 }), { 'A.tsx': 1, 'B.tsx': 2 }, 'a new file starts at 0')
})
