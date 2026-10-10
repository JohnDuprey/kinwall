// In-memory Outings for VITE_MOCK only (the server: routes/outings.ts). The demo family's things to
// do around Maple Grove (all made up): a fall fest this weekend, story time, a sewing class for Maya,
// a pumpkin patch that's open all month, a concert with no date yet, and a few places to go.
import { mock } from './mock.ts'
import { dateKey } from './date.ts'
import { addDays, hiddenFromKid, openStretches, outingIdeas, rainy, weekendOf, type BusyStretch } from './outing-rules.ts'
import type { Outing, OutingCategory, OutingFeed } from './types.ts'

const today = dateKey(new Date())
const [sat, sun] = weekendOf(today)
const monthEnd = dateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0))
const nextWeekSat = addDays(sat, 7)

let categories: OutingCategory[] = [
  ['oc-food', 'Food', '🍔'], ['oc-drinks', 'Drinks', '🍺'], ['oc-music', 'Music', '🎵'], ['oc-movies', 'Movies', '🎬'], ['oc-shows', 'Shows & theater', '🎭'],
  ['oc-art', 'Art & museums', '🎨'], ['oc-fairs', 'Fairs & festivals', '🎪'], ['oc-markets', 'Markets', '🧺'], ['oc-outdoors', 'Outdoors & nature', '🌲'], ['oc-water', 'Beaches & water', '🏖'],
  ['oc-sports', 'Sports', '🏟'], ['oc-classes', 'Classes & workshops', '🧵'], ['oc-library', 'Library & story time', '📚'], ['oc-seasonal', 'Holidays & seasonal', '🎃'],
].map(([id, name, emoji], sort) => ({ id, name, emoji, sort }))

const base: Omit<Outing, 'id' | 'title'> = {
  kind: 'upcoming', categoryId: null, startsOn: null, endsOn: null, startTime: null, endTime: null, hours: null, placeName: null, address: null, priceCents: null, priceNote: null,
  audience: [], memberIds: [], ageMin: null, ageMax: null, url: null, ticketsUrl: null, ticketsOnSaleAt: null, buyBy: null, gotTickets: false, visitStatus: null, lastVisitedOn: null,
  notes: null, calendarEventId: null, calendarEventStart: null, source: 'manual', addedBy: 'm1', archived: false, feedId: null, canceled: false, createdAt: `${addDays(today, -10)}T18:00:00.000Z`, updatedAt: `${addDays(today, -10)}T18:00:00.000Z`, interest: [],
}
const make = (id: string, title: string, p: Partial<Outing>): Outing => ({ ...base, id, title, ...p })
const really = (...ids: string[]) => ids.map(memberId => ({ memberId, level: 'really' as const }))
const looking = (...ids: string[]) => ids.map(memberId => ({ memberId, level: 'interested' as const }))

