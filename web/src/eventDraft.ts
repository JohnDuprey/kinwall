// The "Add to Kinwall" Shortcut's event link (POST /api/share on the server):
// #/calendar?draft=event&title=…&date=YYYY-MM-DD&time=HH:MM&end=HH:MM&place=…&notes=… becomes the new event
// sheet's prefill, for a parent to check and save. Pure, so web/test/eventDraft.test.ts covers it.
import type { EventInstance } from './types.ts'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/

/** The prefill, or null when the link isn't a draft. Times are local (the household's, on its phone);
 * a date alone is all day (end exclusive), a time alone is today. */
export function eventDraft(q: URLSearchParams, today: string): Partial<EventInstance> | null {
  if (q.get('draft') !== 'event') return null
  const date = DAY.test(q.get('date') ?? '') && !Number.isNaN(Date.parse(q.get('date')!)) ? q.get('date')! : null
  const time = CLOCK.test(q.get('time') ?? '') ? q.get('time')! : null
  const end = CLOCK.test(q.get('end') ?? '') ? q.get('end')! : null
  const base = { title: (q.get('title') ?? '').slice(0, 200), location: q.get('place')?.slice(0, 500) || null, ...(q.get('notes')?.trim() && { description: q.get('notes')!.trim().slice(0, 5000) }) }
  if (date && !time) {
    const next = new Date(`${date}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    return { ...base, allDay: true, start: date, end: next.toISOString().slice(0, 10) }
  }
  if (!time) return { ...base, allDay: false }
  const day = date ?? today
  return { ...base, allDay: false, start: `${day}T${time}`, ...(end && end > time && { end: `${day}T${end}` }) }
}
