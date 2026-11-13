import { dateKey } from './date.ts'

/** Milliseconds until the next minute starts (plus a little, so the new minute has surely begun). */
export function msToNextMinute(now: number): number {
  return 60_000 - (now % 60_000) + 50
}

/** Calls `tick` right as each minute starts, so clocks change on the minute instead of up to an
 * interval late; and again when the page comes back to the front (background tabs' timers are
 * slowed, so the clock catches up at once). Returns the cleanup. */
export function onMinute(tick: () => void): () => void {
  let id: ReturnType<typeof setTimeout>
  const schedule = () => { id = setTimeout(() => { tick(); schedule() }, msToNextMinute(Date.now())) }
  const wake = () => { if (document.visibilityState === 'visible') { clearTimeout(id); tick(); schedule() } }
  schedule()
  document.addEventListener('visibilitychange', wake)
  return () => { clearTimeout(id); document.removeEventListener('visibilitychange', wake) }
}

/** Calls `change(was)` when the device's day has moved on since the last check (midnight, or a
 *  tablet waking a day later), checked each minute, so a wall nobody touches still turns the page.
 *  `was`: the day it had been, 'YYYY-MM-DD'. Returns the cleanup. */
export function onDayChange(change: (was: string) => void): () => void {
  let day = dateKey(new Date())
  return onMinute(() => { const was = day; day = dateKey(new Date()); if (day !== was) change(was) })
}

/** A date on screen once the day has changed from `was`: one that was showing today shows the new
 *  today; a date someone paged or tapped to stays. */
export function rollToToday(shown: Date, was: string, now = new Date()): Date {
  return dateKey(shown) === was ? now : shown
}
