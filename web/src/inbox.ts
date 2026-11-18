// The quick-capture inbox (Inbox.tsx, server routes/inbox.ts): jot a thought down now, decide later
// whether it's a task, an event or a note. The server keeps it; this is the screen's state and rules,
// plain so they can be tested.

export type InboxKind = 'task' | 'event' | 'note'
/** Where a sorted thought went; id is null only if saving it was interrupted. */
export type InboxTarget = { kind: InboxKind; id: string | null; listId?: string; label?: string; at?: string }
export type InboxItem = {
  id: string
  text: string // exactly what was typed (trimmed), kept as is whatever it becomes
  status: 'open' | 'sorted' | 'cleared'
  target: InboxTarget | null
  createdAt: string
  updatedAt: string
  doneAt: string | null
}
export type InboxSort =
  | { kind: 'task'; listId: string; title: string; dueDate: string | null }
  | { kind: 'event'; event: Record<string, unknown> }
  | { kind: 'note'; title: string; details: string; expiresAt: string }
/** What the server sent, plus which thoughts this screen is saving right now. */
export type Inbox = { items: InboxItem[]; saving: string[] }

export const cleaned = (text: string) => text.trim() || null
/** Add or replace (by id) what the server sent. */
export const upsert = (inbox: Inbox, item: InboxItem): Inbox =>
  ({ ...inbox, items: inbox.items.some(i => i.id === item.id) ? inbox.items.map(i => i.id === item.id ? item : i) : [item, ...inbox.items] })
/** Waiting to be sorted (one being saved stays here until it's done), newest first. */
export const openItems = (inbox: Inbox) => inbox.items.filter(i => i.status === 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
/** Sorted or cleared, most recent first. */
export const cleared = (inbox: Inbox, max = 5) => inbox.items.filter(i => i.status !== 'open')
  .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')).slice(0, max)

export type InboxStore = { get: () => Inbox; set: (next: Inbox) => void; subscribe: (fn: () => void) => () => void }
export function createInboxStore(initial: Inbox): InboxStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set: next => { state = next; listeners.forEach(fn => fn()) },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
  }
}

/** Sort a thought: send() asks the server (POST /api/inbox/{id}/sort), which makes the task, event
 * or note and answers with the thought as it is now. A second tap while saving, or on one already
 * sorted, sends nothing ('busy'); a failure leaves it as it was and rethrows. */
export async function organize(store: InboxStore, id: string, send: () => Promise<InboxItem>): Promise<'done' | 'busy'> {
  const { items, saving } = store.get()
  if (saving.includes(id) || items.find(i => i.id === id)?.status !== 'open') return 'busy'
  store.set({ ...store.get(), saving: [...saving, id] })
  const done = () => store.get().saving.filter(x => x !== id)
  try {
    const item = await send()
    store.set({ ...upsert(store.get(), item), saving: done() })
    return 'done'
  } catch (e) {
    store.set({ ...store.get(), saving: done() })
    throw e
  }
}

/** The link to where a sorted thought went, or null when there's nothing to open. */
export function whereHref(target: InboxTarget | null): string | null {
  if (!target?.id) return null
  if (target.kind === 'task') return `#/lists/${encodeURIComponent(target.listId ?? '')}`
  if (target.kind === 'event') return `#/calendar?${new URLSearchParams({ event: target.id, ...(target.at && { at: target.at }) })}`
  return '#/home'
}

// ponytail: English day words and keywords only; in other languages nothing is suggested and the parent picks. Add each language's words if families ask.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_WORD = /\b(today|tonight|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
const EVENT_WORDS = /\b(party|appointment|practice|game|recital|concert|meeting|playdate|trip|visit)\b/i
const NOTE_WORDS = /\b(idea|ideas|note)\b/i
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** A starting point for organizing, never applied on its own: a day word ("Friday", "tomorrow")
 * suggests the next such day (today counts), and a few words lean towards an event or a note. */
export function suggest(text: string, today: Date): { kind: InboxKind; date: string | null; dateWord: string | null } {
  const word = text.match(DAY_WORD)?.[1] ?? null
  let date: string | null = null
  if (word) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const lower = word.toLowerCase()
    if (lower === 'tomorrow') d.setDate(d.getDate() + 1)
    else if (DAYS.includes(lower)) d.setDate(d.getDate() + (DAYS.indexOf(lower) - d.getDay() + 7) % 7)
    date = ymd(d)
  }
  const kind = NOTE_WORDS.test(text) ? 'note' : EVENT_WORDS.test(text) ? 'event' : 'task'
  return { kind, date, dateWord: word }
}
