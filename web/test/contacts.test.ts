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

test('demo import preview: parses an Apple vCard like the server and finds demo duplicates', async () => {
  const { mock } = await import('../src/mock.ts')
  const vcard = ['BEGIN:VCARD', 'VERSION:3.0', 'N:Lee;Jordan;;;', 'FN:Jordan Lee',
    'item1.TEL;type=pref:555-010-4400', 'item1.X-ABLabel:_$!<Mobile>!$_',
    'item2.EMAIL;type=INTERNET:jordan.work@example.org', 'item2.X-ABLabel:Soccer club',
    'BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-09', 'ORG:Maple Grove Soccer;', 'TITLE:Coach', 'END:VCARD',
    'BEGIN:VCARD', 'VERSION:3.0', 'FN:New Friend', 'TEL;TYPE=CELL:555-010-0001', 'END:VCARD'].join('\r\n')
  const { entries } = await mock.previewContactImport({ vcard })
  assert.equal(entries.length, 2)
  const [jordan, friend] = entries
  assert.deepEqual(jordan.contact.phones, [{ label: 'Mobile', value: '555-010-4400' }])
  assert.deepEqual(jordan.contact.emails, [{ label: 'Soccer club', value: 'jordan.work@example.org' }])
  assert.deepEqual(jordan.contact.dates, [{ label: 'birthday', date: '--03-09' }])
  assert.equal(jordan.contact.organization, 'Maple Grove Soccer')
  assert.equal(jordan.contact.title, 'Coach')
  assert.equal(jordan.contact.givenName, 'Jordan')
  assert.deepEqual(jordan.duplicateIds, ['contact-neighbor'], 'same phone as the demo neighbor')
  assert.deepEqual(friend.contact.phones, [{ label: 'Mobile', value: '555-010-0001' }])
  assert.deepEqual(friend.duplicateIds, [])
})
