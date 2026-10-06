// Activity chores: which seconds of an open activity count (the player in Plugins.tsx does the timing).
//
// Play counts in 15-second steps from launch. A step counts only if the player did something in it:
// a real tap or key press inside the activity (kinwall.js forwards those as 'active', at most one
// every 3 seconds), an answer saved, or a word spoken. A step with none of those counts 0, and only
// its seconds with the page visible count at all. Launching or loading doesn't count as playing.
// 15 seconds is short enough that a tablet left open earns nothing, and long enough that reading a
// question or thinking about an answer between taps still counts.
export const BUCKET_MS = 15_000
const BUCKET_S = BUCKET_MS / 1000

/** The clock for one open activity, launched at `launched` (ms). */
export function playClock(launched: number) {
  const stepOf = (t: number) => Math.floor((t - launched) / BUCKET_MS)
  let step = 0, seconds = 0
  const active = new Set<number>() // steps with an interaction in them
  const pending = () => active.has(step) ? Math.min(seconds, BUCKET_S) : 0
  return {
    /** The player did something at `t`. */
    interact(t: number) { active.add(stepOf(t)) },
    /** Once a second: seconds that just counted (a step ended), usually 0. */
    tick(t: number, visible: boolean): number {
      const now = stepOf(t - 1) // the second that just ended
      let counted = 0
      if (now !== step) {
        counted = pending()
        active.forEach(s => { if (s <= step) active.delete(s) })
        step = now; seconds = 0
      }
      if (visible) seconds++
      return counted
    },
    /** Seconds the current step will count if it ends now (0 until there's an interaction in it). */
    pending,
    /** Counts the current step's seconds now (a chore just reached its time); the step goes on from 0. */
    settle() { const n = pending(); seconds = 0; return n },
  }
}

/** How full a chore's progress ring is, 0 to 1. */
export const ringFraction = (doneSeconds: number, needSeconds: number) => needSeconds > 0 ? Math.min(1, Math.max(0, doneSeconds / needSeconds)) : 1
