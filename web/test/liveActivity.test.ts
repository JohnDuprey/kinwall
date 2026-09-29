// node --test test/ (npm test). What the iPhone app's Live Activities show (liveActivity.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookingActivity, leaveByActivity, shoppingActivity, timerName } from '../src/liveActivity.ts'
import type { EventInstance } from '../src/types.ts'

test('cooking: the soonest running timer, +N more, then "done" once none is running', () => {
  const steps = ['Rinse', null, 'Simmer']
  const t = (label: string, step: number, endsAt: number, done = false) => ({ label, step, endsAt, done })
  assert.equal(cookingActivity('Tuesday Tacos', [], () => null), null)
  const two = cookingActivity('Tuesday Tacos', [t('Rice · 15 min', 2, 9000), t('5 min', 1, 4000)], i => steps[i])
  assert.deepEqual(two, { recipe: 'Tuesday Tacos', timer: '5 min', step: 'Step 2', endsAt: 4000, done: false, more: 1 })
  const rang = cookingActivity('Tuesday Tacos', [t('Rice · 15 min', 2, 9000), t('5 min', 1, 4000, true)], i => steps[i])
  assert.deepEqual([rang?.timer, rang?.step, rang?.more], ['Rice', 'Step 3 · Simmer', 0], 'a rung timer waits behind a running one')
  const done = cookingActivity('Tuesday Tacos', [t('Rice · 15 min', 2, 9000, true)], i => steps[i])
  assert.deepEqual([done?.timer, done?.done], ['Rice', true])
  assert.equal(timerName('Sauce · 10 min'), 'Sauce')
})

test('shopping: what\'s left and the next items in the store\'s walking order', () => {
  const i = (id: string, title: string, aisle: string | null, done = false, store: string | null = 'Shaws') => ({ id, title, aisle, done, store, places: [] })
  const items = [i('1', 'Ice cream', 'Frozen'), i('2', 'Milk', 'Dairy'), i('3', 'Apples', 'Produce', true), i('4', 'Bread', 'Bakery'), i('5', 'Stamps', null, false, 'Post office'), i('6', 'Batteries', null, false, null)]
  const a = shoppingActivity('l1', 'Shaws', items, new Map([['Shaws', ['Produce', 'Dairy', 'Bakery', 'Frozen']]]))
  assert.deepEqual([a.store, a.left, a.next], ['Shaws', 4, { id: '2', title: 'Milk', aisle: 'Dairy' }])
  assert.deepEqual(a.upcoming.map(x => x.title), ['Milk', 'Bread', 'Ice cream', 'Batteries'], 'no aisle known last; other stores left out')
  const all = shoppingActivity('l1', '*', items.map(x => ({ ...x, done: true })), new Map())
  assert.deepEqual([all.store, all.left, all.next], ['Any store', 0, null])
})

const ev = (id: string, title: string, start: string, extra: Partial<EventInstance> = {}): EventInstance =>
  ({ id, calendarId: 'c', title, start, end: start, allDay: false, location: null, description: null, memberIds: [], color: '#000', rrule: null, occurrenceStart: null, readOnly: false, seriesId: null, memberScope: 'none', categoryId: null, categorySource: null, reminders: null, travelMinutes: null, leaveAt: null, remindBeforeLeave: false, ...extra } as EventInstance)

test('leave by: from the first transition warning until the event starts; the soonest one', () => {
  const sam = { id: 'm2', name: 'Sam Doe', transitionReminders: { on: true, minutes: [10], repeat: { every: 5, within: 30 }, leaveBy: true } }
  const t = (iso: string) => Date.parse(iso)
  const time = (iso: string) => new Date(iso).toISOString().slice(11, 16)
  const soccer = ev('e1', 'Soccer practice', '2030-03-04T16:00:00Z', { memberIds: ['m2'], leaveAt: '2030-03-04T15:40:00Z', travelMinutes: 20 })
  const piano = ev('e2', 'Piano', '2030-03-04T17:00:00Z', { memberIds: ['m3'], leaveAt: '2030-03-04T16:45:00Z' })
  assert.equal(leaveByActivity([soccer, piano], sam, t('2030-03-04T15:09:00Z'), time), null, 'before the first warning (30 min)')
  const a = leaveByActivity([soccer, piano], sam, t('2030-03-04T15:22:00Z'), time)!
  assert.deepEqual([a.activity, a.prep, a.at, a.endsAt], ['leaveBy:e1@2030-03-04T16:00:00.000Z', false, '2030-03-04T15:40:00.000Z', '2030-03-04T16:00:00.000Z'])
  assert.ok(a.headline.includes('Soccer practice') && a.headline.includes('15:40') && !/\d+ min/.test(a.headline), a.headline)
  assert.match(a.urgent, /now/)
  assert.equal(leaveByActivity([soccer], sam, t('2030-03-04T16:00:00Z'), time), null, 'ends when it starts')
  assert.equal(leaveByActivity([soccer], { ...sam, transitionReminders: { ...sam.transitionReminders, on: false } }, t('2030-03-04T15:30:00Z'), time), null)
  assert.equal(leaveByActivity([soccer], { ...sam, transitionReminders: { ...sam.transitionReminders, leaveBy: false } }, t('2030-03-04T15:30:00Z'), time), null)
  assert.equal(leaveByActivity([piano], sam, t('2030-03-04T16:30:00Z'), time), null, 'not Sam\'s')
})

test('start prep by: a meal\'s event, for its cook; a cooking event stays a few minutes past its start', () => {
  const leo = { id: 'm4', name: 'Leo', transitionReminders: { on: true, minutes: [15], repeat: null, leaveBy: false } }
  const time = (iso: string) => new Date(iso).toISOString().slice(11, 16)
  const tacos = ev('e3', 'Dinner · Tuesday Tacos', '2030-03-04T18:00:00Z', { memberIds: ['m1', 'm4'], prepAt: '2030-03-04T17:15:00Z', cookId: 'm4' })
  const a = leaveByActivity([tacos], leo, Date.parse('2030-03-04T17:05:00Z'), time, true)!
  assert.deepEqual([a.prep, a.headline, a.urgent], [true, 'Start prep for Dinner · Tuesday Tacos at 17:15', 'Start prep for Dinner · Tuesday Tacos now'], 'low stimulation: plain lines')
  assert.equal(leaveByActivity([tacos], { ...leo, id: 'm1' }, Date.parse('2030-03-04T17:05:00Z'), time), null, 'Alex eats; Leo cooks')
  const cooking = ev('e4', 'Lunch · Soup', '2030-03-04T11:00:00Z', { prepAt: '2030-03-04T11:00:00Z' })
  assert.equal(leaveByActivity([cooking], leo, Date.parse('2030-03-04T11:04:00Z'), time)?.endsAt, '2030-03-04T11:05:00.000Z')
})
