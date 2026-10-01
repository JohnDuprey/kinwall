// node --test test/ (npm test). The Board's "Finish setting up Kinwall" card: which rows show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getStartedItems, GET_STARTED_SNOOZE_MS, getStartedSnoozed } from '../src/getStarted.ts'

const fresh = { calendars: 0, displays: 0, members: 1, passkeys: 1, recoveryCodes: 0 }

test('getStartedItems: a fresh family sees every row, in order', () => {
  assert.deepEqual(getStartedItems(fresh), ['calendar', 'wall', 'family', 'secondWayIn'])
})

test('getStartedItems: rows drop off once done', () => {
  assert.deepEqual(getStartedItems({ ...fresh, calendars: 1, members: 3 }), ['wall', 'secondWayIn'])
  assert.deepEqual(getStartedItems({ ...fresh, displays: 1 }), ['calendar', 'family', 'secondWayIn'])
})

test('getStartedItems: either a second passkey or unused recovery codes is a second way in', () => {
  assert.ok(!getStartedItems({ ...fresh, passkeys: 2 }).includes('secondWayIn'))
  assert.ok(!getStartedItems({ ...fresh, recoveryCodes: 5 }).includes('secondWayIn'))
})

test("getStartedItems: an answer that couldn't be loaded shows no row, not a wrong one", () => {
  assert.deepEqual(getStartedItems({ calendars: null, displays: null, members: 1, passkeys: null, recoveryCodes: null }), ['family'])
})

test('getStartedItems: everything done means no card', () => {
  assert.deepEqual(getStartedItems({ calendars: 2, displays: 1, members: 4, passkeys: 2, recoveryCodes: 8 }), [])
})

test('getStartedSnoozed: Not now hides it for 30 days', () => {
  const now = Date.UTC(2026, 9, 1)
  assert.equal(getStartedSnoozed(null, now), false)
  assert.equal(getStartedSnoozed(String(now - 1000), now), true)
  assert.equal(getStartedSnoozed(String(now - GET_STARTED_SNOOZE_MS - 1), now), false)
  assert.equal(getStartedSnoozed('junk', now), false)
})
