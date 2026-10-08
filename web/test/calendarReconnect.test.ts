// node --test test/ (npm test). The hints beside a calendar whose sign-in was turned down.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { familyLinkHint, revoked, signInHint } from '../src/calendarReconnect.ts'

const members = [{ id: 'm1', name: 'Alex', grownUp: true }, { id: 'm3', name: 'Maya' }, { id: 'm4', name: 'Leo', grownUp: false }]

test('revoked: only a Google or Microsoft calendar whose sign-in was turned down', () => {
  assert.equal(revoked({ kind: 'google', lastErrorCode: 'revoked' }), true)
  assert.equal(revoked({ kind: 'microsoft', lastErrorCode: 'revoked' }), true)
  assert.equal(revoked({ kind: 'google', lastErrorCode: null }), false)
  assert.equal(revoked({ kind: 'google' }), false)
  assert.equal(revoked({ kind: 'ics', lastErrorCode: 'revoked' }), false)
})

test('signInHint: names the account to sign in with', () => {
  assert.equal(signInHint('leo@example.com'), 'Tap Reconnect and sign in as leo@example.com.')
  assert.equal(signInHint(undefined), null)
})

test("familyLinkHint: a kid's Google calendar gets the Family Link line, by name when it is one kid's", () => {
  assert.equal(familyLinkHint({ kind: 'google', memberIds: ['m4'] }, members), "If Leo's Google account is supervised with Family Link, a parent may need to approve Kinwall there too.")
  assert.equal(familyLinkHint({ kind: 'google', memberIds: ['m3'] }, members), "If Maya's Google account is supervised with Family Link, a parent may need to approve Kinwall there too.", 'grownUp unset: a kid')
  assert.equal(familyLinkHint({ kind: 'google', memberIds: ['m1', 'm4'] }, members), 'If this Google account is supervised with Family Link, a parent may need to approve Kinwall there too.')
  assert.equal(familyLinkHint({ kind: 'google', memberIds: ['m1'] }, members), null, "a grown-up's")
  assert.equal(familyLinkHint({ kind: 'google', memberIds: [] }, members), null, "nobody's")
  assert.equal(familyLinkHint({ kind: 'microsoft', memberIds: ['m4'] }, members), null, 'Family Link is Google')
})
