// The grocery catalog (GET /api/lists/remembered): pure helpers for its search, filters, sort, groups and labels.
import { itemKey } from './itemSuggest.ts'
import { compareAisles, type AisleOrder, type BarcodeLookup, type List, type RememberedItem } from './types.ts'

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

/** Every store an item is found at, A-Z (for the filter chips). */
export function catalogStores(items: RememberedItem[]): string[] {
  return [...new Set(items.flatMap(i => i.places.map(p => p.store)))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Each value once (case ignored, the first spelling), A-Z, with how many items have it. */
function counted(values: string[][]): { name: string; count: number }[] {
  const out = new Map<string, { name: string; count: number }>()
  for (const vs of values) {
    for (const v of new Set(vs.map(x => x.toLowerCase()))) {
      const was = out.get(v)
      out.set(v, { name: was?.name ?? vs.find(x => x.toLowerCase() === v)!, count: (was?.count ?? 0) + 1 })
    }
  }
  return [...out.values()].sort((a, b) => byName(a.name, b.name))
}
/** The family's categories (tags) and the departments in use, for the filters. */
export const catalogTags = (items: RememberedItem[]) => counted(items.map(i => i.tags))
export const catalogDepartments = (items: RememberedItem[]) => counted(items.map(i => (i.category ? [i.category] : [])))

/** Offered in the edit sheet until the family has categories of its own. */
export const STARTER_TAGS = ['Breakfast', 'Snacks', 'Lunchbox', 'Pantry staples', 'Cleaning', 'Baby', 'Pet']

/** Items whose name (or matching key: "tomatoes" finds Tomato) has the search, found at `store`, in
 * category `tag` and department `department` when given (case ignored). All of them combine. */
export function filterCatalog(items: RememberedItem[], query: string, store: string | null, only: { tag?: string | null; department?: string | null } = {}): RememberedItem[] {
  const q = query.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  const key = q.length > 3 ? itemKey(q) : q
  const tag = only.tag?.toLowerCase(), dept = only.department?.toLowerCase()
  return items.filter(i => (!q || i.title.toLowerCase().includes(q) || i.key.includes(key)) && (!store || i.places.some(p => p.store === store))
    && (!tag || i.tags.some(t => t.toLowerCase() === tag)) && (!dept || i.category?.toLowerCase() === dept))
}

export type CatalogSort = 'alpha' | 'bought' | 'department' | 'aisle' | 'recent'
export type CatalogGroup = 'none' | 'department' | 'category'

/** A-Z; most bought; by department (none last); by aisle at `store` (its walking order, items not
 * found there last; A-Z with no store); most recently added to a list first. Ties go A-Z. */
export function sortCatalog(items: RememberedItem[], sort: CatalogSort, store: string | null, order: AisleOrder): RememberedItem[] {
  const aisleAt = (i: RememberedItem) => i.places.find(p => p.store === store)
  const cmp: (a: RememberedItem, b: RememberedItem) => number =
    sort === 'bought' ? (a, b) => b.uses - a.uses
    : sort === 'department' ? (a, b) => byName(a.category ?? '\uffff', b.category ?? '\uffff')
    : sort === 'recent' ? (a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? '')
    : sort === 'aisle' && store ? (a, b) => {
      const pa = aisleAt(a), pb = aisleAt(b)
      return !pa || !pb ? (pa ? -1 : pb ? 1 : 0) : compareAisles(store, pa.aisle, pb.aisle, order)
    }
    : () => 0
  return [...items].sort((a, b) => cmp(a, b) || byName(a.title, b.title))
}

export const CATALOG_SORT_LABELS: Record<CatalogSort, string> = { alpha: 'A–Z', bought: 'Most bought', department: 'Department', aisle: 'Aisle', recent: 'Recently used' }
export const CATALOG_GROUP_LABELS: Record<CatalogGroup, string> = { none: 'None', department: 'Department', category: 'Category' }
export type CatalogFilters = { store: string | null; tag: string | null; department: string | null }

/** How many of store, category and department are picked (the Filter & sort button's badge). */
export const activeCatalogFilters = (f: CatalogFilters) => [f.store, f.tag, f.department].filter(Boolean).length

/** The line above the items: "Shaws · Breakfast · Most bought" (the sort and grouping only when not the
 * default); empty when nothing is filtered. */
export function catalogFilterSummary(f: CatalogFilters, view: { sort: CatalogSort; group: CatalogGroup }): string {
  if (!activeCatalogFilters(f)) return ''
  const sort = view.sort === 'alpha' ? null : view.sort === 'aisle' && f.store ? `Aisle at ${f.store}` : CATALOG_SORT_LABELS[view.sort]
  return [f.store, f.tag, f.department, sort, view.group === 'none' ? null : `By ${CATALOG_GROUP_LABELS[view.group].toLowerCase()}`].filter(Boolean).join(' · ')
}

/** Sections for the list: one untitled section, or one per department / category (an item with
 * several categories is under each), A-Z with "No department" / "No category" last. Keeps the order. */
export function groupCatalog(items: RememberedItem[], by: CatalogGroup): { name: string | null; items: RememberedItem[] }[] {
  if (by === 'none') return [{ name: null, items }]
  const none = by === 'department' ? 'No department' : 'No category'
  const names = counted(items.map(i => (by === 'department' ? (i.category ? [i.category] : []) : i.tags))).map(v => v.name)
  const has = (i: RememberedItem, n: string) => (by === 'department' ? [i.category ?? ''] : i.tags).some(v => v.toLowerCase() === n.toLowerCase())
  const loose = items.filter(i => !names.some(n => has(i, n)))
  return [...names.map(name => ({ name, items: items.filter(i => has(i, name)) })), ...(loose.length ? [{ name: none, items: loose }] : [])]
}

/** An item's categories as saved: trimmed, blanks dropped, each once ignoring case, a category the
 * family already has keeps its spelling (the server does the same). */
export function tagsInput(tags: string[], family: string[]): string[] {
  const known = new Map(family.map(t => [t.toLowerCase(), t] as const))
  const out = new Map<string, string>()
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, ' ')
    if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), known.get(t.toLowerCase()) ?? t)
  }
  return [...out.values()]
}

