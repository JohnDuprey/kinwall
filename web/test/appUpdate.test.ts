import { test } from 'node:test'
import assert from 'node:assert/strict'
import { retryBoot, shellIsNewer } from '../src/appUpdate.ts'

const shell = (name: string) => `<!doctype html><script type="module" crossorigin src="./assets/${name}"></script>`

test('a new build shows the update banner, the same build does not', () => {
  assert.equal(shellIsNewer(shell('index-new.js'), 'index-old.js'), true)
  assert.equal(shellIsNewer(shell('index-old.js'), 'index-old.js'), false)
})

test("another app's page (Home Assistant answering /) is never an update", () => {
  assert.equal(shellIsNewer('<!doctype html><title>Home Assistant</title><script src="/frontend_latest/core.js"></script>', 'index-old.js'), false)
  assert.equal(shellIsNewer('', 'index-old.js'), false)
})

test('a failed start reloads once, then not again within a minute', () => {
  const m = new Map<string, string>()
  const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
  assert.equal(retryBoot(store, 1_000_000), true)
  assert.equal(retryBoot(store, 1_030_000), false)
  assert.equal(retryBoot(store, 1_061_000), true)
})
