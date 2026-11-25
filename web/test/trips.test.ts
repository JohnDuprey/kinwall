import { test } from 'node:test'
import assert from 'node:assert/strict'
import { viewerCheck, careSummary, tripSections as sections, checkLine, clockLine, tripToday, costLabel, dayPlan, legClock, nextUp, nights, priceLabel, sortableByPrice, tally, tripDayLabel, tripPhase, tripSections, tripWhen } from '../src/trips.ts'
import type { StayGroup, StayOption, Trip, TripLeg, TripSummary } from '../src/trip-types.ts'

const TODAY = '2026-11-23'
const counts = { stops: 0, stayGroups: 0, staysChosen: 0, staysBooked: 0, legs: 0, legsBooked: 0, openVotes: 0, planned: 0, ideas: 0 }
const trip = (p: Partial<Trip>): Trip => ({
  id: p.title ?? 'x', title: 'x', emoji: null, description: null, location: null, startDate: null, endDate: null, dateNote: null, status: 'planning',
  archivedAt: null, canceledAt: null, memberIds: [], detailsAudience: 'grownups', detailsOnWall: false, marks: [], counts, revision: 1, createdBy: null, updatedAt: '',
  stops: [], stayGroups: [], legs: [], items: [], packingListIds: [], calendar: { span: null, items: [] }, awayPeriodIds: [], canSeeDetails: false, ...p,
})
const option = (p: Partial<StayOption>): StayOption => ({
  id: p.name ?? 'o', groupId: 'g', kind: 'hotel', name: 'o', town: null, sourceUrl: null, siteName: null, imageUrl: null, cost: 'unknown', price: null, sleeps: null, notes: null,
  booking: 'none', bookedBy: null, addedBy: null, fetchedAt: null, details: null, hasDetails: false, ...p,
})
const group = (p: Partial<StayGroup>): StayGroup => ({ id: 'g', stopId: null, label: 'Stay', checkIn: null, checkOut: null, poll: null, chosenOptionId: null, chosenBy: null, chosenAt: null, sort: 0, options: [], ...p })
const leg = (p: Partial<TripLeg>): TripLeg => ({
  id: 'l', mode: 'flight', title: null, from: null, to: null, departDate: null, departTime: null, departTz: null, arriveDate: null, arriveTime: null, arriveTz: null,
  carrier: null, number: null, memberIds: [], booking: 'none', notes: null, sort: 0, details: null, hasDetails: false, ...p,
})

test('tripSections: ideas, upcoming soonest first with undated last, past; closed trips left out', () => {
  const list: TripSummary[] = [
    trip({ title: 'Summer', startDate: '2027-07-10', endDate: '2027-07-17' }),
    trip({ title: 'Thanksgiving', startDate: '2026-11-25', endDate: '2026-11-29', status: 'ready' }),
    trip({ title: 'Undated plan', dateNote: 'Next spring' }),
    trip({ title: 'Ski', status: 'idea', dateNote: 'Sometime in February' }),
    trip({ title: 'Lake', startDate: '2026-08-14', endDate: '2026-08-16', status: 'ready' }),
    trip({ title: 'Old idea', status: 'idea', startDate: '2025-01-01' }),
    trip({ title: 'Gone', archivedAt: '2026-01-01T00:00:00Z' }),
    trip({ title: 'Called off', canceledAt: '2026-01-01T00:00:00Z' }),
  ]
  const s = tripSections(list, TODAY)
  assert.deepEqual(s.upcoming.map(x => x.title), ['Thanksgiving', 'Summer', 'Undated plan'])
  assert.deepEqual(s.ideas.map(x => x.title), ['Ski'])
  assert.deepEqual(s.past.map(x => x.title), ['Lake', 'Old idea'])
})

