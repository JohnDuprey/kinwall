// One-line summaries for the Settings → General sections that open in a sheet (Features, Time
// cues, Night screen). Labels come in from Settings.tsx so these stay pure and testable.

import type { TransitionReminders, WarningRepeat } from './transitions.ts'

const list = (xs: string[]) => new Intl.ListFormat('en-US', { type: 'conjunction' }).format(xs)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "8 of 10 on" and, when some are off, "Off: Paint, Family messages." */
export function featuresSummary(rows: { label: string; on: boolean }[]): { summary: string; detail?: string } {
  const off = rows.filter(r => !r.on).map(r => r.label)
  if (!off.length) return { summary: `All ${rows.length} on` }
  return { summary: `${rows.length - off.length} of ${rows.length} on`, detail: `Off: ${off.join(', ')}.` }
}

/** "at 10 and 5 min, plus every 5 min in the last 30" / "every 2 min in the last 10 min". */
export function warningsPhrase(minutes: number[], repeat?: WarningRepeat | null): string {
  const at = minutes.length ? `at ${list([...minutes].sort((a, b) => b - a).map(String))} min` : ''
  const every = repeat ? `every ${repeat.every} min in the last ${repeat.within}${at ? '' : ' min'}` : ''
  return at && every ? `${at}, plus ${every}` : at || every
}

/** "Now / Next on · warnings at 10 and 5 min with sound · back to the calendar when idle". */
export function timeCuesSummary(c: { idleReset: boolean; nowNext: boolean; warnings: number[]; repeat?: WarningRepeat | null; sound: boolean }): string {
  const w = warningsPhrase(c.warnings, c.repeat)
  const parts = [
    c.nowNext && 'Now / Next on',
    w && `warnings ${w}${c.sound ? ' with sound' : ''}`,
    c.idleReset && 'back to the calendar when idle',
  ].filter((p): p is string => !!p)
  return parts.length ? cap(parts.join(' · ')) : 'All off'
}

/** A family member's transition reminders: "Off", or "At 10 and 5 min, plus every 5 min in the last 30 · counts down to leaving". */
export function transitionRemindersSummary(t: TransitionReminders | undefined): string {
  if (!t?.on) return 'Off'
  const w = warningsPhrase(t.minutes, t.repeat)
  if (!w) return 'On, no times picked yet'
  return `${cap(w)}${t.leaveBy ? ' · counts down to leaving when there\'s travel time' : ''}`
}

/** "Drawings and family photos, every 5 min, clock on", or "Clock only". */
export function nightSummary(n: { sources: string[]; every: number; bright: 'low' | 'medium'; clock: boolean }): string {
  if (!n.sources.length) return 'Clock only'
  return [cap(list(n.sources.map(s => s.charAt(0).toLowerCase() + s.slice(1)))), `every ${n.every} min`, n.bright === 'medium' && 'medium brightness', n.clock ? 'clock on' : 'no clock']
    .filter(Boolean).join(', ')
}
