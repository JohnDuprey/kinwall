// Transition times ("neurospicy" settings): a few picked minutes before an event, plus an optional
// "every N minutes during the last M". Used by this device's warnings (Time cues) and a family
// member's transition reminders; the server expands a member's the same way (notify.ts).

export type WarningRepeat = { every: number; within: number }
export type TransitionReminders = { on: boolean; minutes: number[]; repeat: WarningRepeat | null; leaveBy: boolean }

export const MAX_WARNING_TIMES = 8
export const REPEAT_EVERY = [1, 2, 3, 5, 10, 15]
export const REPEAT_WITHIN = [5, 10, 15, 20, 30, 45, 60, 90, 120]

/** Picked minutes plus the repeat, deduped, latest first: [10] + every 5 in the last 15 -> [15, 10, 5]. */
export function warningTimes(minutes: number[] = [], repeat?: WarningRepeat | null): number[] {
  const all = new Set(minutes)
  if (repeat && repeat.every > 0) for (let m = repeat.every; m <= repeat.within; m += repeat.every) all.add(m)
  return [...all].filter(m => m >= 1 && m <= 120).sort((a, b) => b - a)
}
