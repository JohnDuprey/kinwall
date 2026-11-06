// Older servers and failed reads retain a retry. Successful reads wake at a server deadline,
// measured from receipt so an incorrect device clock cannot shift a dose by hours.
export type TimedDue = { checkedAt?: string; recheckAt?: string; receivedAt: number }
export function dueRecheckDelay(due: TimedDue | null, now: number): number {
  if (!due?.checkedAt || !due.recheckAt) return 60_000
  const delay = Date.parse(due.recheckAt) - Date.parse(due.checkedAt) - (now - due.receivedAt)
  return Number.isFinite(delay) ? Math.max(1000, Math.min(2_147_483_647, delay)) : 60_000
}
