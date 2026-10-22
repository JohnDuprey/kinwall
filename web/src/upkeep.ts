// Home upkeep's labels and groupings (Upkeep.tsx; server: routes/upkeep.ts). Pure, so
// web/test/upkeep.test.ts covers it. The dates themselves are upkeep-rules.ts, the same file the
// server uses.
import { daysBetween } from './upkeep-rules.ts'
import { formatDate, MONTH_DAY, t, tn } from './i18n.ts'
import type { UpkeepEntry, UpkeepJob, UpkeepThing } from './types.ts'

const day = (d: string) => new Date(`${d}T12:00:00`)
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
export const monthName = (m: number) => formatDate(new Date(2026, m - 1, 15), { month: 'long' })
export const ALL_MONTHS = MONTHS

/** Where a job stands, in words: "3 weeks late", "Due today", "Due in 5 days", "Due Mar 15". */
export function dueLabel(j: Pick<UpkeepJob, 'nextDue' | 'status'>, today: string): string {
  if (!j.nextDue) return t('Done')
  const gap = daysBetween(today, j.nextDue)
  if (gap < 0) return -gap >= 14 ? tn(Math.floor(-gap / 7), '{n} week late', '{n} weeks late') : tn(-gap, '{n} day late', '{n} days late')
  if (gap === 0) return t('Due today')
  if (gap === 1) return t('Due tomorrow')
  if (gap < 14) return tn(gap, 'Due in {n} day', 'Due in {n} days')
  return t('Due {date}', { date: formatDate(day(j.nextDue), MONTH_DAY) })
}

/** How a job repeats: "Every 3 months", "Every April 15 and October 15", "Once, on Nov 5". */
export function repeatLabel(j: Pick<UpkeepJob, 'repeatKind' | 'every' | 'unit' | 'onMonths' | 'onDay' | 'dueOn'>): string {
  if (j.repeatKind === 'once') return j.dueOn ? t('Once, on {date}', { date: formatDate(day(j.dueOn), MONTH_DAY) }) : t('Once')
  if (j.repeatKind === 'on') {
    if (!j.onMonths.length || !j.onDay) return t('On set dates')
    const dates = j.onMonths.map(m => formatDate(new Date(2026, m - 1, Math.min(j.onDay!, 28)), MONTH_DAY))
    return dates.length === 1 ? t('Every {date}', { date: dates[0] }) : t('Every {dates}', { dates: new Intl.ListFormat(undefined, { type: 'conjunction' }).format(dates) })
  }
  const n = j.every ?? 1
  return j.unit === 'day' ? tn(n, 'Every day', 'Every {n} days') : j.unit === 'week' ? tn(n, 'Every week', 'Every {n} weeks') : j.unit === 'year' ? tn(n, 'Every year', 'Every {n} years') : tn(n, 'Every month', 'Every {n} months')
}

/** The Due view's groups, in order: late, due soon (today and within the heads-up), later, and
 * one-offs that are done. Empty groups are left out. */
export function dueSections(jobs: UpkeepJob[]): { key: string; title: string; jobs: UpkeepJob[] }[] {
  const groups = [
    { key: 'overdue', title: t('Late'), jobs: jobs.filter(j => j.status === 'overdue') },
    { key: 'soon', title: t('Due soon'), jobs: jobs.filter(j => j.status === 'due' || j.status === 'soon') },
    { key: 'later', title: t('Later'), jobs: jobs.filter(j => j.status === 'later') },
    { key: 'done', title: t('Done'), jobs: jobs.filter(j => j.status === 'done') },
  ]
  return groups.filter(g => g.jobs.length)
}

/** Things by area, in the areas' order; things with no area last. */
export function thingSections<A extends { id: string; name: string; emoji: string | null }>(things: UpkeepThing[], areas: A[]): { key: string; title: string; things: UpkeepThing[] }[] {
  const byName = (a: UpkeepThing, b: UpkeepThing) => a.name.localeCompare(b.name)
  const out = areas.map(a => ({ key: a.id, title: `${a.emoji ? `${a.emoji} ` : ''}${a.name}`, things: things.filter(x => x.areaId === a.id).sort(byName) }))
  out.push({ key: 'none', title: t('Other things'), things: things.filter(x => !x.areaId || !areas.some(a => a.id === x.areaId)).sort(byName) })
  return out.filter(s => s.things.length)
}

/** A warranty in words: "Warranty until Mar 2028", "Warranty ends in 12 days", "Warranty ended". */
export function warrantyLabel(until: string | null, today: string): string | null {
  if (!until) return null
  const gap = daysBetween(today, until)
  if (gap < 0) return t('Warranty ended')
  if (gap <= 30) return tn(gap, 'Warranty ends in {n} day', 'Warranty ends in {n} days')
  return t('Warranty until {date}', { date: formatDate(day(until), { month: 'short', year: 'numeric' }) })
}

/** Dollars and cents: "$54", "$54.99". */
export const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`
/** "54.99" or "54" back to cents; null when empty, undefined when it isn't a price. */
export function parseCents(s: string): number | null | undefined {
  const v = s.trim().replace(/^\$/, '').replace(/,/g, '')
  if (!v) return null
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return undefined
  return Math.round(Number(v) * 100)
}

/** The history by year, newest first, with what each year cost (costs only reach a parent's device). */
export function historyYears(entries: UpkeepEntry[]): { year: string; entries: UpkeepEntry[]; costCents: number; priced: number }[] {
  const years = new Map<string, UpkeepEntry[]>()
  for (const e of entries) years.set(e.doneOn.slice(0, 4), [...(years.get(e.doneOn.slice(0, 4)) ?? []), e])
  return [...years.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([year, list]) => ({
    year, entries: list, costCents: list.reduce((s, e) => s + (e.costCents ?? 0), 0), priced: list.filter(e => e.costCents != null).length,
  }))
}

/** Lines of a textarea as a list (steps, supplies): trimmed, empty ones dropped. */
export const lines = (s: string) => s.split('\n').map(x => x.trim()).filter(Boolean)
