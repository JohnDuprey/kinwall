import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saveRoutinePolicy } from '../src/routineSave.ts'
import type { RoutinePolicy, RoutineState } from '../src/routineMode.ts'
const policy: RoutinePolicy = { enabled: true, cutoff: '20:00', allowedWebsitesOnly: false, allowedWebDomains: [] }
const state = { ...policy, start: '00:00', appMode: 'selected', requiredChoreIds: null, daySchedules: Array(7).fill(null), schoolLinkDomains: [] } as RoutineState

test('a save confirms the same child’s persisted policy before reporting success', async () => {
  const calls: string[] = []
  const value = await saveRoutinePolicy({ setRoutineMode: async (id, p) => { calls.push(`save:${id}`); return p }, getRoutineMode: async id => { calls.push(`read:${id}`); return state } }, 'maya', policy)
  assert.equal(value, state)
  assert.deepEqual(calls, ['save:maya', 'read:maya'])
})
test('failed readback or a different saved policy cannot produce a successful save', async () => {
  await assert.rejects(saveRoutinePolicy({ setRoutineMode: async () => policy, getRoutineMode: async () => ({ ...state, enabled: false }) }, 'maya', policy), /could not be confirmed/)
  await assert.rejects(saveRoutinePolicy({ setRoutineMode: async () => policy, getRoutineMode: async () => { throw new Error('offline') } }, 'maya', policy), /offline/)
})
