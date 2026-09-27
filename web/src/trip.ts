// "Shopping at": a shopping list as walked in one store. Kept per device (not on the server);
// server/src/routes/lists.ts tripView is the server's copy for the API and MCP - keep in step.
import { compareAisles, type AisleOrder, type ListItem } from './types.ts'

type TripItem = Pick<ListItem, 'title' | 'store' | 'aisle' | 'places'>

/** The item's aisle at `store`: its own when it's planned for that store, else the one the
 * family used there before (null = not known there). */
export function aisleAt(item: TripItem, store: string): string | null {
  return (item.store === store && item.aisle) || item.places?.find(p => p.store === store)?.aisle || null
}

/** Items planned for this store or for anywhere, grouped by their aisle there in walking order
 * (the store's custom order, else natural), A-Z within an aisle; then those with no aisle known
 * there; then those planned for other stores (by store). Checked items keep their place. */
export function tripView<T extends TripItem>(items: T[], store: string, order: AisleOrder) {
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  const aisles = new Map<string, T[]>()
  const unknown: T[] = [], other: T[] = []
  for (const item of items) {
    if (item.store && item.store !== store) { other.push(item); continue }
    const aisle = aisleAt(item, store)
    if (aisle) aisles.set(aisle, [...(aisles.get(aisle) ?? []), item])
    else unknown.push(item)
  }
  return {
    aisles: [...aisles.keys()].sort((a, b) => compareAisles(store, a, b, order)).map(aisle => ({ aisle, items: aisles.get(aisle)!.sort(byTitle) })),
    unknown: unknown.sort(byTitle),
    other: other.sort((a, b) => (a.store ?? '').localeCompare(b.store ?? '') || byTitle(a, b)),
  }
}

// The store a trip is at, per list, on this device. Private browsing: trips just aren't kept.
const tripKey = (listId: string) => `kinwall.trip.${listId}`
export function tripStore(listId: string): string | null {
  try { return localStorage.getItem(tripKey(listId)) } catch { return null }
}
export function setTripStore(listId: string, store: string | null) {
  try { if (store) localStorage.setItem(tripKey(listId), store); else localStorage.removeItem(tripKey(listId)) } catch { /* not kept */ }
}
