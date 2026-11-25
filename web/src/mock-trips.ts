// In-memory trips and away days for VITE_MOCK only (the server: routes/trips.ts, routes/away.ts).
// The demo family's made-up trips: a summer road trip being planned (two stops, a stay vote open, a
// booked lodge), a weekend at Grandma's (a family home, nothing to book), Alex's work trip, two ideas
// and last summer's lake weekend. Places, listings and codes are invented. A kid's device
// (kinwall.demoKid) gets what the server gives it: no booking details unless a trip allows them.
import { mock } from './mock.ts'
import { dateKey } from './date.ts'
import { addDays } from './upkeep-rules.ts'
import { awayDays } from './away.ts'
import { planChecks, tripClock } from './travelContext.ts'
import type { CareArrangement, AwayChoreLine, AwayInput, AwayPeriod, AwayReview, LinkPreview, StayGroup, StayOption, Trip, TripCounts, TripItem, TripLeg, TripStop, TripSummary } from './trip-types.ts'

const today = dateKey(new Date())
const d = (n: number) => addDays(today, n)
const now = () => new Date().toISOString()
const copy = <T,>(x: T): T => structuredClone(x)
const uid = () => crypto.randomUUID()
const kid = () => mock.demoKid()
const fail = (status: number, message: string) => Object.assign(new Error(message), { status })
const grownUp = () => { if (kid()) throw fail(403, 'Only a grown-up can do that.') }

type Stored = Omit<Trip, 'counts' | 'canSeeDetails' | 'can' | 'canSeeCare' | 'canEditCare' | 'checks' | 'travelDay'> & { care: CareArrangement[] }
const base = (p: Partial<Stored> & Pick<Stored, 'id' | 'title'>): Stored => ({
  emoji: null, description: null, location: null, startDate: null, endDate: null, dateNote: null, status: 'idea', archivedAt: null, canceledAt: null,
  memberIds: [], audience: 'everyone', audienceMemberIds: [], connectedApps: false, detailsAudience: 'grownups', detailsOnWall: false, marks: [], revision: 1, createdBy: 'm1', createdAt: now(), updatedAt: now(),
  stops: [], stayGroups: [], legs: [], items: [], packingListIds: [], calendar: { span: null, items: [] }, awayPeriodIds: [], care: [], viewTimeZone: null, ...p,
})
const option = (p: Partial<StayOption> & Pick<StayOption, 'id' | 'groupId' | 'name'>): StayOption => ({
  kind: 'other', town: null, sourceUrl: null, siteName: null, imageUrl: null, cost: 'unknown', price: null, sleeps: null, notes: null, booking: 'none', bookedBy: null, addedBy: 'm1',
  fetchedAt: null, details: null, hasDetails: false, ...p,
})
const leg = (p: Partial<TripLeg> & Pick<TripLeg, 'id'>): TripLeg => ({
  mode: 'other', title: null, from: null, to: null, departDate: null, departTime: null, departTz: null, arriveDate: null, arriveTime: null, arriveTz: null, carrier: null, number: null,
  memberIds: [], booking: 'none', notes: null, sort: 0, details: null, hasDetails: false, ...p,
})
const care = (p: Partial<CareArrangement> & Pick<CareArrangement, 'id' | 'title'>): CareArrangement => ({
  kind: 'pet', helperName: null, helperContact: null, fromDate: null, toDate: null, status: 'needed', tasks: [], instructions: null, entry: null, emergency: null, sort: 0, updatedAt: now(), ...p,
})
const usd = (dollars: number, basis: 'night' | 'stay' | 'week' | 'person' | null, fees: 'included' | 'extra' | 'unknown' = 'unknown') => ({ amountMinor: dollars * 100, currency: 'USD', basis, fees, observedOn: d(-21) })

