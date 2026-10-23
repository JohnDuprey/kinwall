import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routineFormPolicy } from '../src/routineForm.ts'
const fields = () => { const f = new FormData(); for (const [key, value] of Object.entries({ enabled: 'true', start: '07:30', cutoff: '20:00', appMode: 'all', allowedWebDomains: 'https://clever.com, student.freckle.com', allowedWebsitesOnly: 'true', scheduleMode: 'daily', choreRequirement: 'selected' })) f.set(key, value); f.append('schoolLinkDomains', 'clever.com'); return f }
test('autosave reads the complete child policy and normalizes allowed hosts', () => {
  assert.deepEqual(routineFormPolicy(fields()), { enabled: true, start: '07:30', cutoff: '20:00', appMode: 'all', allowedWebsitesOnly: true, allowedWebDomains: ['clever.com', 'student.freckle.com'], schoolLinkDomains: ['clever.com'], daySchedules: Array(7).fill(null), requiredChoreIds: [] })
})
test('partial times and website edits remain drafts instead of saving invalid policies', () => {
  const f = fields(); f.set('start', ''); assert.throws(() => routineFormPolicy(f), /Finish entering/)
  f.set('start', '21:00'); assert.throws(() => routineFormPolicy(f), /start before/)
  f.set('start', '07:30'); f.set('allowedWebDomains', 'clever.'); assert.throws(() => routineFormPolicy(f), /valid website/)
  f.set('allowedWebDomains', ''); assert.throws(() => routineFormPolicy(f), /at least one/)
})
