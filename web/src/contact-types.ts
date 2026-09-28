/** Household directory records. Private records are for admin devices only; the API must enforce
 * that boundary too, since hiding a card in the browser cannot protect its data. */
export interface ContactMethod { label: string; value: string }
export interface ContactAddress { label: string; formatted?: string; street: string; city: string; region: string; postalCode: string; country: string }
export interface ContactCategory { id: string; name: string; color: string | null; sort: number; createdAt: string; updatedAt: string }
export interface Contact {
  id: string
  kind?: 'person' | 'service' | 'organization' | 'place'
  name: string
  organization: string | null
  relationship: string | null
  phones: ContactMethod[]
  emails: ContactMethod[]
  address: string | null
  notes: string | null
  favorite: boolean
  emergency: boolean
  showOnWall: boolean
  wallVisible?: boolean
  addresses?: ContactAddress[]
  websites?: ContactMethod[]
  dates?: { label: string; date: string }[]
  givenName?: string | null
  familyName?: string | null
  nickname?: string | null
  title?: string | null
  sourceMetadata?: Record<string, unknown> | null
  privateFields?: string[]
  categoryIds?: string[]
  tags?: string[]
  memberIds?: string[]
  serviceHours?: string | null
  serviceArea?: string | null
  emergencyDesignation?: boolean
  alwaysOpen?: boolean
  emergencyVisible?: boolean
  phoneVisibleOnWall?: boolean
  addressVisibleOnWall?: boolean
  visibility?: 'household' | 'adults' | 'selected_members' | 'private'
  selectedMemberIds?: string[]
  createdAt: string
  updatedAt: string
}
export type ContactInput = Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>
export type ImportDecision = 'merge' | 'skip' | 'keep'
export interface ImportCandidate { key: string; input: ContactInput; matchId: string | null; status: 'new' | 'possible' | 'duplicate'; decision: ImportDecision | 'add' }

export const emptyContact = (): ContactInput => ({
  kind: 'person', name: '', organization: null, relationship: null, phones: [], emails: [], address: null,
  notes: null, favorite: false, emergency: false, showOnWall: false, categoryIds: [], tags: [], memberIds: [],
  serviceHours: null, serviceArea: null, emergencyDesignation: false, alwaysOpen: false, emergencyVisible: false,
  phoneVisibleOnWall: false, addressVisibleOnWall: false, visibility: 'household', selectedMemberIds: [],
})

const norm = (s: string) => s.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
const phoneKey = (s: string) => {
  const digits = s.replace(/\D/g, '')
  return digits.length >= 7 ? digits.slice(-10) : ''
}
const emailKey = (s: string) => norm(s)

export function matchContact(input: ContactInput, contacts: Contact[]): { id: string | null; status: ImportCandidate['status'] } {
  const exact = contacts.find(c =>
    input.emails.some(m => m.value && c.emails.some(n => emailKey(m.value) === emailKey(n.value))) ||
    input.phones.some(m => phoneKey(m.value) && c.phones.some(n => phoneKey(m.value) === phoneKey(n.value))))
  if (exact) return { id: exact.id, status: 'duplicate' }
  const possible = contacts.find(c => norm(c.name) === norm(input.name) && !!input.name.trim())
  return possible ? { id: possible.id, status: 'possible' } : { id: null, status: 'new' }
}