let outings: Outing[] = [
  make('demo-fall-fest', 'Maple Grove Fall Fest', { categoryId: 'oc-fairs', startsOn: sat, startTime: '10:00', endTime: '16:00', placeName: 'Town Green', address: 'Main St, Maple Grove', priceCents: 0, priceNote: 'Hayrides $3', audience: ['family'], notes: 'Bring cash for the bake sale.', interest: [...really('m3', 'm4'), ...looking('m1')] }),
  make('demo-story-time', 'Library story time', { categoryId: 'oc-library', startsOn: sun, startTime: '10:30', endTime: '11:15', placeName: 'Maple Grove Library', priceCents: 0, audience: ['kids'], ageMin: 3, ageMax: 7, interest: looking('m4') }),
  make('demo-sewing', 'Kids’ sewing class', { categoryId: 'oc-classes', startsOn: addDays(nextWeekSat, 7), startTime: '13:00', endTime: '14:30', placeName: 'Maple Grove Community Center', priceCents: 2000, audience: ['kids'], ageMin: 7, ageMax: 10, memberIds: ['m3'], buyBy: addDays(nextWeekSat, 3), notes: 'Bring a pillowcase to decorate.', addedBy: 'm3', interest: really('m3') }),
  make('demo-pumpkins', 'Cedar Hollow pumpkin patch', { categoryId: 'oc-seasonal', startsOn: addDays(today, -6), endsOn: monthEnd > addDays(today, 6) ? monthEnd : addDays(today, 20), hours: 'Fri–Sun, 9 AM to 5 PM', placeName: 'Cedar Hollow Farm', priceCents: 800, audience: ['family'], interest: looking('m1') }),
  make('demo-space-pups', 'Space Pups opens in theaters', { categoryId: 'oc-movies', startsOn: addDays(nextWeekSat, -1), placeName: 'Maple Grove Cinema', audience: ['family'], interest: [...really('m4'), ...looking('m3')] }),
  make('demo-lanterns', 'The Lanterns, summer tour', { categoryId: 'oc-music', placeName: 'Harbor Amphitheater', priceCents: 4500, priceNote: 'Lawn seats $30', audience: ['grownups'], ticketsOnSaleAt: `${addDays(today, 8)}T14:00:00.000Z`, ticketsUrl: 'https://example.com/lanterns', addedBy: 'm2', interest: really('m2') }),
  make('demo-beer-garden', 'Riverside pop-up beer garden', { categoryId: 'oc-drinks', startsOn: addDays(today, -20), endsOn: addDays(today, 24), hours: 'Thu–Sun, noon to 9 PM', placeName: 'Riverside Park', audience: ['grownups'] }),
  make('demo-apples', 'Apple picking at Orchard Hill', { categoryId: 'oc-outdoors', startsOn: addDays(today, -5), priceCents: 1500, audience: ['family'], interest: really('m3') }),
  make('demo-willow', 'Willow Creek Nature Preserve', { kind: 'place', categoryId: 'oc-outdoors', placeName: 'Willow Creek Rd', priceCents: 0, audience: ['family'], visitStatus: 'want', notes: 'The loop trail is stroller-friendly.', interest: [...really('m3'), ...looking('m2')] }),
  make('demo-science', 'Harbor Science Museum', { kind: 'place', categoryId: 'oc-art', priceCents: 1200, priceNote: 'Kids under 4 free', audience: ['family'], visitStatus: 'been', lastVisitedOn: addDays(today, -240), interest: looking('m4') }),
  make('demo-beach', 'Lakeside Beach', { kind: 'place', categoryId: 'oc-water', priceCents: 0, audience: ['family'], visitStatus: 'been', lastVisitedOn: addDays(today, -40) }),
]

// A community calendar and its pile of new items (server: routes/outing-feeds.ts), all made up.
let feeds: OutingFeed[] = [{ id: 'demo-town-feed', name: 'Maple Grove town calendar', url: 'https://example.com/maple-grove/events.ics', categoryId: null, audience: ['family'], skipWords: 'meeting, committee, board, hearing', lastFetchedAt: `${today}T06:00:00.000Z`, lastError: null, waiting: 0 }]
const fromFeed = (id: string, title: string, p: Partial<Outing>): Outing => make(id, title, { source: 'feed', feedId: 'demo-town-feed', addedBy: null, audience: ['family'], ...p })
let pile: Outing[] = [
  fromFeed('demo-feed-movie', 'Movie night on the green', { startsOn: addDays(sat, 7), startTime: '19:00', placeName: 'Town Green', notes: 'Bring a blanket. Free popcorn.' }),
  fromFeed('demo-feed-tree', 'Tree lighting', { startsOn: addDays(today, 40), startTime: '17:30', placeName: 'Maple Grove Common' }),
  fromFeed('demo-feed-craft', 'Holiday craft fair', { startsOn: addDays(today, 33), endsOn: addDays(today, 34), placeName: 'Maple Grove Community Center' }),
]
const waiting = () => feeds.map(f => ({ ...f, waiting: pile.filter(o => o.feedId === f.id && !o.archived).length }))

