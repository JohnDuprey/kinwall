// In-memory Home upkeep for VITE_MOCK only (the server: routes/upkeep.ts). The demo family's house
// (all made up): Alex changed the furnace filter in July, Sam's van is due an oil change, Leo tests
// the smoke alarms for points, the gutters come round in spring and fall.
import { mock } from './mock.ts'
import { dateKey } from './date.ts'
import { addDays, nextDue, scheduledDue, statusOf } from './upkeep-rules.ts'
import type { UpkeepArea, UpkeepEntry, UpkeepJob, UpkeepStarter, UpkeepThing } from './types.ts'

const today = dateKey(new Date())
const kid = () => mock.demoKid()
const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const stamp = (d: string) => `${d}T18:00:00.000Z`

let areas: UpkeepArea[] = [
  ['ua-heating', 'Heating & cooling', '🌡'], ['ua-water', 'Water & plumbing', '🚰'], ['ua-kitchen', 'Kitchen & laundry', '🧺'], ['ua-safety', 'Safety', '🧯'],
  ['ua-outside', 'Outside & yard', '🌳'], ['ua-cars', 'Cars & bikes', '🚗'], ['ua-pets', 'Pets', '🐾'],
].map(([id, name, emoji], sort) => ({ id, name, emoji, sort }))

const thingBase: Omit<UpkeepThing, 'id' | 'name'> = {
  emoji: null, areaId: null, room: null, brand: null, model: null, serial: null, partNotes: null, boughtOn: null, priceCents: null, warrantyUntil: null, manualUrl: null,
  contactId: null, notes: null, archived: false, createdAt: stamp(addDays(today, -400)), updatedAt: stamp(addDays(today, -400)), files: [],
}
let things: UpkeepThing[] = [
  { ...thingBase, id: 'demo-furnace', name: 'Furnace', emoji: '🔥', areaId: 'ua-heating', room: 'Basement', brand: 'Northwind', model: 'NW-80', serial: 'NW80-55312', partNotes: 'Filter 16x25x1, MERV 8', boughtOn: addDays(today, -1500), warrantyUntil: addDays(today, 1800) },
  { ...thingBase, id: 'demo-dishwasher', name: 'Dishwasher', emoji: '🍽️', areaId: 'ua-kitchen', room: 'Kitchen', brand: 'Brightline', model: 'BL-300', priceCents: 64900, boughtOn: addDays(today, -340), warrantyUntil: addDays(today, 25) },
  { ...thingBase, id: 'demo-van', name: 'Blue van', emoji: '🚐', areaId: 'ua-cars', room: 'Driveway', brand: 'Harbor', model: 'Voyager', partNotes: '0W-20 synthetic, 5 quarts' },
  { ...thingBase, id: 'demo-alarms', name: 'Smoke and CO alarms', emoji: '🚨', areaId: 'ua-safety', room: 'Every floor', partNotes: '9V batteries, 6 of them' },
]

const jobBase: Omit<UpkeepJob, 'id' | 'title' | 'nextDue' | 'status' | 'lastDone'> = {
  emoji: null, thingId: null, areaId: null, repeatKind: 'after', every: 3, unit: 'month', onMonths: [], onDay: null, startOn: null, dueOn: null, headsUpDays: 7,
  snoozedUntil: null, skippedUntil: null, memberId: null, contactId: null, usualCostCents: null, steps: [], supplies: [], suppliesListId: null, suppliesDays: 7, chorePoints: null,
  handedChoreId: null, calendarEventId: null, calendarEventStart: null, wallVisible: true, libraryKey: null, archived: false, createdAt: stamp(addDays(today, -400)), updatedAt: stamp(addDays(today, -400)),
}
type Stored = Omit<UpkeepJob, 'nextDue' | 'status' | 'lastDone'>
let jobs: Stored[] = [
  { ...jobBase, id: 'demo-filter', title: 'Change the furnace filter', emoji: '🌬️', thingId: 'demo-furnace', areaId: 'ua-heating', every: 3, unit: 'month', memberId: 'm1', usualCostCents: 1800, steps: ['Turn the furnace off', 'Slide the old filter out', 'Arrow on the new one points at the furnace'], supplies: [{ name: 'Furnace filter 16x25x1' }], libraryKey: 'hvac-filter' },
  { ...jobBase, id: 'demo-oil', title: 'Oil change', emoji: '🛢️', thingId: 'demo-van', areaId: 'ua-cars', every: 6, unit: 'month', memberId: 'm2', headsUpDays: 14, usualCostCents: 5400, libraryKey: 'oil-change' },
  { ...jobBase, id: 'demo-smoke', title: 'Test the smoke alarms', emoji: '🚨', thingId: 'demo-alarms', areaId: 'ua-safety', every: 1, unit: 'month', memberId: 'm4', chorePoints: 5, headsUpDays: 3, steps: ['Press and hold the test button on each one', 'Tell a grown-up if one stays quiet'], libraryKey: 'smoke-test' },
  { ...jobBase, id: 'demo-gutters', title: 'Clean the gutters', emoji: '🍂', areaId: 'ua-outside', repeatKind: 'on', onMonths: [4, 10], onDay: 15, headsUpDays: 14, libraryKey: 'gutters' },
  { ...jobBase, id: 'demo-dryer', title: 'Clean the dryer vent', emoji: '🌀', areaId: 'ua-kitchen', every: 1, unit: 'year', startOn: addDays(today, 40), libraryKey: 'dryer-vent' },
]
const entryBase = (id: string, jobId: string, title: string, doneOn: string, p: Partial<UpkeepEntry> = {}): UpkeepEntry => ({
  id, jobId, thingId: jobs.find(j => j.id === jobId)?.thingId ?? null, title, doneOn, memberId: null, contactId: null, costCents: null, reading: null, readingUnit: null, notes: null,
  choreId: null, createdBy: null, createdAt: stamp(doneOn), files: [], ...p,
})
let log: UpkeepEntry[] = [
  entryBase('demo-log-1', 'demo-filter', 'Change the furnace filter', addDays(today, -95), { memberId: 'm1', costCents: 1800 }),
  entryBase('demo-log-2', 'demo-oil', 'Oil change', addDays(today, -175), { memberId: 'm2', costCents: 5400, reading: 48210, readingUnit: 'mi', notes: 'Synthetic. Wipers next time.' }),
  entryBase('demo-log-3', 'demo-smoke', 'Test the smoke alarms', addDays(today, -26), { memberId: 'm4' }),
  entryBase('demo-log-4', 'demo-gutters', 'Clean the gutters', addDays(today, -190), { memberId: 'm1', notes: 'Downspout by the garage was clogged.' }),
  entryBase('demo-log-5', 'demo-filter', 'Change the furnace filter', addDays(today, -190), { memberId: 'm1', costCents: 1800 }),
]

