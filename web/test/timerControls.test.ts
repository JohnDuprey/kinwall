import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeTimerChanges, type Timer } from '../src/timers.ts'
import { timerActivity } from '../src/liveActivity.ts'
const timer: Timer = { id: 1, label: 'Rice', seconds: 60, endsAt: 61000, done: false }
test('native pause survives elapsed finish, resume moves the finish, and repeats are harmless', () => {
 const changes = [{ id: 1, endsAt: 61000, left: 40000, nativeRevision: 'pause-1' }]
 const paused = mergeTimerChanges([{ ...timer, done: true }], changes)
 assert.equal(paused[0].done, false)
 assert.equal(paused[0].left, 40000)
 assert.equal(mergeTimerChanges(paused, changes), paused)
 const resumed = mergeTimerChanges(paused, [{ id: 1, endsAt: 240000, nativeRevision: 'resume-1' }])
 assert.equal(resumed[0].left, undefined)
 assert.equal(resumed[0].endsAt, 240000)
 assert.equal(mergeTimerChanges([], changes).length, 0, 'never resurrect a cancelled timer')
 assert.equal(mergeTimerChanges([timer], [{ id: 1, endsAt: NaN, nativeRevision: 'bad' }])[0], timer)
})
test('paused timers stay available to start on the Live Activity without alarms', () => {
 const a = timerActivity([{ ...timer, paused: true, left: 40000 }], true)!
 assert.equal(a.left, 40000)
 assert.equal(a.timerId, 1)
 assert.deepEqual(a.alarms, [])
 assert.equal(a.timers?.[0].alarmTitle, "Time's up: Rice")
 const mixed = timerActivity([{ ...timer, paused: true, left: 40000 }, { ...timer, id: 2 }], true)!
 assert.equal(mixed.timerId, 1)
 assert.equal(mixed.alarms.length, 1)
})

test('native handshake holds publication until initial and foreground snapshots arrive', async () => {
 const { connectNativeTimers, timersReady, getTimers, subscribeTimers } = await import('../src/timers.ts')
 const page = new EventTarget() as EventTarget & { kinwallNative: object; webkit: object }
 const doc = new EventTarget() as EventTarget & { hidden: boolean }
 const sent: unknown[] = []
 page.kinwallNative = { timerControls: true }
 page.webkit = { messageHandlers: { kinwall: { postMessage: (m: unknown) => sent.push(m) } } }
 doc.hidden = false
 Object.assign(globalThis, { window: page, document: doc })
 let stop: (() => void) | undefined
 try {
  const before = getTimers()
  let notified = 0
  const unsubscribe = subscribeTimers(() => notified++)
  stop = connectNativeTimers()
  assert.equal(timersReady(), false)
  assert.deepEqual(sent, [{ type: 'timerSync' }])
  page.dispatchEvent(new CustomEvent('kinwall:timer-sync', { detail: [] }))
  assert.equal(timersReady(), true)
  assert.notEqual(getTimers(), before, 'React gets a new snapshot even without pending changes')
  assert.equal(notified, 1)
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(timersReady(), false)
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(sent.length, 2)
  page.dispatchEvent(new CustomEvent('kinwall:timer-sync', { detail: [] }))
  assert.equal(timersReady(), true)
  unsubscribe()
 } finally {
  stop?.()
  Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'document')
 }
})
