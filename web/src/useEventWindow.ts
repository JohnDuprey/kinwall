import { useEffect, useState } from 'react'
import { addDays } from 'date-fns'
import { api } from './api.ts'
import { eventDay } from './itemDue.ts'
import type { EventInstance } from './types.ts'

/** Events from 30 days back to 30 ahead: `upcoming` (next occurrence per id, for the picker) and
 * `byId` (a linked item's event - its next occurrence, else a past one). */
export function useEventWindow(dep: unknown) {
  const [events, setEvents] = useState<EventInstance[]>([])
  useEffect(() => {
    const now = new Date()
    api.getEvents(addDays(now, -30).toISOString(), addDays(now, 30).toISOString())
      .then(evs => setEvents(evs.sort((a, b) => eventDay(a).getTime() - eventDay(b).getTime()))).catch(() => setEvents([]))
  }, [dep])
  const now = Date.now()
  const byId = new Map<string, EventInstance>()
  for (const e of events) if (new Date(e.allDay ? e.end + 'T00:00:00' : e.end).getTime() > now && !byId.has(e.id)) byId.set(e.id, e)
  const upcoming = [...byId.values()]
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e)
  return { upcoming, byId }
}
