// node --test test/ (npm test). Rules shared by the to-do app screens (src/taskSync.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarAccountFor, pullDue, taskLinkBroken } from '../src/taskSync.ts'

test('taskLinkBroken: a refused sign-in at once, anything else after two failures in a row', () => {
  assert.equal(taskLinkBroken({ lastError: 'Todoist stopped…', lastErrorCode: 'revoked', syncFailures: 1 }), true)
  assert.equal(taskLinkBroken({ lastError: 'Todoist had a problem', lastErrorCode: null, syncFailures: 1 }), false)
  assert.equal(taskLinkBroken({ lastError: 'Todoist had a problem', lastErrorCode: null, syncFailures: 2 }), true)
  assert.equal(taskLinkBroken({ lastError: null, lastErrorCode: null, syncFailures: 0 }), false)
})

test('calendarAccountFor: the calendar account of that kind not yet connected for tasks', () => {
  const cals = [{ kind: 'google' as const, name: 'Demo Google' }, { kind: 'google' as const, name: 'sam@example.com' }, { kind: 'microsoft' as const, name: 'alex@example.com' }]
  assert.equal(calendarAccountFor('google', cals, []), 'sam@example.com')
  assert.equal(calendarAccountFor('google', cals, [{ kind: 'google', name: 'SAM@example.com' }]), null)
  assert.equal(calendarAccountFor('microsoft', cals, [{ kind: 'google', name: 'alex@example.com' }]), 'alex@example.com')
  assert.equal(calendarAccountFor('microsoft', [], []), null)
})

test('taskLinkBroken: a list imported without its account needs connecting', () => {
  assert.equal(taskLinkBroken({ lastError: null, lastErrorCode: null, syncFailures: 0, needsReconnect: true }), true)
})

test('pullDue: opening a synced list pulls it unless it just synced, is waiting, or has no account', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  const base = { accountId: 'a1', needsReconnect: false, retryAfter: null, lastSyncedAt: '2026-10-16T11:58:00Z' }
  assert.equal(pullDue(base, now), true) // two minutes old
  assert.equal(pullDue({ ...base, lastSyncedAt: '2026-10-16T11:59:30Z' }, now), false) // 30 s ago: leave it
  assert.equal(pullDue({ ...base, lastSyncedAt: null }, now), true) // never synced
  assert.equal(pullDue({ ...base, retryAfter: '2026-10-16T12:05:00Z' }, now), false) // the app asked to slow down
  assert.equal(pullDue({ ...base, accountId: null }, now), false) // imported, waiting for a reconnect
  assert.equal(pullDue({ ...base, needsReconnect: true }, now), false)
})
