import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planningWeek, planningDays, dinnerCount, planConflicts, type WeeklyPlanning } from '../src/weekly-planning.ts'
const source = (): WeeklyPlanning => ({ weekStart: '2026-11-15', dates: ['2026-11-15','2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21'], timezone: 'America/New_York', sourceVersion: 0, revision: 0, draft: { dinners: [], prep: [] }, applied: { dinners: {}, prep: {} }, features: { meals: true, lists: true, upkeep: true }, events: [], meals: [], tasks: [], jobs: [], lists: [], pantry: [], recipes: [], suggestions: [] })
test('planning overview uses family dates, spans events across midnight, and notices overlapping commitments', () => {
  const plan = source()
  plan.events = [
    { id:'e1',title:'Soccer',start:'2026-11-17T21:00:00Z',end:'2026-11-17T22:00:00Z',allDay:false,memberIds:['m1'],occurrenceStart:null },
    { id:'e2',title:'Meeting',start:'2026-11-17T21:30:00Z',end:'2026-11-17T22:30:00Z',allDay:false,memberIds:['m1'],occurrenceStart:null },
    { id:'e3',title:'Away',start:'2026-11-18',end:'2026-11-20',allDay:true,memberIds:[],occurrenceStart:null },
  ]
  const days = planningDays(plan)
  assert.equal(days[2].overlap, true)
  assert.equal(days[3].events[0].title, 'Away')
  assert.equal(days[4].events.length, 1)
  assert.equal(days[5].events.length, 0)
  assert.equal(days[1].overlap, false)
})
test('intentionally open dinner is resolved while a saved but unapplied meal is still a choice to apply', () => {
  const plan = source()
  plan.draft.dinners = [{date:plan.dates[0],kind:'open'}]
  plan.meals = [{id:'m',date:plan.dates[1],slot:'dinner',title:'Tacos',canSwap:true}]
  assert.equal(dinnerCount(plan), 5)
  plan.features.meals = false
  assert.equal(dinnerCount(plan), 0)
})
test('review flags dinner added elsewhere and preparation whose event or list disappeared', () => {
  const plan = source()
  plan.meals = [{id:'m',date:plan.dates[1],slot:'dinner',title:'Tacos',canSwap:true}]
  plan.draft = { dinners:[{date:plan.dates[1],kind:'meal',title:'Pasta'}], prep:[{id:'p',eventId:'gone',occurrenceStart:null,listId:'gone',title:'Books',dueDate:plan.dates[1]}] }
  assert.equal(planConflicts(plan, plan.draft).length, 2)
  plan.applied.dinners[plan.dates[1]]={id:'m',choice:JSON.stringify(plan.draft.dinners[0])}
  plan.applied.prep.p={id:'p',choice:JSON.stringify(plan.draft.prep[0])}
  assert.equal(planConflicts(plan, plan.draft).length, 0)
})

test('overlap checks compare instants when events use different UTC offsets', () => {
  const plan = source()
  plan.events = [
    {id:'a',title:'Soccer',start:'2026-11-17T16:00:00-05:00',end:'2026-11-17T17:00:00-05:00',allDay:false,memberIds:['m1'],occurrenceStart:null},
    {id:'b',title:'Meeting',start:'2026-11-17T21:30:00Z',end:'2026-11-17T22:30:00Z',allDay:false,memberIds:['m1'],occurrenceStart:null},
  ]
  assert.equal(planningDays(plan)[2].overlap,true)
})

test('planning always starts with the next complete family week, across year boundaries', () => {
  assert.equal(planningWeek('2026-11-13', 1)[0], '2026-11-16')
  assert.equal(planningWeek('2026-11-16', 1)[0], '2026-11-23')
  assert.equal(planningWeek('2026-11-13', 0)[0], '2026-11-15')
  assert.deepEqual(planningWeek('2026-12-31', 1), ['2027-01-04','2027-01-05','2027-01-06','2027-01-07','2027-01-08','2027-01-09','2027-01-10'])
})

test('a dinner swap targets one existing meal, conflicts if it disappears or cannot be swapped, and becomes settled after apply', () => {
  const plan = source()
  plan.meals = [{ id: 'dinner', date: plan.dates[1], slot: 'dinner', title: 'Tacos', canSwap: true }]
  const draft = { dinners: [{ date: plan.dates[1], kind: 'meal' as const, title: 'Pasta', replaceMealId: 'dinner' }], prep: [] }
  assert.deepEqual(planConflicts(plan, draft), [])
  plan.meals[0].canSwap = false
  assert.equal(planConflicts(plan, draft).length, 1)
  plan.meals = []
  assert.equal(planConflicts(plan, draft).length, 1)
  plan.applied.dinners[plan.dates[1]] = { id: 'dinner', choice: JSON.stringify(draft.dinners[0]) }
  assert.deepEqual(planConflicts(plan, draft), [], 'an already applied swap is not recreated even after deleting its meal')
})

test('leaving planning closes without saving or applying, and asks only for unsaved choices', async () => {
  const { leavePlanning } = await import('../src/weekly-planning.ts')
  let exits = 0, questions = 0
  const close = () => { exits++ }
  const discard = async () => { questions++; return true }
  await leavePlanning({ busy: false, dirty: false, confirmDiscard: discard, onLeave: close })
  assert.equal(exits, 1)
  assert.equal(questions, 0, 'an untouched or already saved plan exits immediately')
  await leavePlanning({ busy: false, dirty: true, confirmDiscard: async () => { questions++; return false }, onLeave: close })
  assert.equal(exits, 1, 'keep editing preserves the planner and its draft')
  await leavePlanning({ busy: false, dirty: true, confirmDiscard: discard, onLeave: close })
  assert.equal(exits, 2, 'discarding unsaved choices exits without requiring an apply')
  assert.equal(questions, 2)
  await leavePlanning({ busy: true, dirty: true, confirmDiscard: discard, onLeave: close })
  assert.equal(exits, 2, 'an in-flight save cannot be dismissed')
  assert.equal(questions, 2)
})

test('planner invitation dismissal expires on family dates; an indefinite dismissal stays hidden', async () => {
  const { plannerInviteHidden, plannerDismissUntil } = await import('../src/weekly-planning.ts')
  assert.equal(plannerDismissUntil('today', '2026-11-14', 0), '2026-11-15')
  assert.equal(plannerDismissUntil('today', '2026-12-31', 0), '2027-01-01')
  assert.equal(plannerDismissUntil('week', '2026-11-14', 0), '2026-11-15')
  assert.equal(plannerDismissUntil('week', '2026-11-15', 0), '2026-11-22')
  assert.equal(plannerDismissUntil('week', '2026-11-14', 1), '2026-11-16')
  assert.equal(plannerDismissUntil('always', '2026-11-14', 0), 'always')
  assert.equal(plannerInviteHidden('2026-11-15', '2026-11-14'), true)
  assert.equal(plannerInviteHidden('2026-11-15', '2026-11-15'), false)
  assert.equal(plannerInviteHidden('2026-11-15', '2026-11-16'), false)
  assert.equal(plannerInviteHidden('always', '2027-01-01'), true)
  assert.equal(plannerInviteHidden(undefined, '2026-11-14'), false)
  assert.equal(plannerInviteHidden('bad value', '2026-11-14'), false)
})