/** The community calendars, the pile, and Save to Outings (POST /api/share kind outing). */
function mockFeeds(parts: string[], method: string, body: Record<string, unknown>): unknown {
  if (kid()) throw new Error('Only a grown-up can do that.')
  if (parts[1] === 'share') {
    const o = body.outing as Partial<Outing> & { title: string }
    const same = outings.find(x => x.title.toLowerCase() === o.title.toLowerCase() && x.startsOn === (o.startsOn ?? null))
    if (same) { const old = same as unknown as Record<string, unknown>; for (const [k, v] of Object.entries(o)) if (v != null && old[k] == null) old[k] = v; return { kind: 'outing', summary: `Filled in ${same.title} in Outings`, link: `#/outings?outing=${same.id}`, review: false } }
    const made = make(crypto.randomUUID(), o.title, { ...o, source: 'share' })
    outings.push(made)
    return { kind: 'outing', summary: `Added ${made.title} to Outings`, link: `#/outings?outing=${made.id}`, review: false }
  }
  const id = parts[2] && decodeURIComponent(parts[2])
  if (id === 'pile') {
    if (method === 'GET') return waiting().map(f => ({ feed: { id: f.id, name: f.name }, outings: copy(pile.filter(o => o.feedId === f.id && !o.archived)) })).filter(p => p.outings.length)
    const o = pile.find(x => x.id === decodeURIComponent(parts[3]))
    if (!o) throw new Error('That item is no longer waiting.')
    if (body.keep) { pile = pile.filter(x => x !== o); outings.push(o) } else o.archived = true
    return copy(o)
  }
  if (!id) {
    if (method === 'GET') return copy(waiting())
    const f: OutingFeed = { id: crypto.randomUUID(), name: String(body.name), url: String(body.url), categoryId: (body.categoryId as string) ?? null, audience: (body.audience as OutingFeed['audience']) ?? [], skipWords: (body.skipWords as string) ?? 'meeting, committee, board, hearing', lastFetchedAt: new Date().toISOString(), lastError: null, waiting: 0 }
    feeds.push(f); return copy(f)
  }
  const f = feeds.find(x => x.id === id)
  if (!f) throw new Error('calendar not found')
  if (method === 'DELETE') { feeds = feeds.filter(x => x !== f); pile = pile.filter(o => o.feedId !== id); return { ok: true } }
  if (parts[3] === 'refresh') f.lastFetchedAt = new Date().toISOString()
  else Object.assign(f, body)
  return copy(waiting().find(x => x.id === id))
}

const copy = <T,>(x: T): T => structuredClone(x)
const kid = () => mock.demoKid()
let outingCategoryId: string | null = null

