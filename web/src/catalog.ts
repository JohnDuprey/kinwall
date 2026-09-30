// The grocery catalog (GET /api/lists/remembered): pure helpers for its search, store filter and labels.
import { itemKey } from './itemSuggest.ts'
import type { RememberedItem } from './types.ts'

/** Every store an item is found at, A-Z (for the filter chips). */
export function catalogStores(items: RememberedItem[]): string[] {
  return [...new Set(items.flatMap(i => i.places.map(p => p.store)))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Items whose name (or matching key: "tomatoes" finds Tomato) has the search, found at `store` when given. */
export function filterCatalog(items: RememberedItem[], query: string, store: string | null): RememberedItem[] {
  const q = query.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  const key = q.length > 3 ? itemKey(q) : q
  return items.filter(i => (!q || i.title.toLowerCase().includes(q) || i.key.includes(key)) && (!store || i.places.some(p => p.store === store)))
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
