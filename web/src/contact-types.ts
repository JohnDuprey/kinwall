/** Household directory records. Private records are for admin devices only; the API must enforce
 * that boundary too, since hiding a card in the browser cannot protect its data. */
export interface ContactMethod { label: string; value: string }
export interface ContactAddress { label: string; street: string; city: string; region: string; postalCode: string; country: string }
export interface ContactCategory { id: string; name: string; color: string | null; sort: number; createdAt: string; updatedAt: string }
export interface Contact {
  id: string
  kind?: 'person' | 'service' | 'organization' | 'place'
  name: string
  organization: string | null
  relationship: string | null
  phones: ContactMethod[]
  emails: ContactMethod[]
  notes: string | null
  favorite: boolean
  emergency: boolean
  wallVisible: boolean
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
  alwaysOpen?: boolean
  emergencyVisible?: boolean
  phoneVisibleOnWall?: boolean
  addressVisibleOnWall?: boolean
  visibility?: 'household' | 'adults' | 'selected_members' | 'private'
  selectedMemberIds?: string[]
  createdAt: string
  updatedAt: string
}
/** One line per address, for display and maps. */
export const formatAddress = (a: ContactAddress) => [a.street, [a.city, a.region].filter(Boolean).join(', '), a.postalCode, a.country].filter(Boolean).join(', ')
export type ContactInput = Omit<Contact, 'id' | 'createdAt' | 'updatedAt'>
export type ImportDecision = 'add' | 'merge' | 'skip' | 'keep'
/** One row of POST /api/contacts/import/preview: a normalized draft and the saved contacts it may duplicate. */
export interface ImportPreviewEntry { contact: ContactInput; duplicateIds: string[] }
export interface ImportCandidate { key: string; input: ContactInput; matchId: string | null; status: 'new' | 'match'; decision: ImportDecision }

export const emptyContact = (): ContactInput => ({
  kind: 'person', name: '', organization: null, relationship: null, phones: [], emails: [], addresses: [],
  notes: null, favorite: false, emergency: false, wallVisible: false, categoryIds: [], tags: [], memberIds: [],
  serviceHours: null, serviceArea: null, alwaysOpen: false, emergencyVisible: false,
  phoneVisibleOnWall: false, addressVisibleOnWall: false, visibility: 'household', selectedMemberIds: [],
})

/** The import review rows. The server parses vCards and finds duplicates; nothing merges until someone picks Merge. */
export function reviewCandidates(entries: ImportPreviewEntry[]): ImportCandidate[] {
  return entries.map(({ contact, duplicateIds }, index) => ({ key: `candidate-${index}`, input: contact, matchId: duplicateIds[0] ?? null,
    status: duplicateIds.length ? 'match' : 'new', decision: duplicateIds.length ? 'skip' : 'add' }))
}

/** The Contacts page's filters. Only this page's state: nothing is saved. */
export interface ContactFilters { show: 'all' | 'favorites' | 'emergency' | 'wall'; kind: 'all' | NonNullable<Contact['kind']>; category: string; sort: 'name' | 'recent' | 'organization' }
export const DEFAULT_CONTACT_FILTERS: ContactFilters = { show: 'all', kind: 'all', category: 'all', sort: 'name' }
export const CONTACT_SHOW_LABELS: Record<ContactFilters['show'], string> = { all: 'All contacts', favorites: 'Favorites', emergency: 'Emergency', wall: 'On wall' }
export const CONTACT_KIND_LABELS: Record<ContactFilters['kind'], string> = { all: 'All kinds', person: 'People', service: 'Services', organization: 'Organizations', place: 'Places' }
export const CONTACT_SORT_LABELS: Record<ContactFilters['sort'], string> = { name: 'Name A–Z', recent: 'Recently updated', organization: 'Organization' }
/** How many filters narrow the list (the sort doesn't). */
export const activeContactFilters = (f: ContactFilters) => [f.show !== 'all', f.kind !== 'all', f.category !== 'all'].filter(Boolean).length
/** One line under the search, e.g. "Favorites · Medical · Name A–Z"; empty while nothing differs from the defaults. */
export function contactFilterSummary(f: ContactFilters, categoryName: (id: string) => string | undefined): string {
  if (!activeContactFilters(f) && f.sort === DEFAULT_CONTACT_FILTERS.sort) return ''
  return [f.show !== 'all' && CONTACT_SHOW_LABELS[f.show], f.kind !== 'all' && CONTACT_KIND_LABELS[f.kind],
    f.category !== 'all' && (categoryName(f.category) ?? 'Category'), CONTACT_SORT_LABELS[f.sort]].filter(Boolean).join(' · ')
}

/** A detail's label as people read it: "birthday" → "Birthday", and labels saved before imports
 * read Apple's and Android's types ("cell", "internet") as words. */
const OLD_LABELS: Record<string, string> = { cell: 'Mobile', internet: '', pref: '', voice: '' }
export function contactLabel(label: string): string {
  const l = label.trim()
  const old = OLD_LABELS[l.toLowerCase()]
  if (old !== undefined) return old
  return l && l[0].toLocaleUpperCase() + l.slice(1)
}

/** A contact date: "1952-03-14" → "March 14, 1952"; "--11-02" (no year) → "November 2". */
export function contactDate(date: string): string {
  const m = /^(\d{4}|-)-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  const d = new Date(Date.UTC(m[1] === '-' ? 2000 : Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', ...(m[1] === '-' ? {} : { year: 'numeric' }) })
}