const STARTERS: UpkeepStarter[] = [
  { key: 'hvac-filter', title: 'Change the furnace or AC filter', emoji: '🌬️', areaId: 'ua-heating', repeatKind: 'after', every: 3, unit: 'month', onMonths: [], onDay: null, supplies: ['Furnace filter'] },
  { key: 'smoke-batteries', title: 'Replace the smoke alarm batteries', emoji: '🔋', areaId: 'ua-safety', repeatKind: 'on', every: null, unit: null, onMonths: [11], onDay: 1, supplies: ['9V batteries'] },
  { key: 'water-heater', title: 'Flush the water heater', emoji: '🚿', areaId: 'ua-water', repeatKind: 'after', every: 1, unit: 'year', onMonths: [], onDay: null, supplies: [] },
  { key: 'fridge-filter', title: 'Change the fridge water filter', emoji: '🧊', areaId: 'ua-kitchen', repeatKind: 'after', every: 6, unit: 'month', onMonths: [], onDay: null, supplies: ['Fridge water filter'] },
  { key: 'tire-rotation', title: 'Rotate the tires', emoji: '🛞', areaId: 'ua-cars', repeatKind: 'after', every: 6, unit: 'month', onMonths: [], onDay: null, supplies: [] },
  { key: 'extinguisher', title: 'Check the fire extinguisher', emoji: '🧯', areaId: 'ua-safety', repeatKind: 'after', every: 1, unit: 'year', onMonths: [], onDay: null, supplies: [] },
]

