import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RoutineAutosave } from '../src/routineAutosave.ts'
import type { RoutinePolicy, RoutineState } from '../src/routineMode.ts'
const policy = (cutoff: string): RoutinePolicy => ({ enabled: true, cutoff, allowedWebsitesOnly: false, allowedWebDomains: [] })
const result = (p: RoutinePolicy) => p as RoutineState

test('autosave coalesces typing and keeps different children independent', async () => {
  const calls: string[] = [], saved: string[] = []
  const make = (id: string) => new RoutineAutosave({ save: async p => { calls.push(id + p.cutoff); return result(p) }, confirmed: s => saved.push(id + s.cutoff), status: () => {} })
  const maya = make('maya:'), leo = make('leo:')
  maya.edit(() => policy('20:00')); maya.edit(() => policy('20:30')); leo.edit(() => policy('21:00'))
  await Promise.all([maya.flush(), leo.flush()])
  assert.deepEqual(calls.sort(), ['leo:21:00', 'maya:20:30'])
  assert.deepEqual(saved.sort(), calls.sort())
})
test('older saves cannot replace newer edits and saves run in order', async () => {
  let finish!: (s: RoutineState) => void
  const calls: string[] = [], saved: string[] = []
  const saver = new RoutineAutosave({ save: p => { calls.push(p.cutoff); return calls.length === 1 ? new Promise(r => { finish = r }) : Promise.resolve(result(p)) }, confirmed: s => saved.push(s.cutoff), status: () => {} })
  saver.edit(() => policy('20:00')); const first = saver.flush()
  saver.edit(() => policy('21:00')); const second = saver.flush()
  finish(result(policy('20:00'))); await Promise.all([first, second])
  assert.deepEqual(calls, ['20:00', '21:00'])
  assert.deepEqual(saved, ['21:00'])
})
test('invalid fields and network failures retain edits for retry without reporting saved', async () => {
  const phases: string[] = []; let offline = true
  const saver = new RoutineAutosave({ save: async p => { if (offline) throw Error('offline'); return result(p) }, confirmed: () => {}, status: s => phases.push(s.phase) })
  saver.edit(() => { throw Error('Finish the time') }); await saver.flush()
  assert.equal(phases.at(-1), 'invalid')
  saver.edit(() => policy('20:00')); await saver.flush()
  assert.equal(phases.at(-1), 'error'); assert.equal(phases.includes('saved'), false)
  offline = false; await saver.retry(); assert.equal(phases.at(-1), 'saved')
})
