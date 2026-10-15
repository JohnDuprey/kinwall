// The translation check (scripts/check.sh runs it; docs/contributing/translations.md explains it).
//   node scripts/i18n-check.mjs          check: fails on anything below
//   node scripts/i18n-check.mjs --write  regenerate src/locales/en.json and lower i18n-baseline.json
//   node scripts/i18n-check.mjs --reset-baseline  set the baseline to today's counts (a reviewed exception)
//   add --server for the server's text (server/src/locales, server/i18n-baseline.json), checked the same way:
//   its t()/tc()/tn() come from `const { t } = words(lang)` (server/src/i18n.ts), and every `error:`
//   in it is a key too ("error|…", a `${value}` in it becomes {value}), translated on the way out.
// 1. en.json holds every key the code uses: the literal text of t(), tn() (both forms), tc()
//    ("context|text") and msg(). It's generated; the check fails when it's out of date.
// 2. A key must be literal text (or a ? : between literals). Text kept in a constant is marked with
//    msg('…') where it's defined and shown with tm(label), which the check doesn't look into.
// 3. No t()/tc()/tn() at module level: it would run before the language loads and stay English.
// 4. Each translation (src/locales/<lang>.json) only has keys en.json has, with the same {placeholders}.
// 5. A ratchet on hard-coded copy: i18n-baseline.json holds each file's count of English strings
//    outside t(); a file may not go up, and a new file starts at 0. --write only ever lowers it.
// ponytail: the hard-coded count is a heuristic (JSX text, UI attributes, sentence-like literals),
// good for a ratchet, not an extractor; demo data and content files are left out.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const KEY_CALLS = new Set(['t', 'tc', 'tn', 'msg'])
const ALL_CALLS = new Set([...KEY_CALLS, 'tm'])
const SKIP_CALLS = new Set([...ALL_CALLS, 'require', 'import', 'querySelector', 'querySelectorAll', 'getItem', 'setItem', 'removeItem', 'prepare', 'get', 'set', 'has', 'fetch', 'addEventListener', 'removeEventListener', 'startsWith', 'endsWith', 'includes', 'split', 'join', 'replace', 'test', 'exec', 'format', 'parse', 'log', 'warn', 'error', 'debug', 'matchMedia', 'getElementById', 'closest', 'Error'])
const UI_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'label', 'alt', 'hint', 'subtitle', 'description', 'emptyText', 'confirmLabel', 'heading'])
// Not UI copy: demo data, content files (translated as content later), test helpers.
const SKIP_FILES = /^(mock[\w-]*|tidbits|coloringPages|catalog|choreLibrary)\.ts$/
// Server: MCP and OpenAPI text stays English (AGENTS.md), and so do the migrations.
const SERVER_SKIP_FILES = /^(mcp|schemas|meal-schemas|worker-migrations|redact)\.ts$/
// Server: what isn't for people: OpenAPI and zod text, SQL, logs, headers.
const SERVER_SKIP_CALLS = new Set(['describe', 'openapi', 'refine', 'regex', 'header', 'bind', 'all', 'first', 'run', 'createRoute', 'json'])
const SERVER_SKIP_PROPS = new Set(['description', 'summary', 'example', 'path', 'method', 'tags', 'name', 'key', 'kind', 'url', 'tag', 'id', 'source'])
const looksLikeCopy = (s) => /[A-Za-z]{2,}/.test(s) && /\s/.test(s.trim()) && !/^[a-z-]+(\s[a-z-]+)*$/.test(s.trim())
  && !/^(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH)\b/i.test(s) && !/[{};]|=>|^\s*[.#]|https?:|\/api\//.test(s) && !/^[\w-]+(\s[\w-]+)*:\s/.test(s)
const isFn = (n) => ts.isFunctionLike(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)
const literal = (n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null
/** The texts an argument can be: a literal, or a ? : (in parentheses or not) between literals. */
function texts(n) {
  if (!n) return null
  if (ts.isParenthesizedExpression(n)) return texts(n.expression)
  if (ts.isConditionalExpression(n)) { const a = texts(n.whenTrue), b = texts(n.whenFalse); return a && b ? [...a, ...b] : null }
  const l = literal(n)
  return l === null ? null : [l]
}

/** A `${value}` in a template's error as its {placeholder}: the variable's or property's name, {n}
 * for a constant or a sum (MAX_WAITING, LIMITS.maxKeys / 1024), else {value}. */
function slotName(e) {
  if (ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e)) return slotName(e.expression)
  if (ts.isBinaryExpression(e)) return e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? slotName(e.left) : 'n'
  const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ts.isCallExpression(e) && !/^Math\./.test(e.expression.getText()) ? slotName(e.expression) : ts.isCallExpression(e) ? 'n' : 'value'
  return /^[A-Z0-9_]+$/.test(name) || /^max[A-Z]/.test(name) ? 'n' : name
}
function templateKey(n) {
  if (!ts.isTemplateExpression(n)) return null
  const byText = new Map(), taken = new Set()
  return n.head.text + n.templateSpans.map(span => {
    const text = span.expression.getText()
    if (!byText.has(text)) {
      const base = slotName(span.expression)
      let name = base
      for (let k = 2; taken.has(name); k++) name = `${base}${k}`
      taken.add(name)
      byText.set(text, name)
    }
    return `{${byText.get(text)}}${span.literal.text}`
  }).join('')
}

/** An error's texts: literals and templates, either side of a ? :. */
function errorTexts(n) {
  if (ts.isParenthesizedExpression(n)) return errorTexts(n.expression)
  if (ts.isConditionalExpression(n)) { const a = errorTexts(n.whenTrue), b = errorTexts(n.whenFalse); return a || b ? [...(a ?? []), ...(b ?? [])] : null }
  const l = literal(n) ?? templateKey(n)
  return l === null ? null : [l]
}
// Server strings that aren't copy: SQL, column lists, paths.
const serverCode = (s) => /\b[a-z]+_[a-z_]+\b|->>|\b(SELECT|FROM|WHERE|CONFLICT|excluded)\b|^\s*\/|^[a-z_, ]+$/.test(s)

/** One file: the keys it uses, its errors and its count of hard-coded strings. `server`: the server's
 * rules (words() destructuring, `error:` keys, OpenAPI/SQL/log text skipped). */
export function scanSource(file, text, { server = false } = {}) {
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const lines = text.split('\n')
  const keys = []
  const errors = []
  const spots = [] // where the hard-coded strings are
  const hard = (n, text) => spots.push({ line: lineOf(n), text })
  const lineOf = (n) => src.getLineAndCharacterOfPosition(n.getStart(src)).line
  const keyCall = (node, name, inFn) => {
    const line = lineOf(node)
    const args = node.arguments
    if (name !== 'msg' && name !== 'stored' && !inFn) errors.push({ line, message: `${name}() at module level stays English: call it at render, or mark the text with msg()` })
    const ctx = name === 'tc' || name === 'stored'
    const want = name === 'tn' ? [args[1], args[2]] : ctx ? [args[1]] : [args[0]]
    if (ctx && literal(args[0]) === null) errors.push({ line, message: `${name}() needs a literal context` })
    for (const a of want) {
      const all = texts(a)
      if (!all) { errors.push({ line, message: `${name}() needs literal English text: for a label kept in a constant, mark it msg('…') there and show it with tm()` }); continue }
      for (const text of all) keys.push({ key: ctx ? `${literal(args[0])}|${text}` : text, text, line })
    }
  }
  // Only the i18n.ts functions count (Library.tsx has its own msg(), the demo data its own t()).
  const ours = new Set()
  for (const st of src.statements) {
    if (ts.isImportDeclaration(st) && /\/i18n(\.ts)?$/.test(st.moduleSpecifier.text) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      for (const el of st.importClause.namedBindings.elements) if ((ALL_CALLS.has(el.name.text) || (server && el.name.text === 'stored')) && !el.isTypeOnly) ours.add(el.name.text)
    }
  }
  const imported = (name) => src.statements.some(st => ts.isImportDeclaration(st) && /\/i18n(\.ts)?$/.test(st.moduleSpecifier.text) && st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings) && st.importClause.namedBindings.elements.some(el => el.name.text === name))
  if (server && (imported('words') || imported('wordsFor'))) ours.add('t').add('tc').add('tn') // const { t, tn } = words(lang)
  // A file that can't import i18n.ts (nudges.ts: the web app shares it) marks its English with its own msg().
  if (server && src.statements.some(st => ts.isVariableStatement(st) && st.declarationList.declarations.some(d => ts.isIdentifier(d.name) && d.name.text === 'msg'))) ours.add('msg')
  if (server) ours.delete('tm') // tm(lang, label): not a key
  const visit = (node, inFn) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (server && ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const prop = node.name.text
      if (prop === 'error') {
        const all = errorTexts(node.initializer)
        if (all) { for (const text of all) if (/\s/.test(text) || /^[A-Z][a-z]+$/.test(text)) keys.push({ key: `error|${text}`, text, line: lineOf(node) }); return }
      }
      if (SERVER_SKIP_PROPS.has(prop)) return
    }
    const fn = inFn || isFn(node)
    if (ts.isCallExpression(node)) {
      const e = node.expression
      const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : ''
      if (ts.isIdentifier(e) && ours.has(name)) {
        if (name === 'stored') { keyCall(node, name, fn); return }
        if (name === 'tm') { if (!fn) errors.push({ line: lineOf(node), message: 'tm() at module level stays English: call it at render' }) }
        else keyCall(node, name, fn)
      }
      // The call's own arguments aren't copy, but what it's called on can be: [t('a'), b].join(' · ').
      if (SKIP_CALLS.has(name) || (server && SERVER_SKIP_CALLS.has(name))) { visit(e, fn); node.arguments.forEach(a => { if (!literal(a)) visit(a, fn) }); return }
    }
    if (ts.isJsxText(node)) { if (/[A-Za-z]{2,}/.test(node.text)) hard(node, node.text.trim()); return }
    if (ts.isJsxAttribute(node)) {
      const a = node.name.getText(src)
      if (['className', 'style', 'key', 'id', 'href', 'lang', 'type', 'role', 'value', 'htmlFor', 'name', 'autoComplete', 'inputMode'].includes(a)) return
      if (node.initializer && ts.isStringLiteral(node.initializer)) { if (UI_ATTRS.has(a) && /[A-Za-z]{2,}/.test(node.initializer.text)) hard(node, node.initializer.text); return }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if ((!ts.isPropertyAssignment(node.parent) || node.parent.initializer === node) && looksLikeCopy(node.text) && !(server && serverCode(node.text))) hard(node, node.text)
      return
    }
    if (ts.isTemplateExpression(node)) { const s = node.head.text + node.templateSpans.map(x => ' x ' + x.literal.text).join(''); if (looksLikeCopy(s) && !(server && serverCode(s))) hard(node, s) }
    ts.forEachChild(node, n => visit(n, fn))
  }
  visit(src, false)
  return { keys, errors, hardcoded: spots.length, spots }
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')

