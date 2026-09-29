// node --test test/ (npm test). The pick-from-a-list sheet: search and the row's summary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickMatches, pickSummary } from '../src/pick.ts'

test('pickMatches: label, detail or keywords, any case; underscores and slashes read as spaces', () => {
  const tz = { value: 'America/New_York', label: 'New York', detail: 'America', keywords: 'America/New_York' }
  assert.ok(pickMatches(tz, 'new york'))
  assert.ok(pickMatches(tz, 'New_York'))
  assert.ok(pickMatches(tz, 'America/New_York'))
  assert.ok(pickMatches(tz, 'america new'))
  assert.ok(pickMatches(tz, '  '))
  assert.ok(!pickMatches(tz, 'chicago'))
  assert.ok(pickMatches({ value: 'c1', label: 'Medical', detail: '3 contacts' }, 'MED'))
})

test('pickSummary: none, one, two, three, then a count', () => {
  const o = ['Maya', 'Leo', 'Sam', 'Alex', 'Ivy'].map(n => ({ value: n.toLowerCase(), label: n }))
  assert.equal(pickSummary(o, []), 'None')
  assert.equal(pickSummary(o, [], 'Not set'), 'Not set')
  assert.equal(pickSummary(o, ['maya']), 'Maya')
  assert.equal(pickSummary(o, ['leo', 'maya']), 'Maya and Leo') // in list order
  assert.equal(pickSummary(o, ['maya', 'leo', 'sam']), 'Maya, Leo, and Sam')
  assert.equal(pickSummary(o, ['maya', 'leo', 'sam', 'ivy']), 'Maya, Leo, and 2 more')
  assert.equal(pickSummary(o, ['gone']), 'None') // a value no longer listed doesn't count
})
