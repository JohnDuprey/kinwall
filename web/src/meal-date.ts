import { useEffect, useState } from 'react'
import { addDays, startOfWeek } from 'date-fns'
import { dateKey } from './date.ts'
import type { MealSlot } from './meal-types.ts'

export const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6
const KEY = 'kinwall.meals.weekStart'
const PREF_EVENT = 'kinwall:meal-week-start'
const validDay = (n: number): n is WeekStart => Number.isInteger(n) && n >= 0 && n <= 6

function readPreference(): WeekStart | null {
  try {
    const value = localStorage.getItem(KEY)
    if (value !== null && validDay(Number(value))) return Number(value) as WeekStart
  } catch { /* storage may be unavailable */ }
  return null
}

function localeWeekStart(): WeekStart {
  try {
    // Safari exposes weekInfo; newer engines expose getWeekInfo().
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } }
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay
    if (first !== undefined) return (first % 7) as WeekStart
    return ['US', 'CA', 'JP', 'PH'].includes(locale.maximize().region ?? '') ? 0 : 1
  } catch { return 1 }
}

export function useMealWeekStart(household?: number | null) {
  const [preference, setPreference] = useState(readPreference)
  useEffect(() => {
    const read = () => setPreference(readPreference())
    window.addEventListener('storage', read)
    window.addEventListener(PREF_EVENT, read)
    return () => { window.removeEventListener('storage', read); window.removeEventListener(PREF_EVENT, read) }
  }, [])
  const change = (value: string) => {
    const day = value === '' ? null : Number(value)
    if (day !== null && !validDay(day)) return
    setPreference(day as WeekStart | null)
    try {
      if (day === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(day))
      window.dispatchEvent(new Event(PREF_EVENT))
    } catch { /* keep the preference for this session */ }
  }
  return { preference, change, weekStart: preference ?? (household != null && validDay(household) ? household : localeWeekStart()) }
}

/** Local noon avoids midnight DST transitions; date-fns advances calendar days, not 24-hour spans. */
export function mealWeek(anchor: string, weekStart: WeekStart): string[] {
  const start = startOfWeek(new Date(`${anchor}T12:00:00`), { weekStartsOn: weekStart })
  return Array.from({ length: 7 }, (_, i) => dateKey(addDays(start, i)))
}
export function moveMealDate(date: string, days: number) { return dateKey(addDays(new Date(`${date}T12:00:00`), days)) }
export function mealDayLabel(date: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`))
}
export function ingredientAmount(quantity: number | null, unit: string | null, qualifier?: string | null) {
  return [quantity === null ? '' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(quantity), unit, qualifier].filter(Boolean).join(' ')
}
