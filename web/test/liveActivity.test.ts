// node --test test/ (npm test). What the iPhone app's Live Activities show (liveActivity.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookingActivity, leaveByActivity, medicationActivity, shoppingActivity, timerName } from '../src/liveActivity.ts'
import { rememberNudge, type NudgeSeen } from '../src/nudges.ts'
import type { DueDose, EventInstance } from '../src/types.ts'

test('cooking: the soonest running timer, +N more, then "done" once none is running', () => {
  const steps = ['Rinse', null, 'Simmer']
  const t = (label: string, step: number, endsAt: number, done = false) => ({ label, step, endsAt, done })
  assert.equal(cookingActivity('Tuesday Tacos', [], () => null), null)
  const two = cookingActivity('Tuesday Tacos', [t('Rice · 15 min', 2, 9000), t('5 min', 1, 4000)], i => steps[i])
  assert.deepEqual(two, { recipe: 'Tuesday Tacos', timer: '5 min', step: 'Step 2', endsAt: 4000, done: false, more: 1, alarms: [
    { at: 4000, title: "Time's up: 5 min", body: 'Tuesday Tacos · Step 2' },
    { at: 9000, title: "Time's up: Rice", body: 'Tuesday Tacos · Step 3 · Simmer' },
  ] })
  const rang = cookingActivity('Tuesday Tacos', [t('Rice · 15 min', 2, 9000), t('5 min', 1, 4000, true)], i => steps[i])
  assert.deepEqual([rang?.timer, rang?.step, rang?.more], ['Rice', 'Step 3 · Simmer', 0], 'a rung timer waits behind a running one')
  const done = cookingActivity('Tuesday Tacos', [t('Rice · 15 min', 2, 9000, true)], i => steps[i])
  assert.deepEqual([done?.timer, done?.done], ['Rice', true])
  assert.equal(timerName('Sauce · 10 min'), 'Sauce')
  const paused = cookingActivity('Tuesday Tacos', [{ ...t('Rice · 15 min', 2, 9000), paused: true }, t('5 min', 1, 4000)], i => steps[i])
  assert.deepEqual([paused?.timer, paused?.more, paused?.alarms.length], ['5 min', 0, 1], 'a paused timer is not shown and does not ring')
  assert.equal(cookingActivity('Tuesday Tacos', [{ ...t('Rice · 15 min', 2, 9000), paused: true }], i => steps[i]), null, 'only paused: nothing on the Lock Screen')
})

test('shopping: what\'s left and the next items in the store\'s walking order', () => {
  const i = (id: string, title: string, aisle: string | null, done = false, store: string | null = 'Shaws') => ({ id, title, aisle, done, store, places: [] })
  const items = [i('1', 'Ice cream', 'Frozen'), i('2', 'Milk', 'Dairy'), i('3', 'Apples', 'Produce', true), i('4', 'Bread', 'Bakery'), i('5', 'Stamps', null, false, 'Post office'), i('6', 'Batteries', null, false, null)]
  const a = shoppingActivity('l1', 'Shaws', items, new Map([['Shaws', ['Produce', 'Dairy', 'Bakery', 'Frozen']]]))
  assert.deepEqual([a.store, a.left, a.next], ['Shaws', 4, { id: '2', title: 'Milk', aisle: 'Dairy' }])
  assert.deepEqual(a.upcoming.map(x => x.title), ['Milk', 'Bread', 'Ice cream', 'Batteries'], 'no aisle known last; other stores left out')
  const rev = shoppingActivity('l1', 'Shaws', items, new Map([['Shaws', ['Produce', 'Dairy', 'Bakery', 'Frozen']]]), [], true)
  assert.deepEqual(rev.upcoming.map(x => x.title), ['Ice cream', 'Bread', 'Milk', 'Batteries'], 'reversed: aisles backwards, no aisle known still last')
  assert.equal(rev.left, 4)
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
  assert.equal(leaveByActivity([{ ...soccer, busy: false }], sam, t('2030-03-04T15:30:00Z'), time), null, 'shown as free: nobody has to leave')
})

test('start prep by: a meal\'s event, for its cook; a cooking event stays a few minutes past its start', () => {
  const leo = { id: 'm4', name: 'Leo', transitionReminders: { on: true, minutes: [15], repeat: null, leaveBy: false } }
  const time = (iso: string) => new Date(iso).toISOString().slice(11, 16)
  const tacos = ev('e3', 'Dinner · Tuesday Tacos', '2030-03-04T18:00:00Z', { memberIds: ['m1', 'm4'], prepAt: '2030-03-04T17:15:00Z', cookId: 'm4' })
  const a = leaveByActivity([tacos], leo, Date.parse('2030-03-04T17:05:00Z'), time, true)!
  assert.deepEqual([a.prep, a.headline, a.urgent], [true, 'Start prep for Tuesday Tacos at 17:15', 'Start prep for Tuesday Tacos now'], 'low stimulation: plain lines')
  assert.equal(leaveByActivity([tacos], { ...leo, id: 'm1' }, Date.parse('2030-03-04T17:05:00Z'), time), null, 'Alex eats; Leo cooks')
  const cooking = ev('e4', 'Lunch · Soup', '2030-03-04T11:00:00Z', { prepAt: '2030-03-04T11:00:00Z' })
  assert.equal(leaveByActivity([cooking], leo, Date.parse('2030-03-04T11:04:00Z'), time)?.endsAt, '2030-03-04T11:05:00.000Z')
})

