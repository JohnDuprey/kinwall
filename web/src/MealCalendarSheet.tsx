import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { mealDayLabel, moveMealDate } from './meal-date.ts'
import type { Meal } from './meal-types.ts'
import type { CalendarEntry, EventInstance } from './types.ts'

export default function MealCalendarSheet({ meal, onClose, onLinked }: { meal: Meal; onClose: () => void; onLinked: (meal: Meal) => void }) {
  const { toast } = useApp()
  const id = useId()
  const [events, setEvents] = useState<EventInstance[]>([])
  const [calendars, setCalendars] = useState<CalendarEntry[]>([])
  const [eventId, setEventId] = useState('')
  const [calendarId, setCalendarId] = useState('')
  const [duration, setDuration] = useState(60)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let canceled = false
    Promise.all([api.getCalendars(), api.getEvents(`${moveMealDate(meal.date, -7)}T00:00:00Z`, `${moveMealDate(meal.date, 8)}T00:00:00Z`)]).then(([cals, values]) => {
      if (!canceled) { setCalendars(cals.filter(c => c.kind === 'local' && c.writable)); setEvents([...new Map(values.map(event => [event.id, event])).values()]); setLoading(false) }
    }).catch(e => { if (!canceled) { setError(e instanceof Error ? e.message : 'Could not load calendars.'); setLoading(false) } })
    return () => { canceled = true }
  }, [meal.date, tick])
  const run = async (action: () => Promise<Meal>, message: string) => {
    setBusy(true); setError('')
    try { const saved = await action(); toast(message); onLinked(saved); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update calendar link.') }
    finally { setBusy(false) }
  }
  return <Sheet title="Meal calendar link" onClose={() => { if (!busy) onClose() }} dismissable={!busy}>
    <p>{meal.title} · {mealDayLabel(meal.date)}{meal.plannedTime ? ` · ${meal.plannedTime}` : ' · No planned time'}</p>
    <p className="field-hint">Calendar actions use the saved meal shown above. Changes in the meal editor take effect after saving. Created events are independent; later meal edits do not update them.</p>
    {meal.calendarEventId ? <>
      <p><a href={`#/calendar?event=${encodeURIComponent(meal.calendarEventId)}&at=${meal.date}`}>Open linked event</a></p>
      <button className="btn btn-secondary" disabled={busy} onClick={() => void run(() => api.unlinkMealCalendar(meal.id), 'Calendar event unlinked')}>Unlink (keep event)</button>
    </> : <fieldset className="meal-fieldset" disabled={busy || loading}>
      <h3>Link an existing event</h3>
      <div className="field"><label htmlFor={`${id}-event`}>Event near this meal’s date</label><select id={`${id}-event`} value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Choose an event</option>{events.map(event => <option key={event.id} value={event.id}>{event.title} · {event.start.slice(0, 10)}</option>)}</select></div>
      <button className="btn btn-secondary" disabled={!eventId || busy || loading} onClick={() => void run(() => api.linkMealCalendar(meal.id, eventId), 'Calendar event linked')}>Link event</button>
      <h3>Add to calendar</h3>
      <div className="field"><label htmlFor={`${id}-calendar`}>Local calendar</label><select id={`${id}-calendar`} value={calendarId} onChange={e => setCalendarId(e.target.value)}><option value="">Default local calendar</option>{calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}</select></div>
      {meal.plannedTime && <div className="field"><label htmlFor={`${id}-duration`}>Duration (minutes)</label><input id={`${id}-duration`} type="number" min="1" max="1440" step="1" value={duration || ''} onChange={e => setDuration(Number(e.target.value))} /></div>}
      <p className="field-hint">Creates a {meal.plannedTime ? 'timed' : 'one-day all-day'} event on a writable local calendar. You can link an existing event from any calendar above.</p>
      <button className="btn btn-primary" disabled={busy || loading || !Number.isInteger(duration) || duration < 1 || duration > 1440} onClick={() => void run(() => api.createMealCalendarEvent(meal.id, { ...(calendarId ? { calendarId } : {}), durationMinutes: duration }), 'Local calendar event created')}>Create and link event</button>
    </fieldset>}
    {loading && <p role="status">Loading calendars…</p>}
    {error && <div role="alert"><p className="field-error">{error}</p><button className="btn btn-secondary" disabled={busy} onClick={() => { setLoading(true); setError(''); setTick(t => t + 1) }}>Reload calendars</button></div>}
  </Sheet>
}
