// The daily check-in row at the end of a person's day (Snapshot.tsx). Pure, so web/test/checkIn.test.ts covers it.
import type { Snapshot } from './types.ts'

export type CheckInState = 'hidden' | 'locked' | 'ready' | 'done'

/** Hidden on the week view or while check-ins are off; otherwise done, or ready once they've reached the end. */
export function checkInState(snap: Pick<Snapshot, 'range' | 'checkInPoints' | 'checkedIn'> | null, reachedEnd: boolean): CheckInState {
  if (!snap || snap.range !== 'day' || !snap.checkInPoints) return 'hidden'
  return snap.checkedIn ? 'done' : reachedEnd ? 'ready' : 'locked'
}

export function checkInLabel(state: CheckInState, points: number): string {
  if (state === 'done') return 'Checked in today ✓'
  if (state === 'locked') return 'Read to the end to check in'
  return `I'm all caught up ✓ · +${points} point${points === 1 ? '' : 's'}`
}
