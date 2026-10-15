// Summaries for the Settings → General sections that open in a sheet (Features, Time cues, Night
// screen, Appearance). Labels come in from Settings.tsx so these stay pure and testable.

import type { TransitionReminders, WarningRepeat } from './transitions.ts'
import type { ThemeMode } from './types.ts'
import { intlLocale, t, msg, tm } from './i18n.ts'

/** One setting in a summary, shown as a small read-only chip. `family`: it follows the household's
 * value (shown with 🏠). */
export interface Chip { icon?: string; label: string; family?: boolean }

const list = (xs: string[]) => new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(xs)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "8 of 10 on" and, when some are off, "Off: Paint, Family messages." */
export function featuresSummary(rows: { label: string; on: boolean }[]): { summary: string; detail?: string } {
  const off = rows.filter(r => !r.on).map(r => r.label)
  if (!off.length) return { summary: t('All {n} on', { n: rows.length }) }
  return { summary: t('{on} of {total} on', { on: rows.length - off.length, total: rows.length }), detail: t('Off: {names}.', { names: off.join(', ') }) }
}

/** "at 10 and 5 min, plus every 5 min in the last 30" / "every 2 min in the last 10 min". */
export function warningsPhrase(minutes: number[], repeat?: WarningRepeat | null): string {
  const at = minutes.length ? t('at {times} min', { times: list([...minutes].sort((a, b) => b - a).map(String)) }) : ''
  const every = repeat ? t(at ? 'every {every} min in the last {within}' : 'every {every} min in the last {within} min', { every: repeat.every, within: repeat.within }) : ''
  return at && every ? t('{at}, plus {every}', { at, every }) : at || every
}

/** The time cues that are on, one chip each; "All off" when none are. */
export function timeCuesSummary(c: { nowNext: boolean; warnings: number[]; repeat?: WarningRepeat | null; sound: boolean }): Chip[] {
  const at = c.warnings.length ? t('At {times} min', { times: list([...c.warnings].sort((a, b) => b - a).map(String)) }) : ''
  const chips: (Chip | false)[] = [
    c.nowNext && { icon: '⏭️', label: t('Now / Next') },
    !!at && { icon: '🔔', label: at },
    !!c.repeat && { icon: '🔁', label: t('Every {every} min in the last {within}', { every: c.repeat.every, within: c.repeat.within }) },
    (!!at || !!c.repeat) && c.sound && { icon: '🔊', label: t('Sound') },
  ]
  const on = chips.filter((x): x is Chip => !!x)
  return on.length ? on : [{ label: t('All off') }]
}

const MODE_CHIPS: Record<ThemeMode, Chip> = { light: { icon: '☀️', label: msg('Light') }, dark: { icon: '🌙', label: msg('Dark') }, auto: { icon: '🌗', label: msg('Auto') }, scheduled: { icon: '🕗', label: msg('Scheduled') } }
type AppearanceKey = 'scheme' | 'mode' | 'textScale' | 'density' | 'typeface' | 'timeFormat'

/** The look in effect, one chip per setting (names come in resolved). `own` says which ones this
 * device sets itself; the rest follow the family and are marked so. `own` null = the family's card.
 * Mode shows when it's set at this level; low-stimulation and custom colors only when on. The time
 * format (a Household setting) only on a device's card. */
export function appearanceChips(a: {
  scheme: { emoji: string; name: string }; custom?: boolean; mode?: ThemeMode; textScale: string; density: string
  typeface: string; timeFormat?: string; lowStim?: boolean
}, own: Partial<Record<AppearanceKey, boolean>> | null): Chip[] {
  const fam = (k: AppearanceKey) => own ? !own[k] : undefined
  const chips: (Chip | false | undefined)[] = [
    { icon: a.scheme.emoji, label: a.scheme.name, family: fam('scheme') },
    a.custom && { icon: '🎨', label: t('Custom colors') },
    a.mode && { ...MODE_CHIPS[a.mode], label: tm(MODE_CHIPS[a.mode].label), family: fam('mode') },
    { icon: 'Aa', label: a.textScale, family: fam('textScale') },
    { label: a.density, family: fam('density') },
    { icon: '🔤', label: a.typeface, family: fam('typeface') },
    !!a.timeFormat && { icon: '🕒', label: a.timeFormat, family: fam('timeFormat') },
    a.lowStim && { icon: '🍃', label: t('Low-stimulation') },
  ]
  return chips.filter((x): x is Chip => !!x)
}

/** A family member's transition reminders: "Off", or "At 10 and 5 min, plus every 5 min in the last 30 · counts down to leaving". */
export function transitionRemindersSummary(r: TransitionReminders | undefined): string {
  if (!r?.on) return t('Off')
  const w = warningsPhrase(r.minutes, r.repeat)
  if (!w) return t('On, no times picked yet')
  return `${cap(w)}${r.leaveBy ? ` · ${t("counts down to leaving when there's travel time")}` : ''}`
}

/** The night screen's choices, one chip each: the picture sources, how often, brightness, clock. */
export function nightSummary(n: { sources: string[]; every: number; bright: 'low' | 'medium'; clock: boolean; pos?: string }): Chip[] {
  const pos = n.pos?.toLowerCase() // a fixed clock position; absent = moves around (the default)
  if (!n.sources.length) return [{ icon: '🕒', label: pos ? t('Clock only, {pos}', { pos }) : t('Clock only') }]
  const chips: (Chip | false)[] = [
    ...n.sources.map(label => ({ label })),
    { icon: '⏱️', label: t('Every {n} min', { n: n.every }) },
    n.bright === 'medium' && { icon: '🔆', label: t('Medium brightness') },
    !n.clock ? { label: t('No clock') } : { icon: '🕒', label: pos ? t('Clock {pos}', { pos }) : t('Clock on') },
  ]
  return chips.filter((x): x is Chip => !!x)
}

/** The family's Night card: the night hours, then what they do. `null` = no night hours. The PIN
 * shows only while walls rest (it's what wakes them). */
export function nightHoursChips(n: { hours: string; rest: boolean; hold: boolean; pin: boolean } | null): Chip[] {
  if (!n) return [{ icon: '🌙', label: t('Night hours off') }]
  const chips: (Chip | false)[] = [
    { icon: '🌙', label: n.hours },
    n.rest ? { icon: '🖼️', label: t('Walls rest') } : { label: t('Walls stay on') },
    n.hold ? { icon: '🔕', label: t('Reminders held') } : { label: t('Reminders on') },
    n.rest && n.pin && { icon: '🔒', label: t('PIN') },
  ]
  return chips.filter((x): x is Chip => !!x)
}
