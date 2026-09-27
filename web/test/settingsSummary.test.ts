// node --test test/ (npm test). The Settings → General sheet summaries read true to the values.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { featuresSummary, nightSummary, timeCuesSummary, transitionRemindersSummary } from '../src/settingsSummary.ts'

test('features', () => {
  assert.deepEqual(featuresSummary([{ label: 'Lists', on: true }, { label: 'Paint', on: true }]), { summary: 'All 2 on' })
  assert.deepEqual(featuresSummary([{ label: 'Lists', on: true }, { label: 'Paint', on: false }, { label: 'Health tracker', on: false }]),
    { summary: '1 of 3 on', detail: 'Off: Paint, Health tracker.' })
})

test('time cues', () => {
  assert.equal(timeCuesSummary({ idleReset: false, nowNext: false, warnings: [], sound: true }), 'All off')
  assert.equal(timeCuesSummary({ idleReset: true, nowNext: true, warnings: [10, 5], sound: false }), 'Now / Next on · warnings at 10 and 5 min · back to the calendar when idle')
  assert.equal(timeCuesSummary({ idleReset: false, nowNext: false, warnings: [1], sound: true }), 'Warnings at 1 min with sound')
  assert.equal(timeCuesSummary({ idleReset: false, nowNext: true, warnings: [5, 10], repeat: { every: 5, within: 30 }, sound: false }), 'Now / Next on · warnings at 10 and 5 min, plus every 5 min in the last 30')
  assert.equal(timeCuesSummary({ idleReset: false, nowNext: false, warnings: [], repeat: { every: 2, within: 10 }, sound: true }), 'Warnings every 2 min in the last 10 min with sound')
})

test('transition reminders (a family member)', () => {
  assert.equal(transitionRemindersSummary(undefined), 'Off')
  assert.equal(transitionRemindersSummary({ on: false, minutes: [10], repeat: null, leaveBy: true }), 'Off')
  assert.equal(transitionRemindersSummary({ on: true, minutes: [], repeat: null, leaveBy: true }), 'On, no times picked yet')
  assert.equal(transitionRemindersSummary({ on: true, minutes: [30, 10], repeat: null, leaveBy: false }), 'At 30 and 10 min')
  assert.equal(transitionRemindersSummary({ on: true, minutes: [15], repeat: { every: 5, within: 10 }, leaveBy: true }),
    "At 15 min, plus every 5 min in the last 10 · counts down to leaving when there's travel time")
})

test('night screen', () => {
  assert.equal(nightSummary({ sources: [], every: 5, bright: 'low', clock: true }), 'Clock only')
  assert.equal(nightSummary({ sources: ['Drawings', 'Family photos'], every: 5, bright: 'low', clock: true }), 'Drawings and family photos, every 5 min, clock on')
  assert.equal(nightSummary({ sources: ['Art (The Met)', 'Nature', 'Drawings'], every: 2, bright: 'medium', clock: false }), 'Art (The Met), nature, and drawings, every 2 min, medium brightness, no clock')
})
