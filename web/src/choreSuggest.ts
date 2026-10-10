// Kids suggest chores (ChoreSuggest.tsx): the weekdays <-> repeat rule, the plain-words schedule a
// parent and kid read, and the stepper's range from the family's own chores.
import type { ChoreSuggestion } from './types.ts'
import { formatTime } from './timeFormat.ts'
import { durationLabel } from './timers.ts'

const RR_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Picked weekdays (0 = Sunday) as a repeat rule; none picked is no repeat. */
export function weekdaysRrule(days: number[]): string | null {
  if (!days.length) return null
  if (days.length === 7) return 'FREQ=DAILY'
  return `FREQ=WEEKLY;BYDAY=${[...new Set(days)].sort().map(d => RR_DAYS[d]).join(',')}`
}

/** The weekdays a simple repeat rule falls on (every day for FREQ=DAILY), or [] for anything else. */
export function rruleWeekdays(rrule: string | null): number[] {
  if (!rrule) return []
  const parts = new Map(rrule.replace(/^RRULE:/i, '').split(';').map(p => p.split('=') as [string, string]))
  if (parts.get('FREQ') === 'DAILY' && parts.size === 1) return [0, 1, 2, 3, 4, 5, 6]
  const by = parts.get('BYDAY')
  if (parts.get('FREQ') !== 'WEEKLY' || !by) return []
  const days = by.split(',').map(d => RR_DAYS.indexOf(d))
  return days.includes(-1) ? [] : days.sort()
}

/** "Every day", "Mon–Fri", "Mon, Wed, Fri", or null for a one-time chore. */
export function daysText(rrule: string | null): string | null {
  if (!rrule) return null
  const days = rruleWeekdays(rrule)
  if (!days.length) return 'Repeats'
  if (days.length === 7) return 'Every day'
  const run = days.every((d, i) => i === 0 || d === days[i - 1] + 1)
  if (run && days.length >= 3) return `${DAY_SHORT[days[0]]}–${DAY_SHORT[days[days.length - 1]]}`
  return days.map(d => DAY_SHORT[d]).join(', ')
}

/** "Mon–Fri · 4:00 PM · 20 min timer · Already done" */
export function suggestionDetails(s: Pick<ChoreSuggestion, 'rrule' | 'dueTime' | 'timerMinutes' | 'done'>): string {
  return [daysText(s.rrule), s.dueTime && formatTime(s.dueTime), s.timerMinutes && `${durationLabel(s.timerMinutes)} timer`, s.done && 'Already done'].filter(Boolean).join(' · ')
}

/** The stepper's top: at least 10, room above the family's biggest chore, never past 100 (the server's cap). */
export function pointsMax(points: number[]): number {
  return Math.min(100, Math.max(10, ...points.map(p => p * 2)))
}

/** Where the stepper starts: the family's usual chore (the middle value), else 5. */
export function pointsStart(points: number[]): number {
  if (!points.length) return 5
  const sorted = [...points].sort((a, b) => a - b)
  return Math.min(100, sorted[Math.floor(sorted.length / 2)])
}

/** Quick notes a parent can tap. */
export const PRAISE = ['Great idea!', 'Love the initiative!', 'Proud of you for practicing!', 'Thanks for helping out!']
