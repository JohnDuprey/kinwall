import { test } from 'node:test'
import assert from 'node:assert/strict'
import { askChoices, pharmacyChoices } from '../src/refillChoices.ts'
import { emptyContact, type Contact, type ContactCategory } from '../src/contact-types.ts'

const cats = [{ id: 'k-em', name: 'Emergency services' }, { id: 'k-med', name: 'Medical' }, { id: 'k-vet', name: 'Veterinary' }] as ContactCategory[]
const c = (name: string, p: Partial<Contact> = {}) => ({ ...emptyContact(), id: name, name, kind: 'service', ...p }) as Contact
const contacts = [
  c('Harbor Locksmith', { relationship: 'Home service' }),
  c('Poison Control', { relationship: 'Emergency service', categoryIds: ['k-em'], tags: ['medical'] }),
  c('Oak Animal Clinic', { relationship: 'Veterinarian', categoryIds: ['k-vet'] }),
  c('Northside Pediatrics', { relationship: 'Medical', categoryIds: ['k-med'] }),
  c('Rose City Pharmacy', { relationship: 'Pharmacy', categoryIds: ['k-med'] }),
  c('Maple Grove School', { kind: 'organization', relationship: 'School office' }),
  c('Dr. Rivera', { kind: 'person', relationship: 'Pediatrician' }),
  c('Grandma', { kind: 'person', relationship: 'Family' }),
]
const names = (gs: { label: string; list: Contact[] }[]) => gs.map(g => [g.label, g.list.map(x => x.name)])

test('pharmacy picker: pharmacies, then medical places, then other places; never people', () => {
  assert.deepEqual(names(pharmacyChoices(contacts, cats)), [
    ['Pharmacies', ['Rose City Pharmacy']],
    ['Medical', ['Northside Pediatrics']],
    ['Other contacts', ['Harbor Locksmith', 'Maple Grove School', 'Oak Animal Clinic', 'Poison Control']],
  ])
})

test('ask-for-refills picker: doctors and pharmacies first (not the vet or a "medical" tag), then everyone else', () => {
  assert.deepEqual(names(askChoices(contacts, cats)), [
    ['Doctors and pharmacies', ['Dr. Rivera', 'Northside Pediatrics', 'Rose City Pharmacy']],
    ['Other contacts', ['Grandma', 'Harbor Locksmith', 'Maple Grove School', 'Oak Animal Clinic', 'Poison Control']],
  ])
})
