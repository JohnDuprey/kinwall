import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DoseChanges } from '../src/doseChanges.ts'

const change = { medicationId: 'sample-med', date: '2026-10-21', time: '08:00', action: 'taken' as const }

test('saving a dose updates every consumer immediately, before the card celebration ends', async () => {
  const updates = new DoseChanges()
  const card: string[] = [], activity: string[] = []
  const stop = updates.listen(d => card.push(d.action))
  updates.listen(d => activity.push(d.action))
  await updates.saved(Promise.resolve({ saved: true }), change)
  assert.deepEqual(card, ['taken'])
  assert.deepEqual(activity, ['taken'])
  assert.equal(updates.revision, 1)
  stop()
  await updates.saved(Promise.resolve(), { ...change, action: 'unmark' })
  assert.deepEqual(card, ['taken'])
  assert.deepEqual(activity, ['taken', 'unmark'])
})

test('an older due-dose read cannot restore an activity after Taken succeeds', async () => {
  const updates = new DoseChanges()
  const readRevision = updates.revision
  await updates.saved(Promise.resolve(), change)
  assert.equal(updates.current(readRevision), false)
  assert.equal(updates.current(updates.revision), true)
})

test('failed saves do not hide a dose, cancel a reminder or invalidate a valid read', async () => {
  const updates = new DoseChanges()
  let calls = 0
  updates.listen(() => calls++)
  await assert.rejects(updates.saved(Promise.reject(new Error('offline')), change), /offline/)
  assert.equal(calls, 0)
  assert.equal(updates.revision, 0)
})
