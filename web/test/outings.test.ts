import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audienceLabel, filterChips, NO_FILTERS, placeSections, priceLabel, shownOutings, startFilters, trayRows, upcomingSections, whenLabel } from '../src/outings.ts'
import type { Outing } from '../src/types.ts'

const TODAY = '2026-10-07' // a Wednesday; the weekend is Oct 10–11
const o = (p: Partial<Outing>): Outing => ({
  id: p.title ?? 'x', title: 'x', kind: 'upcoming', categoryId: null, startsOn: null, endsOn: null, startTime: null, endTime: null, hours: null, placeName: null, address: null,
  priceCents: null, priceNote: null, audience: [], memberIds: [], ageMin: null, ageMax: null, url: null, ticketsUrl: null, ticketsOnSaleAt: null, buyBy: null, gotTickets: false,
  visitStatus: null, lastVisitedOn: null, notes: null, calendarEventId: null, calendarEventStart: null, source: 'manual', addedBy: null, archived: false,
  createdAt: '', updatedAt: '', interest: [], ...p,
})
const members = [
  { id: 'alex', name: 'Alex', grownUp: true, birthday: null },
  { id: 'maya', name: 'Maya', grownUp: false, birthday: '2018-01-15' },
  { id: 'leo', name: 'Leo', grownUp: false, birthday: '2022-01-15' },
]
const fest = o({ title: 'Fall Fest', startsOn: '2026-10-10', startTime: '10:00', endTime: '16:00', priceCents: 0, audience: ['family'], interest: [{ memberId: 'maya', level: 'really' }, { memberId: 'leo', level: 'really' }] })
const sewing = o({ title: 'Sewing class', startsOn: '2026-10-24', startTime: '13:00', priceCents: 2000, audience: ['kids'], ageMin: 7, ageMax: 10, memberIds: ['maya'], buyBy: '2026-10-20' })
const patch = o({ title: 'Pumpkin patch', startsOn: '2026-10-01', endsOn: '2026-10-31', hours: 'Fri–Sun, 9 to 5', priceCents: 800, audience: ['family'] })
const tour = o({ title: 'The Lanterns', audience: ['grownups'], ticketsOnSaleAt: '2026-10-16T14:00:00Z', interest: [{ memberId: 'alex', level: 'really' }] })
const bus = o({ title: 'Bus museum', startsOn: '2026-10-08' })
const december = o({ title: 'Lights', startsOn: '2026-12-05', audience: ['family'] })
const past = o({ title: 'Apple picking', startsOn: '2026-10-03' })
const preserve = o({ title: 'Willow Creek', kind: 'place', priceCents: 0, visitStatus: 'want', interest: [{ memberId: 'maya', level: 'really' }] })
const museum = o({ title: 'Science museum', kind: 'place', priceCents: 1200, visitStatus: 'been', lastVisitedOn: '2026-02-01' })
const all = [fest, sewing, patch, tour, bus, december, past, preserve, museum]

test('outings: when, price and who, in words', () => {
  assert.equal(whenLabel(fest, TODAY), 'Sat, 10 AM – 4 PM')
  assert.equal(whenLabel(sewing, TODAY), 'Sat, Oct 24, 1 PM')
  assert.equal(whenLabel(patch, TODAY), 'Until Oct 31 · Fri–Sun, 9 to 5')
  assert.equal(whenLabel(tour, TODAY), 'Date not announced yet')
  assert.equal(whenLabel(bus, TODAY), 'Tomorrow')
  assert.equal(whenLabel(preserve, TODAY), 'Any time')
  assert.equal(whenLabel(o({ startsOn: '2027-06-12', startTime: '19:30' }), TODAY), 'Sat, Jun 12, 2027, 7:30 PM')
  assert.deepEqual([priceLabel(fest), priceLabel(sewing), priceLabel(tour)], ['Free', '$20', null])
  assert.equal(audienceLabel(sewing, members), 'Kids 7–10 · For Maya')
  assert.equal(audienceLabel(o({ audience: ['family', 'grownups'], memberIds: ['maya', 'leo'] }), members), 'Family · Grown-ups · For Maya and Leo')
})

