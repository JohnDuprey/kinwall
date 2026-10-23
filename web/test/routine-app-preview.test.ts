import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewAppAccess } from '../src/routineAppPreview.ts'
const apps = [{ id: 'kinwall', category: 'tools' }, { id: 'safari', category: 'tools' }, { id: 'game', category: 'games' }, { id: 'reading', category: 'games' }, { id: 'video', category: 'entertainment' }]
test('routine app preview: combines categories and individual apps, with explicit allowances winning', () => {
  const access = previewAppAccess('selected', ['games'], ['video', 'reading'], ['reading'], false, apps)
  assert.deepEqual(access, { kinwall: true, safari: true, game: false, reading: true, video: false })
})
test('routine app preview: all apps includes unselected apps and keeps Kinwall plus allowed browser available', () => {
  assert.deepEqual(previewAppAccess('all', [], [], ['reading'], true, apps), { kinwall: true, safari: true, game: false, reading: true, video: false })
  assert.equal(previewAppAccess('all', [], [], [], false, apps).safari, false)
})