// The catalog's sort and grouping, per device.
const VIEW_KEY = 'kinwall.catalogView'
export function catalogView(): { sort: CatalogSort; group: CatalogGroup } {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || '{}')
    return { sort: ['bought', 'department', 'aisle', 'recent'].includes(v.sort) ? v.sort : 'alpha', group: ['department', 'category'].includes(v.group) ? v.group : 'none' }
  } catch { return { sort: 'alpha', group: 'none' } }
}
export function setCatalogView(view: { sort: CatalogSort; group: CatalogGroup }) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)) } catch { /* not kept */ }
}

/** "Shaws · Aisle 7", or just "Shaws" when the aisle there isn't known. */
export const placeLabel = (p: { store: string; aisle: string | null }) => (p.aisle ? `${p.store} · ${p.aisle}` : p.store)

/** An item's places, the filtered store first. */
export function placesFor(item: RememberedItem, store: string | null) {
  return store ? [...item.places.filter(p => p.store === store), ...item.places.filter(p => p.store !== store)] : item.places
}

/** "Bought 3 times" (adds to a shopping list; 0 = only in the catalog). */
export function boughtLabel(uses: number): string {
  return uses === 0 ? 'Not bought yet' : uses === 1 ? 'Bought once' : `Bought ${uses} times`
}

/** The edit sheet's store rows as the API's places: trimmed, blanks dropped, each store once (the last row wins). */
export function placesInput(rows: { store: string; aisle: string }[]): { store: string; aisle: string | null }[] {
  const out = new Map<string, string | null>()
  for (const r of rows) {
    const store = r.store.trim()
    if (store) out.set(store, r.aisle.trim() || null)
  }
  return [...out].map(([store, aisle]) => ({ store, aisle }))
}

/** Where a scanned product goes by default (Lists.tsx ScanSheet): food and pet food on a Groceries
 * list, household and beauty items on a Shopping list, by the database it was found in; the list it
 * was scanned on when that's already the right type, when nobody knew it, or when there's no list of
 * that type. Of that type, the family's default list, else the first. Older servers' lists without a
 * catalog are groceries. */
export function scanTarget(lists: List[], currentId: string, source: BarcodeLookup['source'] | null): string {
  const want = source === 'openproductsfacts' || source === 'openbeautyfacts' ? 'shopping' : source === 'openfoodfacts' || source === 'openpetfoodfacts' ? 'groceries' : null
  const type = (l: List) => l.catalog ?? 'groceries'
  const current = lists.find(l => l.id === currentId)
  if (!want || (current && type(current) === want)) return currentId
  const ofType = lists.filter(l => l.kind === 'shopping' && !l.archived && type(l) === want)
  return (ofType.find(l => l.isDefault) ?? ofType[0])?.id ?? currentId // the type's default list, else its first
}

/** Words in matching form (each like itemKey: case and simple plurals ignored). */
const matchWords = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(itemKey).join(' ')

/** The open item a scanned product is, on a shopping trip (Lists.tsx): the same name, else the
 * longest item name found as whole words inside the product's ("Cheerios" in "Honey Nut Cheerios"). */
export function scanMatch<T extends { title: string; done: boolean }>(items: T[], title: string): T | undefined {
  const product = matchWords(title)
  const open = items.filter(i => !i.done).map(i => ({ i, key: matchWords(i.title) })).filter(x => x.key)
  return (open.find(x => x.key === product) ?? open.filter(x => ` ${product} `.includes(` ${x.key} `)).sort((a, b) => b.key.length - a.key.length)[0])?.i
}