// The road trip starts 30 weeks out on a Saturday, so it stays in "Later" whatever day the demo runs.
const sat = d(210 + ((6 - new Date().getDay() + 7) % 7))
const road = { a: sat, b: addDays(sat, 4), c: addDays(sat, 7) }
let trips: Stored[] = [
  base({
    id: 'trip-road', title: 'Summer road trip', emoji: '🌊', status: 'planning', startDate: road.a, endDate: road.c, location: 'Harbor Point → Pine Ridge',
    description: 'Beach first, then the mountains. Fly home from Pine Ridge.', memberIds: ['m1', 'm2', 'm3', 'm4'], packingListIds: ['l3'],
    marks: [{ memberId: 'm3', kind: 'really' }, { memberId: 'm4', kind: 'really' }],
    stops: [
      { id: 'stop-hp', label: 'Harbor Point', town: 'Harbor Point', timezone: 'America/Chicago', arriveDate: road.a, leaveDate: road.b, notes: null, sort: 0 },
      { id: 'stop-pr', label: 'Pine Ridge', town: 'Pine Ridge', timezone: 'America/Denver', arriveDate: road.b, leaveDate: road.c, notes: null, sort: 1 },
    ],
    stayGroups: [
      { id: 'sg-hp', stopId: 'stop-hp', label: 'Harbor Point', checkIn: road.a, checkOut: road.b, chosenOptionId: null, chosenBy: null, chosenAt: null, sort: 0,
        poll: { id: 'trip-poll-hp', status: 'open', round: 1, voterIds: ['m1', 'm2', 'm3', 'm4'], options: [{ id: 'po-sea', stayId: 'st-sea' }, { id: 'po-inn', stayId: 'st-inn' }, { id: 'po-dune', stayId: 'st-dune' }],
          votes: [{ memberId: 'm1', optionId: 'po-sea' }, { memberId: 'm3', optionId: 'po-sea' }, { memberId: 'm4', optionId: 'po-dune' }] },
        options: [
          option({ id: 'st-sea', groupId: 'sg-hp', kind: 'rental', name: 'Seagrass Cottage', town: 'Harbor Point', siteName: 'Example Stays', sourceUrl: 'https://stays.example.com/listing/seagrass', cost: 'price', price: usd(212, 'night', 'extra'), sleeps: 6, notes: 'Porch, 5 minutes to the beach', fetchedAt: `${d(-21)}T15:00:00Z`, hasDetails: true, details: { address: '14 Dune Road, Harbor Point', contact: 'Host: message through the listing', arrival: 'Lockbox by the side door', confirmation: null, manageUrl: null, codes: '4182' } }),
          option({ id: 'st-inn', groupId: 'sg-hp', kind: 'hotel', name: 'Harbor Inn', town: 'Harbor Point', siteName: 'harborinn.example', sourceUrl: 'https://harborinn.example/rooms', cost: 'price', price: usd(1480, 'stay', 'included'), sleeps: 4, notes: 'Pool, breakfast', fetchedAt: `${d(-20)}T15:00:00Z` }),
          option({ id: 'st-dune', groupId: 'sg-hp', kind: 'rental', name: 'Dune House', town: 'Harbor Point', cost: 'unknown', sleeps: 8, notes: 'Leo found it. Asked the owner for a price.', addedBy: 'm2' }),
        ] },
      { id: 'sg-pr', stopId: 'stop-pr', label: 'Pine Ridge', checkIn: road.b, checkOut: road.c, chosenOptionId: 'st-lodge', chosenBy: 'm2', chosenAt: `${d(-18)}T15:00:00Z`, sort: 1, poll: null,
        options: [option({ id: 'st-lodge', groupId: 'sg-pr', kind: 'hotel', name: 'Pine Ridge Lodge', town: 'Pine Ridge', cost: 'price', price: usd(176, 'night'), booking: 'booked', bookedBy: 'm2', addedBy: 'm2', hasDetails: true, details: { address: null, contact: 'Front desk 555-010-7700', arrival: 'Check-in 4 PM', confirmation: 'PRL-58213', manageUrl: 'https://lodge.example/manage', codes: null } })] },
    ],
    legs: [
      leg({ id: 'lg-out', mode: 'flight', title: 'Fly to Harbor Point', from: 'Boston', to: 'Harbor Point', departDate: road.a, departTime: '07:05', departTz: 'America/New_York', arriveDate: road.a, arriveTime: '09:12', arriveTz: 'America/Chicago', carrier: 'Skyline Air', number: '482', memberIds: ['m1', 'm3', 'm4'], booking: 'booked', sort: 0, hasDetails: true, details: { confirmation: 'K7Q2ZP', manageUrl: null, notes: null } }),
      leg({ id: 'lg-car', mode: 'rental', title: 'Rental car', from: 'Harbor Point airport', to: 'Pine Ridge', departDate: road.a, departTime: '10:00', departTz: 'America/Chicago', arriveDate: road.c, carrier: 'Coastline Cars', memberIds: ['m1', 'm3', 'm4'], booking: 'booked', sort: 1, hasDetails: true, details: { confirmation: 'CC-30418', manageUrl: null, notes: null } }),
      leg({ id: 'lg-sam', mode: 'flight', title: 'Sam flies to Pine Ridge', from: 'Boston', to: 'Pine Ridge', departDate: road.b, departTime: '08:30', departTz: 'America/New_York', arriveDate: road.b, arriveTime: '11:05', arriveTz: 'America/Denver', memberIds: ['m2'], sort: 2 }),
      leg({ id: 'lg-drive', mode: 'drive', title: 'Harbor Point → Pine Ridge', from: 'Harbor Point', to: 'Pine Ridge', departDate: road.b, notes: 'About 3 hours. Leave after checkout.', memberIds: ['m1', 'm3', 'm4'], sort: 3 }),
      leg({ id: 'lg-home', mode: 'flight', title: 'Fly home', from: 'Pine Ridge', to: 'Boston', departDate: road.c, departTime: '16:40', departTz: 'America/Denver', arriveDate: road.c, arriveTime: '22:55', arriveTz: 'America/New_York', memberIds: ['m1', 'm2', 'm3', 'm4'], sort: 4 }),
    ],
    items: [
      { id: 'it-pools', kind: 'activity', title: 'Tide pools at North Beach', date: addDays(road.a, 1), time: '10:30', tz: 'America/Chicago', place: 'North Beach', url: null, notes: null, suggestedBy: 'm3', marks: [{ memberId: 'm3', kind: 'really' }, { memberId: 'm4', kind: 'interested' }], sort: 0 },
      { id: 'it-aquarium', kind: 'outing', refId: 'demo-aquarium', label: 'Harbor Point Aquarium', date: addDays(road.a, 1), time: '13:00', missing: false, sort: 1 },
      { id: 'it-light', kind: 'activity', title: 'Lighthouse tour', date: null, time: null, place: null, url: null, notes: null, suggestedBy: 'm2', marks: [{ memberId: 'm2', kind: 'interested' }, { memberId: 'm3', kind: 'interested' }], sort: 2 },
      { id: 'it-golf', kind: 'activity', title: 'Mini golf', date: null, time: null, place: null, url: null, notes: null, suggestedBy: 'm4', marks: [{ memberId: 'm4', kind: 'really' }], sort: 3 },
    ],
  }),
  base({
    id: 'trip-grandma', title: 'Weekend at Grandma’s', emoji: '🏡', status: 'ready', startDate: d(9), endDate: d(11), location: 'Maple Falls', memberIds: ['m1', 'm2', 'm3', 'm4'], awayPeriodIds: ['away-grandma'],
    stayGroups: [{ id: 'sg-gm', stopId: null, label: 'Grandma’s house', checkIn: d(9), checkOut: d(11), chosenOptionId: 'st-gm', chosenBy: 'm1', chosenAt: `${d(-5)}T15:00:00Z`, sort: 0, poll: null,
      options: [option({ id: 'st-gm', groupId: 'sg-gm', kind: 'family', name: 'Grandma’s house', town: 'Maple Falls', booking: 'confirmed_family', bookedBy: 'm1', hasDetails: true, details: { address: '91 Rose Avenue, Maple Falls', contact: 'Grandma: 555-010-6600', arrival: 'Spare key under the blue pot', confirmation: null, manageUrl: null, codes: null } })] }],
    care: [
      care({ id: 'care-dog', kind: 'pet', title: 'Feed and walk Biscuit', helperName: 'The neighbors at number 12', helperContact: '555-010-4400', fromDate: d(9), toDate: d(11), status: 'confirmed', sort: 0,
        tasks: [{ id: 'ct-1', text: 'Breakfast and dinner, half a scoop', done: false }, { id: 'ct-2', text: 'Walk after dinner', done: false }, { id: 'ct-3', text: 'Fresh water', done: true }],
        instructions: 'Biscuit hides under the porch when it storms. Treats are on the top shelf.', entry: 'Side door keypad: 2468', emergency: 'Vet: Maple Street Animal Clinic, 555-010-9100' }),
      care({ id: 'care-plants', kind: 'plants', title: 'Water the tomatoes', fromDate: d(10), toDate: d(10), status: 'needed', sort: 1, tasks: [{ id: 'ct-4', text: 'Back porch pots', done: false }] }),
    ],
    legs: [leg({ id: 'lg-gm', mode: 'drive', title: 'Drive to Maple Falls', from: 'Home', to: 'Maple Falls', departDate: d(9), departTime: '09:00', memberIds: ['m1', 'm2', 'm3', 'm4'], sort: 0 })],
  }),
  base({
    id: 'trip-work', title: 'Alex’s work trip', emoji: '💼', status: 'ready', startDate: d(16), endDate: d(18), location: 'Denver', memberIds: ['m1'],
    legs: [leg({ id: 'lg-work', mode: 'flight', title: 'Flight to Denver', from: 'Boston', to: 'Denver', departDate: d(16), departTime: '07:05', departTz: 'America/New_York', arriveDate: d(16), arriveTime: '09:40', arriveTz: 'America/Denver', booking: 'booked', memberIds: ['m1'], hasDetails: true, details: { confirmation: 'ZX81QM', manageUrl: null, notes: null } })],
  }),
  // Under way now, in another time zone: Today on the trip follows Lisbon's clock.
  base({
    id: 'trip-city', title: 'City weekend', emoji: '🏙️', status: 'ready', startDate: d(-1), endDate: d(2), location: 'Lisbon', memberIds: ['m1', 'm2', 'm3', 'm4'],
    stops: [{ id: 'stop-lis', label: 'Lisbon', town: 'Lisbon', timezone: 'Europe/Lisbon', arriveDate: d(-1), leaveDate: d(2), notes: null, sort: 0 }],
    stayGroups: [{ id: 'sg-lis', stopId: 'stop-lis', label: 'Lisbon', checkIn: d(-1), checkOut: d(2), chosenOptionId: 'st-lis', chosenBy: 'm2', chosenAt: `${d(-30)}T15:00:00Z`, sort: 0, poll: null,
      options: [option({ id: 'st-lis', groupId: 'sg-lis', kind: 'rental', name: 'Tiled flat by the river', town: 'Lisbon', booking: 'booked', bookedBy: 'm2', hasDetails: true, details: { address: '8 River Lane, Lisbon', contact: null, arrival: 'Key in the lockbox', confirmation: 'RV-2207', manageUrl: null, codes: '7731' } })] }],
    legs: [leg({ id: 'lg-lis-home', mode: 'flight', title: 'Fly home', from: 'Lisbon', to: 'Boston', departDate: d(2), departTime: '11:30', departTz: 'Europe/Lisbon', arriveDate: d(2), arriveTime: '14:10', arriveTz: 'America/New_York', memberIds: ['m1', 'm2', 'm3', 'm4'], booking: 'booked', sort: 0 })],
    items: [
      { id: 'it-tram', kind: 'activity', title: 'Old tram up the hill', date: d(0), time: '10:00', tz: 'Europe/Lisbon', place: 'Tram stop', url: null, notes: null, suggestedBy: 'm4', marks: [], sort: 0 },
      { id: 'it-tiles', kind: 'activity', title: 'Tile museum', date: d(1), time: '14:00', tz: 'Europe/Lisbon', place: null, url: null, notes: null, suggestedBy: 'm3', marks: [], sort: 1 },
    ],
    care: [care({ id: 'care-house', kind: 'home', title: 'Check on the house', helperName: 'Grandpa', fromDate: d(-1), toDate: d(2), status: 'asked', sort: 0, tasks: [{ id: 'ct-5', text: 'Bring in the mail', done: false }], entry: 'He has a key' })],
  }),
  base({ id: 'trip-ski', title: 'Ski weekend', emoji: '⛷️', dateNote: 'Sometime in February', marks: [{ memberId: 'm3', kind: 'really' }, { memberId: 'm4', kind: 'really' }, { memberId: 'm2', kind: 'interested' }] }),
  base({ id: 'trip-canyon', title: 'Grand Canyon someday', emoji: '🏜️', location: 'Arizona', marks: [{ memberId: 'm1', kind: 'really' }, { memberId: 'm4', kind: 'interested' }] }),
  base({ id: 'trip-lake', title: 'Lake weekend', emoji: '🛶', status: 'ready', startDate: d(-100), endDate: d(-98), location: 'Clear Lake', memberIds: ['m1', 'm2', 'm3', 'm4'] }),
]