test('tripPhase: underway between the first and last day, past after, nothing without dates', () => {
  assert.equal(tripPhase(trip({ startDate: '2026-11-20', endDate: '2026-11-25' }), TODAY), 'underway')
  assert.equal(tripPhase(trip({ startDate: TODAY }), TODAY), 'underway')
  assert.equal(tripPhase(trip({ startDate: '2026-11-01', endDate: '2026-11-22' }), TODAY), 'past')
  assert.equal(tripPhase(trip({ startDate: '2026-12-01' }), TODAY), 'soon')
  assert.equal(tripPhase(trip({ dateNote: 'next summer' }), TODAY), null)
})

test('tripWhen: a range, one day, the family’s own words, or no dates', () => {
  assert.equal(tripWhen(trip({ startDate: '2027-07-10', endDate: '2027-07-17' })), 'Sat, Jul 10 – Sat, Jul 17')
  assert.equal(tripWhen(trip({ startDate: '2027-07-10' })), 'Sat, Jul 10')
  assert.equal(tripWhen(trip({ startDate: '2027-07-10', endDate: '2027-07-10' })), 'Sat, Jul 10')
  assert.equal(tripWhen(trip({ dateNote: 'Sometime in February' })), 'Sometime in February')
  assert.equal(tripWhen(trip({})), 'No dates yet')
})

test('tripDayLabel: "Day 3 of 8" while underway', () => {
  assert.equal(tripDayLabel(trip({ startDate: '2026-11-21', endDate: '2026-11-28' }), TODAY), 'Day 3 of 8')
  assert.equal(tripDayLabel(trip({ startDate: '2026-11-24', endDate: '2026-11-28' }), TODAY), null)
})

test('nights: checkout is the morning you leave; missing or backwards dates give none', () => {
  assert.equal(nights('2027-07-10', '2027-07-14'), 4)
  assert.equal(nights('2027-07-10', '2027-07-10'), 0)
  assert.equal(nights('2027-07-10', null), null)
  assert.equal(nights('2027-07-14', '2027-07-10'), null)
})

test('priceLabel: amount in the currency’s own units, with its basis and fees', () => {
  assert.equal(priceLabel({ amountMinor: 21200, currency: 'USD', basis: 'night', fees: 'unknown', observedOn: null }), '$212 a night')
  assert.equal(priceLabel({ amountMinor: 148050, currency: 'USD', basis: 'stay', fees: 'extra', observedOn: null }), '$1,480.50 for the stay, before fees')
  assert.equal(priceLabel({ amountMinor: 9000, currency: 'JPY', basis: 'person', fees: 'included', observedOn: null }), '¥9,000 a person, fees included')
  assert.equal(priceLabel({ amountMinor: 50000, currency: 'EUR', basis: null, fees: 'unknown', observedOn: null }), '€500')
})

test('costLabel: not set is never free', () => {
  assert.equal(costLabel(option({ cost: 'unknown' })), 'Cost not set yet')
  assert.equal(costLabel(option({ cost: 'free' })), 'Free')
  assert.equal(costLabel(option({ cost: 'contribution' })), 'We’ll offer to chip in')
  assert.equal(costLabel(option({ cost: 'price', price: { amountMinor: 17600, currency: 'USD', basis: 'night', fees: 'unknown', observedOn: null } })), '$176 a night')
  assert.equal(costLabel(option({ cost: 'price', price: null })), 'Cost not set yet')
})

test('sortableByPrice: only like with like (same currency and basis, two or more)', () => {
  const p = (amountMinor: number, basis: 'night' | 'stay', currency = 'USD') => option({ cost: 'price', price: { amountMinor, currency, basis, fees: 'unknown', observedOn: null } })
  assert.equal(sortableByPrice([p(100, 'night'), p(200, 'night')]), true)
  assert.equal(sortableByPrice([p(100, 'night'), p(200, 'stay')]), false)
  assert.equal(sortableByPrice([p(100, 'night'), p(200, 'night', 'EUR')]), false)
  assert.equal(sortableByPrice([p(100, 'night'), option({ cost: 'free' })]), false)
  assert.equal(sortableByPrice([p(100, 'night')]), false)
})

