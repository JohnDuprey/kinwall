// node --test test/ (npm test). Rules shared by the to-do app screens (src/taskSync.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calendarAccountFor, taskLinkBroken } from '../src/taskSync.ts'

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
