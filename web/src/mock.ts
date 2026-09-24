// Dev-only in-memory fixture, used when VITE_MOCK=1. Excluded from prod by the env check in api.ts.
import type {
  Account, ApiKey, CalendarEntry, Chore, ChoreDay, EventInstance, LeaderboardEntry, LeaderboardPeriod, List, ListGroup,
  ListItem, ListItemInput, Member, Providers, RemoteCalendar, Settings, Webhook,
} from './types.ts'

const uid = () => crypto.randomUUID()
const todayISO = () => new Date().toISOString().slice(0, 10)

let rev = 1
const bump = () => { rev++ }

const settings: Settings = {
  familyName: 'The Duprey Family',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStart: 0,
  themeMode: 'light',
  darkFrom: '20:00',
  darkTo: '07:00',
  accent: '#FF9E7A',
  backgroundLight: 'warm',
  backgroundDark: 'cocoa',
  textScale: 'm',
  density: 'comfortable',
}

const members: Member[] = [
  { id: 'm1', name: 'John', color: '#7AB8FF', avatar: '🦊', sort: 0, pointsToday: 10, pointsWeek: 40 },
  { id: 'm2', name: 'Sam', color: '#FF8FA3', avatar: '🐰', sort: 1, pointsToday: 5, pointsWeek: 25 },
  { id: 'm3', name: 'Riley', color: '#7ED9A6', avatar: '🐻', sort: 2, pointsToday: 0, pointsWeek: 15 },
]

const calendars: CalendarEntry[] = [
  { id: 'c1', kind: 'local', accountId: null, remoteId: null, name: 'Family', color: '#B39DFF', memberId: null, memberIds: [], writable: true, enabled: true, lastSyncedAt: null, lastError: null },
  { id: 'c2', kind: 'ics', accountId: null, remoteId: null, name: 'School (ICS)', color: '#FFD166', memberId: null, memberIds: [], writable: false, enabled: true, lastSyncedAt: new Date().toISOString(), lastError: null },
]

function at(daysFromToday: number, hh: number, mm = 0) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + daysFromToday)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}
function dateOnly(daysFromToday: number) {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  return d.toISOString().slice(0, 10)
}

