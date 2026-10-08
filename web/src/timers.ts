// Timers on this device: quick timers from the header and cooking mode's step timers, one list.
// Kept outside React so they outlive a closed sheet, the wall's idle reset and leaving cooking
// mode, and in localStorage so a reload (an update) doesn't lose them. TimerHost (Timers.tsx)
// ticks and rings them. The helpers are pure, so web/test/timers.test.ts covers them.

/** `left`: set while paused (ms to go); `endsAt` only counts while it's running. `seconds`: for
 * Reset. `title` and `detail`: what it's for ("Tuesday Tacos", "Step 3 · Simmer"). `key`: where it
 * was started (a recipe step), so that spot can show it. */
export interface Timer { id: number; label: string; seconds: number; endsAt: number; done: boolean; left?: number; title?: string; detail?: string; key?: string }
export type NewTimer = Pick<Timer, 'label' | 'seconds' | 'title' | 'detail' | 'key'>

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** 10 -> "10 min", 90 -> "1 hr 30 min", 0.5 -> "30 sec". */
export function durationLabel(minutes: number) {
  if (minutes < 1) return `${Math.round(minutes * 60)} sec`
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60)
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`
}

/** Never more than its full time: `now` can trail a just-started timer by a tick. */
export const remaining = (t: Timer, now: number) => Math.min(t.seconds * 1000, t.left ?? t.endsAt - now)
export const isRunning = (t: Timer) => !t.done && t.left === undefined

export const added = (ts: Timer[], t: NewTimer, at: number): Timer[] =>
  [...ts, { ...t, id: Math.max(at, ...ts.map(x => x.id + 1)), endsAt: at + t.seconds * 1000, done: false }]
export const paused = (ts: Timer[], id: number, at: number) => ts.map(t => t.id === id && isRunning(t) ? { ...t, left: Math.max(0, t.endsAt - at) } : t)
export const resumed = (ts: Timer[], id: number, at: number) => ts.map(t => t.id === id && t.left !== undefined ? { ...t, endsAt: at + t.left, left: undefined } : t)
/** Back to the full time; a paused timer stays paused. */
export const wasReset = (ts: Timer[], id: number, at: number) => ts.map(t => t.id !== id ? t : t.left !== undefined ? { ...t, left: t.seconds * 1000 } : { ...t, endsAt: at + t.seconds * 1000, done: false })
/** The running timers that are up at `at`. */
export const due = (ts: Timer[], at: number) => ts.filter(t => isRunning(t) && t.endsAt <= at)

/** A chore's timer (ChoreTimer.tsx) is keyed to it, so the chore can show it and "Mark done" can find it. */
export const choreTimerKey = (choreId: string) => `chore:${choreId}`
/** The chore a timer was started for, or null. */
export const choreOfTimer = (t: Pick<Timer, 'key'>) => t.key?.startsWith('chore:') ? t.key.slice(6) : null

// ---- The store ----

const STORE_KEY = 'kinwall.timers'
const listeners = new Set<() => void>()
let timers: Timer[] = (() => {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
})()

function save(next: Timer[]) {
  timers = next
  try { if (next.length) localStorage.setItem(STORE_KEY, JSON.stringify(next)); else localStorage.removeItem(STORE_KEY) } catch { /* storage blocked: this page only */ }
  listeners.forEach(l => l())
}

export const getTimers = () => timers
export function subscribeTimers(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }
export const startTimer = (t: NewTimer) => save(added(timers, t, Date.now()))
export const pauseTimer = (id: number) => save(paused(timers, id, Date.now()))
export const resumeTimer = (id: number) => save(resumed(timers, id, Date.now()))
export const resetTimer = (id: number) => save(wasReset(timers, id, Date.now()))
export const stopTimer = (id: number) => save(timers.filter(t => t.id !== id))
/** OK on the "Time's up" banner: clears every timer that rang. */
export const dismissRung = () => save(timers.filter(t => !t.done))
/** Marks the timers that are up as done and returns them (each rings once). */
export function ringDue(at: number): Timer[] {
  const up = due(timers, at)
  if (up.length) save(timers.map(t => up.includes(t) ? { ...t, done: true } : t))
  return up
}
