import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shellAssetUrls } from '../src/offlineAssets.ts'

const manifest = JSON.stringify({ modern: ['assets/App.js', 'assets/Settings.js'], legacy: ['assets/App-legacy.js', 'assets/Settings-legacy.js'] })

test('offline caching includes unopened screens for the current browser build and proxy base', () => {
  assert.deepEqual(shellAssetUrls(manifest, 'https://home.example/kinwall/', false), ['https://home.example/kinwall/assets/App.js', 'https://home.example/kinwall/assets/Settings.js'])
  assert.deepEqual(shellAssetUrls(manifest, 'https://home.example/kinwall/', true), ['https://home.example/kinwall/assets/App-legacy.js', 'https://home.example/kinwall/assets/Settings-legacy.js'])
})

test('missing or malformed asset lists cannot cache another site or files outside the app', () => {
  for (const value of [null, 'invalid', '{}', '{"modern":42}']) assert.deepEqual(shellAssetUrls(value, 'https://home.example/kinwall/', false), [])
  const unsafe = JSON.stringify({ modern: ['https://elsewhere.example/assets/a.js', '../assets/a.js', 'assets/../../a.js', 'api/members', 42, 'assets/Settings.js'] })
  assert.deepEqual(shellAssetUrls(unsafe, 'https://home.example/kinwall/', false), ['https://home.example/kinwall/assets/Settings.js'])
})

test('the build asset list keeps modern and legacy screens separate and skips optional PDF and language chunks', async () => {
  const { offlineAssetManifest } = await import('../scripts/offline-assets.mjs')
  const bundle = {
    modern: { type: 'chunk', name: 'Settings', fileName: 'assets/Settings-new.js', code: "import'./legacy-guard.js?Settings'" },
    legacy: { type: 'chunk', name: 'Settings-legacy', fileName: 'assets/Settings-legacy-old.js', code: '' },
    css: { type: 'asset', fileName: 'assets/Setup.css' },
    pdf: { type: 'chunk', name: 'pdf', fileName: 'assets/pdf.js', code: '' },
    de: { type: 'chunk', name: 'de', fileName: 'assets/de.js', code: '' },
    deLegacy: { type: 'chunk', name: 'de-legacy', fileName: 'assets/de-legacy-old.js', code: '' },
  }
  assert.deepEqual(offlineAssetManifest(bundle), {
    modern: ['assets/Settings-new.js', 'assets/Setup.css', 'assets/legacy-guard.js?Settings'],
    legacy: ['assets/Settings-legacy-old.js', 'assets/Setup.css'],
  })
})