let away: AwayPeriod[] = [
  { id: 'away-grandma', label: 'Weekend at Grandma’s', tripId: 'trip-grandma', tripTitle: 'Weekend at Grandma’s', revision: 1, createdBy: 'm1', updatedAt: now(),
    people: ['m1', 'm2', 'm3', 'm4'].map(memberId => ({ memberId, startDate: d(9), endDate: d(11), leaveDayAway: true, returnDayAway: false })), handoffs: [], keepDue: [] },
  { id: 'away-camp', label: 'Band camp', tripId: null, tripTitle: null, revision: 1, createdBy: 'm1', updatedAt: now(),
    people: [{ memberId: 'm3', startDate: d(40), endDate: d(42), leaveDayAway: true, returnDayAway: false }],
    handoffs: [{ id: 'ho-dog', choreId: 'ch2', choreTitle: 'Feed the dog', choreEmoji: '🐕', fromMemberId: 'm3', toMemberId: 'm4', startDate: d(40), endDate: d(41) }], keepDue: [{ choreId: 'ch9', memberId: 'm3' }] },
]

/** What this device may see and do (the server decides the same from the device). */
function project(x: Stored): Trip {
  const k = kid()
  const canSeeDetails = !k || x.detailsAudience === 'everyone'
  const hide = <T extends { details: unknown; hasDetails: boolean }>(o: T): T => canSeeDetails ? o : { ...o, details: null }
  const options = x.stayGroups.flatMap(g => g.options)
  const counts: TripCounts = {
    stops: x.stops.length, stayGroups: x.stayGroups.length, staysChosen: x.stayGroups.filter(g => g.chosenOptionId).length,
    staysBooked: x.stayGroups.filter(g => options.some(o => o.id === g.chosenOptionId && (o.booking === 'booked' || o.booking === 'confirmed_family'))).length,
    legs: x.legs.length, legsBooked: x.legs.filter(l => l.booking === 'booked').length, openVotes: x.stayGroups.filter(g => g.poll?.status === 'open').length,
    planned: x.items.filter(i => i.date).length, ideas: x.items.filter(i => !i.date).length,
  }
  const homeZone = Intl.DateTimeFormat().resolvedOptions().timeZone // the demo family's zone is this browser's
  // Home and pet care: grown-ups' own devices read it, full access changes it; never a kid's.
  const seesCare = !k || mock.membersNow().find(m => m.id === k)?.grownUp === true
  return copy({
    ...x, counts, canSeeDetails,
    care: seesCare ? x.care : [], canSeeCare: seesCare, canEditCare: !k, careUnavailable: false,
    checks: planChecks(x), travelDay: tripClock(x, Date.now(), homeZone),
    can: { edit: !k, addStays: !k, choose: !k, suggest: true, vote: !k || x.memberIds.includes(k) },
    stayGroups: x.stayGroups.map(g => ({ ...g, options: g.options.map(o => hide({ ...o, hasDetails: !!o.details && Object.values(o.details).some(Boolean) })) })),
    legs: x.legs.map(l => hide({ ...l, hasDetails: !!l.details && Object.values(l.details).some(Boolean) })),
  })
}
const summary = (x: Stored): TripSummary => {
  const { stops: _s, stayGroups: _g, legs: _l, items: _i, packingListIds: _p, calendar: _c, awayPeriodIds: _a, canSeeDetails: _d, can: _can, care: _care, canSeeCare: _sc, canEditCare: _ec, checks: _ch, viewTimeZone: _v, ...rest } = project(x)
  return rest
}
const find = (id: string) => { const x = trips.find(t => t.id === id); if (!x) throw fail(404, 'Trip not found'); return x }
const touch = (x: Stored, revision?: number) => {
  if (revision !== undefined && revision !== x.revision) throw fail(409, 'Someone changed this trip. It has been read again; try once more.')
  x.revision++; x.updatedAt = now()
}
const clean = <T extends object>(body: T) => { const { revision: _r, ...rest } = body as T & { revision?: number }; return rest }

