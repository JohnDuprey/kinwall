import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/Lists.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('phone lists offer the add sheet for every kind and keep wide-screen add controls', () => {
  assert.match(source, /const isPhone = narrow \|\| landscape/)
  assert.match(source, /list.kind !== 'shopping' && !isPhone/)
  assert.match(source, /!isPhone && <button className=\{`btn/)
  assert.match(source, /isPhone && <button className="fab" onClick=\{\(\) => setAdding\(true\)\}/)
  assert.match(source, /<ItemAddSheet[^>]*kind=\{itemKind\(list\)\}/)
  assert.match(styles, /\.list-detail-phone \.list-items \{ padding-bottom: calc\(84px \+ var\(--safe-b\)\)/)
})

test('phone overview keeps new and edit list actions outside the wide-screen pill row', () => {
  assert.match(source, /!reordering && !isPhone &&/)
  assert.match(source, /isPhone && !selectedId && !reordering && <button className="fab"/)
  assert.match(source, /aria-label=\{t\('Edit lists'\)\}/)
  assert.match(source, /isPhone && index === 0 && parentDevice && !reordering/)
})
