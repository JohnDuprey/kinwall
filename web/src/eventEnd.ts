// The event sheet's end follows its start. Until the end is picked, it's the start plus the family's
// new-event length (Settings → Calendars); once it's picked (or the event already had one), moving the
// start keeps that length. Dates are 'yyyy-MM-dd' and times 'HH:mm', local, as the sheet's inputs hold
// them. Pure, so web/test/eventEnd.test.ts covers it.
import { format } from 'date-fns'

export const EVENT_LENGTHS = [15, 30, 45, 60, 90, 120, 180] as const

type At = { date: string; time: string }
const local = (a: At) => new Date(`${a.date}T${a.time}:00`)

/** `minutes` after a local date and time; past midnight is the next day. */
export function addMinutes(a: At, minutes: number): At {
  const d = local(a)
  d.setMinutes(d.getMinutes() + minutes)
  return { date: format(d, 'yyyy-MM-dd'), time: format(d, 'HH:mm') }
}

/** The end for a start that moved from `from` to `to`: the same length as before when the end was
 * picked (and is after the old start), else the default length. */
export function endAfterStartMove(from: At, end: At, to: At, defaultMinutes: number, endPicked: boolean): At {
  const kept = Math.round((local(end).getTime() - local(from).getTime()) / 60000)
  return addMinutes(to, endPicked && kept > 0 ? kept : defaultMinutes)
}
