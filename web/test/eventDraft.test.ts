// node --test test/ (npm test). The "Add to Kinwall" Shortcut's event link (POST /api/share):
// #/calendar?draft=event&title=…&date=…&time=…&end=…&place=… opens the event sheet filled in.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eventDraft, outingExtras } from '../src/eventDraft.ts'

const q = (s: string) => new URLSearchParams(s)

test('eventDraft: a date and times start and end then (local time)', () => {
  assert.deepEqual(eventDraft(q('draft=event&title=Spring+fair&date=2027-05-08&time=10%3A00&end=14%3A00&place=Lincoln+Elementary'), '2026-10-07'),
    { title: 'Spring fair', location: 'Lincoln Elementary', allDay: false, start: '2027-05-08T10:00', end: '2027-05-08T14:00' })
  // No end: the sheet's usual hour.
  assert.deepEqual(eventDraft(q('draft=event&title=Swim&date=2027-05-08&time=18%3A00'), '2026-10-07'),
    { title: 'Swim', location: null, allDay: false, start: '2027-05-08T18:00' })
})

test('eventDraft: a date alone is all day; a time alone is today; neither leaves the times to the sheet', () => {
  assert.deepEqual(eventDraft(q('draft=event&title=Picture+day&date=2027-02-28'), '2026-10-07'),
    { title: 'Picture day', location: null, allDay: true, start: '2027-02-28', end: '2027-03-01' })
  assert.deepEqual(eventDraft(q('draft=event&title=Pickup&time=15%3A15'), '2026-10-07'),
    { title: 'Pickup', location: null, allDay: false, start: '2026-10-07T15:15' })
  assert.deepEqual(eventDraft(q('draft=event&title=Bake+sale'), '2026-10-07'), { title: 'Bake sale', location: null, allDay: false })
})

test('eventDraft: not a draft, or junk values, are ignored', () => {
  assert.equal(eventDraft(q('event=e1'), '2026-10-07'), null)
  assert.deepEqual(eventDraft(q('draft=event&date=tomorrow&time=25%3A99&end=later'), '2026-10-07'), { title: '', location: null, allDay: false })
})

test('eventDraft: notes (what to bring, how to RSVP) become the event notes', () => {
  assert.deepEqual(eventDraft(q('draft=event&title=Swim&notes=Bring+a+towel%0ARSVP+to+Sam'), '2026-10-07'),
    { title: 'Swim', location: null, description: 'Bring a towel\nRSVP to Sam', allDay: false })
})

test('outingExtras: the cost, ticket dates, ages and last day Save to Outings adds; junk is left out', () => {
  assert.deepEqual(outingExtras(q('draft=event&title=Fair&cost=1500&buyBy=2027-05-01&onSale=2027-04-01T14%3A00%3A00.000Z&ageMin=7&ageMax=10&endsOn=2027-05-10')),
    { priceCents: 1500, buyBy: '2027-05-01', ticketsOnSaleAt: '2027-04-01T14:00:00.000Z', ageMin: 7, ageMax: 10, endsOn: '2027-05-10' })
  assert.deepEqual(outingExtras(q('draft=event&cost=0')), { priceCents: 0 })
  assert.deepEqual(outingExtras(q('draft=event&cost=-5&buyBy=soon&onSale=tomorrow&ageMin=999')), {})
})
