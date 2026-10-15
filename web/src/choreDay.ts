// A day of chores on the Chores tab (Chores.tsx): whose points they are, the order a column reads in,
// and which start times have passed.
import { tn } from './i18n.ts'
type Done = { points: number; completed: boolean; completedBy: string | null; memberId: string | null }

/** Points a person earned from the day's chores: whoever it was credited to, so an Anyone chore
 * Leo did counts for Leo, not for the Anyone column. */
export const pointsEarned = (chores: Done[], memberId: string) =>
  chores.reduce((n, c) => n + (c.completed && (c.completedBy ?? c.memberId) === memberId ? c.points : 0), 0)

/** What the Anyone column handed out: its done chores credited to someone ("Nobody in particular" earns nothing). */
export const pointsGivenOut = (chores: Done[]) =>
  chores.reduce((n, c) => n + (!c.memberId && c.completed && c.completedBy ? c.points : 0), 0)

/** A start time ("HH:MM") that's already gone by `now` ("HH:MM"), for a chore still to do. */
export const isLate = (dueTime: string | null | undefined, now: string) => !!dueTime && /^\d{2}:\d{2}$/.test(dueTime) && dueTime < now

/** A column in reading order: what's still to do first (by start time, then the rest in their own
 * order), then what's ticked. Stable, so cards without a time keep the order a parent gave them. */
export function choreOrder<C extends { dueTime: string | null; completed: boolean; pending?: boolean }>(list: C[]): C[] {
  const time = (c: C) => (c.dueTime && /^\d{2}:\d{2}$/.test(c.dueTime) ? c.dueTime : '99:99')
  const ticked = (c: C) => (c.completed || c.pending ? 1 : 0)
  return list.map((c, i) => ({ c, i })).sort((a, b) => ticked(a.c) - ticked(b.c) || (ticked(a.c) ? 0 : time(a.c).localeCompare(time(b.c))) || a.i - b.i).map(x => x.c)
}

/** Whether a tick waits for a parent's OK (as the server decides): never from a parent's device;
 * otherwise an activity chore whose activity is gone always does, else the chore's own setting or
 * its person's. */
export const waitsForOk = (c: { needsApproval?: boolean | null; activity?: { available: boolean } | null }, person: { needsApproval?: boolean } | undefined, parentDevice: boolean) =>
  !parentDevice && ((!!c.activity && !c.activity.available) || !!(c.needsApproval ?? person?.needsApproval))

/** What completing a checklist chore earns, for its All done! screen. */
export const earnedText = (points: number, name: string, waits: boolean) =>
  waits ? tn(points, 'a grown-up will OK it, then {name} gets {n} point', 'a grown-up will OK it, then {name} gets {n} points', { name }) : tn(points, '⭐ {n} point for {name}', '⭐ {n} points for {name}', { name })
