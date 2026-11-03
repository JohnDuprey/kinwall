import { activeAnnouncements, type Announcement } from './announcements.ts'
const now = Date.now(), iso = (ms: number) => new Date(ms).toISOString()
let items: Announcement[] = [{ id: 'demo-announcement', title: 'Library books tomorrow', details: 'Put your library books by the door tonight so they are ready for school.', priority: 'important', startsAt: iso(now - 3600000), expiresAt: iso(now + 86400000), createdAt: iso(now), updatedAt: iso(now) }]
export async function mockAnnouncementRequest(path: string, options: RequestInit) {
  const url = new URL(path, 'https://demo.invalid'), id = url.pathname.split('/')[3], method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(String(options.body)) : {}
  const ordered = [...items].sort((a, b) => Number(b.priority === 'important') - Number(a.priority === 'important') || b.startsAt.localeCompare(a.startsAt) || a.id.localeCompare(b.id))
  if (method === 'GET') return { announcements: structuredClone(url.searchParams.get('status') === 'all' ? ordered : activeAnnouncements(ordered)), nextChangeAt: items.flatMap(a => [a.startsAt, a.expiresAt]).filter(at => Date.parse(at) > Date.now()).sort()[0] ?? null }
  if (method === 'POST') { const item = { ...body, id: crypto.randomUUID(), createdAt: iso(Date.now()), updatedAt: iso(Date.now()) }; items.unshift(item); return structuredClone(item) }
  if (method === 'PATCH') { const i = items.findIndex(a => a.id === id); items[i] = { ...items[i], ...body, updatedAt: iso(Date.now()) }; return structuredClone(items[i]) }
  items = items.filter(a => a.id !== id)
  return { ok: true }
}
