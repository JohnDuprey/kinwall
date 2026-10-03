// Get stuff done mode's pure helpers (GetStuffDone.tsx): a checklist in its own order, one item at
// a time or the whole list, how far along it is, and a wall screen's pinned checklist.
import { inTimeWindow } from './wallScreen.ts'

type Item = { id: string; sort: number; done: boolean }

/** The list in its own (manual) order. */
export const doOrder = <T extends Item>(items: T[]): T[] => items.slice().sort((a, b) => a.sort - b.sort)

/** The whole-list view: open items first, ticked ones at the bottom, each in the list's order. */
export const listOrder = <T extends Item>(items: T[]): T[] => { const o = doOrder(items); return [...o.filter(i => !i.done), ...o.filter(i => i.done)] }

export const progress = (items: Item[]) => ({ done: items.filter(i => i.done).length, total: items.length })

/** Everything ticked (and something to tick). */
export const allDone = (items: Item[]) => items.length > 0 && items.every(i => i.done)

/** Where one at a time starts: the first open item, else the first. */
export const startAt = (ordered: Item[]) => Math.max(0, ordered.findIndex(i => !i.done))

/** The next open item after `index`, wrapping round to ones skipped; -1 when no other is open. */
export function nextOpen(ordered: Item[], index: number): number {
  for (let k = 1; k < ordered.length; k++) {
    const i = (index + k) % ordered.length
    if (!ordered[i].done) return i
  }
  return -1
}

/** The item that was showing, after a reload (a tick on another device, an item added or deleted):
 * by id, so two people on two screens never move each other along; gone, the nearest place left. */
export function stayOn(ordered: Item[], id: string | null, index: number): number {
  const at = ordered.findIndex(i => i.id === id)
  return at >= 0 ? at : Math.max(0, Math.min(index, ordered.length - 1))
}

/** A chore's checklist: its person's items and nobody's (an Anyone chore: all of them). The
 * server's rule for completing the chore (routes/chores.ts). */
export const choreItems = <T extends { memberId: string | null }>(items: T[], memberId: string | null) =>
  items.filter(i => !memberId || !i.memberId || i.memberId === memberId)

/** The checklist this screen opens straight into (Settings → This display → Pin a checklist): all
 * day, or only inside its from–to window on this device's clock. Null = none now. */
export function pinnedNow(device: { pinList?: string; pinFrom?: string; pinTo?: string }, now = new Date()): string | null {
  if (!device.pinList) return null
  return !device.pinFrom || !device.pinTo || inTimeWindow(device.pinFrom, device.pinTo, now) ? device.pinList : null
}

// One at a time or the whole list: the last one picked, on this device.
export type DoView = 'step' | 'list'
const VIEW_KEY = 'kinwall.doView'
export function savedView(): DoView {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'step' } catch { return 'step' }
}
export function saveView(view: DoView) {
  try { localStorage.setItem(VIEW_KEY, view) } catch { /* storage blocked: just for now */ }
}
