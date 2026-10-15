// The refill pickers' order (Refills.tsx RefillFields): pharmacies and medical contacts first, then
// everyone else under "Other contacts", each group by name. "Medical" is the built-in category of that
// name, or a doctor-like relationship; tags and names don't count (an animal clinic isn't a doctor).
import type { Contact, ContactCategory } from './contact-types.ts'

type Group = { label: string; list: Contact[] }
const text = (c: Contact) => [c.name, c.organization, c.relationship].join(' ')
const isPharmacy = (c: Contact) => /pharm|drug|apothec/i.test(text(c))
const DOCTOR = /^medical$|doctor|pediatric|physician|dental|dentist|hospital|nurse|clinic/i
const medicalIds = (categories: ContactCategory[]) => new Set(categories.filter(k => k.name === 'Medical').map(k => k.id))
const isMedical = (c: Contact, ids: Set<string>) => (c.categoryIds ?? []).some(id => ids.has(id)) || DOCTOR.test(c.relationship ?? '')
const byName = (cs: Contact[]) => [...cs].sort((a, b) => a.name.localeCompare(b.name))

/** Pharmacy: pharmacies, then other medical places, then other places (not people). */
export function pharmacyChoices(contacts: Contact[], categories: ContactCategory[]): Group[] {
  const ids = medicalIds(categories)
  const all = byName(contacts)
  const pharmacies = all.filter(isPharmacy)
  const medical = all.filter(c => !isPharmacy(c) && isMedical(c, ids) && c.kind !== 'person')
  return [
    { label: 'Pharmacies', list: pharmacies },
    { label: 'Medical', list: medical },
    { label: 'Other contacts', list: all.filter(c => !pharmacies.includes(c) && !medical.includes(c) && c.kind !== 'person') },
  ]
}

/** Ask for refills at: doctors and pharmacies, then every other contact. */
export function askChoices(contacts: Contact[], categories: ContactCategory[]): Group[] {
  const ids = medicalIds(categories)
  const all = byName(contacts)
  const med = all.filter(c => isPharmacy(c) || isMedical(c, ids))
  return [
    { label: 'Doctors and pharmacies', list: med },
    { label: 'Other contacts', list: all.filter(c => !med.includes(c)) },
  ]
}