// seriesId/memberScope: mock data has no synced recurring events, so every fixture is 'none'/null
// (matches how a local event or a non-recurring synced event reports these fields for real).
const events: EventInstance[] = [
  { id: 'e1', calendarId: 'c1', title: 'Soccer Practice', start: at(0, 16), end: at(0, 17, 30), allDay: false, location: 'Park field', description: null, memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none' },
  { id: 'e2', calendarId: 'c1', title: 'Team Meeting', start: at(0, 16, 30), end: at(0, 17), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none' },
  { id: 'e3', calendarId: 'c2', title: 'Teacher In-Service (No School)', start: dateOnly(1), end: dateOnly(2), allDay: true, location: null, description: null, memberIds: ['m3'], color: '#FFD166', rrule: null, occurrenceStart: null, readOnly: true, seriesId: null, memberScope: 'none' },
  { id: 'e4', calendarId: 'c1', title: 'Family Dinner', start: at(2, 18), end: at(2, 19), allDay: false, location: 'Home', description: null, memberIds: [], color: '#B39DFF', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none' },
  { id: 'e5', calendarId: 'c1', title: 'Piano Lesson', start: at(3, 15), end: at(3, 15, 45), allDay: false, location: null, description: null, memberIds: ['m3'], color: '#7ED9A6', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none' },
  { id: 'e6', calendarId: 'c1', title: 'Book Club', start: at(-1, 19), end: at(-1, 20), allDay: false, location: null, description: null, memberIds: ['m1'], color: '#7AB8FF', rrule: 'FREQ=WEEKLY', occurrenceStart: at(-1, 19), readOnly: false, seriesId: null, memberScope: 'none' },
  { id: 'e7', calendarId: 'c1', title: "Sam's Birthday", start: dateOnly(4), end: dateOnly(5), allDay: true, location: null, description: null, memberIds: ['m2'], color: '#FF8FA3', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none' },
]

const chores: Chore[] = [
  { id: 'ch1', title: 'Make bed', emoji: '🛏️', memberId: 'm2', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 0 },
  { id: 'ch2', title: 'Feed the dog', emoji: '🐕', memberId: 'm3', points: 5, rrule: 'FREQ=DAILY', dueDate: null, dueTime: null, active: true, sort: 1 },
  { id: 'ch3', title: 'Take out trash', emoji: '🗑️', memberId: 'm1', points: 10, rrule: 'FREQ=WEEKLY;BYDAY=MO,TH', dueDate: null, dueTime: null, active: true, sort: 2 },
  { id: 'ch4', title: 'Water plants', emoji: '🪴', memberId: null, points: 5, rrule: null, dueDate: todayISO(), dueTime: null, active: true, sort: 3 },
  { id: 'ch5', title: 'Vacuum living room', emoji: '🧹', memberId: 'm2', points: 15, rrule: 'FREQ=WEEKLY', dueDate: null, dueTime: null, active: true, sort: 4 },
]
const completions = new Map<string, { completedAt: string; memberId: string | null }>() // key `${choreId}:${date}`

const lists: List[] = [
  { id: 'l1', name: 'Groceries', emoji: '🛒', color: '#7ED9A6', kind: 'shopping', memberIds: [], groupBy: 'category', sort: 0, archived: false, createdAt: new Date().toISOString(), itemCount: 5, openCount: 4 },
  { id: 'l2', name: 'Weekend To-Dos', emoji: '✅', color: '#7AB8FF', kind: 'todo', memberIds: ['m1'], groupBy: 'none', sort: 1, archived: false, createdAt: new Date().toISOString(), itemCount: 3, openCount: 2 },
  { id: 'l3', name: 'Camping Packing List', emoji: '🎒', color: '#FFD166', kind: 'reusable', memberIds: [], groupBy: 'none', sort: 2, archived: false, createdAt: new Date().toISOString(), itemCount: 4, openCount: 4 },
]
let listItems: ListItem[] = [
  { id: 'li1', listId: 'l1', title: 'Milk', notes: null, quantity: '1', store: null, category: 'Dairy', memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li2', listId: 'l1', title: 'Eggs', notes: null, quantity: '1 dozen', store: null, category: 'Dairy', memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li3', listId: 'l1', title: 'Bread', notes: null, quantity: null, store: null, category: 'Bakery', memberId: null, dueDate: null, done: true, doneAt: new Date().toISOString(), doneBy: 'm1', sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li4', listId: 'l1', title: 'Apples', notes: null, quantity: '6', store: null, category: 'Produce', memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li5', listId: 'l1', title: 'Paper towels', notes: null, quantity: null, store: null, category: 'Household', memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 4, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li6', listId: 'l2', title: 'Mow the lawn', notes: null, quantity: null, store: null, category: null, memberId: 'm1', dueDate: todayISO(), done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li7', listId: 'l2', title: 'Return library books', notes: null, quantity: null, store: null, category: null, memberId: 'm2', dueDate: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li8', listId: 'l2', title: 'Book dentist appointment', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, done: true, doneAt: new Date().toISOString(), doneBy: 'm1', sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li9', listId: 'l3', title: 'Tent', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li10', listId: 'l3', title: 'Sleeping bags', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li11', listId: 'l3', title: 'Flashlight', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: 'li12', listId: 'l3', title: 'Bug spray', notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: 3, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]
let listGroups: ListGroup[] = []

function recomputeListCounts(id: string) {
  const l = lists.find(x => x.id === id); if (!l) return
  const items = listItems.filter(i => i.listId === id)
  l.itemCount = items.length
  l.openCount = items.filter(i => !i.done).length
}

export const mock = {
  getRev: async () => ({ rev }),

  getSettings: async (): Promise<Settings> => ({ ...settings }),
  updateSettings: async (patch: Partial<Settings>) => { Object.assign(settings, patch); bump(); return { ...settings } },

  getMembers: async () => [...members].sort((a, b) => a.sort - b.sort),
  createMember: async (m: Partial<Member>) => {
    const nm: Member = { id: uid(), name: m.name ?? 'New', color: m.color ?? '#FF9E7A', avatar: m.avatar ?? '🙂', sort: members.length, pointsToday: 0, pointsWeek: 0 }
    members.push(nm); bump(); return nm
  },
  updateMember: async (id: string, patch: Partial<Member>) => {
    const m = members.find(x => x.id === id); if (!m) throw new Error('not found')
    Object.assign(m, patch); bump(); return m
  },
  deleteMember: async (id: string) => { const i = members.findIndex(x => x.id === id); if (i >= 0) members.splice(i, 1); bump() },

  getCalendars: async () => [...calendars],
  createCalendar: async (c: Partial<CalendarEntry>) => {
    const memberIds = c.memberIds ?? (c.memberId ? [c.memberId] : [])
    const nc: CalendarEntry = {
      id: uid(), kind: c.kind ?? 'local', accountId: c.accountId ?? null, remoteId: c.remoteId ?? null,
      name: c.name ?? 'New Calendar', color: c.color ?? '#7AB8FF', memberId: memberIds[0] ?? null, memberIds,
      writable: c.kind === 'local' || c.kind === undefined, enabled: true, lastSyncedAt: null, lastError: null,
    }
    calendars.push(nc); bump(); return nc
  },
  updateCalendar: async (id: string, patch: Partial<CalendarEntry>) => {
    const c = calendars.find(x => x.id === id); if (!c) throw new Error('not found')
    Object.assign(c, patch); bump(); return c
  },
  deleteCalendar: async (id: string) => { const i = calendars.findIndex(x => x.id === id); if (i >= 0) calendars.splice(i, 1); bump() },
  syncCalendar: async (id: string) => { const c = calendars.find(x => x.id === id); if (c) c.lastSyncedAt = new Date().toISOString(); return { ok: true, count: events.filter(e => e.calendarId === id).length } },

  getProviders: async (): Promise<Providers> => ({
    publicUrl: { value: location.origin, source: null },
    redirectUris: { google: `${location.origin}/api/oauth/google/callback`, microsoft: `${location.origin}/api/oauth/microsoft/callback` },
    google: { configured: false, source: null, secretSet: false },
    microsoft: { configured: false, source: null, secretSet: false },
  }),
  saveProvider: async (_kind: 'google' | 'microsoft', _body: { clientId: string; clientSecret?: string; tenant?: string }): Promise<Providers['google']> => ({ configured: true, source: 'ui', clientId: _body.clientId, tenant: _body.tenant, secretSet: true }),
  deleteProvider: async (_kind: 'google' | 'microsoft') => { bump() },
  savePublicUrl: async (value: string): Promise<{ value: string; warning?: string }> => ({ value }),

  getAccounts: async (): Promise<Account[]> => [],
  deleteAccount: async (_id: string) => { bump() },
  createCaldavAccount: async (_body: { name: string; serverUrl: string; username: string; password: string }): Promise<Account> => ({ id: uid(), kind: 'caldav', name: _body.name, createdAt: new Date().toISOString() }),
  getRemoteCalendars: async (_accountId: string): Promise<RemoteCalendar[]> => ([
    { remoteId: 'remote-1', name: 'Work', color: '#7AB8FF', writable: true },
    { remoteId: 'remote-2', name: 'Holidays', color: '#FFD166', writable: false },
  ]),

  getEvents: async (from: string, to: string) => events.filter(e => e.start < to && e.end > from),
  getEvent: async (id: string) => { const e = events.find(x => x.id === id); if (!e) throw new Error('not found'); return e },
  createEvent: async (body: Partial<EventInstance>) => {
    const cal = calendars.find(c => c.id === body.calendarId)
    const ev: EventInstance = {
      id: uid(), calendarId: body.calendarId!, title: body.title ?? 'Untitled',
      start: body.start!, end: body.end!, allDay: !!body.allDay,
      location: body.location ?? null, description: body.description ?? null,
      memberIds: body.memberIds ?? [], color: (body.memberIds?.length && members.find(m => m.id === body.memberIds![0])?.color) || cal?.color || '#888',
      rrule: body.rrule ?? null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none',
    }
    events.push(ev); bump(); return ev
  },
  updateEvent: async (id: string, patch: Partial<EventInstance>) => {
    const e = events.find(x => x.id === id); if (!e) throw new Error('not found')
    Object.assign(e, patch); bump(); return e
  },
  deleteEvent: async (id: string) => { const i = events.findIndex(x => x.id === id); if (i >= 0) events.splice(i, 1); bump() },

  getChoresDay: async (date: string): Promise<ChoreDay[]> => chores.filter(c => c.active).map(c => {
    const comp = completions.get(`${c.id}:${date}`)
    return { ...c, completed: !!comp, completedAt: comp?.completedAt ?? null, completedBy: comp?.memberId ?? null }
  }),
  createChore: async (body: Partial<Chore>) => {
    const nc: Chore = { id: uid(), title: body.title ?? 'New chore', emoji: body.emoji ?? '⭐', memberId: body.memberId ?? null, points: body.points ?? 5, rrule: body.rrule ?? null, dueDate: body.dueDate ?? null, dueTime: body.dueTime ?? null, active: true, sort: chores.length }
    chores.push(nc); bump(); return nc
  },
  updateChore: async (id: string, patch: Partial<Chore>) => {
    const c = chores.find(x => x.id === id); if (!c) throw new Error('not found')
    Object.assign(c, patch); bump(); return c
  },
  deleteChore: async (id: string) => { const i = chores.findIndex(x => x.id === id); if (i >= 0) chores.splice(i, 1); bump() },
  completeChore: async (id: string, date: string, memberId?: string) => { completions.set(`${id}:${date}`, { completedAt: new Date().toISOString(), memberId: memberId ?? null }); bump() },
  uncompleteChore: async (id: string, date: string) => { completions.delete(`${id}:${date}`); bump() },

  // Dev fixture only - period filtering is approximate (day-count windows, no real tz/weekStart
  // math) and streak is derived from how many of the last few days have any completion for that
  // member, just enough to make the widget look alive in `npm run dev -- --mode mock`.
  getLeaderboard: async (period: LeaderboardPeriod): Promise<LeaderboardEntry[]> => {
    const days = period === 'today' ? 1 : period === 'week' ? 7 : 30
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days + 1); cutoff.setHours(0, 0, 0, 0)
    const entries = members.map(m => {
      let points = 0, completed = 0, streak = 0
      for (const [k, v] of completions) {
        const [choreId, date] = k.split(':')
        if (v.memberId !== m.id) continue
        if (new Date(date) < cutoff) continue
        const chore = chores.find(c => c.id === choreId)
        if (!chore) continue
        points += chore.points; completed++
      }
      for (let i = 0; i < 30; i++) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        const any = [...completions.entries()].some(([k, v]) => k.endsWith(`:${key}`) && v.memberId === m.id)
        if (any) streak++
        else if (i > 0) break
      }
      return { memberId: m.id, name: m.name, color: m.color, avatar: m.avatar, points, completed, streak }
    })
    entries.sort((a, b) => b.points - a.points || b.completed - a.completed || a.name.localeCompare(b.name))
    let rank = 1
    return entries.map((e, i) => {
      if (i > 0 && !(e.points === entries[i - 1].points && e.completed === entries[i - 1].completed)) rank = i + 1
      return { ...e, rank }
    })
  },

  getKeys: async (): Promise<ApiKey[]> => [{ id: 'k1', name: 'iPad Wall Display', prefix: 'fc_live_ab12', scope: 'display', createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() }],
  createKey: async (name: string) => ({ id: uid(), name, key: 'fc_live_' + uid().replace(/-/g, '').slice(0, 24) }),
  deleteKey: async (_id: string) => {},

  getLists: async (archived?: boolean) => lists.filter(l => archived ? true : !l.archived).sort((a, b) => a.sort - b.sort),
  createList: async (body: Partial<List>): Promise<List> => {
    const nl: List = {
      id: uid(), name: body.name ?? 'New list', emoji: body.emoji ?? '📝', color: body.color ?? '#FF9E7A',
      kind: body.kind ?? 'todo', memberIds: body.memberIds ?? [], groupBy: body.groupBy ?? (body.kind === 'shopping' ? 'category' : 'none'),
      sort: lists.length, archived: false, createdAt: new Date().toISOString(), itemCount: 0, openCount: 0,
    }
    lists.push(nl); bump(); return nl
  },
  getList: async (id: string) => {
    const l = lists.find(x => x.id === id); if (!l) throw new Error('not found')
    const items = listItems.filter(i => i.listId === id).sort((a, b) => a.sort - b.sort)
    const groups = listGroups.filter(g => g.name) // per-list groups aren't keyed by list in this fixture; kept simple for demo
    const stores = [...new Set(listItems.map(i => i.store).filter((v): v is string => !!v))].sort()
    const categories = [...new Set(listItems.map(i => i.category).filter((v): v is string => !!v))].sort()
    return { list: l, items, groups, suggestions: { stores, categories } }
  },
  updateList: async (id: string, patch: Partial<List>) => {
    const l = lists.find(x => x.id === id); if (!l) throw new Error('not found')
    Object.assign(l, patch); bump(); return l
  },
  deleteList: async (id: string) => {
    const i = lists.findIndex(x => x.id === id); if (i >= 0) lists.splice(i, 1)
    listItems = listItems.filter(x => x.listId !== id); bump()
  },
  addListItems: async (listId: string, body: ListItemInput | ListItemInput[]): Promise<ListItem[]> => {
    const inputs = Array.isArray(body) ? body : [body]
    const maxSort = Math.max(-1, ...listItems.filter(i => i.listId === listId).map(i => i.sort))
    const created = inputs.map((input, idx) => {
      // "remembers where things go": omitted store/category (undefined) inherit from the most
      // recently updated same-title item anywhere; explicit null means "none".
      const remembered = [...listItems].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .find(i => i.title.trim().toLowerCase() === input.title.trim().toLowerCase())
      const item: ListItem = {
        id: uid(), listId, title: input.title.trim(), notes: input.notes ?? null,
        quantity: input.quantity ?? null,
        store: input.store !== undefined ? input.store : (remembered?.store ?? null),
        category: input.category !== undefined ? input.category : (remembered?.category ?? null),
        memberId: input.memberId ?? null, dueDate: input.dueDate ?? null,
        done: false, doneAt: null, doneBy: null, sort: maxSort + 1 + idx,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      }
      return item
    })
    listItems.push(...created); recomputeListCounts(listId); bump(); return created
  },
  updateListItem: async (listId: string, itemId: string, patch: Partial<ListItem>) => {
    const i = listItems.find(x => x.id === itemId && x.listId === listId); if (!i) throw new Error('not found')
    if (patch.done !== undefined) {
      i.doneAt = patch.done ? new Date().toISOString() : null
      i.doneBy = patch.done ? (patch.doneBy ?? null) : null
    }
    Object.assign(i, patch, { updatedAt: new Date().toISOString() })
    recomputeListCounts(listId); bump(); return i
  },
  deleteListItem: async (listId: string, itemId: string) => {
    const i = listItems.findIndex(x => x.id === itemId && x.listId === listId)
    if (i >= 0) listItems.splice(i, 1)
    recomputeListCounts(listId); bump()
  },
  clearListCompleted: async (listId: string) => {
    const before = listItems.length
    listItems = listItems.filter(i => !(i.listId === listId && i.done))
    recomputeListCounts(listId); bump()
    return { deleted: before - listItems.length }
  },
  resetList: async (listId: string) => {
    const items = listItems.filter(i => i.listId === listId && i.done)
    items.forEach(i => { i.done = false; i.doneAt = null; i.doneBy = null })
    recomputeListCounts(listId); bump()
    return { reset: items.length }
  },
  reorderListItems: async (_listId: string, itemIds: string[]) => {
    itemIds.forEach((id, idx) => { const i = listItems.find(x => x.id === id); if (i) i.sort = idx })
    bump(); return { ok: true }
  },
  setListGroups: async (_listId: string, groups: { kind: 'store' | 'category'; name: string }[]) => {
    listGroups = groups.map((g, idx) => ({ ...g, sort: idx }))
    bump(); return listGroups
  },

  getWebhooks: async (): Promise<Webhook[]> => [],
  createWebhook: async (url: string, evs: string[]) => ({ id: uid(), url, events: evs, enabled: true, createdAt: new Date().toISOString() }),
  updateWebhook: async (id: string, patch: Partial<Webhook>) => ({ id, url: patch.url ?? '', events: patch.events ?? [], enabled: patch.enabled ?? true, createdAt: new Date().toISOString() }),
  deleteWebhook: async (_id: string) => {},
}
