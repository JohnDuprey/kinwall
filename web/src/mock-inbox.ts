// The demo's inbox (api.ts sends /api/inbox here): the same rules as server/src/routes/inbox.ts,
// in memory. Sorting adds the task, event or note to the demo's own lists, calendar and Board.
import { ApiError } from './apiError.ts'
import type { InboxItem, InboxSort } from './inbox.ts'

/** The demo family's inbox: a few thoughts from the last couple of days. */
export function seedInbox(now: Date): InboxItem[] {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600e3).toISOString()
  const open = (id: string, text: string, hours: number): InboxItem => ({ id, text, status: 'open', target: null, createdAt: ago(hours), updatedAt: ago(hours), doneAt: null })
  return [open('inbox-1', 'Permission slip for Friday', 1), open('inbox-2', 'Ask about a library book', 20), open('inbox-3', 'Remember an idea for dinner', 30)]
}

let items = seedInbox(new Date())
const copy = (i: InboxItem) => structuredClone(i)
const find = (id: string) => { const i = items.find(x => x.id === id); if (!i) throw new ApiError(404, 'That isn’t in the inbox.'); return i }

export async function mockInboxRequest(path: string, options: RequestInit) {
  const [, , , id, action] = new URL(path, 'https://demo.invalid').pathname.split('/') // /api/inbox/{id}/sort
  const method = options.method ?? 'GET', body = options.body ? JSON.parse(String(options.body)) : {}
  const now = new Date().toISOString()
  if (method === 'GET') {
    const open = items.filter(i => i.status === 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const done = items.filter(i => i.status !== 'open').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')).slice(0, 20)
    return { items: [...open, ...done].map(copy) }
  }
  if (method === 'POST' && !id) {
    const existing = items.find(i => i.id === body.id)
    if (existing) return copy(existing)
    const item: InboxItem = { id: body.id ?? crypto.randomUUID(), text: String(body.text).trim(), status: 'open', target: null, createdAt: now, updatedAt: now, doneAt: null }
    items.unshift(item)
    return copy(item)
  }
  const item = find(id)
  if (method === 'PATCH') {
    const ok = body.status === 'cleared' ? item.status === 'open' : item.status === 'cleared' || (item.status === 'sorted' && !item.target?.id)
    if (!ok) throw new ApiError(409, body.status === 'cleared' ? 'That’s already been sorted.' : 'That’s already in the inbox, or it went somewhere.')
    Object.assign(item, body.status === 'cleared' ? { status: 'cleared', doneAt: now } : { status: 'open', target: null, doneAt: null }, { updatedAt: now })
    return copy(item)
  }
  if (method === 'POST' && action === 'sort') {
    if (item.status !== 'open') throw new ApiError(409, 'That’s already been sorted.')
    const sort = body as InboxSort
    Object.assign(item, { status: 'sorted', target: { kind: sort.kind, id: null }, doneAt: now, updatedAt: now }) // claimed
    try {
      const { mock } = await import('./mock.ts')
      if (sort.kind === 'task') {
        const list = (await mock.getLists()).find(l => l.id === sort.listId)
        if (!list) throw new ApiError(404, 'List not found')
        await mock.addListItems(list.id, [{ id: item.id, title: sort.title, dueDate: sort.dueDate }])
        item.target = { kind: 'task', id: item.id, listId: list.id, label: list.name }
      } else if (sort.kind === 'event') {
        const ev = await mock.createEvent(sort.event)
        item.target = { kind: 'event', id: ev.id, at: ev.start }
      } else {
        const { mockAnnouncementRequest } = await import('./mock-announcements.ts')
        const note = await mockAnnouncementRequest('api/announcements', { method: 'POST', body: JSON.stringify({ title: sort.title, details: sort.details, startsAt: now, expiresAt: sort.expiresAt, priority: 'normal' }) }) as { id: string }
        item.target = { kind: 'note', id: note.id }
      }
      return copy(item)
    } catch (e) {
      Object.assign(item, { status: 'open', target: null, doneAt: null }) // released: still in the inbox
      throw e
    }
  }
  throw new ApiError(404, 'Not found')
}