export async function mockOutingRequest(path: string, options: RequestInit): Promise<unknown> {
  const url = new URL(path, 'https://demo.invalid/')
  const parts = url.pathname.slice(1).split('/') // api, outings, id, action
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(String(options.body)) : {}
  if (parts[1] === 'events') {
    const o = outings.find(x => x.calendarEventId === decodeURIComponent(parts[2]))
    return { outing: o && !(kid() && hiddenFromKid(o, kid()!)) ? copy(o) : null }
  }
  if (parts[1] === 'outing-feeds' || parts[1] === 'share') return mockFeeds(parts, method, body)
  if (parts[1] === 'outing-categories') {
    const id = parts[2] && decodeURIComponent(parts[2])
    if (method === 'GET') return copy(categories)
    if (kid()) throw new Error('Only a grown-up can change the categories.')
    if (method === 'POST') { const c = { id: crypto.randomUUID(), name: body.name, emoji: body.emoji ?? null, sort: categories.length }; categories.push(c); return copy(c) }
    if (method === 'DELETE') { categories = categories.filter(c => c.id !== id); outings.forEach(o => { if (o.categoryId === id) o.categoryId = null }); return { ok: true } }
    const c = categories.find(x => x.id === id)!
    Object.assign(c, body); categories.sort((a, b) => a.sort - b.sort); return copy(c)
  }
  const id = parts[2] && decodeURIComponent(parts[2])
  const action = parts[3]
  if (id === 'ideas') return mockIdeas()
  if (!id) {
    if (method === 'GET') return copy(outings.filter(o => !(kid() && hiddenFromKid(o, kid()!))))
    const now = new Date().toISOString()
    const o: Outing = { ...base, ...body, id: crypto.randomUUID(), addedBy: kid() ?? mock.myOwner() ?? 'm1', createdAt: now, updatedAt: now, interest: [] }
    outings.push(o); return copy(o)
  }
  const o = outings.find(x => x.id === id)
  if (!o || (kid() && hiddenFromKid(o, kid()!))) throw new Error('outing not found')
  if (method === 'GET') return copy(o)
  if (method === 'DELETE') { if (kid()) throw new Error('Only a grown-up can delete an outing.'); outings = outings.filter(x => x.id !== id); return { ok: true } }
  if (action === 'interest') {
    if (kid() && body.memberId !== kid()) throw new Error('This device can only do that for its owner.')
    o.interest = o.interest.filter(i => i.memberId !== body.memberId)
    if (body.level) o.interest.push({ memberId: body.memberId, level: body.level })
    return copy(o)
  }
  if (action === 'calendar') {
    const date = body.date ?? o.startsOn
    const cals = await mock.getCalendars()
    const cal = cals.find(c => c.id === body.calendarId) ?? cals.find(c => c.writable && c.kind === 'local') ?? cals[0]
    if (!outingCategoryId) outingCategoryId = (await mock.createCategory({ name: 'Outing', emoji: '🎟', color: '#7c3aed' })).id
    const startTime = body.startTime === undefined ? o.startTime : body.startTime
    const endTime = body.endTime === undefined ? o.endTime : body.endTime
    const at = (t: string) => new Date(`${date}T${t}:00`).toISOString()
    const ev = await mock.createEvent({
      calendarId: cal.id, title: o.title, allDay: !startTime, categoryId: outingCategoryId,
      start: startTime ? at(startTime) : date, end: startTime ? (endTime ? at(endTime) : new Date(Date.parse(at(startTime)) + 3600_000).toISOString()) : addDays(date, 1),
      location: [o.placeName, o.address].filter(Boolean).join(', ') || null, description: [o.notes, 'From Kinwall Outings'].filter(Boolean).join('\n\n'),
      memberIds: body.memberIds ?? [...new Set([...o.interest.filter(i => i.level === 'really').map(i => i.memberId), ...o.memberIds])],
    })
    o.calendarEventId = ev.id; o.calendarEventStart = ev.start
    return copy(o)
  }
  if (kid() && o.addedBy !== kid()) throw new Error('Kids can change the outings they added. Ask a grown-up to change this one.')
  Object.assign(o, body, { updatedAt: new Date().toISOString() })
  return copy(o)
}

/** GET /api/outings/ideas: the same rules as the server, over the demo's events and forecast. */
async function mockIdeas() {
  const mine = outings.filter(o => !(kid() && hiddenFromKid(o, kid()!)))
  const events = await mock.getEvents(`${addDays(today, -1)}T00:00:00Z`, `${addDays(today, 16)}T00:00:00Z`)
  const local = (iso: string) => { const d = new Date(iso); return { day: dateKey(d), m: d.getHours() * 60 + d.getMinutes() } }
  const busy: BusyStretch[] = []
  for (const e of events) {
    if (e.busy === false) continue
    if (e.allDay) { for (let d = e.start.slice(0, 10); d < e.end.slice(0, 10); d = addDays(d, 1)) busy.push({ day: d, from: 0, to: 1440 }); continue }
    const a = local(e.start), b = local(e.end)
    for (let d = a.day; d <= b.day; d = addDays(d, 1)) busy.push({ day: d, from: d === a.day ? a.m : 0, to: d === b.day ? b.m : 1440 })
  }
  const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i))
  const forecast = (mock.forecast(dates)?.days ?? []).map(d => ({ date: d.date, rainChance: d.rainChance, code: d.code, text: d.text }))
  const ideas = outingIdeas(mine, today, busy, forecast, { grownUp: !kid() })
  const named = new Set(ideas.flatMap(i => i.outingIds))
  const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  return {
    ideas, outings: copy(mine.filter(o => named.has(o.id))),
    openTime: weekendOf(today).filter(d => d >= today).flatMap(day => openStretches(day, busy).map(x => ({ day, from: clock(x.from), to: clock(x.to) }))),
    forecast: forecast.map(d => ({ date: d.date, text: d.text, rainy: rainy(d) })),
  }
}
