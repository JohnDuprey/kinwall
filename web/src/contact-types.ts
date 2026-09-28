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
export type ImportDecision = 'add' | 'merge' | 'skip' | 'keep'
/** One row of POST /api/contacts/import/preview: a normalized draft and the saved contacts it may duplicate. */
export interface ImportPreviewEntry { contact: ContactInput; duplicateIds: string[] }
export interface ImportCandidate { key: string; input: ContactInput; matchId: string | null; status: 'new' | 'match'; decision: ImportDecision }

export const emptyContact = (): ContactInput => ({
  kind: 'person', name: '', organization: null, relationship: null, phones: [], emails: [], address: null,
  notes: null, favorite: false, emergency: false, showOnWall: false, categoryIds: [], tags: [], memberIds: [],
  serviceHours: null, serviceArea: null, emergencyDesignation: false, alwaysOpen: false, emergencyVisible: false,
  phoneVisibleOnWall: false, addressVisibleOnWall: false, visibility: 'household', selectedMemberIds: [],
})

/** The import review rows. The server parses vCards and finds duplicates; nothing merges until someone picks Merge. */
export function reviewCandidates(entries: ImportPreviewEntry[]): ImportCandidate[] {
  return entries.map(({ contact, duplicateIds }, index) => ({ key: `candidate-${index}`, input: contact, matchId: duplicateIds[0] ?? null,
    status: duplicateIds.length ? 'match' : 'new', decision: duplicateIds.length ? 'skip' : 'add' }))
}
