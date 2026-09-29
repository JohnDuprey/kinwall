// node --test test/ (npm test). The Settings → General sheet summaries read true to the values.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appearanceChips, featuresSummary, nightSummary, timeCuesSummary, transitionRemindersSummary } from '../src/settingsSummary.ts'

const text = (chips: { icon?: string; label: string; family?: boolean }[]) => chips.map(c => [c.family && '🏠', c.icon, c.label].filter(Boolean).join(' '))

test('features', () => {
  assert.deepEqual(featuresSummary([{ label: 'Lists', on: true }, { label: 'Paint', on: true }]), { summary: 'All 2 on' })
  assert.deepEqual(featuresSummary([{ label: 'Lists', on: true }, { label: 'Paint', on: false }, { label: 'Health tracker', on: false }]),
    { summary: '1 of 3 on', detail: 'Off: Paint, Health tracker.' })
})

test('time cues: one chip per cue that is on', () => {
  assert.deepEqual(text(timeCuesSummary({ nowNext: false, warnings: [], sound: true })), ['All off'])
  assert.deepEqual(text(timeCuesSummary({ nowNext: true, warnings: [10, 5], sound: false })), ['⏭️ Now / Next', '🔔 At 10 and 5 min'])
  assert.deepEqual(text(timeCuesSummary({ nowNext: false, warnings: [1], sound: true })), ['🔔 At 1 min', '🔊 Sound'])
  assert.deepEqual(text(timeCuesSummary({ nowNext: true, warnings: [5, 10], repeat: { every: 5, within: 30 }, sound: false })), ['⏭️ Now / Next', '🔔 At 10 and 5 min', '🔁 Every 5 min in the last 30'])
  assert.deepEqual(text(timeCuesSummary({ nowNext: false, warnings: [], repeat: { every: 2, within: 10 }, sound: true })), ['🔁 Every 2 min in the last 10', '🔊 Sound'])
})

test('appearance on this device: every setting as a chip, household ones marked', () => {
  const a = { scheme: { emoji: '🌊', name: 'Ocean' }, textScale: 'Medium', density: 'Compact', typeface: 'Hyperlegible' }
  const own = { scheme: true, textScale: false, density: true, typeface: true }
  const chips = appearanceChips({ ...a, mode: undefined }, own)
  assert.deepEqual(text(chips), ['🌊 Ocean', '🏠 Aa Medium', 'Compact', '🔤 Hyperlegible'])
  // Mode only when this device sets one; low-stimulation only when on; custom colors when set.
  assert.deepEqual(text(appearanceChips({ ...a, mode: 'dark', lowStim: true, custom: true }, { ...own, mode: true })),
    ['🌊 Ocean', '🎨 Custom colors', '🌙 Dark', '🏠 Aa Medium', 'Compact', '🔤 Hyperlegible', '🍃 Low-stimulation'])
  // Following the family on everything: each chip says so.
  assert.ok(appearanceChips({ ...a, mode: undefined }, {}).every(c => c.family))
})

test('appearance for the family: no household marks, mode always shown', () => {
  const chips = appearanceChips({ scheme: { emoji: '🍑', name: 'Peach' }, mode: 'auto', textScale: 'Large', density: 'Comfortable', typeface: 'Default' }, null)
  assert.deepEqual(text(chips), ['🍑 Peach', '🌗 Auto', 'Aa Large', 'Comfortable', '🔤 Default'])
})

test('transition reminders (a family member)', () => {
  assert.equal(transitionRemindersSummary(undefined), 'Off')
  assert.equal(transitionRemindersSummary({ on: false, minutes: [10], repeat: null, leaveBy: true }), 'Off')
  assert.equal(transitionRemindersSummary({ on: true, minutes: [], repeat: null, leaveBy: true }), 'On, no times picked yet')
  assert.equal(transitionRemindersSummary({ on: true, minutes: [30, 10], repeat: null, leaveBy: false }), 'At 30 and 10 min')
  assert.equal(transitionRemindersSummary({ on: true, minutes: [15], repeat: { every: 5, within: 10 }, leaveBy: true }),
    "At 15 min, plus every 5 min in the last 10 · counts down to leaving when there's travel time")
})

test('night screen: one chip per choice', () => {
  assert.deepEqual(text(nightSummary({ sources: [], every: 5, bright: 'low', clock: true })), ['🕒 Clock only'])
  assert.deepEqual(text(nightSummary({ sources: ['Drawings', 'Family photos'], every: 5, bright: 'low', clock: true })), ['Drawings', 'Family photos', '⏱️ Every 5 min', '🕒 Clock on'])
  assert.deepEqual(text(nightSummary({ sources: ['Art (The Met)', 'Nature'], every: 2, bright: 'medium', clock: false })), ['Art (The Met)', 'Nature', '⏱️ Every 2 min', '🔆 Medium brightness', 'No clock'])
  // A fixed clock position is named; "Moves around" (the default) isn't.
  assert.deepEqual(text(nightSummary({ sources: [], every: 5, bright: 'low', clock: true, pos: 'Top left' })), ['🕒 Clock only, top left'])
  assert.deepEqual(text(nightSummary({ sources: ['Nature'], every: 5, bright: 'low', clock: true, pos: 'Center' })), ['Nature', '⏱️ Every 5 min', '🕒 Clock center'])
  assert.deepEqual(text(nightSummary({ sources: ['Nature'], every: 5, bright: 'low', clock: false, pos: 'Center' })), ['Nature', '⏱️ Every 5 min', 'No clock'])
})
