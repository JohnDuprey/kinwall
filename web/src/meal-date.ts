import { addDays, startOfWeek } from 'date-fns'
import { dateKey } from './date.ts'
import type { MealKind, MealSlot, MealStatus } from './meal-types.ts'
import { ordersInLabel } from './orders.ts'

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
/** What the family did, in plain words (the API keeps planned / prepared). Eating out is "Ordered" once a parent marks it. */
export const STATUS_LABEL: Record<MealStatus, string> = { planned: 'Planned', prepared: 'Cooked' }
export const statusLabel = (meal: { status: MealStatus; mealKind: MealKind }) => meal.status === 'prepared' && meal.mealKind === 'dining_out' ? 'Ordered' : STATUS_LABEL[meal.status]
/** Eating out from a binder restaurant: tapping it opens the order view, with Edit meal a tap away. */
export const isOrderNight = (meal: { mealKind: MealKind; restaurantId?: string | null }) => meal.mealKind === 'dining_out' && !!meal.restaurantId
/** A meal's calendar event (GET /api/events `meal`): "✓ Cooked" / "✓ Ordered" once done, an order night's
 * "3 of 4 orders in" before then, else "Planned". `compact` is for month cells: 🍽️, with ✓ once done. */
export function mealEventStatus(meal: { status: MealStatus; mealKind: MealKind; restaurantId: string | null; eaterCount: number; orderCount: number }) {
  const done = meal.status === 'prepared'
  const text = done ? `✓ ${statusLabel(meal)}` : isOrderNight(meal) ? ordersInLabel(meal.orderCount, meal.eaterCount) : 'Planned'
  return { done, text, compact: done ? '🍽️✓' : '🍽️' }
}
/** Local noon avoids midnight DST transitions; date-fns advances calendar days, not 24-hour spans. */
export function mealWeek(anchor: string, weekStart: 0 | 1): string[] {
  const start = startOfWeek(new Date(`${anchor}T12:00:00`), { weekStartsOn: weekStart })
  return Array.from({ length: 7 }, (_, i) => dateKey(addDays(start, i)))
}
/** The dates a meal can swap into: today (or its week's start, if later) through its week's end; null once that week is over. */
export function swapWindow(date: string, today: string, weekStart: 0 | 1): { from: string; to: string } | null {
  const week = mealWeek(date, weekStart)
  const from = week[0] > today ? week[0] : today
  return from > week[6] ? null : { from, to: week[6] }
}
/** The meals to offer for a swap: every other one, by day and then slot. */
export function swapCandidates<M extends { id: string; date: string; slot: MealSlot }>(meals: M[], mealId: string): M[] {
  return meals.filter(m => m.id !== mealId).sort((a, b) => a.date.localeCompare(b.date) || MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot))
}
/** Minutes after midnight a meal is at: its own time, else the family's usual time for its slot. */
export const mealMinutes = (meal: { slot: MealSlot; plannedTime?: string | null }, mealTimes: Record<MealSlot, string>) => {
  const t = meal.plannedTime ?? mealTimes[meal.slot]
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
}
/** A day's meals in the order they happen (a 3:30 snack before a 6:00 dinner); slot order breaks ties. */
export function byMealTime<M extends { slot: MealSlot; plannedTime?: string | null }>(meals: M[], mealTimes: Record<MealSlot, string>): M[] {
  return [...meals].sort((a, b) => mealMinutes(a, mealTimes) - mealMinutes(b, mealTimes) || MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot))
}
export function moveMealDate(date: string, days: number) { return dateKey(addDays(new Date(`${date}T12:00:00`), days)) }
export function mealDayLabel(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`))
}
export const servingsLabel = (n: number) => `${n} serving${n === 1 ? '' : 's'}`
// Kitchen fractions for what recipes print (0.5 -> ½, 1.25 -> 1¼); anything else as a plain number.
const FRACTIONS: Record<string, string> = { '0.125': '⅛', '0.250': '¼', '0.333': '⅓', '0.375': '⅜', '0.500': '½', '0.625': '⅝', '0.667': '⅔', '0.750': '¾', '0.875': '⅞' }
export function formatQuantity(quantity: number): string {
  const whole = Math.floor(quantity)
  const fraction = FRACTIONS[(quantity - whole).toFixed(3)]
  return fraction ? `${whole || ''}${fraction}` : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(quantity)
}
// Abbreviations read the same for any amount ("2 oz"); words follow the amount ("1 cup", "2 cups").
const ABBREVIATED = /^(oz|fl\.? ?oz|tsp|tbsp|tbs|lbs?|g|kg|mg|ml|l|doz|pt|qt|gal)\.?$/i
export function unitFor(quantity: number | null, unit: string): string {
  if (quantity === null || ABBREVIATED.test(unit)) return unit
  if (quantity > 1) return /s$/i.test(unit) ? unit : /(ch|sh|x)$/i.test(unit) ? `${unit}es` : `${unit}s`
  return /(ch|sh|x)es$/i.test(unit) ? unit.slice(0, -2) : /[^s]s$/i.test(unit) ? unit.slice(0, -1) : unit
}
export function ingredientAmount(quantity: number | null, unit: string | null, qualifier?: string | null) {
  return [quantity === null ? '' : formatQuantity(quantity), unit && unitFor(quantity, unit), qualifier].filter(Boolean).join(' ')
}
/** A recipe source that is a PDF recipe card: the path ends in .pdf (query ignored). */
export function isPdfUrl(url: string): boolean {
  try { return /\.pdf$/i.test(new URL(url).pathname) } catch { return false }
}
export function urlHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}
type Times = { prepMinutes?: number | null; totalMinutes?: number | null } | null | undefined
export const minutesLabel = (m: number) => m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`
/** "35 min · 10 min prep", "35 min", "10 min prep", or '' when the recipe doesn't say. */
export function recipeTime(r: Times): string {
  return [r?.totalMinutes ? minutesLabel(r.totalMinutes) : '', r?.prepMinutes ? `${minutesLabel(r.prepMinutes)} prep` : ''].filter(Boolean).join(' · ')
}
/** When to start so a recipe taking `total` minutes is ready at `plannedTime` (HH:MM), same day only. */
export function startBy(plannedTime: string | null, total: number | null | undefined): string | null {
  if (!plannedTime || !total) return null
  const at = Number(plannedTime.slice(0, 2)) * 60 + Number(plannedTime.slice(3, 5)) - total
  return at < 0 ? null : `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`
}
/** A person's filtered view (the header's member filter): meals they eat or cook, and meals with nobody picked. */
export const mealForMember = (meal: { eaterIds?: string[]; assigneeMemberId: string | null }, memberId: string | null) =>
  !memberId || !meal.eaterIds?.length || meal.eaterIds.includes(memberId) || meal.assigneeMemberId === memberId
/** Tapping a planned meal opens its recipe (read-only, "Edit meal" a tap away) when the library has it; otherwise the meal's own sheet. */
export const mealRecipe = <R extends { id: string }>(meal: { mealKind: string; recipeId: string | null }, recipes: R[]): R | undefined =>
  meal.mealKind === 'recipe' ? recipes.find(r => r.id === meal.recipeId) : undefined
