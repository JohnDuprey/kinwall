import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

test('web controls never render native select elements', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url))
  const files = readdirSync(root, { recursive: true }).filter(file => /\.[jt]sx?$/.test(String(file)))
  const offenders = files.filter(file => {
    const source = ts.createSourceFile(String(file), readFileSync(join(root, String(file)), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let found = false
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'select') found = true
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  })
  assert.deepEqual(offenders, [], 'Use Choose or PickField for choices')
})

test('web controls never render native checkboxes', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url))
  const files = readdirSync(root, { recursive: true }).filter(file => /\.[jt]sx?$/.test(String(file)))
  const offenders = files.filter(file => {
    const source = ts.createSourceFile(String(file), readFileSync(join(root, String(file)), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let found = false
    const visit = (node: ts.Node) => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'input') {
        found ||= node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'type'
          && !!attribute.initializer && (ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text === 'checkbox'
            : ts.isJsxExpression(attribute.initializer) && !!attribute.initializer.expression && ts.isStringLiteral(attribute.initializer.expression) && attribute.initializer.expression.text === 'checkbox'))
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  })
  assert.deepEqual(offenders, [], 'Use Switch for settings, chips or checkable rows for choices, and the existing tick control for tasks')
})
