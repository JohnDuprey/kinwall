// Where a day's timed events go in the Day and Week grids (Calendar.tsx). Pure, so
// web/test/dayLayout.test.ts covers it.
import { minutesSinceMidnight } from './date.ts'
import type { EventInstance } from './types.ts'

/** Matches --hour-h in styles.css (comfortable/compact, and 44px on a phone on its side) so pixel
 * offsets in the time grid line up with the CSS hour rows. */
export function hourPx(density: string, shortLandscape = false): number {
  return shortLandscape ? 44 : density === 'compact' ? 40 : 60
}

/** Greedy column packing for overlapping timed events on one day. Simple, not cluster-optimal.
 * ponytail: good enough for a wall calendar's visual density; revisit with an interval-graph
 * algorithm if events routinely overlap 4+ ways. */
export function layoutColumns(evs: EventInstance[], tz: string, minMinutes = 20) {
  const withMin = evs
    .map(ev => ({ ev, s: minutesSinceMidnight(ev.start, tz), e: Math.max(minutesSinceMidnight(ev.end, tz), minutesSinceMidnight(ev.start, tz) + minMinutes) }))
    .sort((a, b) => a.s - b.s)
  // Columns are counted per cluster of overlapping events, not per day - otherwise one 9am
  // clash would halve the width of every other event that day.
  const out: ((typeof withMin)[number] & { col: number; totalCols: number })[] = []
  let cluster: ((typeof withMin)[number] & { col: number })[] = []
  let colEnds: number[] = []
  let clusterEnd = -1
  const flush = () => { for (const p of cluster) out.push({ ...p, totalCols: Math.max(1, colEnds.length) }) }
  for (const item of withMin) {
    if (item.s >= clusterEnd) { flush(); cluster = []; colEnds = [] }
    let col = colEnds.findIndex(end => end <= item.s)
    if (col === -1) { col = colEnds.length; colEnds.push(item.e) } else { colEnds[col] = item.e }
    cluster.push({ ...item, col })
    clusterEnd = Math.max(clusterEnd, item.e)
  }
  flush()
  return out
}

/** The inset (px) a busy event steps in by where it overlaps a free one, leaving the free one's edge showing. */
export const FREE_EDGE = 14

/** layoutColumns, with free events (Show as free) kept out of the way: they're packed among
 * themselves and drawn first (behind), at full width; busy events are packed among themselves, so a
 * delivery window never squeezes a real appointment into half a column, and step in by FREE_EDGE
 * where they overlap a free one so its striped edge stays visible. left/width are CSS values. */
export function layoutDay(evs: EventInstance[], tz: string, minMinutes = 20) {
  const free = layoutColumns(evs.filter(e => e.busy === false), tz, minMinutes)
  const busy = layoutColumns(evs.filter(e => e.busy !== false), tz, minMinutes)
  const place = (col: number, total: number, inset: number) => ({
    left: `calc(${inset}px + (100% - ${inset}px) * ${col / total} + 2px)`,
    width: `calc((100% - ${inset}px) / ${total} - 4px)`,
  })
  return [
    ...free.map(p => ({ ...p, free: true, ...place(p.col, p.totalCols, 0) })),
    ...busy.map(p => ({ ...p, free: false, ...place(p.col, p.totalCols, free.some(f => f.s < p.e && p.s < f.e) ? FREE_EDGE : 0) })),
  ]
}

/** One event shown once. Two instances are the same event when they share an id and start (a
 * repeat in the feed), or when they come from different calendars with the same title (ignoring
 * case and spacing), start, end and all-day flag: the same meeting synced from two connected
 * calendars. Two same-titled events on one calendar stay apart (each can be opened and changed).
 * The first copy (not hidden, if any is) is kept and opens on tap; memberIds become everyone's
 * across the copies.
 * ponytail: matches on title+time, not the provider's iCalUID (Kinwall doesn't store it); a copy
 * renamed on one calendar shows twice. Store the UID at sync if that comes up. */
export function dedupeEvents(evs: EventInstance[]): EventInstance[] {
  const groups = new Map<string, { kept: EventInstance; ids: Set<string>; calendars: Set<string> }[]>()
  const out: EventInstance[] = []
  for (const ev of evs) {
    const key = `${ev.allDay}|${ev.start}|${ev.end}|${ev.title.trim().replace(/\s+/g, ' ').toLowerCase()}`
    const list = groups.get(key) ?? []
    groups.set(key, list)
    const same = list.find(g => g.ids.has(ev.id) || !g.calendars.has(ev.calendarId))
    if (!same) { list.push({ kept: ev, ids: new Set([ev.id]), calendars: new Set([ev.calendarId]) }); out.push(ev); continue }
    same.ids.add(ev.id); same.calendars.add(ev.calendarId)
    const memberIds = [...new Set([...same.kept.memberIds, ...ev.memberIds])]
    const kept = same.kept.hidden && !ev.hidden ? ev : same.kept
    const merged = { ...kept, memberIds }
    out[out.indexOf(same.kept)] = merged
    same.kept = merged
  }
  return out
}

/** Who an event is for, in family order (memberIds already holds the calendar's members when the
 * event has none of its own). */
export function eventPeople<M extends { id: string }>(ev: Pick<EventInstance, 'memberIds'>, members: M[]): M[] {
  return members.filter(m => ev.memberIds.includes(m.id))
}

/** Where + starts a new event: on the day being looked at (`day`), at the next half hour when that's
 * today, else 9 AM; an hour long. Local time, like tapping a slot in the grid. */
export function newEventTimes(day: Date, now = new Date()): { start: string; end: string } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9)
  if (start.toDateString() === now.toDateString()) {
    start.setHours(now.getHours(), now.getMinutes() < 30 ? 30 : 60)
  }
  return { start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString() }
}

/** The day + adds to: Day view's day; Week / 3 Day and Month: today when it's on screen, else the
 * first day shown; Schedule: its first day (today, unless paged ahead). */
export function newEventDay(shown: Date[], now = new Date()): Date {
  return shown.find(d => d.toDateString() === now.toDateString()) ?? shown[0] ?? now
}