function shown(j: Stored): UpkeepJob {
  const last = log.filter(e => e.jobId === j.id).sort((a, b) => b.doneOn.localeCompare(a.doneOn))[0]
  const facts = { ...j, createdOn: j.createdAt.slice(0, 10) }
  const due = j.archived ? null : nextDue(facts, last?.doneOn ?? null)
  const out = { ...j, nextDue: due, status: statusOf(due, today, j.headsUpDays), lastDone: last ? { id: last.id, doneOn: last.doneOn, memberId: last.memberId } : null }
  return kid() ? { ...out, usualCostCents: null, contactId: null, supplies: [], suppliesListId: null } : out
}
const visible = (j: Stored) => !kid() || j.memberId === kid()
const allShown = () => jobs.filter(visible).map(shown).sort((a, b) => (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999') || a.title.localeCompare(b.title))
const plainThing = (x: UpkeepThing): UpkeepThing => kid() ? { ...x, brand: null, model: null, serial: null, partNotes: null, boughtOn: null, priceCents: null, warrantyUntil: null, manualUrl: null, contactId: null, notes: null, files: [] } : x
const grownUp = () => { if (kid()) throw new Error('Only a grown-up can do that.') }

export async function mockUpkeepRequest(path: string, options: RequestInit): Promise<unknown> {
  const url = new URL(path, 'https://demo.invalid/')
  const parts = url.pathname.slice(1).split('/') // api, upkeep, kind, id, action
  const method = options.method ?? 'GET'
  const body = typeof options.body === 'string' && options.body ? JSON.parse(options.body) : {}
  const kind = parts[2], id = parts[3] && decodeURIComponent(parts[3]), action = parts[4]
  const now = new Date().toISOString()
  if (kind === 'areas') {
    if (method === 'GET') return copy(areas)
    grownUp()
    if (method === 'POST') { const a = { id: crypto.randomUUID(), name: body.name, emoji: body.emoji ?? null, sort: areas.length }; areas.push(a); return copy(a) }
    if (method === 'DELETE') { areas = areas.filter(a => a.id !== id); return { ok: true } }
    Object.assign(areas.find(a => a.id === id)!, body); return copy(areas.find(a => a.id === id))
  }
  if (kind === 'starters') {
    grownUp()
    const used = new Set(jobs.map(j => j.libraryKey))
    if (method === 'GET') return copy(STARTERS.filter(s => !used.has(s.key)))
    const added = STARTERS.filter(s => (body.keys as string[]).includes(s.key) && !used.has(s.key)).map(s => ({ ...jobBase, id: crypto.randomUUID(), title: s.title, emoji: s.emoji, areaId: s.areaId, repeatKind: s.repeatKind, every: s.every, unit: s.unit, onMonths: s.onMonths, onDay: s.onDay, supplies: s.supplies.map(name => ({ name })), libraryKey: s.key, createdAt: now, updatedAt: now }))
    jobs.push(...added); return added.map(shown)
  }
  if (kind === 'files') throw new Error('Files aren’t kept in the demo.')
  if (kind === 'log') {
    if (method === 'GET') {
      const f = url.searchParams
      return copy(log.filter(e => (!kid() || e.memberId === kid()) && (!f.get('job') || e.jobId === f.get('job')) && (!f.get('thing') || e.thingId === f.get('thing')) && (!f.get('year') || e.doneOn.startsWith(f.get('year')!))
        && (!f.get('q') || `${e.title} ${e.notes ?? ''}`.toLowerCase().includes(f.get('q')!.toLowerCase()))).sort((a, b) => b.doneOn.localeCompare(a.doneOn))
        .map(e => kid() ? { ...e, costCents: null, reading: null, readingUnit: null, notes: null, contactId: null } : e))
    }
    if (method === 'DELETE') { log = log.filter(e => e.id !== id); return { ok: true } }
    grownUp(); Object.assign(log.find(e => e.id === id)!, body); return copy(log.find(e => e.id === id))
  }
  if (kind === 'things') {
    if (method === 'GET' && !id) return copy(things.filter(x => url.searchParams.get('archived') === 'all' || !x.archived).map(plainThing))
    if (method === 'GET') { const x = things.find(y => y.id === id); if (!x) throw new Error('thing not found'); return copy(plainThing(x)) }
    grownUp()
    if (method === 'POST') { const x = { ...thingBase, ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now, files: [] }; things.push(x); return copy(x) }
    if (method === 'DELETE') { things = things.filter(x => x.id !== id); jobs.forEach(j => { if (j.thingId === id) j.thingId = null }); return { ok: true } }
    const x = things.find(y => y.id === id)!
    Object.assign(x, body, { updatedAt: now })
    if (body.archived !== undefined) jobs.forEach(j => { if (j.thingId === id) j.archived = body.archived })
    return copy(x)
  }
  // jobs
  if (!id) {
    if (method === 'GET') {
      const status = url.searchParams.get('status')?.split(',')
      const archived = url.searchParams.get('archived') === 'true'
      return copy(allShown().filter(j => j.archived === archived && (!status || status.includes(j.status))))
    }
    grownUp()
    const j: Stored = { ...jobBase, ...body, id: crypto.randomUUID(), createdAt: now, updatedAt: now }
    jobs.push(j); return copy(shown(j))
  }
  const j = jobs.find(x => x.id === id)
  if (!j || !visible(j)) throw new Error('job not found')
  if (method === 'GET') return copy(shown(j))
  if (action === 'done') {
    const e = entryBase(crypto.randomUUID(), j.id, j.title, body.doneOn ?? today, { memberId: kid() ?? body.memberId ?? mock.myOwner() ?? null, createdAt: now, ...(kid() ? {} : { costCents: body.costCents ?? null, reading: body.reading ?? null, readingUnit: body.reading != null ? body.readingUnit ?? 'mi' : null, notes: body.notes || null }) })
    log.push(e); j.snoozedUntil = null; j.skippedUntil = null
    return copy({ entry: e, job: shown(j) })
  }
  grownUp()
  if (action === 'snooze') { j.snoozedUntil = body.until; return copy(shown(j)) }
  if (action === 'skip') {
    const last = log.filter(e => e.jobId === j.id).sort((a, b) => b.doneOn.localeCompare(a.doneOn))[0]
    j.skippedUntil = scheduledDue({ ...j, createdOn: j.createdAt.slice(0, 10) }, last?.doneOn ?? null); j.snoozedUntil = null; return copy(shown(j))
  }
  if (action === 'calendar') { j.calendarEventId = `demo-event-${j.id}`; j.calendarEventStart = body.date ?? shown(j).nextDue; return copy(shown(j)) }
  if (method === 'DELETE') { jobs = jobs.filter(x => x.id !== id); log.forEach(e => { if (e.jobId === id) e.jobId = null }); return { ok: true } }
  Object.assign(j, body, { updatedAt: now }); return copy(shown(j))
}
