// node --test test/ (npm test). Who added / checked off a list item, and when, in a short line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actorName, byLine, whenLabel } from '../src/addedBy.ts'
import { setHour12 } from '../src/timeFormat.ts'

const members = [{ id: 'm3', name: 'Maya', avatar: '🦊' }, { id: 'm4', name: 'Leo', avatar: '' }]

test('actorName: a member with their avatar, a label as is, nothing for unknown or removed people', () => {
  assert.equal(actorName({ memberId: 'm3' }, members), '🦊 Maya')
  assert.equal(actorName({ memberId: 'm4' }, members), 'Leo')
  assert.equal(actorName({ label: 'Kitchen wall' }, members), 'Kitchen wall')
  assert.equal(actorName({ memberId: 'gone' }, members), null)
  assert.equal(actorName(null, members), null)
  assert.equal(actorName(undefined, members), null)
})

test('whenLabel: time today, weekday this week, date before that', () => {
  setHour12(true)
  const now = new Date(2026, 8, 30, 18, 0) // Wed Sep 30
  assert.equal(whenLabel(new Date(2026, 8, 30, 17, 2).toISOString(), now), '5:02 PM')
  assert.equal(whenLabel(new Date(2026, 8, 29, 16, 12).toISOString(), now), 'Tue 4:12 PM')
  assert.equal(whenLabel(new Date(2026, 8, 24, 8, 0).toISOString(), now), 'Thu 8:00 AM')
  assert.equal(whenLabel(new Date(2026, 8, 3, 9, 5).toISOString(), now), 'Sep 3, 9:05 AM')
  assert.equal(whenLabel(new Date(2025, 11, 31, 9, 5).toISOString(), now), 'Dec 31, 2025, 9:05 AM')
})

test('byLine: who and when, or nothing', () => {
  setHour12(true)
  const now = new Date(2026, 8, 30, 18, 0)
  assert.equal(byLine('Added by', { memberId: 'm3' }, new Date(2026, 8, 29, 16, 12).toISOString(), members, now), 'Added by 🦊 Maya · Tue\u00a04:12\u00a0PM', 'the time stays on one line')
  assert.equal(byLine('Checked off by', { label: 'Assistant' }, null, members, now), 'Checked off by Assistant')
  assert.equal(byLine('Added by', null, new Date().toISOString(), members, now), null)
})
