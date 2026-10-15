// Where a day's timed events go in the Day and Week grids (Calendar.tsx). Pure, so
// web/test/dayLayout.test.ts covers it.
import { minutesSinceMidnight } from './date.ts'
import type { EventInstance } from './types.ts'

/** Matches --hour-h in styles.css (comfortable/compact, 44px on a phone on its side, compact's
 * 40px on a short landscape tablet, 48px times --cast-k on a cast screen (`castK`, 0 when it isn't one)
 * and the comfortable/compact sizes times --screen-k on a big screen) so pixel offsets in the time
 * grid line up with the CSS hour rows. */
export function hourPx(density: string, shortLandscape = false, shortTablet = false, castK = 0, screenK = 1): number {
  if (castK) return 48 * castK
  return shortLandscape ? 44 : (density === 'compact' || shortTablet ? 40 : 60) * screenK
}

/** A wall or cast screen's hour height (px): 7 AM to 9 PM in the grid's `space` without scrolling,
 * never taller than the usual `base` nor shorter than `min` (then the grid scrolls, see gridTop). */
export const wallHourPx = (space: number, base: number, min = 40) => Math.max(min, Math.min(base, Math.floor(space / 14)))

/** The hour a time grid opens at: 7 AM; on today, an hour before now (`now`, hours) while that still
 * leaves 9 PM in view (`visible`: hours on screen), and always with now on screen. */
export function gridTop(now: number, visible: number, isToday: boolean): number {
  if (!isToday) return 7
  const top = Math.min(Math.max(now - 1, 7), Math.max(7, 21 - visible))
  return now >= top && now < top + visible ? top : Math.max(0, now - visible / 3)
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

/** The inset (CSS length) a busy event steps in by where it overlaps a free one: a lane where the free
 * one's striped edge and its title ("📦 Grocery delivery", wrapping) stay showing. */
export const FREE_EDGE = 'max(14px, min(22%, 100px))'

/** layoutColumns, with free events (Show as free) kept out of the way: they're packed among
 * themselves and drawn first (behind), at full width; busy events are packed among themselves, so a
 * delivery window never squeezes a real appointment into half a column, and step in by FREE_EDGE
 * where they overlap a free one so its edge and title stay visible (`covered`: a free one some busy
 * event overlaps, whose words keep to that lane). left/width are CSS values. */
export function layoutDay(evs: EventInstance[], tz: string, minMinutes = 20) {
  const free = layoutColumns(evs.filter(e => e.busy === false), tz, minMinutes)
  const busy = layoutColumns(evs.filter(e => e.busy !== false), tz, minMinutes)
  const place = (col: number, total: number, inset: string) => ({
    left: `calc(${inset} + (100% - ${inset}) * ${col / total} + 2px)`,
    width: `calc((100% - ${inset}) / ${total} - 4px)`,
  })
  const overlaps = (a: { s: number; e: number }, b: { s: number; e: number }) => a.s < b.e && b.s < a.e
  return [
    ...free.map(p => ({ ...p, free: true, covered: busy.some(b => overlaps(b, p)), ...place(p.col, p.totalCols, '0px') })),
    ...busy.map(p => ({ ...p, free: false, covered: false, ...place(p.col, p.totalCols, free.some(f => overlaps(f, p)) ? FREE_EDGE : '0px') })),
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
export function dedupeEvents<E extends EventInstance & { date?: string }>(evs: E[]): E[] {
  const groups = new Map<string, { kept: E; ids: Set<string>; calendars: Set<string> }[]>()
  const out: E[] = []
  for (const ev of evs) {
    // The Board lists a multi-day event under each of its days (`date`): one copy per day stays.
    const key = `${ev.date ?? ''}|${ev.allDay}|${ev.start}|${ev.end}|${ev.title.trim().replace(/\s+/g, ' ').toLowerCase()}`
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
 * today, else 9 AM (the event sheet picks the end). Local time, like tapping a slot in the grid. */
export function newEventStart(day: Date, now = new Date()): { start: string } {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9)
  if (start.toDateString() === now.toDateString()) {
    start.setHours(now.getHours(), now.getMinutes() < 30 ? 30 : 60)
  }
  return { start: start.toISOString() } // the event sheet adds the family's event length
}

/** The day + adds to: Day view's day; Week / 3 Day and Month: today when it's on screen, else the
 * first day shown; Schedule: its first day (today, unless paged ahead). */
export function newEventDay(shown: Date[], now = new Date()): Date {
  return shown.find(d => d.toDateString() === now.toDateString()) ?? shown[0] ?? now
}

/** The event sheet's Repeat menu: what a stored rule shows as ('' when it doesn't repeat), and the
 * rule each choice saves. Anything fancier (FREQ=WEEKLY;BYDAY=MO,WE) shows as its frequency and is
 * kept as long as the menu isn't changed (Calendar.tsx). */
export type RepeatChoice = '' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export const repeatChoice = (rrule: string | null | undefined): RepeatChoice =>
  (['daily', 'weekly', 'monthly', 'yearly'] as const).find(f => rrule?.includes(`FREQ=${f.toUpperCase()}`)) ?? ''
export const repeatRule = (choice: RepeatChoice): string | null => choice ? `FREQ=${choice.toUpperCase()}` : null