test('tally: who voted out of who can, leaders only with votes, ties named as ties', () => {
  const g = (votes: { memberId: string; optionId: string }[]) => group({ options: [option({ id: 'a' }), option({ id: 'b' })], poll: { id: 'p', status: 'open', round: 1, votes, voterIds: ['alex', 'sam', 'maya', 'leo'] } })
  assert.deepEqual(tally(g([])), { voted: 0, of: 4, counts: { a: 0, b: 0 }, leaders: [], tie: false })
  assert.deepEqual(tally(g([{ memberId: 'alex', optionId: 'a' }, { memberId: 'maya', optionId: 'a' }, { memberId: 'leo', optionId: 'b' }])), { voted: 3, of: 4, counts: { a: 2, b: 1 }, leaders: ['a'], tie: false })
  assert.deepEqual(tally(g([{ memberId: 'alex', optionId: 'a' }, { memberId: 'leo', optionId: 'b' }])).tie, true)
  // A vote from someone no longer going isn't counted.
  assert.equal(tally(g([{ memberId: 'grandma', optionId: 'a' }])).voted, 0)
  assert.equal(tally(group({})), null)
})

test('legClock: each end in its own zone, "+1" for a next-day arrival, nothing made up when unknown', () => {
  const c = legClock(leg({ departDate: '2027-07-10', departTime: '07:05', departTz: 'America/New_York', arriveDate: '2027-07-10', arriveTime: '09:12', arriveTz: 'America/Chicago' }))
  assert.equal(c.depart, '7:05 AM EDT')
  assert.equal(c.arrive, '9:12 AM CDT')
  assert.equal(c.plusDays, 0)
  const red = legClock(leg({ departDate: '2027-07-10', departTime: '22:30', departTz: 'America/Los_Angeles', arriveDate: '2027-07-11', arriveTime: '06:40', arriveTz: 'America/New_York' }))
  assert.equal(red.plusDays, 1)
  // Across the date line, arriving "before" leaving on the clock.
  const back = legClock(leg({ departDate: '2027-07-12', departTime: '10:00', departTz: 'Asia/Tokyo', arriveDate: '2027-07-12', arriveTime: '07:00', arriveTz: 'America/Los_Angeles' }))
  assert.equal(back.plusDays, 0)
  // No zone: the clock as typed, labeled so nobody reads it as home time.
  const loose = legClock(leg({ departDate: '2027-07-10', departTime: '07:05' }))
  assert.equal(loose.depart, '7:05 AM (local time)')
  assert.equal(loose.arrive, null)
  assert.equal(legClock(leg({})).depart, null)
})

test('dayPlan: one day per date with legs, check-in and -out from their records, and items; undated items set aside', () => {
  const t = trip({
    startDate: '2027-07-10', endDate: '2027-07-11',
    legs: [leg({ id: 'fly', departDate: '2027-07-10', departTime: '07:05' }), leg({ id: 'later', departDate: '2027-08-01' })],
    stayGroups: [group({ id: 'hp', label: 'Harbor Point', checkIn: '2027-07-10', checkOut: '2027-07-12', chosenOptionId: 'sea', options: [option({ id: 'sea', name: 'Seagrass Cottage' })] })],
    items: [
      { id: 'pools', kind: 'activity', title: 'Tide pools', date: '2027-07-11', time: '10:30', place: null, url: null, notes: null, suggestedBy: 'maya', marks: [], sort: 0 },
      { id: 'pan', kind: 'meal', refId: 'm1', label: 'Pancakes', date: '2027-07-11', time: '08:30', missing: false, sort: 1 },
      { id: 'golf', kind: 'activity', title: 'Mini golf', date: null, time: null, place: null, url: null, notes: null, suggestedBy: 'leo', marks: [], sort: 2 },
    ],
  })
  const plan = dayPlan(t)
  assert.deepEqual(plan.days.map(d => d.date), ['2027-07-10', '2027-07-11'])
  assert.deepEqual(plan.days[0].entries.map(e => `${e.kind}:${e.id}`), ['leg:fly', 'checkin:hp'])
  assert.deepEqual(plan.days[1].entries.map(e => `${e.kind}:${e.id}`), ['item:pan', 'item:pools'])
  assert.deepEqual(plan.ideas.map(i => i.id), ['golf'])
  // Things outside the trip's dates still show, on their own day, rather than vanish.
  assert.deepEqual(plan.outside.map(e => `${e.kind}:${e.id}`), ['checkout:hp', 'leg:later'])
})

