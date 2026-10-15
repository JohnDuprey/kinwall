// A day of chores on the Chores tab (Chores.tsx): whose points they are, the order a column reads in,
// and which start times have passed.
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
