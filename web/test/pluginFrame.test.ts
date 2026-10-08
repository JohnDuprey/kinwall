// node --test test/ (npm test). A plugin frame that loads a second page has left its package.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frameLive, frameLoaded, fromPluginFrame } from '../src/pluginFrame.ts'

test('frameLive: talks to a frame before and after its own page loads', () => {
  const f = {}
  assert.equal(frameLive(f), true) // the plugin's scripts run (and ask) before its load event
  assert.equal(frameLoaded(f), false)
  assert.equal(frameLive(f), true)
})

test('frameLoaded: a second load means it navigated, and the bridge stops for good', () => {
  const f = {}
  frameLoaded(f)
  assert.equal(frameLoaded(f), true)
  assert.equal(frameLive(f), false)
  frameLoaded(f)
  assert.equal(frameLive(f), false)
})

test('frameLoaded: each frame counts on its own (switching players makes a new one)', () => {
  const a = {}, b = {}
  frameLoaded(a); frameLoaded(a)
  assert.equal(frameLive(a), false)
  assert.equal(frameLive(b), true)
  assert.equal(frameLoaded(b), false)
})

test('fromPluginFrame: only the frame window, from the sandbox opaque origin, while live', () => {
  const win = {}
  const f = { contentWindow: win }
  assert.equal(fromPluginFrame({ source: win, origin: 'null' }, f), true)
  assert.equal(fromPluginFrame({ source: {}, origin: 'null' }, f), false, 'another window')
  assert.equal(fromPluginFrame({ source: null, origin: 'null' }, { contentWindow: null }), false, 'a frame with no window')
  assert.equal(fromPluginFrame({ source: win, origin: 'https://evil.example' }, f), false, 'a page with a real origin')
  assert.equal(fromPluginFrame({ source: win, origin: 'null' }, null), false)
  frameLoaded(f); frameLoaded(f)
  assert.equal(fromPluginFrame({ source: win, origin: 'null' }, f), false, 'after a second page loaded')
})