test('stay votes: read by stay whether a vote names the poll option or the stay; write the poll option', async () => {
  const { pollOptionFor, stayOfVote } = await import('../src/trips.ts')
  const poll = { options: [{ id: 'po-a', stayId: 'a' }, { id: 'po-b', stayId: 'b' }] }
  assert.equal(stayOfVote(poll, 'po-a'), 'a')
  assert.equal(stayOfVote(poll, 'b'), 'b')
  assert.equal(pollOptionFor(poll, 'b'), 'po-b')
  const g = group({ options: [option({ id: 'a' }), option({ id: 'b' })], poll: { id: 'p', status: 'open', voterIds: ['alex', 'maya'], options: poll.options, votes: [{ memberId: 'alex', optionId: 'po-a' }, { memberId: 'maya', optionId: 'a' }] } })
  assert.deepEqual(tally(g)!.counts, { a: 2, b: 0 })
})

test('changedFields: only what differs is sent; null and missing are the same', async () => {
  const { changedFields } = await import('../src/trips.ts')
  const saved = { name: 'Seagrass', booking: 'none', price: { amountMinor: 100, currency: 'USD' }, notes: null }
  assert.deepEqual(changedFields(saved, { name: 'Seagrass', booking: 'booked', price: { amountMinor: 100, currency: 'USD' }, notes: undefined as unknown as null }), { booking: 'booked' })
  assert.deepEqual(changedFields(saved, { price: { amountMinor: 120, currency: 'USD' } }), { price: { amountMinor: 120, currency: 'USD' } })
  assert.deepEqual(changedFields(null, { name: 'x' }), { name: 'x' })
})

test('trip loads: never another trip’s data; 403/404 drop what was shown, other failures keep it stale', async () => {
  const { tripFailed, tripFor, tripLoaded } = await import('../src/trips.ts')
  const a = tripLoaded('a', { id: 'a', secret: 'door 4182' })
  assert.equal(tripFor(a, 'b').trip, null, 'a different id shows nothing of the old trip')
  assert.equal(tripFailed(a, 'a', { status: 404 }).trip, null)
  assert.equal(tripFailed(a, 'a', { status: 403 }).trip, null, 'no longer allowed: booking details go at once')
  const offline = tripFailed(a, 'a', { status: 0 })
  assert.equal(offline.trip?.id, 'a'); assert.equal(offline.stale, true)
  assert.equal(tripFailed(a, 'b', { status: 0 }).trip, null, 'a failure for another id never borrows the old trip')
  assert.equal(tripFailed(null, 'a', new Error('x')).stale, false)
})

test('legClock: the zone name is the one in effect at that local time, even on a daylight-saving day', () => {
  const at = (time: string) => legClock(leg({ departDate: '2027-03-14', departTime: time, departTz: 'America/New_York' })).depart
  assert.equal(at('01:30'), '1:30 AM EST')
  assert.equal(at('03:30'), '3:30 AM EDT')
  assert.equal(legClock(leg({ departDate: '2027-11-07', departTime: '23:00', departTz: 'America/New_York' })).depart, '11:00 PM EST')
})

test('reorderStops: swap with a neighbor and renumber only what changed; ends stay put', async () => {
  const { reorderStops } = await import('../src/trips.ts')
  const stops = [{ id: 'a', sort: 0 }, { id: 'b', sort: 0 }, { id: 'c', sort: 5 }]
  assert.deepEqual(reorderStops(stops, 'c', -1), [{ id: 'c', sort: 1 }, { id: 'b', sort: 2 }])
  assert.deepEqual(reorderStops(stops, 'a', -1), [])
  assert.deepEqual(reorderStops(stops, 'c', 1), [])
})

