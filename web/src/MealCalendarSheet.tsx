import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { formatTime } from './timeFormat.ts'
import { SLOT_LABEL, mealDayLabel, minutesLabel, moveMealDate } from './meal-date.ts'
import type { Meal } from './meal-types.ts'
import type { CalendarEntry, EventInstance } from './types.ts'

const LAST_CALENDAR_KEY = 'kinwall.mealCalendarId'
const PROVIDER: Partial<Record<CalendarEntry['kind'], string>> = { google: 'Google', microsoft: 'Outlook', caldav: 'CalDAV' }
const hhmm = (minutes: number) => `${String(Math.floor(((minutes % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((minutes % 60) + 60) % 60).padStart(2, '0')}`

export default function MealCalendarSheet({ meal, onClose, onLinked }: { meal: Meal; onClose: () => void; onLinked: (meal: Meal) => void }) {
  const { settings, toast } = useApp()
  const id = useId()
  const [events, setEvents] = useState<EventInstance[]>([])
  const [calendars, setCalendars] = useState<CalendarEntry[]>([])
  const [eventId, setEventId] = useState('')
  const [calendarId, setCalendarId] = useState<string | null>(null)
  const [eventStart, setEventStart] = useState<'meal' | 'cooking'>('meal')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let canceled = false
    Promise.all([api.getCalendars(), api.getEvents(`${moveMealDate(meal.date, -7)}T00:00:00Z`, `${moveMealDate(meal.date, 8)}T00:00:00Z`)]).then(([cals, values]) => {
      if (canceled) return
      const writable = cals.filter(c => c.writable && c.enabled && c.canEditEvents !== false).sort((a, b) => Number(a.kind !== 'local') - Number(b.kind !== 'local'))
      let last = ''
      try { last = localStorage.getItem(LAST_CALENDAR_KEY) ?? '' } catch { /* private mode */ }
      setCalendars(writable)
      setCalendarId(c => c ?? (writable.some(cal => cal.id === last) ? last : (writable.find(cal => cal.default) ?? writable.find(cal => cal.kind === 'local'))?.id ?? ''))
      setEvents([...new Map(values.map(event => [event.id, event])).values()]); setLoading(false)
    }).catch(e => { if (!canceled) { setError(e instanceof Error ? e.message : 'Could not load calendars.'); setLoading(false) } })
    return () => { canceled = true }
  }, [meal.date, tick])
  const run = async (action: () => Promise<Meal>, message: string) => {
    setBusy(true); setError('')
    try { const saved = await action(); toast(message); onLinked(saved); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not update the calendar.') }
    finally { setBusy(false) }
  }
  const create = () => run(async () => {
    try { localStorage.setItem(LAST_CALENDAR_KEY, calendarId ?? '') } catch { /* private mode */ }
    return api.createMealCalendarEvent(meal.id, { ...(calendarId ? { calendarId } : {}), eventStart })
  }, 'Added to the calendar')

  // The same times the server uses: the meal's time or the usual one; the recipe's total time, else an hour.
  const time = meal.plannedTime ?? settings.mealTimes[meal.slot]
  const minutes = meal.recipeSnapshot?.totalMinutes || 60
  const at = Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  const [from, to] = eventStart === 'cooking' ? [at - minutes, at] : [at, at + minutes]
  const chosen = calendars.find(c => c.id === calendarId)
  const groups = [['On Kinwall', calendars.filter(c => c.kind === 'local')], ['Synced calendars', calendars.filter(c => c.kind !== 'local')]] as const
  const owned = !!meal.calendarEventStart

  return <Sheet title="Meal on the calendar" onClose={() => { if (!busy) onClose() }} dismissable={!busy}>
    <p>{meal.title} · {mealDayLabel(meal.date)} · {formatTime(time)}{meal.plannedTime ? '' : ` (usual ${SLOT_LABEL[meal.slot].toLowerCase()} time)`}</p>
    {meal.calendarEventId ? <>
      <p className="field-hint">{owned
        ? 'Kinwall made this event, so it follows the meal: saving the meal updates its day, time, title, notes and people, and deleting the meal deletes it.'
        : 'You linked this event, so Kinwall never changes or deletes it.'}</p>
      <p><a href={`#/calendar?event=${encodeURIComponent(meal.calendarEventId)}&at=${meal.date}`}>Open the event</a></p>
      <button className="btn btn-secondary" disabled={busy} onClick={() => void run(() => api.unlinkMealCalendar(meal.id), 'Calendar event unlinked')}>Unlink (keep the event)</button>
    </> : <fieldset className="meal-fieldset" disabled={busy || loading}>
      <h3>Add to a calendar</h3>
      <div className="field"><label htmlFor={`${id}-cal`}>Calendar</label><select id={`${id}-cal`} value={calendarId ?? '-'} onChange={e => setCalendarId(e.target.value)}>
        {calendarId === null && <option value="-" disabled>Choose a calendar</option>}
        {groups.map(([label, list]) => list.length > 0 && <optgroup key={label} label={label}>
          {list.map(cal => <option key={cal.id} value={cal.id}>{cal.name}{PROVIDER[cal.kind] ? ` · ${PROVIDER[cal.kind]}` : ''}</option>)}
        </optgroup>)}
        {!loading && !calendars.some(c => c.kind === 'local') && <option value="">A new “Meals” calendar on Kinwall</option>}
      </select></div>
      <div className="field"><label htmlFor={`${id}-start`}>Starts</label><select id={`${id}-start`} value={eventStart} onChange={e => setEventStart(e.target.value as typeof eventStart)}>
        <option value="meal">At the meal time</option>
        <option value="cooking">When cooking starts</option>
      </select></div>
      <p className="field-hint">{formatTime(hhmm(from))} to {formatTime(hhmm(to))} ({minutesLabel(minutes)}{meal.recipeSnapshot?.totalMinutes ? ', the recipe’s total time' : ''}). {chosen && chosen.kind !== 'local' ? `It’s also added to ${chosen.name} on ${PROVIDER[chosen.kind] ?? 'that calendar'}.` : ''}</p>
      <button className="btn btn-primary" disabled={busy || loading || calendarId === null} onClick={() => void create()}>Add to calendar</button>
      <h3>Or link an event you already have</h3>
      <div className="field"><label htmlFor={`${id}-event`}>Event near this meal’s date</label><select id={`${id}-event`} value={eventId} onChange={e => setEventId(e.target.value)}><option value="">Choose an event</option>{events.map(event => <option key={event.id} value={event.id}>{event.title} · {event.start.slice(0, 10)}</option>)}</select></div>
      <p className="field-hint">A linked event is never changed or deleted by Kinwall.</p>
      <button className="btn btn-secondary" disabled={!eventId || busy || loading} onClick={() => void run(() => api.linkMealCalendar(meal.id, eventId), 'Calendar event linked')}>Link event</button>
    </fieldset>}
    {loading && <p role="status">Loading calendars…</p>}
    {error && <div role="alert"><p className="field-error">{error}</p><button className="btn btn-secondary" disabled={busy} onClick={() => { setLoading(true); setError(''); setTick(t => t + 1) }}>Reload calendars</button></div>}
  </Sheet>
}
