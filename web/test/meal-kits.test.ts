import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plannedMealKit } from '../src/meal-kits.ts'

test('planner kit tags appear only on planned meals after a box arrived with units left', () => {
  const kits = [{ id: 'old', provider: 'Box service', receivedOn: '2026-11-20', cookBy: '2026-11-27', quantity: 2, left: 0 }, { id: 'new', provider: 'Box service', receivedOn: '2026-11-23', cookBy: '2026-11-30', quantity: 2, left: 1 }]
  assert.equal(plannedMealKit({ status: 'prepared', date: '2026-11-24' }, kits), undefined)
  assert.equal(plannedMealKit({ status: 'planned', date: '2026-11-22' }, kits), undefined)
  assert.equal(plannedMealKit({ status: 'planned', date: '2026-11-23' }, kits)?.id, 'new')
})

test('an explicit ready item wins over older recipe stock and never falls back to another item', () => {
  const kits = [
    { id: 'kit', kind: 'kit' as const, provider: '', receivedOn: '2026-11-20', cookBy: '2026-11-27', quantity: 2, left: 2 },
    { id: 'prepped', kind: 'prepped' as const, provider: '', receivedOn: '2026-11-21', cookBy: '2026-11-25', quantity: 1, left: 1 },
  ]
  assert.equal(plannedMealKit({ status: 'planned', date: '2026-11-24', readyId: 'prepped' }, kits)?.kind, 'prepped')
  assert.equal(plannedMealKit({ status: 'planned', date: '2026-11-24', readyId: 'missing' }, kits), undefined)
})