/** A translation's problems: keys English doesn't have, and placeholders that don't match. */
export function checkTranslation(en, dict, lang) {
  const errors = []
  for (const [key, value] of Object.entries(dict)) {
    const base = key.replace(/#(zero|one|two|few|many|other)$/, '') // an extra plural form of `base`
    if (!(base in en)) { errors.push(`${lang}.json: "${key}" isn't in en.json (the English changed or was removed: translate the new text, drop this one)`); continue }
    if (typeof value !== 'string' || !value.trim()) { errors.push(`${lang}.json: "${key}" is empty`); continue }
    if (placeholders(value) !== placeholders(en[base])) errors.push(`${lang}.json: "${key}" has {${placeholders(value)}}, English has {${placeholders(en[base])}}`)
  }
  return errors
}

/** Files whose hard-coded count went up since the baseline. A new file starts from 0. */
export function compareBaseline(baseline, counts) {
  return Object.entries(counts).filter(([f, n]) => n > (baseline[f] ?? 0))
    .map(([f, n]) => `${f}: ${n} hard-coded strings, the baseline allows ${baseline[f] ?? 0}. Wrap new text in t() (docs/contributing/translations.md)`)
}
/** The baseline after --write: never higher than before. */
export const lowerBaseline = (baseline, counts) =>
  Object.fromEntries(Object.entries(counts).map(([f, n]) => [f, Math.min(n, baseline[f] ?? 0)]).filter(([, n]) => n > 0).sort(([a], [b]) => a.localeCompare(b)))

const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
const json = (o) => JSON.stringify(o, null, 2) + '\n'

function main() {
  const server = process.argv.includes('--server')
  const web = fileURLToPath(new URL('..', import.meta.url))
  const root = server ? join(web, '..', 'server') : web
  const srcDir = join(root, 'src')
  const where = server ? 'server/src' : 'src'
  const reset = process.argv.includes('--reset-baseline')
  const write = reset || process.argv.includes('--write')
  const files = []
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== 'locales') walk(p) } else if (/\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) files.push(p) } }
  walk(srcDir)
  const en = {}
  const errors = []
  const counts = {}
  const spots = {}
  for (const file of files) {
    const rel = relative(srcDir, file)
    const r = scanSource(file, readFileSync(file, 'utf8'), { server })
    for (const k of r.keys) en[k.key] = k.text
    for (const e of r.errors) errors.push(`${where}/${rel}:${e.line + 1}: ${e.message}`)
    if (!(server ? SERVER_SKIP_FILES : SKIP_FILES).test(rel) && r.hardcoded) { counts[rel] = r.hardcoded; spots[rel] = r.spots }
  }
  const enPath = join(srcDir, 'locales', 'en.json')
  const basePath = join(root, 'i18n-baseline.json')
  const fresh = json(sortObj(en))
  const again = `node scripts/i18n-check.mjs${server ? ' --server' : ''} --write`
  let baseline = JSON.parse(readFileSync(basePath, 'utf8'))
  if (write) {
    writeFileSync(enPath, fresh)
    baseline = reset ? sortObj(counts) : lowerBaseline(baseline, counts)
    writeFileSync(basePath, json(baseline))
  } else if (readFileSync(enPath, 'utf8') !== fresh) errors.push(`${where}/locales/en.json is out of date: run \`${again}\` in web/`)
  for (const e of compareBaseline(baseline, counts)) {
    const f = e.slice(0, e.indexOf(':'))
    errors.push(e, ...spots[f].slice(0, 8).map(s => `  ${where}/${f}:${s.line + 1}: ${JSON.stringify(s.text).slice(0, 100)}`))
  }
  const report = []
  for (const f of readdirSync(join(srcDir, 'locales'))) {
    if (!/^[a-z]{2}\.json$/.test(f) || f === 'en.json') continue
    const lang = f.slice(0, 2)
    const dict = JSON.parse(readFileSync(join(srcDir, 'locales', f), 'utf8'))
    errors.push(...checkTranslation(en, dict, lang))
    const done = Object.keys(en).filter(k => k in dict).length
    report.push(`${lang}: ${done} of ${Object.keys(en).length} strings (${Math.round(100 * done / (Object.keys(en).length || 1))}%)`)
  }
  const left = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`i18n${server ? ' (server)' : ''}: ${Object.keys(en).length} keys; ${left} hard-coded strings left in ${Object.keys(counts).length} files; ${report.join('; ')}`)
  if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
