// The pick-from-a-list sheet (PickField.tsx): search and the summary its row shows.

export type Pickable = { value: string; label: string; detail?: string; keywords?: string }

// Any case; "_" and "/" read as spaces, so "new york" finds America/New_York.
const norm = (s: string) => s.toLocaleLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()

/** The label, secondary line or keywords contain the text; blank matches everything. */
export function pickMatches(option: Pickable, query: string): boolean {
  const needle = norm(query)
  return !needle || norm(`${option.label} ${option.detail ?? ''} ${option.keywords ?? ''}`).includes(needle)
}

const list = new Intl.ListFormat('en-US', { type: 'conjunction' })
/** "Maya", "Maya and Leo", "Maya, Leo, and Sam", "Maya, Leo, and 2 more", in list order; `none` when empty. */
export function pickSummary(options: Pickable[], value: string[], none = 'None'): string {
  const labels = options.filter(o => value.includes(o.value)).map(o => o.label)
  if (!labels.length) return none
  return list.format(labels.length > 3 ? [...labels.slice(0, 2), `${labels.length - 2} more`] : labels)
}
