import { addDays, startOfWeek } from 'date-fns'
import { dateKey } from './date.ts'
import type { MealSlot } from './meal-types.ts'

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
/** Local noon avoids midnight DST transitions; date-fns advances calendar days, not 24-hour spans. */
export function mealWeek(anchor: string, weekStart: 0 | 1): string[] {
  const start = startOfWeek(new Date(`${anchor}T12:00:00`), { weekStartsOn: weekStart })
  return Array.from({ length: 7 }, (_, i) => dateKey(addDays(start, i)))
}
export function moveMealDate(date: string, days: number) { return dateKey(addDays(new Date(`${date}T12:00:00`), days)) }
export function mealDayLabel(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`))
}
export const servingsLabel = (n: number) => `${n} serving${n === 1 ? '' : 's'}`
export function ingredientAmount(quantity: number | null, unit: string | null, qualifier?: string | null) {
  return [quantity === null ? '' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(quantity), unit, qualifier].filter(Boolean).join(' ')
}
