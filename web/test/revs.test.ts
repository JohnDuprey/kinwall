// node --test test/ (npm test). Which parts of the app refetch after a /api/rev poll.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedAreas } from '../src/revs.ts'

const none = { any: false, events: false, lists: false, chores: false }
const all = { any: true, events: true, lists: true, chores: true }

test('changedAreas: the first answer only sets the baseline', () => {
  assert.deepEqual(changedAreas(null, { rev: 5, revs: { events: 1, lists: 2, chores: 2 } }), none)
})

test('changedAreas: nothing moved, nothing to refetch', () => {
  const r = { rev: 5, revs: { events: 1, lists: 2, chores: 2 } }
  assert.deepEqual(changedAreas(r, { ...r }), none)
})

test('changedAreas: only the area whose rev moved', () => {
  const prev = { rev: 5, revs: { events: 1, lists: 2, chores: 2 } }
  assert.deepEqual(changedAreas(prev, { rev: 6, revs: { events: 1, lists: 3, chores: 2 } }), { any: true, events: false, lists: true, chores: false })
  assert.deepEqual(changedAreas(prev, { rev: 7, revs: { events: 2, lists: 2, chores: 3 } }), { any: true, events: true, lists: false, chores: true })
})

test('changedAreas: rev moved without an area (contacts, recipes…): only whole-app refreshes', () => {
  const prev = { rev: 5, revs: { events: 1, lists: 2, chores: 2 } }
  assert.deepEqual(changedAreas(prev, { rev: 6, revs: { events: 1, lists: 2, chores: 2 } }), { any: true, events: false, lists: false, chores: false })
})

test('changedAreas: an older server without per-area revs refreshes everything on any change', () => {
  assert.deepEqual(changedAreas({ rev: 5 }, { rev: 6 }), all)
  assert.deepEqual(changedAreas({ rev: 5 }, { rev: 5 }), none)
  // The server was upgraded between polls: no baseline for the areas yet.
  assert.deepEqual(changedAreas({ rev: 5 }, { rev: 6, revs: { events: 0, lists: 1, chores: 0 } }), all)
})