test('toggledAt: Not this time and Put away send the moment or null, as the API takes them', async () => {
  const { toggledAt } = await import('../src/trips.ts')
  const now = new Date('2026-11-24T10:00:00Z')
  assert.deepEqual(toggledAt('canceledAt', null, now), { canceledAt: '2026-11-24T10:00:00.000Z' })
  assert.deepEqual(toggledAt('canceledAt', '2026-11-01T00:00:00Z', now), { canceledAt: null })
  assert.deepEqual(toggledAt('archivedAt', null, now), { archivedAt: '2026-11-24T10:00:00.000Z' })
  assert.ok(!('canceled' in toggledAt('canceledAt', null, now)), 'never the old true/false field')
})

test('nextUp: exact times compare as instants in their own zones, not as clock strings', () => {
  // 8:30 in Denver (14:30 UTC) is after 9:00 in Boston (14:00 UTC), though "08:30" < "09:00".
  const t1 = trip({ startDate: '2027-07-10', endDate: '2027-07-12', legs: [
    leg({ id: 'denver', departDate: '2027-07-10', departTime: '08:30', departTz: 'America/Denver' }),
    leg({ id: 'boston', departDate: '2027-07-10', departTime: '09:00', departTz: 'America/New_York' }),
  ] })
  const entries = dayPlan(t1).days.flatMap(d => d.entries)
  const clock = { today: '2027-07-10', timeZone: 'America/New_York' }
  assert.equal(nextUp(entries, Date.parse('2027-07-10T12:00:00Z'), clock)?.id, 'boston')
  // Boston's has left (14:00 UTC); Denver's hasn't.
  assert.equal(nextUp(entries, Date.parse('2027-07-10T14:10:00Z'), clock)?.id, 'denver')
  assert.equal(nextUp(entries, Date.parse('2027-07-10T15:00:00Z'), clock), null)
})

test('nextUp: an untimed thing is ahead all of its day on the trip clock; earlier days are done', () => {
  const t1 = trip({ startDate: '2027-07-10', endDate: '2027-07-12', stayGroups: [group({ id: 'g', checkIn: '2027-07-10', checkOut: '2027-07-12' })] })
  const entries = dayPlan(t1).days.flatMap(d => d.entries)
  // Late at night in Tokyo the check-in day is still today there, though it's tomorrow in UTC.
  const tokyo = { today: '2027-07-10', timeZone: 'Asia/Tokyo' }
  assert.equal(nextUp(entries, Date.parse('2027-07-10T14:30:00Z'), tokyo)?.kind, 'checkin')
  assert.equal(nextUp(entries, Date.parse('2027-07-11T01:00:00Z'), { today: '2027-07-11', timeZone: 'Asia/Tokyo' })?.kind, 'checkout')
})

test('checkLine: gentle words from the code and the trip\'s own names, never a raw server string', () => {
  const t1 = trip({ stayGroups: [group({ id: 'g1', label: 'Harbor Point' }), group({ id: 'g2', label: 'Pine Ridge' })], legs: [leg({ id: 'l1', title: 'Fly home' })] })
  const nightsLine = checkLine({ code: 'uncovered_nights', from: '2027-07-12', to: '2027-07-14', ids: [], part: 'stays', count: 2 }, t1)
  assert.equal(nightsLine.title, 'No place to stay yet for 2 nights')
  assert.match(nightsLine.sub, /Jul 12 – .*Jul 13/) // the last night, not the morning after
  assert.match(nightsLine.sub, /red-eye/)
  assert.equal(checkLine({ code: 'overlapping_stays', from: '2027-07-12', to: '2027-07-13', ids: ['g1', 'g2'], part: 'stays' }, t1).title, 'Places to stay overlap: Harbor Point and Pine Ridge')
  assert.match(checkLine({ code: 'overlapping_stays', from: null, to: null, ids: ['g1', 'g2'], part: 'stays' }, t1).sub, /splits up/)
  assert.equal(checkLine({ code: 'travel_backwards', from: null, to: null, ids: ['l1'], part: 'travel' }, t1).title, 'Arrives before it leaves: Fly home')
  // An id this device can't name still reads as a sentence.
  assert.equal(checkLine({ code: 'outside_trip', from: '2027-08-01', to: null, ids: ['gone'], part: 'plan' }, t1).title, 'Outside the trip’s dates: something')
})

