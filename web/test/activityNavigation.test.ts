import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activityBackAction } from '../src/activityNavigation.ts'

test('confirmed exit navigates once and stops handling the destination popstate', () => {
  for (const opened of ['#/activities/plugin/math', '#/activities/plugin/math?member=maya']) {
    // The dialog resolves during its popstate; the activity entry is still current.
    assert.equal(activityBackAction(true, opened, opened, true), 'none')
    // Only the next traversal has actually dropped the activity's extra entry.
    assert.equal(activityBackAction(true, opened, opened, false), 'leave')
    assert.equal(activityBackAction(true, '#/activities', opened, false), 'none')
  }
})
test('Back asks to leave only after popping the activity entry', () => {
  const opened = '#/activities/plugin/math?member=maya'
  assert.equal(activityBackAction(false, opened, opened, false), 'ask')
  assert.equal(activityBackAction(false, opened, opened, true), 'none')
  assert.equal(activityBackAction(false, '#/home', opened, false), 'none')
})