/** Merge adds missing details. It never changes a saved contact's display/privacy choices. */
export function mergeContact(existing: Contact, incoming: ContactInput): ContactInput {
  const methods = (saved: ContactMethod[], added: ContactMethod[], key: (s: string) => string) => {
    const result = [...saved]
    for (const method of added) if (method.value.trim() && !result.some(m => key(m.value) === key(method.value))) result.push(method)
    return result
  }
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...saved } = existing
  return {
    ...saved,
    name: existing.name || incoming.name,
    organization: existing.organization || incoming.organization,
    relationship: existing.relationship || incoming.relationship,
    phones: methods(existing.phones, incoming.phones, phoneKey),
    emails: methods(existing.emails, incoming.emails, emailKey),
    addresses: [...(existing.addresses ?? []), ...(incoming.addresses ?? []).filter(a => !(existing.addresses ?? []).some(b => JSON.stringify(a) === JSON.stringify(b)))],
    websites: methods(existing.websites ?? [], incoming.websites ?? [], norm),
    dates: [...(existing.dates ?? []), ...(incoming.dates ?? []).filter(a => !(existing.dates ?? []).some(b => a.label === b.label && a.date === b.date))],
    categoryIds: [...new Set([...(existing.categoryIds ?? []), ...(incoming.categoryIds ?? [])])],
    tags: [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])],
    memberIds: [...new Set([...(existing.memberIds ?? []), ...(incoming.memberIds ?? [])])],
    address: existing.address || incoming.address,
    notes: existing.notes || incoming.notes,
    favorite: existing.favorite, emergency: existing.emergency, showOnWall: existing.showOnWall,
  }
}

function unescapeVCard(value: string) {
  return value.replace(/\\([nN,;\\])/g, (_all, char: string) => char.toLowerCase() === 'n' ? '\n' : char).trim()
}

/** Parse ordinary 2.1/3.0/4.0 vCards locally. Photos and unknown properties are deliberately
 * ignored. Folded lines are joined before fields are read. */
export function parseVCards(source: string): ContactInput[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const unfolded: string[] = []
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1)
    else unfolded.push(line)
  }
  const result: ContactInput[] = []
  let card: ContactInput | null = null
  let nameParts = ''
  for (const line of unfolded) {
    if (/^BEGIN:VCARD$/i.test(line.trim())) { card = emptyContact(); nameParts = ''; continue }
    if (/^END:VCARD$/i.test(line.trim())) {
      if (card) {
        if (!card.name) card.name = nameParts
        if (card.name.trim()) result.push(card)
      }
      card = null; continue
    }
    if (!card) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const head = line.slice(0, colon)
    const key = head.split(';')[0].split('.').pop()?.toUpperCase()
    const value = unescapeVCard(line.slice(colon + 1))
    const label = /(?:^|;)TYPE=([^;]+)/i.exec(head)?.[1]?.split(',')[0] ??
      head.split(';').slice(1).find(s => !s.includes('=')) ?? 'Other'
    if (key === 'FN') card.name = value
    else if (key === 'N') nameParts = value.split(/(?<!\\);/).filter(Boolean).reverse().join(' ').trim()
    else if (key === 'ORG') card.organization = value.replace(/;/g, ' · ') || null
    else if (key === 'TITLE') card.title = value || null
    else if (key === 'TEL' && value) card.phones.push({ label, value: value.replace(/^tel:/i, '') })
    else if (key === 'EMAIL' && value) card.emails.push({ label, value: value.replace(/^mailto:/i, '') })
    else if (key === 'ADR' && value) card.address = value.split(/(?<!\\);/).map(unescapeVCard).filter(Boolean).join(', ') || null
    else if (key === 'NICKNAME') card.nickname = value || null
    else if (key === 'CATEGORIES') card.tags = [...new Set([...(card.tags ?? []), ...value.split(',').map(tag => tag.trim()).filter(Boolean)])]
    else if (key === 'URL') card.websites = [...(card.websites ?? []), { label, value }]
    else if (key === 'NOTE') card.notes = value || null
  }
  return result
}

export function reviewCandidates(inputs: ContactInput[], saved: Contact[]): ImportCandidate[] {
  const seen = [...saved]
  return inputs.map((input, index) => {
    const match = matchContact(input, seen)
    if (!match.id) seen.push({ ...input, id: `review-${index}`, createdAt: '', updatedAt: '' })
    return { key: `candidate-${index}`, input, matchId: match.id, status: match.status,
      decision: match.status === 'new' ? 'add' : 'skip' }
  })
}