test('careSummary: what\'s confirmed and what still needs someone; canceled ones don\'t count', () => {
  assert.equal(careSummary([]), 'Pets, plants and the house while you’re away')
  assert.equal(careSummary([{ status: 'confirmed' }, { status: 'asked' }, { status: 'canceled' }]), '1 confirmed · 1 still needs someone')
  assert.equal(careSummary([{ status: 'needed' }, { status: 'needed' }]), '2 still need someone')
  // Some couldn't be opened: never "nothing set up", and no count of what's missing.
  assert.equal(careSummary([], true), 'Some can’t be opened right now')
  assert.equal(careSummary([{ status: 'confirmed' }], true), 'Some can’t be opened right now · 1 confirmed')
})

test('clockLine and tripToday: a known place\'s clock by name; home time says it\'s home time and why', () => {
  const at = new Date('2027-07-11T01:30:00Z') // still Jul 10 in Denver, Jul 11 in Boston
  const stops = [{ id: 's', label: 'Pine Ridge', town: null, timezone: 'America/Denver', arriveDate: '2027-07-10', leaveDate: '2027-07-12', notes: null, sort: 0 }]
  assert.match(clockLine({ today: '2027-07-10', timeZone: 'America/Denver', source: 'stop', stopId: 's' }, { stops, legs: [] }, at, 'America/New_York'), /^Today follows Pine Ridge time · 7:30\sPM$/)
  assert.match(clockLine({ today: '2027-07-11', timeZone: 'America/New_York', source: 'home', stopId: null }, { stops, legs: [] }, at, 'America/New_York'), /^Home time \(New York.*\): the plan doesn’t say/)
  assert.match(clockLine({ today: '2027-07-11', timeZone: 'America/New_York', source: 'home', stopId: null }, { stops: [], legs: [] }, at, 'America/New_York'), /add stops with their time zones/)
  // The list and the Board use the server's travel day only when it follows a place on the trip.
  assert.equal(tripToday({ travelDay: { today: '2027-07-10', timeZone: 'America/Denver', source: 'stop', stopId: 's' } }, '2027-07-11'), '2027-07-10')
  assert.equal(tripToday({ travelDay: { today: '2027-07-09', timeZone: 'UTC', source: 'home', stopId: null } }, '2027-07-11'), '2027-07-11')
  assert.equal(tripToday({}, '2027-07-11'), '2027-07-11')
})

test('tripSections: each trip by its own today, so a trip still under way where the family is isn\'t Past', () => {
  // Home (Boston) is already Nov 25; in Honolulu it's still Nov 24, the trip's last day.
  const hawaii = trip({ title: 'Hawaii', startDate: '2026-11-20', endDate: '2026-11-24', travelDay: { today: '2026-11-24', timeZone: 'Pacific/Honolulu', source: 'stop', stopId: 's' } })
  const homeOnly = trip({ title: 'Lake', startDate: '2026-11-20', endDate: '2026-11-24', travelDay: { today: '2026-11-25', timeZone: 'America/New_York', source: 'home', stopId: null } })
  const s = sections([hawaii, homeOnly], '2026-11-25')
  assert.deepEqual(s.upcoming.map(x => x.title), ['Hawaii'])
  assert.deepEqual(s.past.map(x => x.title), ['Lake'])
})

test('viewerCheck: an answer is dropped once the sign-in changed, in this tab or another', () => {
  let key = 'grown-up', switches = 0
  const now = () => `${switches}|${key}`
  const save = viewerCheck(now)
  assert.equal(save(), true)
  key = 'kid' // signed in as a kid in this tab: no storage event, the key alone tells
  assert.equal(save(), false)
  const read = viewerCheck(now)
  switches++ // another tab: the storage event bumps the count, even if it lands on the same key again
  assert.equal(read(), false)
})