function linkPreview(url: string): LinkPreview {
  const u = new URL(url)
  const base = { sourceUrl: url, finalUrl: url, siteName: u.hostname.replace(/^www\./, ''), fetchedAt: now(), sleeps: null }
  // The demo can't read pages: links with "blocked" in them act like a site that refuses.
  if (/blocked/.test(url)) return { ...base, ok: false, reason: 'blocked', name: null, town: null, imageUrl: null, price: null }
  const words = u.pathname.split('/').filter(Boolean).pop()?.replace(/[-_]+/g, ' ') ?? ''
  return { ...base, ok: true, reason: null, name: words ? words.replace(/\b\w/g, c => c.toUpperCase()) : null, town: null, imageUrl: `https://${u.hostname}/images/listing.jpg`, price: null }
}

function review(draft: AwayInput): AwayReview {
  const chores = mock.choresNow()
  const line = (memberId: string, c: { id: string; title: string; emoji: string }, dates: string[], toMemberId?: string): AwayChoreLine => ({ memberId, choreId: c.id, title: c.title, emoji: c.emoji, dates, ...(toMemberId && { toMemberId }) })
  const paused: AwayChoreLine[] = [], handoffs: AwayChoreLine[] = [], keepDue: AwayChoreLine[] = []
  for (const p of draft.people) {
    const r = awayDays(p)
    if (!r) continue
    const dates: string[] = []
    for (let x = r.from; x <= r.to; x = addDays(x, 1)) dates.push(x)
    for (const c of chores.filter(c => c.memberId === p.memberId && c.active && !c.ongoing && (c.rrule || (c.dueDate && c.dueDate >= r.from && c.dueDate <= r.to)))) {
      const h = draft.handoffs.find(h => h.choreId === c.id && h.fromMemberId === p.memberId)
      if (h) handoffs.push(line(p.memberId, c, dates.filter(x => x >= h.startDate && x <= h.endDate), h.toMemberId))
      else if (draft.keepDue.some(k => k.choreId === c.id && k.memberId === p.memberId)) keepDue.push(line(p.memberId, c, dates))
      else paused.push(line(p.memberId, c, c.rrule ? dates : [c.dueDate!]))
    }
  }
  const everyone = mock.membersNow().every(m => draft.people.some(p => p.memberId === m.id && awayDays(p)))
  return {
    token: `demo-${Date.now()}`, paused, handoffs, keepDue,
    conflicts: [
      ...(everyone ? [{ kind: 'everyone-away', text: 'Everyone is away. Chores that must still happen, like feeding a pet, need someone outside the family.', blocking: false }] : []),
      ...draft.handoffs.filter(h => draft.people.some(p => p.memberId === h.toMemberId && awayDays(p) && awayDays(p)!.from <= h.endDate && h.startDate <= awayDays(p)!.to))
        .map(h => ({ kind: 'recipient-away', text: `${mock.membersNow().find(m => m.id === h.toMemberId)?.name ?? 'Someone'} is away then and can’t take a chore.`, blocking: true, choreId: h.choreId })),
      { kind: 'upkeep', text: 'Change the furnace filter comes due while Alex is away. Its due date stays.', blocking: false },
    ],
    continues: [
      { kind: 'medicines', text: 'Medicines and their reminders keep going.' },
      { kind: 'bedtime', text: 'Bedtime cutoffs stay as they are.' },
      { kind: 'calendar', text: 'Calendar events stay, and school calendars and records aren’t changed.' },
      { kind: 'library', text: 'Library due dates stay.' },
    ],
  }
}