test('leave by: the headline holds for its stage, is remembered once, and the category picks its hints', () => {
  const sam = { id: 'm2', name: 'Sam', transitionReminders: { on: true, minutes: [30], repeat: null, leaveBy: true } }
  const time = (iso: string) => new Date(iso).toISOString().slice(11, 16)
  const soccer = ev('e1', 'Practice', '2030-03-04T16:00:00Z', { memberIds: ['m2'], leaveAt: '2030-03-04T15:40:00Z', categoryId: 'c1' })
  let seen: NudgeSeen[] = []
  const opts = () => ({ category: (id: string | null) => (id === 'c1' ? 'Soccer ⚽' : null), seen, remember: (e: NudgeSeen) => { seen = rememberNudge(seen, e) } })
  const a = leaveByActivity([soccer], sam, Date.parse('2030-03-04T15:20:00Z'), time, false, opts())!
  assert.equal(seen.length, 2, 'the headline and the "now" line')
  const b = leaveByActivity([soccer], sam, Date.parse('2030-03-04T15:21:00Z'), time, false, opts())!
  assert.deepEqual([b.headline, b.urgent, seen.length], [a.headline, a.urgent, 2], 'the same while its stage lasts')
  const lines = ['2030-03-04', '2030-03-05', '2030-03-06', '2030-03-07', '2030-03-08', '2030-03-09'].map(d =>
    leaveByActivity([{ ...soccer, id: d, start: `${d}T16:00:00Z`, leaveAt: `${d}T15:40:00Z` }], sam, Date.parse(`${d}T15:20:00Z`), time, false, opts())!.headline)
  assert.equal(new Set(lines).size, lines.length, lines.join('\n'))
  assert.match(lines.join('\n'), /Cleats|Shin guards|Ball in the bag|⚽|🥅/)
})

// ---- A medicine dose that's due (medicationActivity) ----
const H = 3_600_000
const dose = (o: Partial<DueDose> = {}): DueDose => ({ medicationId: 'med1', memberId: 'm3', date: '2026-09-28', time: '08:00', dueAt: new Date(Date.UTC(2026, 8, 28, 15)).toISOString(), startedAt: null, until: new Date(Date.UTC(2026, 8, 29, 3)).toISOString(), name: 'Allergy medicine', dose: '1 tablet', ...o })
const MAYA = { id: 'm3', name: 'Maya' }
const T0 = Date.UTC(2026, 8, 28, 15) // due; the window runs 12 hours, to 8 PM at home

test('medicationActivity: generic unless this device opted into medicine names, with what the app needs to mark it', () => {
  assert.deepEqual(medicationActivity([dose()], MAYA, T0 + 60_000, false), {
    medicationId: 'med1', date: '2026-09-28', time: '08:00', memberName: 'Maya', label: "Maya's medicine", headline: "Time for Maya's medicine",
    dueAt: dose().dueAt, windowEndsAt: dose().until, stage: 'due',
  })
  assert.equal(medicationActivity([dose()], MAYA, T0 + 60_000, true)!.label, 'Allergy medicine · 1 tablet')
  assert.equal(medicationActivity([dose({ name: null, dose: null })], MAYA, T0 + 60_000, true)!.label, "Maya's medicine", 'names the server withheld stay withheld')
  assert.doesNotMatch(JSON.stringify(medicationActivity([dose()], MAYA, T0 + 60_000, false)), /Allergy|tablet/)
})

test('medicationActivity: "late" from the follow-up point (halfway through a window past 3 hours), kindly worded', () => {
  assert.equal(medicationActivity([dose()], MAYA, T0 + 6 * H - 60_000, false)!.stage, 'due')
  const late = medicationActivity([dose()], MAYA, T0 + 6 * H, false)!
  assert.deepEqual([late.stage, late.headline], ['late', "Still time for Maya's medicine"])
  const short = dose({ until: new Date(T0 + 3 * H).toISOString() })
  assert.equal(medicationActivity([short], MAYA, T0 + 2.9 * H, false)!.stage, 'due', 'a 3-hour window has no follow-up')
  for (const a of [medicationActivity([dose()], MAYA, T0, false)!, late]) assert.doesNotMatch(a.headline, /missed|late|forg/i)
})

test('medicationActivity: only their own doses, the earliest first, a start-of-day dose too; ends when marked or the window closes', () => {
  const wake = dose({ medicationId: 'med3', time: 'wake', startedAt: new Date(T0 - H).toISOString(), dueAt: new Date(T0 - H).toISOString() })
  assert.deepEqual(medicationActivity([dose(), wake], MAYA, T0, false)!.time, 'wake')
  assert.equal(medicationActivity([dose({ memberId: 'm4' })], MAYA, T0, false), null, "someone else's dose")
  assert.equal(medicationActivity([], MAYA, T0, false), null, 'marked: gone from the due list')
  assert.equal(medicationActivity([dose()], MAYA, Date.parse(dose().until), false), null, 'the window closed')
  assert.equal(medicationActivity([dose()], MAYA, T0 - 60_000, false), null, 'not due yet')
})
