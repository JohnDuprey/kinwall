// Demo adapter only. Uses the same in-memory fixtures as Calendar, Meals and Lists.
import { mock } from './mock.ts'
import { mockMealRequest } from './mock-meals.ts'
import { mockUpkeepRequest } from './mock-upkeep.ts'
import { ApiError } from './apiError.ts'
import { dateKey, zonedDayKey } from './date.ts'
import { planningWeek } from './weekly-planning.ts'
import type { PlanningDraft, WeeklyPlanning } from './weekly-planning.ts'
import type { Meal, Recipe } from './meal-types.ts'
import type { UpkeepJob } from './types.ts'

const plans = new Map<string, { revision: number; draft: PlanningDraft; applied: WeeklyPlanning['applied'] }>()
const requests = new Map<string, string>()
let seeding: Promise<void> | undefined
const error = (message: string, status = 409): never => { throw new ApiError(status, message) }
const writeMeal = (body: unknown) => mockMealRequest('api/meals', { method: 'POST', body: JSON.stringify({ status: 'planned', ...(body as object) }) }) as Promise<Meal>
async function seedStory() {
  const settings = await mock.getSettings()
  const dates = planningWeek(dateKey(new Date()), settings.weekStart)
  const on = (day: number) => dates.find(d => new Date(`${d}T12:00:00Z`).getUTCDay() === day)!
  const at = (day: number, time: string) => new Date(`${on(day)}T${time}:00`).toISOString()
  await mock.createEvent({ calendarId: 'c1', title: 'Leo’s soccer', start: at(2, '16:00'), end: at(2, '17:00'), memberIds: ['m4'] })
  await mock.createEvent({ calendarId: 'c1', title: 'Sam working until 6', start: at(2, '09:00'), end: at(2, '18:00'), memberIds: ['m2'] })
  await mock.createEvent({ calendarId: 'c1', title: 'Maya’s library visit', start: at(3, '15:00'), end: at(3, '16:00'), memberIds: ['m3'] })
  await mock.createEvent({ calendarId: 'c1', title: 'School photo day', start: on(4), end: dateKey(new Date(Date.parse(`${on(4)}T12:00:00`) + 86400000)), allDay: true, memberIds: ['m3','m4'] })
  for (const [day, title] of [[1, 'Tacos'], [3, 'Lemon chicken'], [5, 'Leftovers'], [6, 'Family pizza night']] as const) await writeMeal({ date: on(day), slot: 'dinner', title, mealKind: 'freeform' })
  const lists = await mock.getLists()
  const pantry = lists.find(l => l.purpose === 'pantry') ?? await mock.createList({ name: 'Food at home', kind: 'todo', purpose: 'pantry' })
  await mock.addListItems(pantry.id, { title: 'Spinach', dueDate: on(3), quantity: '1 bag' })
  await mockMealRequest('api/recipes', { method: 'POST', body: JSON.stringify({ name: '20-minute spinach pasta', kind: 'meal', defaultServings: 4, totalMinutes: 20, ingredients: [{ name: 'Spinach', quantity: 1, unit: 'bag' }, { name: 'Pasta', quantity: 400, unit: 'g' }], instructions: 'Cook the pasta. Wilt the spinach in olive oil, then toss with pasta and a little cooking water.' }) })
}
async function read(requested?: string): Promise<WeeklyPlanning> {
  await (seeding ??= seedStory())
  const settings = await mock.getSettings(), timezone = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const dates = planningWeek(zonedDayKey(new Date().toISOString(), timezone), settings.weekStart)
  if (requested) {
    const start = new Date(`${requested}T12:00:00`)
    for (let i = 0; i < 7; i++) { const day = new Date(start); day.setDate(day.getDate() + i); dates[i] = dateKey(day) }
  }
  const [events, meals, recipes, lists, jobs, pantry] = await Promise.all([
    mock.getEvents(`${dates[0]}T00:00:00Z`, `${dates[6]}T23:59:59Z`),
    mockMealRequest(`api/meals?from=${dates[0]}&to=${dates[6]}`, {}) as Promise<Meal[]>,
    mockMealRequest('api/recipes', {}) as Promise<Recipe[]>, mock.getLists(),
    mockUpkeepRequest('api/upkeep/jobs', {}) as Promise<UpkeepJob[]>, mock.getPantrySuggestions(14),
  ])
  const todos = lists.filter(l => !l.archived && l.kind === 'todo' && !l.purpose)
  const taskRows = (await Promise.all(todos.map(l => mock.getList(l.id)))).flatMap(l => l.items)
  const saved = plans.get(dates[0]) ?? { revision: 0, draft: { dinners: [], prep: [] }, applied: { dinners: {}, prep: {} } }
  const relevant = { events, meals, recipes, lists, jobs, taskRows, pantry, features: settings.features }
  const fingerprint = JSON.stringify(relevant)
  let sourceVersion = 0
  for (let i = 0; i < fingerprint.length; i++) sourceVersion = (sourceVersion * 31 + fingerprint.charCodeAt(i)) >>> 0
  return structuredClone({
    ...saved, weekStart: dates[0], dates, timezone, sourceVersion,
    features: { meals: settings.features.meals, lists: settings.features.lists, upkeep: settings.features.upkeep },
    events: events.map(e => ({ id:e.id,title:e.title,start:e.start,end:e.end,allDay:e.allDay,memberIds:e.memberIds,occurrenceStart:e.occurrenceStart })),
    meals: settings.features.meals ? meals.map(m => ({ id:m.id,date:m.date,slot:m.slot,title:m.title,canSwap:m.status === 'planned' && m.mealKind !== 'dining_out' && !(m.calendarEventId && m.calendarEventStart) })) : [],
    pantry: settings.features.meals && settings.features.lists ? pantry.expiring.filter(i => i.useBy && i.useBy >= dates[0] && i.useBy <= dates[6]).map(i => ({id:i.id,title:i.title,useBy:i.useBy!})) : [],
    recipes: settings.features.meals ? recipes.filter(r => r.kind !== 'basic').map(r => ({ id:r.id,name:r.name,totalMinutes:r.totalMinutes ?? null })) : [],
    lists: settings.features.lists ? todos.map(l => ({ id:l.id,name:l.name })) : [],
    tasks: settings.features.lists ? taskRows.filter(i => !i.done && i.dueDate && i.dueDate >= dates[0] && i.dueDate <= dates[6]).map(i => ({ id:i.id,title:i.title,dueDate:i.dueDate,eventId:i.eventId,listId:i.listId,done:i.done })) : [],
    jobs: settings.features.upkeep ? jobs.filter(j => j.nextDue && j.nextDue <= dates[6]).map(j => ({ id:j.id,title:j.title,date:j.nextDue! })) : [],
    suggestions: settings.features.meals && settings.features.lists ? pantry.suggestions.map(s => ({ id:s.recipe.id,name:s.recipe.name,totalMinutes:s.recipe.totalMinutes,uses:s.uses.filter(i => i.useBy && i.useBy >= dates[0] && i.useBy <= dates[6]).map(i => ({title:i.title,useBy:i.useBy})) })).filter(s => s.uses.length) : [],
  })
}
export async function mockWeeklyPlanningRequest(path: string, options: RequestInit): Promise<WeeklyPlanning> {
  if (mock.demoKid()) error('A grown-up must plan the week.', 403)
  const url = new URL(path, 'https://demo.invalid'), parts = url.pathname.split('/')
  const week = parts[3] ?? url.searchParams.get('weekStart') ?? undefined
  const snapshot = await read(week)
  if (!options.method || options.method === 'GET') return snapshot
  const input = JSON.parse(String(options.body)) as { revision:number; sourceVersion:number; requestId:string; draft:PlanningDraft }
  const request = JSON.stringify(input)
  if (parts[4] === 'apply' && requests.has(input.requestId)) {
    if (requests.get(input.requestId) !== request) error('This save was already used for a different plan.')
    return snapshot
  }
  if (input.revision !== snapshot.revision) error('The saved plan changed. Reload and review it before trying again.')
  if (parts[4] === 'apply') {
    if (input.sourceVersion !== snapshot.sourceVersion) error('The week changed. Reload and review it before trying again.')
    for (const dinner of input.draft.dinners) if (dinner.kind === 'meal' && snapshot.applied.dinners[dinner.date]?.choice !== JSON.stringify(dinner)) {
      if (dinner.replaceMealId) {
        if (!snapshot.meals.some(m => m.id === dinner.replaceMealId && m.date === dinner.date && m.slot === 'dinner' && m.canSwap)) error('This dinner can no longer be swapped here. Refresh the week or open Meals.')
      } else if (snapshot.applied.dinners[dinner.date] || snapshot.meals.some(m => m.date === dinner.date && m.slot === 'dinner')) error('Dinner is already planned for that day.')
      if (dinner.recipeId && !snapshot.recipes.some(r => r.id === dinner.recipeId)) error('Choose a meal recipe that is still in your library.', 400)
    }
    for (const prep of input.draft.prep) if (!snapshot.applied.prep[prep.id] && (!snapshot.events.some(e => e.id === prep.eventId && e.occurrenceStart === prep.occurrenceStart) || !snapshot.lists.some(l => l.id === prep.listId))) error('Choose a visible event and an active to-do list.', 400)
    for (const dinner of input.draft.dinners) if (dinner.kind === 'meal' && snapshot.applied.dinners[dinner.date]?.choice !== JSON.stringify(dinner)) {
      const body = { date:dinner.date,slot:'dinner',title:dinner.title,mealKind:dinner.recipeId ? 'recipe' : 'freeform',recipeId:dinner.recipeId ?? null,sourceUrl:null }
      const meal = dinner.replaceMealId ? await mockMealRequest('api/meals/' + encodeURIComponent(dinner.replaceMealId), {method:'PATCH',body:JSON.stringify(body)}) as Meal : await writeMeal(body)
      snapshot.applied.dinners[dinner.date] = { id:meal.id,choice:JSON.stringify(dinner) }
    }
    for (const prep of input.draft.prep) if (!snapshot.applied.prep[prep.id]) {
      const [item] = await mock.addListItems(prep.listId, { title:prep.title,eventId:prep.eventId,dueDate:prep.dueDate })
      snapshot.applied.prep[prep.id] = { id:item.id,choice:JSON.stringify(prep) }
    }
    requests.set(input.requestId, request)
  }
  plans.set(snapshot.weekStart, { revision:snapshot.revision + 1,draft:structuredClone(input.draft),applied:snapshot.applied })
  return read(snapshot.weekStart)
}
