// A chore's timer ("Practice piano · 20 min"): Start runs the app's own timer (timers.ts, rung by
// TimerHost in Timers.tsx, which offers "Mark done" for it). Keyed to the chore, so the chore shows
// its time left and a second Start doesn't start another.
import { announce } from './a11y.tsx'
import { start, useNow, useTimers } from './Timers.tsx'
import { choreTimerKey, clock, durationLabel, getTimers, remaining } from './timers.ts'

type TimedChore = { id: string; title: string; timerMinutes?: number | null }

/** Starts the chore's timer, labeled with the chore and `who` (the Lock Screen shows both). */
export function startChoreTimer(c: TimedChore, who?: string) {
  if (!c.timerMinutes) return
  if (getTimers().some(t => t.key === choreTimerKey(c.id) && !t.done)) { announce(`${c.title} timer is already running`); return }
  start({ label: `${c.title} · ${durationLabel(c.timerMinutes)}`, seconds: Math.round(c.timerMinutes * 60), title: who ?? 'Chore', key: choreTimerKey(c.id) })
}

/** The chore's timer that hasn't rung yet, if it's running here. */
export function useChoreTimer(id: string) {
  return useTimers().find(t => t.key === choreTimerKey(id) && !t.done)
}

/** "⏱ Start · 20 min", or the time left once it's running. */
export function ChoreTimerText({ chore }: { chore: TimedChore }) {
  const t = useChoreTimer(chore.id)
  const now = useNow(!!t)
  return <>⏱ {t ? `${clock(remaining(t, now))} left` : `Start · ${durationLabel(chore.timerMinutes ?? 0)}`}</>
}

/** The Board's Start button for a chore's timer, the time left while it runs. */
export function ChoreTimerButton({ chore, who }: { chore: TimedChore; who?: string }) {
  const t = useChoreTimer(chore.id)
  const now = useNow(!!t)
  if (t) return <span className="chore-timer-left" role="timer" aria-label={`${chore.title}: ${clock(remaining(t, now))} left`}>⏱ {clock(remaining(t, now))}</span>
  return <button type="button" className="btn btn-secondary chore-timer-start" aria-label={`Start ${chore.title}, ${durationLabel(chore.timerMinutes ?? 0)} timer`} onClick={() => startChoreTimer(chore, who)}>▶ Start</button>
}
