// node --test test/ (npm test). Leave by vs start prep by for a meal's event.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leadBy, leadFor, leadIcon, leadOf } from '../src/leadTime.ts'

test('a meal\'s prep time wins; else leave-by; else nothing', () => {
  assert.deepEqual(leadOf({ leaveAt: null, prepAt: '2030-01-01T17:15:00Z' }), { at: '2030-01-01T17:15:00Z', prep: true })
  assert.deepEqual(leadOf({ leaveAt: '2030-01-01T15:40:00Z', prepAt: null }), { at: '2030-01-01T15:40:00Z', prep: false })
  assert.equal(leadOf({ leaveAt: null }), null)
})

test('wording', () => {
  const prep = { at: '', prep: true }, leave = { at: '', prep: false }
  assert.equal(`${leadIcon(prep)} ${leadBy(prep, '5:15 PM', true)}`, '🍳 start prep by 5:15 PM')
  assert.equal(`${leadIcon(leave)} ${leadBy(leave, '9:20 AM')}`, '🚗 Leave by 9:20 AM')
  assert.equal(leadFor(prep, 'Tuesday Tacos'), 'Start prep for Tuesday Tacos')
  assert.equal(leadFor(leave, 'Soccer practice'), 'Leave for Soccer practice')
})
