// Kids suggest chores (ChoreSuggest.tsx): the weekdays <-> repeat rule, the plain-words schedule a
// parent and kid read, and the stepper's range from the family's own chores.
import type { ChoreSuggestion } from './types.ts'
import { formatTime } from './timeFormat.ts'
import { durationLabel } from './timers.ts'
import { formatDate, msg, t } from './i18n.ts'

const RR_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
// A weekday's short name in the current language (0 = Sunday): 2023-01-01 was a Sunday.
const dayShort = (d: number) => formatDate(new Date(2023, 0, 1 + d), { weekday: 'short' })

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

/** "Every day", "Mon–Fri", "Every Mon, Wed, Fri", or null for a one-time chore. */
export function daysText(rrule: string | null): string | null {
  if (!rrule) return null
  const days = rruleWeekdays(rrule)
  if (!days.length) return t('Repeats')
  if (days.length === 7) return t('Every day')
  const run = days.every((d, i) => i === 0 || d === days[i - 1] + 1)
  if (run && days.length >= 3) return `${dayShort(days[0])}–${dayShort(days[days.length - 1])}`
  return t('Every {days}', { days: days.map(dayShort).join(', ') }) // "Thu" alone reads like a one-time day
}

/** "Mon–Fri · 4:00 PM · 20 min timer · Already done" */
export function suggestionDetails(s: Pick<ChoreSuggestion, 'rrule' | 'dueTime' | 'timerMinutes' | 'done'>): string {
  return [daysText(s.rrule), s.dueTime && formatTime(s.dueTime), s.timerMinutes && t('{time} timer', { time: durationLabel(s.timerMinutes) }), s.done && t('Already done')].filter(Boolean).join(' · ')
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

/** Quick notes a parent can tap on a yes: practicing only for an idea with a timer (piano, reading).
 * English, marked: show with tm(). */
export const praiseFor = (s: Pick<ChoreSuggestion, 'timerMinutes'>) =>
  [msg('Great idea!'), msg('Love the initiative!'), s.timerMinutes ? msg('Proud of you for practicing!') : msg('Thanks for helping out!')]

/** Kind quick notes for "Not this time" (English, marked: show with tm()). */
export const NOT_NOW = [msg("Let's do it on Saturday."), msg("Let's talk about it at dinner."), msg('Thanks for the idea!')]
