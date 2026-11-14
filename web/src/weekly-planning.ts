import type { RecipeRating } from './meal-types.ts'
import { zonedDayKey } from './date.ts'

/** Leaving a review never saves or applies its choices. */
export async function leavePlanning({ busy, dirty, confirmDiscard, onLeave }: {
  busy: boolean; dirty: boolean; confirmDiscard: () => Promise<boolean>; onLeave: () => void
}) {
  if (busy || (dirty && !await confirmDiscard())) return
  onLeave()
}
export type PlanningDinner = { date: string; kind: 'open' } | { date: string; kind: 'meal'; title: string; recipeId?: string; replaceMealId?: string }
export type PlanningPrep = { id: string; eventId: string; occurrenceStart: string | null; title: string; dueDate: string; listId: string }
export type PlanningDraft = { dinners: PlanningDinner[]; prep: PlanningPrep[] }
export type PlanningApplied = { dinners: Record<string, { id: string; choice: string }>; prep: Record<string, { id: string; choice: string }> }
export type WeeklyPlanning = {
  weekStart: string; dates: string[]; timezone: string; sourceVersion: number; revision: number; draft: PlanningDraft; applied: PlanningApplied
  features: { meals: boolean; lists: boolean; upkeep: boolean }
  events: { id: string; title: string; start: string; end: string; allDay: boolean; memberIds: string[]; occurrenceStart: string | null }[]
  meals: { id: string; date: string; slot: string; title: string; canSwap: boolean }[]
  tasks: { id: string; title: string; dueDate: string | null; eventId: string | null; listId: string; done: boolean }[]
  jobs: { id: string; title: string; date: string }[]
  lists: { id: string; name: string }[]
  pantry: { id: string; title: string; useBy: string }[]
  recipes: { id: string; name: string; totalMinutes: number | null; createdAt?: string; cookedCount?: number; lastCookedDate?: string | null; favoritedBy?: string[]; rating?: RecipeRating; description?: string | null; ingredients?: { name: string }[] }[]
  suggestions: { id: string; name: string; totalMinutes: number | null; uses: { title: string; useBy: string | null }[] }[]
}
export const planningDay = (event: WeeklyPlanning['events'][number], timezone: string) => event.allDay ? event.start.slice(0, 10) : zonedDayKey(event.start, timezone)
export function planningDays(plan: WeeklyPlanning) {
  return plan.dates.map(date => {
    const events = plan.events.filter(e => {
      const start = planningDay(e, plan.timezone)
      const last = e.allDay ? e.end.slice(0, 10) : zonedDayKey(new Date(Date.parse(e.end) - 1).toISOString(), plan.timezone)
      return start <= date && (e.allDay ? date < last : date <= last)
    })
    const timed = events.filter(e => !e.allDay)
    const overlap = timed.some((a, i) => timed.slice(i + 1).some(b => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end) && (!a.memberIds.length || !b.memberIds.length || a.memberIds.some(id => b.memberIds.includes(id)))))
    return { date, events, overlap, meals: plan.meals.filter(m => m.date === date), tasks: plan.tasks.filter(i => i.dueDate === date), jobs: plan.jobs.filter(j => j.date === date || (date === plan.weekStart && j.date < date)) }
  })
}
export function dinnerCount(plan: WeeklyPlanning): number {
  if (!plan.features.meals) return 0
  return plan.dates.filter(date => !plan.meals.some(m => m.date === date && m.slot === 'dinner') && !plan.draft.dinners.some(m => m.date === date)).length
}
export const dinnerNeedsApply = (plan: WeeklyPlanning, choice: PlanningDinner) => choice.kind === 'meal' && plan.applied.dinners[choice.date]?.choice !== JSON.stringify(choice)
export function planConflicts(plan: WeeklyPlanning, draft: PlanningDraft) {
  const dinners = draft.dinners.filter(m => dinnerNeedsApply(plan, m) && m.kind === 'meal' && (m.replaceMealId ? !plan.meals.some(x => x.id === m.replaceMealId && x.date === m.date && x.slot === 'dinner' && x.canSwap) : plan.meals.some(x => x.date === m.date && x.slot === 'dinner'))).map(m => ({ kind: 'dinner' as const, id: m.date }))
  const prep = draft.prep.filter(p => !plan.applied.prep[p.id] && (!plan.events.some(e => e.id === p.eventId && e.occurrenceStart === p.occurrenceStart) || !plan.lists.some(l => l.id === p.listId))).map(p => ({ kind: 'prep' as const, id: p.id }))
  return [...dinners, ...prep]
}

export function planningWeek(today: string, weekStart: number): string[] {
  const day = new Date(`${today}T12:00:00Z`)
  const ahead = (weekStart - day.getUTCDay() + 7) % 7 || 7
  day.setUTCDate(day.getUTCDate() + ahead)
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(day)
    date.setUTCDate(date.getUTCDate() + i)
    return date.toISOString().slice(0, 10)
  })
}
