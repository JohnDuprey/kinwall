// node --test test/ (npm test). The contact import review built from the server's preview.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyContact, reviewCandidates } from '../src/contact-types.ts'

test('reviewCandidates: new drafts are added, matches are skipped until someone decides', () => {
  const maya = { ...emptyContact(), name: 'Coach Maya' }
  const leo = { ...emptyContact(), name: 'Leo’s dentist' }
  const rows = reviewCandidates([{ contact: maya, duplicateIds: [] }, { contact: leo, duplicateIds: ['c1', 'c2'] }])
  assert.deepEqual(rows.map(r => [r.input.name, r.status, r.decision, r.matchId]), [
    ['Coach Maya', 'new', 'add', null],
    ['Leo’s dentist', 'match', 'skip', 'c1'],
  ])
  assert.notEqual(rows[0].key, rows[1].key)
})
