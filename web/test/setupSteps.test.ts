// node --test test/ (npm test). The setup wizard's choices, resume and error copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultGrownUp, freshHandoff, HANDOFF_MS, kidChoices, ownerChoices, resumeFor, setupErrorText } from '../src/setupSteps.ts'
import type { Member } from '../src/types.ts'

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

test("kidChoices: a kid's device lists only kids", () => {
  assert.deepEqual(kidChoices(family).map(x => x.name), ['Maya', 'Leo'])
})

test('resumeFor: a claimed device always resumes setup, never lands in an empty app', () => {
  assert.equal(resumeFor('welcome', null), null)
  assert.equal(resumeFor('role', null), null) // not claimed yet: the wizard opens fresh anyway
  assert.deepEqual(resumeFor('role', 'admin'), { step: 'household', deviceRole: 'admin', displayKeyId: undefined })
  assert.deepEqual(resumeFor('members', 'display', 'k1'), { step: 'members', deviceRole: 'display', displayKeyId: 'k1' })
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
