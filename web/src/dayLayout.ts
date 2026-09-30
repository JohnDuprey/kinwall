// Where a day's timed events go in the Day and Week grids (Calendar.tsx). Pure, so
// web/test/dayLayout.test.ts covers it.
import { minutesSinceMidnight } from './date.ts'
import type { EventInstance } from './types.ts'

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
