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
