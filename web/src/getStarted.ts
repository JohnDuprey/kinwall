// The Board's "Finish setting up Kinwall" card (GetStarted.tsx): which rows still apply. Worked out
// from live counts, so there's no checklist to store. Pure, so it's tested in
// test/getStarted.test.ts.

export type GetStartedItem = 'calendar' | 'wall' | 'family' | 'secondWayIn'

/** null: that count couldn't be loaded, so its row stays hidden rather than nagging wrongly. */
export interface GetStartedCounts {
  calendars: number | null
  displays: number | null // paired wall screens and kids' devices
  members: number
  passkeys: number | null
  recoveryCodes: number | null // unused ones
}

export function getStartedItems(c: GetStartedCounts): GetStartedItem[] {
  const items: GetStartedItem[] = []
  if (c.calendars === 0) items.push('calendar')
  if (c.displays === 0) items.push('wall')
  if (c.members <= 1) items.push('family')
  if (c.passkeys !== null && c.recoveryCodes !== null && c.passkeys <= 1 && c.recoveryCodes === 0) items.push('secondWayIn')
  return items
}

export const GET_STARTED_KEY = 'kinwall.getStartedDismissedAt'
export const GET_STARTED_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

/** "Not now" was tapped on this device within the last 30 days. */
export function getStartedSnoozed(dismissedAt: string | null, now: number): boolean {
  const at = Number(dismissedAt)
  return !!dismissedAt && Number.isFinite(at) && now - at < GET_STARTED_SNOOZE_MS
}
