import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Guard the startup dependency graph, including small named exports which can accidentally
// bring an entire deferred screen back into the initial bundle.
function eagerModules(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const source = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true)
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue
    if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) continue
    if (ts.isExportDeclaration(node) && node.isTypeOnly) continue
    const path = node.moduleSpecifier.text
    if (!path.startsWith('.')) continue
    const base = resolve(dirname(entry), path)
    const file = [base, base + '.ts', base + '.tsx'].find(f => existsSync(f))
    if (file && /\.tsx?$/.test(file)) eagerModules(file, seen)
  }
  return seen
}

test('secondary screens stay out of the eager startup graph', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url))
  const eager = eagerModules(resolve(src, 'App.tsx'))
  for (const screen of ['Settings', 'Activities', 'Setup', 'Authorize', 'Meals', 'Lists', 'Rewards', 'Profile', 'Journal', 'Insights', 'Medications', 'RoutineMode']) {
    assert.ok(!eager.has(resolve(src, screen + '.tsx')), `${screen} loads before it is opened`)
  }
})
