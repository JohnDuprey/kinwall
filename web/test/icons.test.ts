import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement, type ComponentType, type SVGProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const source = readFileSync(new URL('../src/icons.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
} }).outputText
const icons: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {}
new Function('require', 'exports', compiled)(createRequire(import.meta.url), icons)

test('every shared icon is decorative, unfocusable and uses the same outline canvas', () => {
  assert.ok(Object.keys(icons).length > 50)
  for (const [name, Icon] of Object.entries(icons)) {
    const svg = renderToStaticMarkup(createElement(Icon))
    for (const attribute of ['aria-hidden="true"', 'focusable="false"', 'viewBox="0 0 24 24"', 'stroke="currentColor"', 'stroke-width="2"']) {
      assert.ok(svg.includes(attribute), `${name}: missing ${attribute}`)
    }
    assert.ok(!/NaN|undefined/.test(svg), name)
  }
})

test('shared icons keep caller sizing, class and style overrides', () => {
  for (const [name, Icon] of Object.entries(icons)) {
    const svg = renderToStaticMarkup(createElement(Icon, { width: 18, height: 18, className: 'toolbar-icon', style: { color: 'red' } }))
    for (const attribute of ['width="18"', 'height="18"', 'class="toolbar-icon"', 'color:red']) {
      assert.ok(svg.includes(attribute), `${name}: missing ${attribute}`)
    }
  }
})
