// Offline support: a last-good copy of GET responses and an outbox of list/chore changes, both in
// IndexedDB (in memory when IndexedDB is missing or blocked, so a session still works online-only
// plus retries). No React or DOM here beyond IndexedDB: test/outbox.test.ts runs it under Node.
//
// Conflict rule (SPEC.md, "Offline"): changes replay in the order they were
// made and each sends only the fields it touched ("done: true", never "toggle"), so the change that
// reaches the server last wins, field by field. A change the server refuses (4xx: the item or chore
// was deleted elsewhere, or the device may not make it) is dropped and reported. New items carry a
// client-made id, so a replay never adds one twice.

export interface Op {
  seq?: number // IndexedDB key: replay order
  tag: string // which server (its base URL) it's for; only replayed there
  method: 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
  tries?: number
}

/** What the outbox needs from the API client: resolve on success, or throw with `status`
 * (0 = no network). */
export type Sender = (op: Op) => Promise<unknown>

const DB_NAME = 'kinwall-offline'
let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  if (!dbp) {
    dbp = new Promise(resolve => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null)
        const r = indexedDB.open(DB_NAME, 1)
        r.onupgradeneeded = () => {
          r.result.createObjectStore('cache')
          r.result.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
        }
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => resolve(null) // private mode, storage blocked, old Safari quirks
        r.onblocked = () => resolve(null)
      } catch { resolve(null) }
    })
  }
  return dbp
}

function tx<T>(store: 'cache' | 'outbox', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then(d => !d ? undefined : new Promise<T | undefined>(resolve => {
    try {
      const t = d.transaction(store, mode)
      const r = fn(t.objectStore(store))
      t.oncomplete = () => resolve(r ? r.result : undefined)
      t.onerror = t.onabort = () => resolve(undefined)
    } catch { resolve(undefined) }
  }))
}

// ---- GET cache -------------------------------------------------------------------------------

export const cacheGet = <T,>(key: string) => tx<{ v: T }>('cache', 'readonly', s => s.get(key)).then(r => r?.v)
export const cachePut = (key: string, v: unknown) => tx('cache', 'readwrite', s => s.put({ v }, key)).then(() => {})

// ---- outbox ----------------------------------------------------------------------------------

let ops: Op[] = [] // mirror of the store, in seq order
let loaded: Promise<void> | null = null
let memSeq = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())
export const onOutboxChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function load(): Promise<void> {
  if (!loaded) loaded = tx<Op[]>('outbox', 'readonly', s => s.getAll()).then(all => {
    if (all?.length) { ops = all.concat(ops); memSeq = Math.max(...all.map(o => o.seq ?? 0)) } // stored ones are older
    notify()
  })
  return loaded
}

export function pendingOps(tag: string): Op[] {
  return ops.filter(o => o.tag === tag)
}
/** Loaded from storage (call once at start-up before trusting pendingOps). */
export const outboxReady = () => load()

/** Adds a change: visible to pendingOps at once, stored before it can be sent. */
export function enqueue(op: Op): Promise<void> {
  const entry: Op = { ...op }
  delete entry.seq
  ops.push(entry)
  notify()
  return load()
    .then(() => tx<IDBValidKey>('outbox', 'readwrite', s => s.add({ ...entry })))
    .then(seq => { entry.seq = typeof seq === 'number' ? seq : ++memSeq })
}

async function remove(op: Op) {
  ops = ops.filter(o => o !== op)
  await tx('outbox', 'readwrite', s => s.delete(op.seq!))
  notify()
}

/** Worth trying again later: no network, the server hiccuped, or the key is being re-checked. */
export const retryable = (status: number) => status === 0 || status === 401 || status === 408 || status === 429 || status >= 500
const MAX_TRIES = 20 // a change the server keeps failing on (5xx) goes eventually, rather than blocking the rest

export type Dropped = { op: Op; status: number; message: string }
let flushing: Promise<{ sent: number; dropped: Dropped[]; stalled: boolean }> | null = null
/** Replays this tag's changes oldest first. Stops at the first one that can't go yet, so order is
 * kept; drops (and reports) ones the server refuses. One flush at a time. */
