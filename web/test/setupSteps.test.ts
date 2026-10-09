// node --test test/ (npm test). The setup wizard's choices, resume and error copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardOn, defaultGrownUp, FEATURE_CARDS, freshHandoff, HANDOFF_MS, landOn, nextStep, ownerChoices, prevStep, progressSteps, resumeFor, setupErrorText, suggestedFeatures, toggleCard } from '../src/setupSteps.ts'
import { FEATURE_ROWS } from '../src/featureConfig.ts'
import type { Features, Member } from '../src/types.ts'

const m = (name: string, grownUp: boolean) => ({ id: name, name, grownUp }) as Member
const family = [m('Alex', true), m('Sam', true), m('Maya', false), m('Leo', false)]

test('defaultGrownUp: the first person added is a grown-up, everyone after a kid', () => {
  assert.equal(defaultGrownUp(0), true)
  assert.equal(defaultGrownUp(1), false)
  assert.equal(defaultGrownUp(3), false)
})

test('ownerChoices: only grown-ups can own a parent device', () => {
  assert.deepEqual(ownerChoices(family).map(x => x.name), ['Alex', 'Sam'])
  assert.deepEqual(ownerChoices([m('Maya', false)]), [])
})

test('resumeFor: a claimed device always resumes setup, never lands in an empty app', () => {
  assert.equal(resumeFor('welcome', null), null)
  assert.equal(resumeFor('passkey', null), null) // not claimed yet: the wizard opens fresh anyway
  assert.deepEqual(resumeFor('members', 'admin'), { step: 'members', deviceRole: 'admin' })
  assert.equal(resumeFor('done', 'admin'), null)
})

test("setupErrorText: friendly copy, never the server's raw words", () => {
  const fallback = 'Could not create chores. Try again.'
  for (const status of [401, 403]) {
    const t = setupErrorText(status, fallback)
    assert.doesNotMatch(t, /route|display key/i)
    assert.match(t, /Settings/)
  }
  assert.match(setupErrorText(409, fallback), /already set up/)
  assert.match(setupErrorText(0, fallback), /offline/i)
  assert.match(setupErrorText(429, fallback), /Too many tries/)
  assert.equal(setupErrorText(500, fallback), fallback)
  assert.equal(setupErrorText(undefined, fallback), fallback)
})

test('a passkey step handed to a new tab resumes only while fresh', () => {
  const now = Date.parse('2026-10-01T12:00:00Z')
  const handoff = (at: number) => JSON.stringify({ step: 'passkey', deviceRole: 'admin', at })
  assert.deepEqual(freshHandoff(handoff(now - 1000), now), { step: 'passkey', deviceRole: 'admin' })
  assert.equal(freshHandoff(handoff(now - HANDOFF_MS - 1), now), null, 'never picked up: a later visit is not mid-setup')
  assert.equal(freshHandoff(JSON.stringify({ step: 'passkey', deviceRole: 'admin' }), now), null, 'no time: from before this check')
  assert.equal(freshHandoff('not json', now), null)
  assert.equal(freshHandoff(null, now), null)
})

const ALL_ON = Object.fromEntries(FEATURE_ROWS.map(r => [r.key, true])) as unknown as Features

test('nextStep/prevStep: the features step follows the owner step; chores is skipped while chores are off', () => {
  assert.equal(nextStep('owner', ALL_ON), 'features')
  assert.equal(nextStep('features', ALL_ON), 'calendars')
  assert.equal(nextStep('calendars', ALL_ON), 'chores')
  assert.equal(nextStep('chores', ALL_ON), 'done')
  assert.equal(prevStep('calendars', ALL_ON), 'features')
  assert.equal(prevStep('features', ALL_ON), 'owner')
  const noChores = { ...ALL_ON, chores: false }
  assert.equal(nextStep('calendars', noChores), 'done')
  assert.equal(prevStep('done', noChores), 'calendars')
  assert.equal(nextStep('calendars', null), 'chores') // settings not loaded yet: nothing skipped
})

test('landOn: a resumed chores step moves on once chores are off', () => {
  assert.equal(landOn('chores', { ...ALL_ON, chores: false }), 'done')
  assert.equal(landOn('chores', ALL_ON), 'chores')
  assert.equal(landOn('features', { ...ALL_ON, chores: false }), 'features')
  assert.deepEqual(resumeFor('features', 'admin'), { step: 'features', deviceRole: 'admin' })
})

test('progressSteps: one dot per step shown', () => {
  assert.deepEqual(progressSteps(ALL_ON), ['household', 'members', 'features', 'calendars', 'chores', 'done'])
  assert.deepEqual(progressSteps({ ...ALL_ON, chores: false }), ['household', 'members', 'features', 'calendars', 'done'])
})

test('FEATURE_CARDS: every feature switch belongs to exactly one card', () => {
  const keys = FEATURE_CARDS.flatMap(c => c.keys)
  assert.deepEqual([...keys].sort(), FEATURE_ROWS.map(r => r.key).sort())
})

test('toggleCard: a card turns all its switches on or off together', () => {
  const photos = FEATURE_CARDS.find(c => c.id === 'photos')!
  const off = toggleCard(ALL_ON, photos)
  assert.equal(off.photos, false); assert.equal(off.trackersMemories, false); assert.equal(off.meals, true)
  assert.equal(cardOn(off, photos), false)
  // Partly on (one switch flipped in Show all features) counts as off; a tap turns all on.
  const partly = { ...ALL_ON, trackersMemories: false }
  assert.equal(cardOn(partly, photos), false)
  assert.equal(toggleCard(partly, photos).trackersMemories, true)
})

test('suggestedFeatures: kid-only cards start off when no one is a kid; otherwise the defaults stay', () => {
  const grownUps = suggestedFeatures(ALL_ON, [{ grownUp: true }, { grownUp: true }])
  assert.equal(grownUps.chores, false); assert.equal(grownUps.paint, false); assert.equal(grownUps.meals, true)
  assert.deepEqual(suggestedFeatures(ALL_ON, family), ALL_ON)
  assert.deepEqual(suggestedFeatures(ALL_ON, []), ALL_ON)
})
