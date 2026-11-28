import { test } from 'node:test'
import assert from 'node:assert/strict'
import { awayDays, awayOn, awayUntil, choreAwayNotice, groupChoreAway, handoffProblems, personSummary } from '../src/away.ts'
import type { AwayPeriod, AwayPerson } from '../src/trip-types.ts'

const person = (p: Partial<AwayPerson>): AwayPerson => ({ memberId: 'maya', startDate: '2027-03-03', endDate: '2027-03-05', leaveDayAway: true, returnDayAway: true, ...p })
const period = (p: Partial<AwayPeriod>): AwayPeriod => ({ id: 'a', label: 'Band camp', tripId: null, tripTitle: null, people: [], handoffs: [], keepDue: [], revision: 1, createdBy: null, updatedAt: '', ...p })

test('groupChoreAway groups return dates, preserves names and handles filters', () => {
  const members = [{ id: 'alex', name: 'Alex' }, { id: 'sam', name: 'Sam' }, { id: 'maya', name: 'Maya' }, { id: 'leo', name: 'Leo' }]
  const all = period({ people: members.map(m => person({ memberId: m.id })) })
  assert.deepEqual(groupChoreAway([], members, '2027-03-03'), [])
  assert.deepEqual(groupChoreAway([all], [], '2027-03-03'), [])
  assert.deepEqual(groupChoreAway([all], members, '2027-03-03'), [{ until: '2027-03-05', names: ['Alex', 'Sam', 'Maya', 'Leo'], everyone: true }])
  assert.deepEqual(groupChoreAway([all], members, '2027-03-03', 'maya'), [{ until: '2027-03-05', names: ['Maya'], everyone: false }])
  const split = period({ people: [person({ memberId: 'alex', endDate: '2027-03-06' }), person({ memberId: 'maya' }), person({ memberId: 'sam' })] })
  assert.deepEqual(groupChoreAway([split], members, '2027-03-03'), [
    { until: '2027-03-05', names: ['Sam', 'Maya'], everyone: false },
    { until: '2027-03-06', names: ['Alex'], everyone: false },
  ])
  assert.deepEqual(groupChoreAway([all], members, '2027-03-06'), [])
})

test('choreAwayNotice uses singular, plural and everyone, shortening only the visible names', () => {
  const group = { until: '2027-03-05', names: ['Maya'], everyone: false }
  assert.equal(choreAwayNotice(group).text, '✈️ Maya is away until Fri, Mar 5 · chores wait')
  assert.equal(choreAwayNotice({ ...group, names: ['Maya', 'Leo'] }).text, '✈️ Maya and Leo are away until Fri, Mar 5 · chores wait')
  const many = choreAwayNotice({ ...group, names: ['Alex', 'Sam', 'Maya', 'Leo'] })
  assert.equal(many.text, '✈️ Alex, Sam, and 2 more are away until Fri, Mar 5 · chores wait')
  assert.equal(many.label, 'Alex, Sam, Maya, and Leo are away until Fri, Mar 5. Their chores wait until they’re back.')
  assert.equal(choreAwayNotice({ ...group, everyone: true }).text, '✈️ Everyone’s away until Fri, Mar 5 · chores wait')
})

test('awayDays: the leave and return days count only when ticked; same day with either unticked is none', () => {
  assert.deepEqual(awayDays(person({})), { from: '2027-03-03', to: '2027-03-05' })
  assert.deepEqual(awayDays(person({ returnDayAway: false })), { from: '2027-03-03', to: '2027-03-04' })
  assert.deepEqual(awayDays(person({ leaveDayAway: false, returnDayAway: false })), { from: '2027-03-04', to: '2027-03-04' })
  assert.equal(awayDays(person({ startDate: '2027-03-03', endDate: '2027-03-04', leaveDayAway: false, returnDayAway: false })), null)
  assert.equal(awayDays(person({ startDate: '2027-03-03', endDate: '2027-03-03', returnDayAway: false })), null)
  assert.deepEqual(awayDays(person({ startDate: '2027-03-03', endDate: '2027-03-03' })), { from: '2027-03-03', to: '2027-03-03' })
  assert.equal(awayDays(person({ startDate: '2027-03-05', endDate: '2027-03-03' })), null)
})

test('awayOn and awayUntil: overlapping periods combine, and removing one leaves the other', () => {
  const camp = period({ id: 'camp', people: [person({ startDate: '2027-03-03', endDate: '2027-03-05' })] })
  const visit = period({ id: 'visit', people: [person({ startDate: '2027-03-05', endDate: '2027-03-08', leaveDayAway: false })] })
  assert.equal(awayOn([camp, visit], 'maya', '2027-03-06'), true)
  assert.equal(awayOn([camp, visit], 'leo', '2027-03-06'), false)
  assert.equal(awayUntil([camp, visit], 'maya', '2027-03-04'), '2027-03-08')
  assert.equal(awayUntil([visit], 'maya', '2027-03-04'), null)
  assert.equal(awayUntil([camp], 'maya', '2027-03-04'), '2027-03-05')
})

test('personSummary: dates and which boundary days count, in words', () => {
  assert.equal(personSummary(person({ returnDayAway: false })), 'Wed, Mar 3 – Fri, Mar 5 · leave day counts, back day doesn’t')
  assert.equal(personSummary(person({})), 'Wed, Mar 3 – Fri, Mar 5 · both days count')
  assert.equal(personSummary(person({ startDate: '2027-03-03', endDate: '2027-03-03', returnDayAway: false })), 'Wed, Mar 3 · no away days')
})

test('handoffProblems: to someone away, to themselves, two people for one chore, or outside the away days', () => {
  const draft = { people: [person({ memberId: 'maya' }), person({ memberId: 'alex', startDate: '2027-03-04', endDate: '2027-03-04' })], handoffs: [] as AwayPeriod['handoffs'] }
  const h = (toMemberId: string, startDate = '2027-03-03', endDate = '2027-03-05', choreId = 'fish') => ({ choreId, fromMemberId: 'maya', toMemberId, startDate, endDate })
  const names = { maya: 'Maya', alex: 'Alex', sam: 'Sam' }
  assert.deepEqual(handoffProblems({ ...draft, handoffs: [h('sam')] }, [], names), [])
  assert.deepEqual(handoffProblems({ ...draft, handoffs: [h('alex')] }, [], names), ['Alex is away on Thu, Mar 4, so can’t take a chore that day.'])
  assert.deepEqual(handoffProblems({ ...draft, handoffs: [h('maya')] }, [], names), ['Pick someone other than Maya.'])
  assert.deepEqual(handoffProblems({ ...draft, handoffs: [h('sam'), h('alex', '2027-03-05', '2027-03-05')] }, [], names), ['One chore can go to only one person on a day: check Mar 5.'])
  assert.deepEqual(handoffProblems({ ...draft, handoffs: [h('sam', '2027-03-01', '2027-03-05')] }, [], names), ['A handoff covers only Maya’s away days.'])
  // Someone away in another saved period counts too.
  const other = period({ id: 'other', people: [person({ memberId: 'sam', startDate: '2027-03-05', endDate: '2027-03-09' })] })
  assert.deepEqual(handoffProblems({ ...draft, handoffs: [h('sam')] }, [other], names), ['Sam is away on Fri, Mar 5, so can’t take a chore that day.'])
})
