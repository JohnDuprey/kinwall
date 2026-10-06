// Activity chores: which seconds of an open activity count (the player in Plugins.tsx does the timing).
//
// Opening an activity for someone with an activity chore counts from launch, whatever the activity
// saves. A second counts while the page is visible and the player saw something within IDLE_MS: the
// launch, a tap or key press on the player, focus moving into the activity, or any message from it
// (loading, saving, speaking). Taps inside the sandboxed frame are invisible to Kinwall, so the
// window has to be generous: 5 minutes covers a long think, a story page or a game that only saves
// at the end of a round, and still caps a tablet left open at 5 minutes per walk-away.
export const IDLE_MS = 5 * 60_000

/** Whether this second of play counts: page visible, and something happened in the last IDLE_MS. */
export const countsNow = (visible: boolean, lastActive: number, now: number) => visible && now - lastActive < IDLE_MS

/** How full a chore's progress ring is, 0 to 1. */
export const ringFraction = (doneSeconds: number, needSeconds: number) => needSeconds > 0 ? Math.min(1, Math.max(0, doneSeconds / needSeconds)) : 1
