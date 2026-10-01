// node --test test/ (npm test). The contact import review built from the server's preview.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeContactFilters, contactDate, contactFilterSummary, contactLabel, DEFAULT_CONTACT_FILTERS, emptyContact, reviewCandidates } from '../src/contact-types.ts'

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

test('contact filters: defaults count nothing and need no summary', () => {
  assert.equal(activeContactFilters(DEFAULT_CONTACT_FILTERS), 0)
  assert.equal(contactFilterSummary(DEFAULT_CONTACT_FILTERS, () => undefined), '')
})

test('contact filters: count what narrows the list; the summary adds the sort', () => {
  const names = new Map([['cat-med', 'Medical']])
  const f = { ...DEFAULT_CONTACT_FILTERS, show: 'favorites' as const, category: 'cat-med' }
  assert.equal(activeContactFilters(f), 2)
  assert.equal(contactFilterSummary(f, id => names.get(id)), 'Favorites · Medical · Name A–Z')
  const all = { show: 'emergency' as const, kind: 'service' as const, category: 'gone', sort: 'recent' as const }
  assert.equal(activeContactFilters(all), 3)
  assert.equal(contactFilterSummary(all, id => names.get(id)), 'Emergency · Services · Category · Recently updated')
  // Sorting alone isn't filtering, but it still shows so the order isn't a surprise.
  const sorted = { ...DEFAULT_CONTACT_FILTERS, sort: 'organization' as const }
  assert.equal(activeContactFilters(sorted), 0)
  assert.equal(contactFilterSummary(sorted, () => undefined), 'Organization')
})

test('contact labels and dates read as words', () => {
  assert.deepEqual(['birthday', 'cell', 'internet', 'Home page', 'Garden shed'].map(contactLabel), ['Birthday', 'Mobile', '', 'Home page', 'Garden shed'])
  assert.equal(contactDate('1952-03-14'), 'March 14, 1952')
  assert.equal(contactDate('--11-02'), 'November 2')
  assert.equal(contactDate('--02-29'), 'February 29')
})