test('outings: Upcoming sections and Places', () => {
  const upcoming = all.filter(x => x.kind === 'upcoming' && x !== past)
  assert.deepEqual(upcomingSections(upcoming, TODAY).map(s => [s.title, s.outings.map(x => x.title)]), [
    ['This week', ['Bus museum']],
    ['This weekend · Oct 10–11', ['Fall Fest']],
    ['Later this month', ['Sewing class']],
    ['December', ['Lights']],
    ['Open now', ['Pumpkin patch']],
    ['Date not announced yet', ['The Lanterns']],
  ])
  assert.deepEqual(placeSections([museum, preserve]).map(s => [s.title, s.outings.map(x => x.title)]), [['Want to go', ['Willow Creek']], ['Been there', ['Science museum']]])
})

test("outings: filters, a kid's own device and the chips", () => {
  const titles = (list: Outing[]) => list.map(x => x.title).sort()
  assert.deepEqual(titles(shownOutings(all, 'upcoming', NO_FILTERS, members, TODAY, null)), ['Bus museum', 'Fall Fest', 'Lights', 'Pumpkin patch', 'Sewing class', 'The Lanterns'])
  assert.deepEqual(titles(shownOutings(all, 'upcoming', startFilters('maya'), members, TODAY, 'maya')), ['Fall Fest', 'Lights', 'Pumpkin patch', 'Sewing class'], "Maya's device: for her, and no grown-ups-only")
  assert.deepEqual(titles(shownOutings(all, 'upcoming', NO_FILTERS, members, TODAY, 'maya')), ['Bus museum', 'Fall Fest', 'Lights', 'Pumpkin patch', 'Sewing class'], 'grown-ups-only stays hidden with the filters cleared')
  assert.deepEqual(titles(shownOutings(all, 'upcoming', { ...NO_FILTERS, who: 'leo', boxes: ['age'] }, members, TODAY, null)), [], 'nothing for kids Leo’s age')
  assert.deepEqual(titles(shownOutings(all, 'upcoming', { ...NO_FILTERS, when: 'weekend' }, members, TODAY, null)), ['Fall Fest', 'Pumpkin patch'])
  assert.deepEqual(titles(shownOutings(all, 'upcoming', { ...NO_FILTERS, when: 'past' }, members, TODAY, null)), ['Apple picking'])
  assert.deepEqual(titles(shownOutings(all, 'upcoming', { ...NO_FILTERS, cost: '10' }, members, TODAY, null)), ['Fall Fest', 'Pumpkin patch'])
  assert.deepEqual(titles(shownOutings(all, 'upcoming', { ...NO_FILTERS, markedBy: 'really' }, members, TODAY, null)), ['Fall Fest', 'The Lanterns'])
  assert.deepEqual(titles(shownOutings(all, 'place', { ...NO_FILTERS, when: 'weekend', cost: 'free' }, members, TODAY, null)), ['Willow Creek'], "places ignore When")
  const chips = filterChips({ ...NO_FILTERS, who: 'maya', cost: 'free', markedBy: 'leo' }, members, [])
  assert.deepEqual(chips.map(c => c.label), ['For Maya, kids, family', 'Marked by Leo', 'Free'])
  assert.equal(chips[0].without.who, '')
})

test('outings: the Board tray', () => {
  const { weekend, coming } = trayRows(all, TODAY, null)
  assert.deepEqual(weekend.map(x => x.title), ['Fall Fest', 'Pumpkin patch', 'Willow Creek'])
  assert.deepEqual(coming.map(c => [c.outing.title, c.note]), [['The Lanterns', 'Tickets go on sale Fri, Oct 16'], ['Sewing class', 'Get tickets by Tue, Oct 20']])
  assert.deepEqual(trayRows(all, TODAY, 'maya').coming.map(c => c.outing.title), ['Sewing class'], "a kid's device: no grown-ups-only")
})
