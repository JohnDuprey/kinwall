import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const source = readFileSync(new URL('../src/a11y.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
} }).outputText
const require = createRequire(import.meta.url)
const controls: Record<string, ComponentType<Record<string, unknown>>> = {}
new Function('require', 'exports', compiled)((name: string) => {
  if (name === './i18n.ts') return { t: (text: string) => text }
  if (name === './failureMessage.ts') return {}
  if (name === './icons.tsx') return { CheckIcon: () => createElement('svg', { 'aria-hidden': true }) }
  return require(name)
}, controls)
const render = (control: string, props: Record<string, unknown>) => renderToStaticMarkup(createElement(controls[control], { checked: false, onChange: () => {}, label: 'A setting', ...props }))

for (const control of ['Switch', 'CheckRow']) {
  test(`${control} preserves named checkbox submission values and omission`, () => {
    const off = render(control, { name: 'day-1' })
    const input = off.match(/<input[^>]*>/)?.[0] ?? ''
    for (const attribute of ['type="hidden"', 'name="day-1"', 'disabled=""', 'value="on"']) assert.ok(input.includes(attribute), attribute)
    const on = render(control, { checked: true, name: 'requiredChoreIds', value: 'fake-chore-1' })
    assert.match(on, /<input[^>]*name="requiredChoreIds"[^>]*value="fake-chore-1"/)
    assert.doesNotMatch(on, /disabled=/)
    const disabled = render(control, { checked: true, disabled: true, name: 'requiredChoreIds', value: 'fake-chore-1' })
    assert.match(disabled, /<input[^>]*disabled=""/)
    assert.match(disabled, /<button[^>]*disabled=""/)
  })

  test(`${control} never submits a button or creates an unnamed form value`, () => {
    const html = render(control, {})
    assert.match(html, /<button[^>]*type="button"/)
    assert.doesNotMatch(html, /<input/)
  })
}

test('switch exposes its visible label, hint and state to assistive technology', () => {
  const html = render('Switch', { id: 'fake-setting', checked: true, label: 'A setting', hint: 'A useful hint' })
  assert.match(html, /<label[^>]*for="fake-setting"[^>]*id="fake-setting-label">A setting<\/label>/)
  assert.match(html, /id="fake-setting-hint">A useful hint<\/p>/)
  assert.match(html, /role="switch" aria-checked="true" aria-labelledby="fake-setting-label" aria-describedby="fake-setting-hint"/)
})

test('checkable choices use pressed state while switches use on/off state', () => {
  assert.match(render('CheckRow', { checked: true }), /aria-pressed="true"/)
  assert.match(render('CheckRow', { checked: false }), /aria-pressed="false"/)
  assert.match(render('Switch', { checked: false }), /aria-checked="false"/)
})