export async function mockTripRequest(path: string, options: RequestInit): Promise<unknown> {
  const url = new URL(path, 'https://demo.invalid/')
  const [, area, a, b, c] = url.pathname.slice(1).split('/').map(decodeURIComponent)
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(String(options.body)) : {}

  if (area === 'polls') { // a stay vote: the existing poll routes, for trip polls
    const g = trips.flatMap(x => x.stayGroups.map(gr => ({ x, gr }))).find(({ gr }) => gr.poll?.id === a)
    if (!g || !g.gr.poll) throw fail(404, 'Poll not found')
    const poll = g.gr.poll
    if (b === 'vote') {
      const who = kid() ?? body.memberId
      if (!poll.voterIds.includes(who)) throw fail(403, 'Only people going on this trip vote.')
      if (poll.status !== 'open') throw fail(409, 'Voting has ended.')
      poll.votes = poll.votes.filter(v => v.memberId !== who)
      // The real poll takes its own option ids, never a stay id (mock-trips keeps them apart on purpose).
      if (body.optionId && !poll.options?.some(o => o.id === body.optionId)) throw fail(400, 'That isn’t a choice in this vote.')
      if (body.optionId) poll.votes.push({ memberId: who, optionId: body.optionId })
    }
    if (b === 'close') { grownUp(); poll.status = 'closed' }
    touch(g.x)
    return { id: poll.id }
  }

  if (area === 'away') {
    if (a === 'preview') return review(body)
    if (!a) {
      if (method === 'GET') return copy(away)
      grownUp()
      const p: AwayPeriod = { ...body, id: uid(), tripTitle: trips.find(x => x.id === body.tripId)?.title ?? null, revision: 1, createdBy: mock.myOwner(), updatedAt: now(), handoffs: body.handoffs.map((h: AwayPeriod['handoffs'][number]) => ({ ...h, id: uid(), choreTitle: mock.choresNow().find(c => c.id === h.choreId)?.title, choreEmoji: mock.choresNow().find(c => c.id === h.choreId)?.emoji })) }
      away.push(p)
      if (p.tripId) find(p.tripId).awayPeriodIds.push(p.id)
      return copy(p)
    }
    const p = away.find(x => x.id === a)
    if (!p) throw fail(404, 'Away days not found')
    if (method === 'GET') return copy(p)
    grownUp()
    if (method === 'DELETE') {
      if (Number(url.searchParams.get('revision')) !== p.revision) throw fail(409, 'These away days changed. Check them again.')
      // Days already gone stay excused; only what's ahead goes.
      p.people = p.people.map(x => x.startDate < today ? { ...x, endDate: x.endDate < today ? x.endDate : addDays(today, -1) } : null).filter((x): x is AwayPeriod['people'][number] => !!x)
      if (!p.people.length) { away = away.filter(x => x !== p); trips.forEach(x => { x.awayPeriodIds = x.awayPeriodIds.filter(id => id !== a) }) }
      else p.revision++
      return { ok: true }
    }
    if (body.revision !== p.revision) throw fail(409, 'These away days changed. Check them again.')
    Object.assign(p, clean(body), { revision: p.revision + 1, updatedAt: now(), handoffs: body.handoffs.map((h: AwayPeriod['handoffs'][number]) => ({ ...h, id: h.id ?? uid(), choreTitle: mock.choresNow().find(c => c.id === h.choreId)?.title, choreEmoji: mock.choresNow().find(c => c.id === h.choreId)?.emoji })) })
    return copy(p)
  }

  // trips
  if (!a) {
    // Like the server: put-away trips only with ?archived=1.
    if (method === 'GET') return trips.filter(x => !x.archivedAt || url.searchParams.get('archived') === '1').map(summary)
    grownUp()
    const x = base({ ...body, id: uid(), title: body.title, createdBy: mock.myOwner() })
    trips.push(x); return project(x)
  }
  if (a === 'links') return trips.flatMap(x => [
    ...x.items.filter(i => i.kind !== 'activity').map(i => ({ kind: i.kind, refId: (i as { refId: string }).refId, tripId: x.id, title: x.title, emoji: x.emoji })),
    ...[x.calendar.span, ...x.calendar.items.map(i => i.link)].filter(l => l?.eventId && l.state === 'added').map(l => ({ kind: 'event' as const, refId: l!.eventId!, tripId: x.id, title: x.title, emoji: x.emoji })),
  ])
  if (a === 'link-preview') { grownUp(); return linkPreview(body.url) }
  if (a === 'stays' && c === 'image') throw fail(404, 'No picture in the demo')
  const x = find(a)
  if (!b) {
    if (method === 'GET') return project(x)
    grownUp()
    if (method === 'DELETE') { trips = trips.filter(t => t !== x); away.forEach(p => { if (p.tripId === x.id) p.tripId = null }); return { ok: true } }
    if (body.detailsAudience === 'grownups') body.detailsOnWall = false
    touch(x, body.revision)
    // The real API's shape exactly: archivedAt/canceledAt are an ISO time or null; anything else is refused.
    const input = clean(body) as Record<string, unknown>
    if ('archived' in input || 'canceled' in input) throw fail(400, 'Unknown field: use archivedAt or canceledAt.')
    Object.assign(x, input)
    return project(x)
  }
  if (b === 'items' && url.pathname.endsWith('/marks')) {
    const it = x.items.find(i => i.id === c)
    if (!it || it.kind !== 'activity') throw fail(404, 'Not found')
    const who = kid() ?? body.memberId
    it.marks = it.marks.filter(m => m.memberId !== who)
    if (body.kind) it.marks.push({ memberId: who, kind: body.kind })
    touch(x); return project(x)
  }
  if (b === 'marks') {
    const who = kid() ?? body.memberId
    x.marks = x.marks.filter(m => m.memberId !== who)
    if (body.kind) x.marks.push({ memberId: who, kind: body.kind })
    touch(x); return project(x)
  }
  if (b === 'date-change' && c === 'preview') {
    grownUp()
    const outside = (date: string | null) => !!date && ((body.startDate && date < body.startDate) || (body.endDate && date > body.endDate))
    return {
      away: away.filter(p => p.tripId === x.id).map(p => ({ id: p.id, title: p.label, date: null })),
      events: x.calendar.span ? [{ id: x.calendar.span.eventId ?? 'span', title: x.title, date: x.startDate }] : [],
      meals: x.items.filter(i => i.kind === 'meal').map(i => ({ id: i.id, title: i.kind === 'activity' ? i.title : i.label, date: i.date })),
      bookedLegs: x.legs.filter(l => l.booking === 'booked' && outside(l.departDate)).map(l => ({ id: l.id, title: l.title, date: l.departDate })),
      bookedStays: x.stayGroups.flatMap(g => g.options.filter(o => o.id === g.chosenOptionId && o.booking === 'booked' && outside(g.checkIn)).map(o => ({ id: o.id, title: o.name, date: g.checkIn }))),
      care: x.care.filter(c => c.status !== 'canceled').map(c => ({ id: c.id, title: c.title, date: c.fromDate })),
    }
  }
  if (b === 'calendar') {
    grownUp(); touch(x, body.revision)
    const link = { eventId: `demo-event-${uid().slice(0, 8)}`, calendarId: body.calendarId, state: 'added' as const, error: null }
    if (body.span) x.calendar.span = { ...link }
    for (const [kind, ids] of [['leg', body.legs], ['stay', body.stays], ['item', body.items]] as const) for (const id of ids as string[]) {
      if (!x.calendar.items.some(i => i.kind === kind && i.id === id)) x.calendar.items.push({ kind, id, link: { ...link, eventId: `demo-event-${uid().slice(0, 8)}` } })
    }
    return project(x)
  }
  if (b === 'stay-groups' && c && (url.pathname.endsWith('/vote') || url.pathname.endsWith('/choose'))) {
    grownUp(); touch(x, body.revision)
    const g = x.stayGroups.find(gr => gr.id === c)
    if (!g) throw fail(404, 'Not found')
    if (url.pathname.endsWith('/vote')) {
      if (g.options.length < 2) throw fail(400, 'A vote needs at least two places to choose from.')
      if (g.poll?.status === 'open' && !body.restart) throw fail(409, 'A vote is already open.')
      g.poll = { id: `trip-poll-${uid().slice(0, 8)}`, status: 'open', round: (g.poll?.round ?? 0) + 1, voterIds: [...x.memberIds], votes: [], options: g.options.map(o => ({ id: `po-${uid().slice(0, 8)}`, stayId: o.id })) }
    } else {
      if (body.optionId && !g.options.some(o => o.id === body.optionId)) throw fail(400, 'That place isn’t in this stay.')
      g.chosenOptionId = body.optionId; g.chosenBy = body.optionId ? mock.myOwner() ?? 'm1' : null; g.chosenAt = body.optionId ? now() : null
    }
    return project(x)
  }
  if (b === 'care') {
    grownUp()
    touch(x, method === 'DELETE' ? Number(url.searchParams.get('revision')) : body.revision)
    const input = clean(body) as Partial<CareArrangement>
    if (method === 'POST') { x.care.push(care({ title: '', ...input, id: uid() })); return project(x) }
    const it = x.care.find(i => i.id === c)
    if (!it) throw fail(404, 'Not found')
    if (method === 'DELETE') x.care = x.care.filter(i => i !== it)
    else Object.assign(it, input, { updatedAt: now() })
    return project(x)
  }
  // nested parts: stops, stay-groups, stays, legs, items
  const list: { id: string }[] = b === 'stops' ? x.stops : b === 'stay-groups' ? x.stayGroups : b === 'legs' ? x.legs : b === 'items' ? x.items : x.stayGroups.flatMap(g => g.options)
  const suggestion = b === 'items' && method === 'POST' && body.kind === 'activity'
  if (!suggestion) grownUp()
  touch(x, method === 'DELETE' ? Number(url.searchParams.get('revision')) : body.revision)
  const input = clean(body) as Record<string, unknown>
  if (method === 'POST') {
    const id = uid()
    if (b === 'stops') x.stops.push({ id, label: '', town: null, timezone: null, arriveDate: null, leaveDate: null, notes: null, sort: x.stops.length, ...input } as TripStop)
    if (b === 'stay-groups') x.stayGroups.push({ id, stopId: null, label: '', checkIn: null, checkOut: null, poll: null, chosenOptionId: null, chosenBy: null, chosenAt: null, sort: x.stayGroups.length, options: [], ...input } as StayGroup)
    if (b === 'legs') x.legs.push(leg({ ...input, id, sort: x.legs.length } as TripLeg))
    if (b === 'items') x.items.push(input.kind === 'activity'
      ? { id, kind: 'activity', title: '', date: null, time: null, place: null, url: null, notes: null, marks: [], sort: x.items.length, ...input, suggestedBy: kid() ?? mock.myOwner() ?? 'm1' } as TripItem
      : { id, label: '', date: null, time: null, missing: false, sort: x.items.length, ...input } as TripItem)
    if (b === 'stays') {
      const g = x.stayGroups.find(gr => gr.id === input.groupId)
      if (!g) throw fail(400, 'Pick a stay for it.')
      if (g.poll?.status === 'open') throw fail(409, 'A vote is open for this stay. Start a new vote to add a place.')
      g.options.push(option({ ...input, id, addedBy: mock.myOwner() ?? 'm1' } as StayOption))
    }
    return project(x)
  }
  const item = list.find(i => i.id === c)
  if (!item) throw fail(404, 'Not found')
  if (method === 'DELETE') {
    if (b === 'stops') x.stops = x.stops.filter(i => i !== item)
    if (b === 'stay-groups') x.stayGroups = x.stayGroups.filter(i => i !== item)
    if (b === 'legs') x.legs = x.legs.filter(i => i !== item)
    if (b === 'items') x.items = x.items.filter(i => i !== item)
    if (b === 'stays') x.stayGroups.forEach(g => { if (g.options.includes(item as StayOption)) { if (g.poll?.status === 'open') throw fail(409, 'A vote is open for this stay. End it or start a new vote first.'); g.options = g.options.filter(o => o !== item); if (g.chosenOptionId === item.id) g.chosenOptionId = null } })
    return project(x)
  }
  if (b === 'stays' && 'details' in input) input.details = { ...(item as StayOption).details, ...(input.details as object) }
  if (b === 'legs' && 'details' in input) input.details = { ...(item as TripLeg).details, ...(input.details as object) }
  Object.assign(item, input)
  return project(x)
}
