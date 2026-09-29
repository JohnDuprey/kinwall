// The daily check-in row at the end of a person's day (Snapshot.tsx). Pure, so web/test/checkIn.test.ts covers it.
import type { Snapshot, TempCheckSettings } from './types.ts'

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

/** Where a check-in link (#/calendar?checkin=<member>) lands in their day: the evening check from
 * their evening time (goal check or battery), else the Temp check, else the daily check-in row. */
export function checkInFocus(tc: TempCheckSettings | undefined, nowMinutes: number): 'evening' | 'temp' | 'checkin' {
  if (!tc?.on) return 'checkin'
  const [h, m] = tc.eveningTime.split(':').map(Number)
  return (tc.evening || tc.battery) && nowMinutes >= h * 60 + m ? 'evening' : 'temp'
}
