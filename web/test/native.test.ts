// node --test test/ (npm test). The colors the page hands the iPhone/Android app for its frame.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { surfaces } from '../src/native.ts'
import { SKINS } from '../src/skins.ts'

const peach = SKINS.find(s => s.id === 'meadow')!

test('surfaces: the scheme\'s own bg and card, light and dark', () => {
  assert.deepEqual(surfaces(peach, {}), {
    light: { bg: '#FFFBF5', card: '#FFFFFF' },
    dark: { bg: '#1C1712', card: '#2A221B' },
  })
})

test('surfaces: custom colors win in both modes', () => {
  const s = surfaces(peach, { bg: '#0F1420', accent: '#123456' })
  assert.equal(s.light.bg, '#0F1420')
  assert.equal(s.dark.bg, '#0F1420')
  assert.equal(s.dark.card, '#2A221B')
})

test('activities: sent only when changed, ended once, and nothing in a browser', async () => {
  const { endAppActivity, tellAppActivity } = await import('../src/native.ts')
  const g = globalThis as { window?: unknown }
  g.window = {}
  tellAppActivity('shopping', { left: 3 }) // a browser: nowhere to send
  const sent: unknown[] = []
  g.window = { webkit: { messageHandlers: { kinwall: { postMessage: (m: unknown) => sent.push(m) } } } }
  tellAppActivity('shopping', { left: 3 })
  tellAppActivity('shopping', { left: 3 })
  tellAppActivity('shopping', { left: 2 })
  endAppActivity('shopping'); endAppActivity('shopping')
  endAppActivity('cooking') // never told this page load: goes once, in case the app still shows one
  assert.deepEqual(sent, [
    { type: 'activity', kind: 'shopping', payload: { left: 3 } },
    { type: 'activity', kind: 'shopping', payload: { left: 2 } },
    { type: 'activityEnd', kind: 'shopping' },
    { type: 'activityEnd', kind: 'cooking' },
  ])
  delete g.window
})

test('live activities line: on, off in iPhone Settings, or nothing outside the iPhone app', async () => {
  const { appLiveActivities, liveActivitiesLine } = await import('../src/native.ts')
  const g = globalThis as { window?: unknown }
  g.window = { kinwallNative: { platform: 'ios', liveActivities: false } }
  assert.equal(appLiveActivities(), false)
  g.window = { kinwallNative: { platform: 'android' } }
  assert.equal(appLiveActivities(), null)
  delete g.window
  assert.match(liveActivitiesLine(true)!, /^Countdowns and timers show on the Lock Screen\. Turn them off in iPhone Settings → Kinwall → Live Activities\.$/)
  assert.match(liveActivitiesLine(false)!, /Off in iPhone Settings/)
  assert.equal(liveActivitiesLine(null), null)
})

test('live activities line on Android: ongoing notifications, turned off in Android Settings', async () => {
  const { liveActivitiesLine } = await import('../src/native.ts')
  assert.equal(liveActivitiesLine(true, 'android'), 'Countdowns show as ongoing notifications. Turn them off in Android Settings → Apps → Kinwall → Notifications.')
  assert.match(liveActivitiesLine(false, 'android')!, /Android Settings → Apps → Kinwall → Notifications/)
  assert.equal(liveActivitiesLine(null, 'android'), null)
  assert.match(liveActivitiesLine(true, 'ios')!, /iPhone Settings/)
})

test('appPlatform: the app\'s platform (an older app without one is the iPhone app), null in a browser', async () => {
  const { appPlatform } = await import('../src/native.ts')
  const g = globalThis as { window?: unknown }
  g.window = { kinwallNative: { platform: 'android' } }
  assert.equal(appPlatform(), 'android')
  g.window = { kinwallNative: { platform: 'ios' } }
  assert.equal(appPlatform(), 'ios')
  g.window = { kinwallNative: {} }
  assert.equal(appPlatform(), 'ios')
  g.window = {}
  assert.equal(appPlatform(), null)
  delete g.window
})

test('app medicine names: this device\'s choice in the app, off by default and when storage is blocked', async () => {
  const { appMedicineNames, setAppMedicineNames } = await import('../src/native.ts')
  const g = globalThis as { window?: unknown; localStorage?: Storage }
  g.window = { dispatchEvent: () => true }
  assert.equal(appMedicineNames(), false) // no storage at all
  const store = new Map<string, string>()
  g.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k) } as Storage
  try {
    assert.equal(appMedicineNames(), false)
    setAppMedicineNames(true)
    assert.equal(appMedicineNames(), true)
    setAppMedicineNames(false)
    assert.equal(appMedicineNames(), false)
  } finally { delete g.localStorage; delete g.window }
})
