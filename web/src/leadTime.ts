// When to get going for an event: leave by (its travel time) or, for a meal's event, start prep by
// (the meal time minus the recipe's time, server/src/prepBy.ts). One wording for the Board, Now /
// Next, the calendar, a person's day and the app's Live Activity.
import type { EventInstance } from './types.ts'

export type Lead = { at: string; prep: boolean }

/** Timed and shown as busy: what Now / Next, transition warnings and leave-by count. A free event
 * (a delivery window) is on the calendar but never "now", and nobody has to leave for it. */
export const blocksTime = (e: Pick<EventInstance, 'allDay' | 'busy'>) => !e.allDay && e.busy !== false

/** A meal's prep time first (meals have no travel time), else the leave-by time; null for neither. */
export function leadOf(e: Pick<EventInstance, 'leaveAt'> & { prepAt?: string | null }): Lead | null {
  return e.prepAt ? { at: e.prepAt, prep: true } : e.leaveAt ? { at: e.leaveAt, prep: false } : null
}

export const leadIcon = (l: Lead) => (l.prep ? '🍳' : '🚗')
/** "Leave by 4:40 PM" / "Start prep by 5:15 PM" (lowercase first word mid-sentence: `lower`). */
export const leadBy = (l: Lead, time: string, lower = false) => `${l.prep ? (lower ? 'start' : 'Start') + ' prep' : lower ? 'leave' : 'Leave'} by ${time}`
/** "Leave for Soccer" / "Start prep for Dinner · Tuesday Tacos". */
export const leadFor = (l: Lead, title: string) => `${l.prep ? 'Start prep' : 'Leave'} for ${title}`
/** "🚗 Leave by 4:40 PM" / "🍳 Start prep by 5:15 PM" for an event, or null; `time` formats the ISO time. */
export function leadText(e: Parameters<typeof leadOf>[0], time: (iso: string) => string): string | null {
  const l = leadOf(e)
  return l && `${leadIcon(l)} ${leadBy(l, time(l.at))}`
}
