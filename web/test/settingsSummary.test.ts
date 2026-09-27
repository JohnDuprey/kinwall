// node --test test/ (npm test). The Settings → General sheet summaries read true to the values.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { featuresSummary, nightSummary, timeCuesSummary } from '../src/settingsSummary.ts'

test('features', () => {
  assert.deepEqual(featuresSummary([{ label: 'Lists', on: true }, { label: 'Paint', on: true }]), { summary: 'All 2 on' })
  assert.deepEqual(featuresSummary([{ label: 'Lists', on: true }, { label: 'Paint', on: false }, { label: 'Health tracker', on: false }]),
    { summary: '1 of 3 on', detail: 'Off: Paint, Health tracker.' })
})

test('time cues', () => {
  assert.equal(timeCuesSummary({ idleReset: false, nowNext: false, warnings: [], sound: true }), 'All off')
  assert.equal(timeCuesSummary({ idleReset: true, nowNext: true, warnings: [10, 5], sound: false }), 'Now / Next on · warnings at 10 and 5 min · back to the calendar when idle')
  assert.equal(timeCuesSummary({ idleReset: false, nowNext: false, warnings: [1], sound: true }), 'Warnings at 1 min with sound')
})

test('night screen', () => {
  assert.equal(nightSummary({ sources: [], every: 5, bright: 'low', clock: true }), 'Clock only')
  assert.equal(nightSummary({ sources: ['Drawings', 'Family photos'], every: 5, bright: 'low', clock: true }), 'Drawings and family photos, every 5 min, clock on')
  assert.equal(nightSummary({ sources: ['Art (The Met)', 'Nature', 'Drawings'], every: 2, bright: 'medium', clock: false }), 'Art (The Met), nature, and drawings, every 2 min, medium brightness, no clock')
})