export function flush(tag: string, send: Sender) {
  if (flushing) return flushing
  flushing = (async () => {
    await load()
    let sent = 0
    const dropped: Dropped[] = []
    // Oldest first, including ones queued mid-flush; one still being stored waits for the next flush.
    for (let op = pendingOps(tag)[0]; op && op.seq !== undefined; op = pendingOps(tag)[0]) {
      try {
        await send(op)
        sent++
        await remove(op)
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0
        if (op.method === 'DELETE' && status === 404) { sent++; await remove(op); continue } // already gone
        // No network doesn't count as a try: a phone can be offline for hours.
        const tries = (op.tries ?? 0) + (status === 0 ? 0 : 1)
        if (retryable(status) && tries < MAX_TRIES) {
          op.tries = tries
          await tx('outbox', 'readwrite', s => s.put(op))
          return { sent, dropped, stalled: true }
        }
        dropped.push({ op, status, message: (e as Error).message })
        await remove(op)
      }
    }
    return { sent, dropped, stalled: false }
  })().finally(() => { flushing = null })
  return flushing
}

/** Sign-out forgets both; a rejected key keeps the queue (the same household signs in again). */
export async function clearOffline(keepOutbox = false): Promise<void> {
  await tx('cache', 'readwrite', s => s.clear())
  if (keepOutbox) return
  ops = []
  notify()
  await tx('outbox', 'readwrite', s => s.clear())
}

// ---- showing queued changes on top of what the server (or the cache) last said ---------------

interface ItemLike { id: string; listId: string; done: boolean; doneAt: string | null; sort: number; pending?: boolean }
interface DetailLike<I extends ItemLike> { list: { id: string; itemCount: number; openCount: number }; items: I[] }

/** A list as it will be once its queued changes land: adds appended, edits merged, deletes gone.
 * Touched items get `pending: true` for a subtle "not synced yet" mark. */
export function applyListOps<I extends ItemLike, D extends DetailLike<I>>(detail: D, queued: Op[]): D {
  const base = `api/lists/${detail.list.id}/items`
  const mine = queued.filter(o => o.path === base || o.path.startsWith(base + '/'))
  if (!mine.length) return detail
  let items = detail.items.slice()
  for (const op of mine) {
    const itemId = op.path.slice(base.length + 1)
    if (op.method === 'POST') {
      for (const input of ([] as Record<string, unknown>[]).concat(op.body as Record<string, unknown>)) {
        if (items.some(i => i.id === input.id)) continue
        const now = new Date().toISOString()
        items.push({
          listId: detail.list.id, notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, eventId: null,
          priority: 'normal', done: false, doneAt: null, doneBy: null, createdAt: now, updatedAt: now, steps: [], stepsDone: 0, stepsTotal: 0,
          sort: items.reduce((m, i) => Math.max(m, i.sort), -1) + 1, ...input, pending: true,
        } as unknown as I)
      }
    } else if (op.method === 'PATCH') {
      const body = op.body as Partial<ItemLike>
      items = items.map(i => i.id !== itemId ? i : {
        ...i, ...body, pending: true,
        ...(body.done !== undefined && body.done !== i.done ? { doneAt: body.done ? new Date().toISOString() : null } : {}),
      })
    } else if (op.method === 'DELETE') {
      items = items.filter(i => i.id !== itemId)
    }
  }
  return { ...detail, items, list: { ...detail.list, itemCount: items.length, openCount: items.filter(i => !i.done).length } }
}

interface ChoreLike { id: string; completed: boolean; completedBy: string | null }
/** A day's chores with queued ticks and unticks for that day applied. */
export function applyChoreOps<C extends ChoreLike>(chores: C[], date: string, queued: Op[]): C[] {
  let out = chores
  for (const op of queued) {
    const m = /^api\/chores\/([^/]+)\/complete(?:\?date=(.+))?$/.exec(op.path)
    if (!m) continue
    const body = op.body as { date?: string; memberId?: string } | undefined
    if ((op.method === 'POST' ? body?.date : m[2]) !== date) continue
    out = out.map(c => c.id !== m[1] ? c : op.method === 'POST'
      ? { ...c, completed: true, completedBy: body?.memberId ?? c.completedBy }
      : { ...c, completed: false, completedBy: null })
  }
  return out
}
