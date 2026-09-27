// "Shopping at": a shopping list as walked in one store. Kept per device (not on the server);
// server/src/routes/lists.ts tripView is the server's copy for the API and MCP - keep in step.
import { compareAisles, type AisleOrder, type ListItem } from './types.ts'

type TripItem = Pick<ListItem, 'title' | 'store' | 'aisle' | 'places'> & { category?: string | null }

/** A department that names one of the store's aisles (any case) stands in for an aisle not known
 * there: "Produce" lands in the store's Produce aisle. Display only - never saved, so it follows
 * the store's layout. Same rule as the server's departmentAisle (routes/lists.ts). */
export function departmentAisle(department: string | null | undefined, storeAisles: string[]): string | null {
  const d = department?.trim().toLowerCase()
  return (d && storeAisles.find(a => a.toLowerCase() === d)) || null
}

/** The item's aisle at `store`: its own when it's planned for that store, else the one the
 * family used there before, else (given the store's aisles) its department's (null = not known there). */
export function aisleAt(item: TripItem, store: string, storeAisles: string[] = []): string | null {
  return (item.store === store && item.aisle) || item.places?.find(p => p.store === store)?.aisle || departmentAisle(item.category, storeAisles)
}

/** Items planned for this store or for anywhere, grouped by their aisle there (see aisleAt) in walking order
 * (the store's custom order, else natural), A-Z within an aisle; then those with no aisle known
 * there; then those planned for other stores (by store). Checked items keep their place. */
export function tripView<T extends TripItem>(items: T[], store: string, order: AisleOrder, storeAisles: string[] = []) {
  const byTitle = (a: T, b: T) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  const aisles = new Map<string, T[]>()
  const unknown: T[] = [], other: T[] = []
  for (const item of items) {
    if (item.store && item.store !== store) { other.push(item); continue }
    const aisle = aisleAt(item, store, storeAisles)
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

/** "Any store": a trip with no one store's layout. Kept as the trip's store. */
export const ANY_STORE = '*'

/** Any store: store by store (A-Z, "Anywhere" last), each walked in its own aisle order, A-Z
 * within an aisle. Same shape as tripView, a store's name standing in for the aisle heading. */
export function anyStoreView<T extends TripItem>(items: T[], order: AisleOrder) {
  const stores = new Map<string, T[]>()
  for (const item of items) stores.set(item.store ?? '', [...(stores.get(item.store ?? '') ?? []), item])
  const cmp = (store: string) => (a: T, b: T) => compareAisles(store, a.aisle, b.aisle, order) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  const names = [...stores.keys()].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
  return { aisles: names.map(s => ({ aisle: s || 'Anywhere', items: stores.get(s)!.sort(cmp(s)) })), unknown: [] as T[], other: [] as T[] }
}

/** What a trip at `store` didn't get, at Checkout: the unchecked items planned for that store or for
 * anywhere (items planned for other stores weren't on this trip). Any store: every unchecked item. */
export function tripLeftovers<T extends Pick<ListItem, 'store' | 'done'>>(items: T[], store: string): T[] {
  return items.filter(i => !i.done && (store === ANY_STORE || !i.store || i.store === store))
}

// Shopping mode (#/lists/<id>/shop): the list it's showing on this device, so a reload or a
// relaunched app returns to it. Only while that list's trip is on (Checkout ends both).
const SHOP_KEY = 'kinwall.shopping'
export function shoppingModeList(): string | null {
  try { const id = localStorage.getItem(SHOP_KEY); return id && tripStore(id) ? id : null } catch { return null }
}
export function setShoppingModeList(listId: string | null) {
  try { if (listId) localStorage.setItem(SHOP_KEY, listId); else localStorage.removeItem(SHOP_KEY) } catch { /* not kept */ }
}

/** Where a relaunch opens: straight back into shopping mode when it was showing and the app would
 * otherwise land on the calendar (a link to somewhere else wins). null = leave the hash alone. */
export function resumeShoppingHash(hash: string): string | null {
  const id = shoppingModeList()
  return id && ['', '#', '#/', '#/calendar', '#/lists'].includes(hash) ? `#/lists/${id}/shop` : null
}
