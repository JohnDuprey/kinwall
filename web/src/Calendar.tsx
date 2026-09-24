import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError, stripHtmlToText } from './api.ts'
import type { CalendarEntry, Category, EventInstance } from './types.ts'
import { dateKey, formatTime, minutesSinceMidnight, zonedDayKey } from './date.ts'
import { inkFor } from './color.ts'
import Sheet from './Sheet.tsx'
import { ChevronLeft, ChevronRight, LocationIcon, PlusIcon, RepeatIcon, TrashIcon, EditIcon } from './icons.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { useIsPhone } from './useIsPhone.ts'

const PHONE_WEEK_DAYS = 3

type ViewMode = 'week' | 'day' | 'month' | 'schedule'
// Matches --hour-h in styles.css (comfortable/compact) so JS-computed pixel offsets in the time
// grid line up with the CSS row heights.
function hourPx(density: 'comfortable' | 'compact' | undefined): number {
  return density === 'compact' ? 40 : 60
}

function isAllDayOnDate(ev: EventInstance, key: string) {
  // all-day start/end are date strings, end exclusive
  return ev.start <= key && key < ev.end
}
function isTimedOnDate(ev: EventInstance, key: string, tz: string) {
  return zonedDayKey(ev.start, tz) === key || (zonedDayKey(ev.start, tz) < key && zonedDayKey(ev.end, tz) >= key)
}

/** Greedy column packing for overlapping timed events on one day. Simple, not cluster-optimal.
 * ponytail: good enough for a wall calendar's visual density; revisit with an interval-graph
 * algorithm if events routinely overlap 4+ ways. */
function layoutColumns(evs: EventInstance[], tz: string) {
  const withMin = evs
    .map(ev => ({ ev, s: minutesSinceMidnight(ev.start, tz), e: Math.max(minutesSinceMidnight(ev.end, tz), minutesSinceMidnight(ev.start, tz) + 20) }))
    .sort((a, b) => a.s - b.s)
  const colEnds: number[] = []
  const placed = withMin.map(item => {
    let col = colEnds.findIndex(end => end <= item.s)
    if (col === -1) { col = colEnds.length; colEnds.push(item.e) } else { colEnds[col] = item.e }
    return { ...item, col }
  })
  const totalCols = Math.max(1, colEnds.length)
  return placed.map(p => ({ ...p, totalCols }))
}

/** Current minute-of-day in `tz`, refreshed every minute (for the now-line + auto-scroll). */
function useNowMinutes(tz: string) {
  const [minutes, setMinutes] = useState(() => minutesSinceMidnight(new Date().toISOString(), tz))
  useEffect(() => {
    const id = setInterval(() => setMinutes(minutesSinceMidnight(new Date().toISOString(), tz)), 60000)
    return () => clearInterval(id)
  }, [tz])
  return minutes
}

/** Scrolls a time-grid to the current time (1/3 down from the top) when `isToday`, else to 7am. */
function useGridAutoScroll(scrollRef: React.RefObject<HTMLDivElement>, nowMinutes: number, isToday: boolean, dep: unknown, hourPx: number) {
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (isToday) el.scrollTop = Math.max(0, (nowMinutes / 60) * hourPx - el.clientHeight / 3)
    else el.scrollTop = 7 * hourPx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToday, dep, hourPx])
}

function useSwipe(onLeft: () => void, onRight: () => void) {
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  return {
    onPointerDown: (e: React.PointerEvent) => { startX.current = e.clientX; startY.current = e.clientY },
    onPointerUp: (e: React.PointerEvent) => {
      if (startX.current === null || startY.current === null) return
      const dx = e.clientX - startX.current
      const dy = e.clientY - startY.current
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? onLeft() : onRight() }
      startX.current = null; startY.current = null
    },
  }
}

export default function CalendarView() {
  const { settings, members, categories, selectedMemberId, toast, reloadCore, refreshTick } = useApp()
  const isPhone = useIsPhone()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  // Phones default to the agenda view (a 7-day grid is unreadable that narrow); the wall iPad
  // keeps Week. Only the initial default differs — switching views afterward still works either way.
  const [viewMode, setViewMode] = useState<ViewMode>(() => (isPhone ? 'schedule' : 'week'))
  const [anchor, setAnchor] = useState(() => new Date())
  const [events, setEvents] = useState<EventInstance[]>([])
  const [calendars, setCalendars] = useState<CalendarEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [detail, setDetail] = useState<EventInstance | null>(null)
  const [editState, setEditState] = useState<{ event: EventInstance | null; prefill?: Partial<EventInstance> } | null>(null)

  useEffect(() => { api.getCalendars().then(setCalendars).catch(() => {}) }, [])

  // Days shown by the Week/"3 Day" grid: on phones a 3-day window starting at anchor (paged by
  // 3), on the wall iPad the usual Sunday/Monday-aligned 7-day week. WeekView itself just renders
  // whatever list it's given — this is the one place that decides the day count.
  const weekDays = useMemo(() => {
    if (isPhone) { const from = startOfDay(anchor); return Array.from({ length: PHONE_WEEK_DAYS }, (_, i) => addDays(from, i)) }
    const from = startOfWeek(anchor, { weekStartsOn: settings.weekStart })
    return Array.from({ length: 7 }, (_, i) => addDays(from, i))
  }, [anchor, settings.weekStart, isPhone])

  const range = useMemo(() => {
    if (viewMode === 'week') return { from: weekDays[0], to: addDays(weekDays[weekDays.length - 1], 1) }
    if (viewMode === 'day') return { from: anchor, to: addDays(anchor, 1) }
    if (viewMode === 'month') {
      const from = startOfWeek(startOfMonth(anchor), { weekStartsOn: settings.weekStart })
      const to = addDays(startOfWeek(endOfMonth(anchor), { weekStartsOn: settings.weekStart }), 7)
      return { from, to }
    }
    return { from: anchor, to: addDays(anchor, 30) } // schedule: rolling 30-day agenda
  }, [viewMode, anchor, settings.weekStart, weekDays])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getEvents(range.from.toISOString(), range.to.toISOString())
      .then(evs => { if (!cancelled) { setEvents(evs); setError(false) } })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [range.from, range.to, refreshTick])

  useEffect(() => {
    const onIdle = () => { setDetail(null); setEditState(null); setViewMode('week'); setAnchor(new Date()) }
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => window.removeEventListener(IDLE_RESET_EVENT, onIdle)
  }, [])

  const visibleEvents = useMemo(
    () => selectedMemberId ? events.filter(e => e.memberIds.includes(selectedMemberId)) : events,
    [events, selectedMemberId],
  )

  const step = (dir: 1 | -1) => {
    if (viewMode === 'week') setAnchor(a => addDays(a, dir * (isPhone ? PHONE_WEEK_DAYS : 7)))
    else if (viewMode === 'day') setAnchor(a => addDays(a, dir))
    else if (viewMode === 'month') setAnchor(a => addMonths(a, dir))
    else setAnchor(a => addDays(a, dir * 30))
  }
  const swipe = useSwipe(() => step(1), () => step(-1))

  const periodLabel = useMemo(() => {
    if (viewMode === 'week') {
      const from = weekDays[0], to = weekDays[weekDays.length - 1]
      if (isPhone) return isSameMonth(from, to) ? `${format(from, 'MMM d')} – ${format(to, 'd')}` : `${format(from, 'MMM d')} – ${format(to, 'MMM d')}`
      const weekEnd = endOfWeek(anchor, { weekStartsOn: settings.weekStart })
      return isSameMonth(from, weekEnd) ? format(from, 'MMMM yyyy') : `${format(from, 'MMM')} – ${format(weekEnd, 'MMM yyyy')}`
    }
    if (viewMode === 'day') return format(anchor, 'EEEE, MMMM d')
    if (viewMode === 'month') return format(anchor, 'MMMM yyyy')
    return `Next 30 days`
  }, [viewMode, anchor, settings.weekStart, weekDays, isPhone])

  const openAdd = (prefill?: Partial<EventInstance>) => setEditState({ event: null, prefill })
  const openEdit = (ev: EventInstance) => { setDetail(null); setEditState({ event: ev }) }

  const saveEvent = async (body: Partial<EventInstance>, id: string | null, seriesCategory?: { categoryId: string | null; scope: 'occurrence' | 'series' }) => {
    try {
      if (id) await api.updateEvent(id, body)
      else await api.createEvent(body)
      if (id && seriesCategory) await api.updateEvent(id, seriesCategory)
      setEditState(null)
      reloadCore()
      setEvents(evs => [...evs]) // no-op to be explicit; real refetch happens via refreshTick after reloadCore bump isn't guaranteed for mock — force refetch:
      api.getEvents(range.from.toISOString(), range.to.toISOString()).then(setEvents).catch(() => {})
      toast(id ? 'Event updated' : 'Event added')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save event')
    }
  }
  // Member chips in the detail sheet save immediately via a memberIds-only PATCH - works even on
  // read-only (ICS) events, since it's a local-only annotation that never touches the provider.
  // Recurring synced events (event.seriesId set) don't save immediately - see saveDetailMembers.
  const toggleDetailMember = async (memberId: string) => {
    if (!detail) return
    const memberIds = detail.memberIds.includes(memberId) ? detail.memberIds.filter(x => x !== memberId) : [...detail.memberIds, memberId]
    try {
      const updated = await api.updateEvent(detail.id, { memberIds })
      setDetail(updated)
      setEvents(evs => evs.map(e => e.id === updated.id ? updated : e))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update members')
    }
  }
  // Used once the user picks "This event" / "All events in the series" for a recurring synced event.
  const saveDetailMembers = async (id: string, memberIds: string[], scope: 'occurrence' | 'series') => {
    try {
      const updated = await api.updateEvent(id, { memberIds, scope })
      setDetail(updated)
      setEvents(evs => evs.map(e => e.id === updated.id ? updated : e))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update members')
    }
  }

  const deleteEvent = async (id: string) => {
    try {
      await api.deleteEvent(id)
      setDetail(null)
      setEvents(evs => evs.filter(e => e.id !== id))
      toast('Event deleted')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not delete event')
    }
  }

  return (
    <div className="content">
      <div className="calendar-toolbar">
        <div className="segmented">
          {(['week', 'day', 'month', 'schedule'] as ViewMode[]).map(v => (
            <button key={v} className={viewMode === v ? 'active' : ''} onClick={() => setViewMode(v)}>
              {v === 'week' ? (isPhone ? '3 Day' : 'Week') : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <div className="toolbar-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft width={20} height={20} /></button>
          <button className="today-btn" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next"><ChevronRight width={20} height={20} /></button>
          <div className="period-label">{periodLabel}</div>
        </div>
      </div>

      <div className="swipe-area" {...swipe}>
        {error ? (
          <div className="state-card">Couldn't load events. Pull to retry or check your connection.</div>
        ) : !loading && visibleEvents.length === 0 && viewMode === 'schedule' ? (
          <div className="empty-card"><span className="emoji">🗓️</span>No events in the next 30 days.</div>
        ) : viewMode === 'week' ? (
          <WeekView days={weekDays} events={visibleEvents} tz={tz} members={members} categories={categories} onTap={setDetail} onSlotTap={openAdd} />
        ) : viewMode === 'day' ? (
          <DayView anchor={anchor} events={visibleEvents} tz={tz} members={members} categories={categories} onTap={setDetail} onSlotTap={openAdd} />
        ) : viewMode === 'month' ? (
          <MonthView anchor={anchor} events={visibleEvents} tz={tz} weekStart={settings.weekStart} members={members} categories={categories} onTap={setDetail} onDayTap={d => { setAnchor(d); setViewMode('day') }} />
        ) : (
          <ScheduleView anchor={anchor} events={visibleEvents} tz={tz} members={members} categories={categories} onTap={setDetail} />
        )}
      </div>

      <button className="fab" onClick={() => openAdd()} aria-label="Add event"><PlusIcon /></button>

      {detail && (
        <EventDetailSheet
          event={detail}
          members={members}
          categories={categories}
          calendars={calendars}
          tz={tz}
          onClose={() => setDetail(null)}
          onEdit={() => openEdit(detail)}
          onDelete={() => deleteEvent(detail.id)}
          onToggleMember={toggleDetailMember}
          onSaveScopedMembers={saveDetailMembers}
        />
      )}
      {editState && (
        <EventEditSheet
          event={editState.event}
          prefill={editState.prefill}
          calendars={calendars}
          members={members}
          categories={categories}
          onClose={() => setEditState(null)}
          onSave={saveEvent}
        />
      )}
    </div>
  )
}

type ChipMember = { id: string; color: string; avatar: string }
type ChipCategory = { id: string; color: string; emoji: string | null }

/** Solid category color (overrides member color entirely) when the event has one, else: solid
 * member color for a single-member event, calendar/event color for zero members, or diagonal
 * stripes cycling through each assigned member's color (in family sort order, so a shared pair
 * always stripes the same way) for 2+. Single helper used by every view - routes the category
 * override through the same place every view already gets its background/avatars/ink from.
 * `ink` is the best-contrast text color for that background (any member/category/custom color
 * can be very light or very dark) - for stripes it's picked across all assigned colors, with the
 * title's translucent pill (see EventTitle) as an extra safety net. */
function eventVisual(ev: EventInstance, members: ChipMember[], categories: ChipCategory[], stripeWidth: number): { background: string; avatars: string[]; ink: string; emoji: string | null } {
  const assigned = members.filter(m => ev.memberIds.includes(m.id))
  const category = ev.categoryId ? categories.find(c => c.id === ev.categoryId) : undefined
  if (category) {
    // Category color always wins, but member avatars stay visible - without stripes, a solid
    // category color alone wouldn't say who's assigned.
    return { background: category.color, avatars: assigned.map(m => m.avatar), ink: inkFor(category.color), emoji: category.emoji }
  }
  if (assigned.length <= 1) {
    const color = assigned[0]?.color ?? ev.color
    return { background: color, avatars: [], ink: inkFor(color), emoji: null }
  }
  const stops = assigned.map((m, i) => `${m.color} ${i * stripeWidth}px ${(i + 1) * stripeWidth}px`).join(', ')
  return { background: `repeating-linear-gradient(135deg, ${stops})`, avatars: assigned.map(m => m.avatar), ink: inkFor(assigned.map(m => m.color)), emoji: null }
}

/** Title text (truncating), optionally prefixed with a category emoji, plus - for striped
 * multi-member or categorized events - an inline avatar row and a translucent backing pill so
 * text stays readable over the stripes/category color. */
function EventTitle({ title, avatars, emoji }: { title: string; avatars: string[]; emoji?: string | null }) {
  const text = emoji ? `${emoji} ${title}` : title
  if (avatars.length === 0) return <span className="event-title-text">{text}</span>
  return (
    <>
      <span className="event-title-text event-title-pill">{text}</span>
      <span className="event-avatars">{avatars.join(' ')}</span>
    </>
  )
}

function EventChip({ ev, members, categories, small, onTap }: { ev: EventInstance; members: ChipMember[]; categories: ChipCategory[]; small?: boolean; onTap: () => void }) {
  const { background, avatars, ink, emoji } = eventVisual(ev, members, categories, small ? 7 : 10)
  return (
    <div className={small ? 'allday-chip' : 'event-chip'} style={{ background, color: ink }} onClick={onTap}>
      <EventTitle title={ev.title} avatars={avatars} emoji={emoji} />
    </div>
  )
}

/** Renders an N-day time grid (all-day row, now-line, auto-scroll, overlap columns). Used for
 * both the wall iPad's 7-day Week and the phone's 3-day view — `days` is the only thing that
 * changes between them, decided by the caller (CalendarView's `weekDays`). */
function WeekView({ days, events, tz, members, categories, onTap, onSlotTap }: {
  days: Date[]; events: EventInstance[]; tz: string; members: ChipMember[]; categories: ChipCategory[]
  onTap: (e: EventInstance) => void; onSlotTap: (prefill: Partial<EventInstance>) => void
}) {
  const { settings } = useApp()
  const HOUR_PX = hourPx(settings.density)
  const todayStr = dateKey(new Date())
  const isCurrentWeek = days.some(d => dateKey(d) === todayStr)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nowMinutes = useNowMinutes(tz)
  useGridAutoScroll(scrollRef, nowMinutes, isCurrentWeek, days[0].getTime(), HOUR_PX)

  const dayKeys = days.map(dateKey)
  const allDayByDay = dayKeys.map(k => events.filter(e => e.allDay && isAllDayOnDate(e, k)))
  const timedByDay = dayKeys.map(k => events.filter(e => !e.allDay && isTimedOnDate(e, k, tz)))
  const maxAllDay = Math.max(0, ...allDayByDay.map(a => a.length))

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className="week-header" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d, i) => (
          <div key={i} className={`week-header-cell ${dateKey(d) === todayStr ? 'today' : ''}`}>
            <div className="wd">{format(d, 'EEE')}</div>
            <div className="dn">{format(d, 'd')}</div>
          </div>
        ))}
      </div>
      {maxAllDay > 0 && (
        <div className="allday-row" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))`, minHeight: maxAllDay * 26 + 6 }}>
          <div />
          {allDayByDay.map((list, i) => (
            <div className="allday-cell" key={i}>
              {list.map(ev => <EventChip key={ev.id} ev={ev} members={members} categories={categories} small onTap={() => onTap(ev)} />)}
            </div>
          ))}
        </div>
      )}
      <div className="timegrid" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
        <div className="time-gutter">
          {Array.from({ length: 24 }, (_, h) => <div className="time-label" key={h}>{h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}</div>)}
        </div>
        {days.map((d, i) => {
          const laidOut = layoutColumns(timedByDay[i], tz)
          return (
            <div key={i} className={`day-col ${dateKey(d) === todayStr ? 'today' : ''}`}
              onClick={e => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const minutes = Math.max(0, Math.round(((e.clientY - rect.top) / HOUR_PX) * 60 / 15) * 15)
                const hh = Math.floor(minutes / 60), mm = minutes % 60
                const start = new Date(d); start.setHours(hh, mm, 0, 0)
                const end = new Date(start.getTime() + 60 * 60000)
                onSlotTap({ start: start.toISOString(), end: end.toISOString(), allDay: false })
              }}>
              {Array.from({ length: 24 }, (_, h) => <div className="hour-line" key={h} />)}
              {dateKey(d) === todayStr && <div className="now-line" style={{ top: (nowMinutes / 60) * HOUR_PX }}><span className="now-dot" /></div>}
              {laidOut.map(({ ev, s, e, col, totalCols }) => {
                const { background, avatars, ink, emoji } = eventVisual(ev, members, categories, 10)
                return (
                  <div key={ev.id} className="timed-event"
                    style={{
                      top: (s / 60) * HOUR_PX, height: Math.max(((e - s) / 60) * HOUR_PX - 2, 16),
                      left: `calc(${(col / totalCols) * 100}% + 2px)`, width: `calc(${100 / totalCols}% - 4px)`,
                      background, color: ink,
                    }}
                    onClick={ev2 => { ev2.stopPropagation(); onTap(ev) }}>
                    <div className="event-title-row"><EventTitle title={ev.title} avatars={avatars} emoji={emoji} /></div>
                    <span style={{ opacity: 0.85 }}>{formatTime(ev.start, tz)}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ anchor, events, tz, members, categories, onTap, onSlotTap }: {
  anchor: Date; events: EventInstance[]; tz: string; members: { id: string; name: string; color: string; avatar: string }[]; categories: ChipCategory[]
  onTap: (e: EventInstance) => void; onSlotTap: (prefill: Partial<EventInstance>) => void
}) {
  const { settings } = useApp()
  const HOUR_PX = hourPx(settings.density)
  const cols = members.length > 0 ? members : [{ id: '__none', name: 'Everyone', color: '#888', avatar: '' }]
  const key = dateKey(anchor)
  const isToday = key === dateKey(new Date())
  const allDay = events.filter(e => e.allDay && isAllDayOnDate(e, key))
  const scrollRef = useRef<HTMLDivElement>(null)
  const nowMinutes = useNowMinutes(tz)
  useGridAutoScroll(scrollRef, nowMinutes, isToday, key, HOUR_PX)

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className="week-header" style={{ gridTemplateColumns: `50px repeat(${cols.length}, minmax(0, 1fr))` }}>
        <div />
        {cols.map(m => (
          <div key={m.id} className="week-header-cell">
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: m.color, color: inkFor(m.color), margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>{m.avatar}</div>
            <div className="wd" style={{ marginTop: 4 }}>{m.name}</div>
          </div>
        ))}
      </div>
      {allDay.length > 0 && (
        <div className="allday-row" style={{ gridTemplateColumns: `50px repeat(${cols.length}, minmax(0, 1fr))` }}>
          <div />
          {cols.map(m => (
            <div className="allday-cell" key={m.id}>
              {allDay.filter(e => m.id === '__none' || e.memberIds.includes(m.id) || e.memberIds.length === 0).map(ev => (
                <EventChip key={ev.id} ev={ev} members={members} categories={categories} small onTap={() => onTap(ev)} />
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="timegrid" style={{ gridTemplateColumns: `50px repeat(${cols.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
        <div className="time-gutter">
          {Array.from({ length: 24 }, (_, h) => <div className="time-label" key={h}>{h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}</div>)}
        </div>
        {isToday && <div className="now-line" style={{ top: (nowMinutes / 60) * HOUR_PX, left: 50, right: 0 }}><span className="now-dot" /></div>}
        {cols.map(m => {
          const dayEvents = events.filter(e => !e.allDay && isTimedOnDate(e, key, tz) && (m.id === '__none' || e.memberIds.includes(m.id) || e.memberIds.length === 0))
          const laidOut = layoutColumns(dayEvents, tz)
          return (
            <div key={m.id} className="day-col today"
              onClick={e => {
                const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
                const minutes = Math.max(0, Math.round(((e.clientY - rect.top) / HOUR_PX) * 60 / 15) * 15)
                const hh = Math.floor(minutes / 60), mm = minutes % 60
                const start = new Date(anchor); start.setHours(hh, mm, 0, 0)
                const end = new Date(start.getTime() + 60 * 60000)
                onSlotTap({ start: start.toISOString(), end: end.toISOString(), allDay: false, memberIds: m.id === '__none' ? [] : [m.id] })
              }}>
              {Array.from({ length: 24 }, (_, h) => <div className="hour-line" key={h} />)}
              {laidOut.map(({ ev, s, e, col, totalCols }) => {
                const { background, avatars, ink, emoji } = eventVisual(ev, members, categories, 10)
                return (
                  <div key={ev.id} className="timed-event"
                    style={{ top: (s / 60) * HOUR_PX, height: Math.max(((e - s) / 60) * HOUR_PX - 2, 16), left: `calc(${(col / totalCols) * 100}% + 2px)`, width: `calc(${100 / totalCols}% - 4px)`, background, color: ink }}
                    onClick={ev2 => { ev2.stopPropagation(); onTap(ev) }}>
                    <div className="event-title-row"><EventTitle title={ev.title} avatars={avatars} emoji={emoji} /></div>
                    <span style={{ opacity: 0.85 }}>{formatTime(ev.start, tz)}</span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Chip row height (font + padding, from .month-chip) plus the cell's flex `gap: 3px` between
// rows, and the fixed space taken by the day-number row — used to compute how many event chips
// fit in a cell before falling back to "+N more" (measured from the live DOM instead, see below;
// these are just the fallback defaults for the very first paint).
const MONTH_CHIP_ROW_PX = 21
const MONTH_DAYNUM_ROW_PX = 32

function MonthView({ anchor, events, tz, weekStart, members, categories, onTap, onDayTap }: {
  anchor: Date; events: EventInstance[]; tz: string; weekStart: 0 | 1; members: ChipMember[]; categories: ChipCategory[]
  onTap: (e: EventInstance) => void; onDayTap: (d: Date) => void
}) {
  const days = useMemo(() => {
    const from = startOfWeek(startOfMonth(anchor), { weekStartsOn: weekStart })
    const to = addDays(startOfWeek(endOfMonth(anchor), { weekStartsOn: weekStart }), 6)
    const out: Date[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
    return out
  }, [anchor, weekStart])
  const todayStr = dateKey(new Date())
  const weeks = days.length / 7

  // Rows now stretch to fill the cell (minmax(0, 1fr)), so how many chips fit varies with
  // viewport height/orientation — measure a live cell instead of hardcoding a chip count.
  const gridRef = useRef<HTMLDivElement>(null)
  const [maxFit, setMaxFit] = useState(3)
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const measure = () => {
      const cell = grid.querySelector('.month-cell') as HTMLElement | null
      if (!cell) return
      const avail = cell.clientHeight - MONTH_DAYNUM_ROW_PX
      setMaxFit(Math.max(1, Math.floor(avail / MONTH_CHIP_ROW_PX)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(grid)
    return () => ro.disconnect()
  }, [weeks])

  return (
    <div className="scroll-y" style={{ height: '100%' }}>
      {/* .month-grid's CSS `flex: 1` only stretches it when its parent is a flex container — this
          wrapper is a plain scrollable block, so give the grid an explicit height here instead;
          otherwise its minmax(0, 1fr) rows collapse to content height instead of filling the area. */}
      <div className="month-grid" ref={gridRef} style={{ height: '100%', gridTemplateRows: `24px repeat(${weeks}, minmax(0, 1fr))` }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 800, color: 'var(--text-dim)', paddingTop: 4 }}>{d}</div>
        ))}
        {days.map((d, i) => {
          const key = dateKey(d)
          const dayEvents = events.filter(e => e.allDay ? isAllDayOnDate(e, key) : isTimedOnDate(e, key, tz))
          const overflow = dayEvents.length > maxFit
          const shown = overflow ? dayEvents.slice(0, Math.max(1, maxFit - 1)) : dayEvents
          const hidden = dayEvents.length - shown.length
          return (
            <div key={i} className={`month-cell ${isSameMonth(d, anchor) ? '' : 'dim'}`} onClick={() => onDayTap(d)}>
              <div className={`month-daynum ${key === todayStr ? 'today' : ''}`}>{format(d, 'd')}</div>
              {shown.map(ev => {
                const { background, avatars, ink, emoji } = eventVisual(ev, members, categories, 6)
                return (
                  <div key={ev.id} className="month-chip" style={{ background, color: ink }} onClick={e => { e.stopPropagation(); onTap(ev) }}>
                    <EventTitle title={`${ev.allDay ? '' : formatTime(ev.start, tz) + ' '}${ev.title}`} avatars={avatars} emoji={emoji} />
                  </div>
                )
              })}
              {hidden > 0 && <div className="month-more">+{hidden} more</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScheduleView({ anchor, events, tz, members, categories, onTap }: { anchor: Date; events: EventInstance[]; tz: string; members: ChipMember[]; categories: ChipCategory[]; onTap: (e: EventInstance) => void }) {
  const byDay = useMemo(() => {
    const map = new Map<string, EventInstance[]>()
    for (let i = 0; i < 30; i++) {
      const d = addDays(anchor, i)
      const key = dateKey(d)
      const list = events.filter(e => e.allDay ? isAllDayOnDate(e, key) : isTimedOnDate(e, key, tz))
      if (list.length) map.set(key, list.sort((a, b) => a.start.localeCompare(b.start)))
    }
    return map
  }, [anchor, events, tz])

  if (byDay.size === 0) return <div className="empty-card"><span className="emoji">🗓️</span>No events in the next 30 days.</div>

  return (
    <div className="scroll-y schedule-list">
      {[...byDay.entries()].map(([key, list]) => (
        <div key={key}>
          <div className="schedule-day-label">{format(new Date(key + 'T00:00:00'), 'EEEE, MMMM d')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {list.map(ev => {
              const { background, avatars, emoji } = eventVisual(ev, members, categories, 8)
              return (
              <div key={ev.id} className="schedule-item" onClick={() => onTap(ev)}>
                <div className="schedule-color-bar" style={{ background }} />
                <div className="schedule-time">{ev.allDay ? 'All day' : formatTime(ev.start, tz)}</div>
                <div>
                  <div className="schedule-title">{emoji ? `${emoji} ` : ''}{ev.title}{avatars.length > 0 && <span className="event-avatars schedule-avatars">{avatars.join(' ')}</span>}</div>
                  {ev.location && <div className="schedule-loc">{ev.location}</div>}
                </div>
              </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// Text for "where did these tags come from" - shown when the chips aren't mid-edit.
function memberScopeLabel(scope: EventInstance['memberScope']): string | null {
  if (scope === 'series') return 'Tagged for the whole series'
  if (scope === 'occurrence') return 'Tagged for this event'
  if (scope === 'calendar') return 'From the calendar'
  return null
}

// "🎂 Birthdays · auto" / "🎂 Birthdays · from calendar" when the category came from a keyword
// match or the calendar default, or just "🎂 Birthdays" for an explicit override.
function categoryLabel(event: EventInstance, categories: Category[]): string | null {
  if (!event.categoryId) return null
  const cat = categories.find(c => c.id === event.categoryId)
  if (!cat) return null
  const name = `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}`
  if (event.categorySource === 'keyword') return `${name} · auto`
  if (event.categorySource === 'calendar') return `${name} · from calendar`
  return name
}

function EventDetailSheet({ event, members, categories, calendars, tz, onClose, onEdit, onDelete, onToggleMember, onSaveScopedMembers }: {
  event: EventInstance; members: { id: string; name: string; color: string; avatar: string }[]; categories: Category[]; calendars: CalendarEntry[]; tz: string
  onClose: () => void; onEdit: () => void; onDelete: () => void; onToggleMember: (memberId: string) => void
  onSaveScopedMembers: (id: string, memberIds: string[], scope: 'occurrence' | 'series') => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Recurring synced events don't save a member-chip change immediately - the chips stay
  // "pending" until the user picks This event / All events in the series (see the scope-choice
  // block below). Everything else (local events, non-recurring synced events) keeps the old
  // save-immediately behavior via onToggleMember.
  const [pendingMemberIds, setPendingMemberIds] = useState<string[] | null>(null)
  const chipMemberIds = pendingMemberIds ?? event.memberIds
  const toggleChip = (memberId: string) => {
    const next = chipMemberIds.includes(memberId) ? chipMemberIds.filter(x => x !== memberId) : [...chipMemberIds, memberId]
    if (event.seriesId) setPendingMemberIds(next)
    else onToggleMember(memberId)
  }
  const { background: detailBar } = eventVisual(event, members, categories, 10)
  const calendarName = calendars.find(c => c.id === event.calendarId)?.name ?? 'another calendar'
  const scopeLabel = memberScopeLabel(event.memberScope)
  const catLabel = categoryLabel(event, categories)
  return (
    <Sheet title={event.title} onClose={onClose}
      actions={!event.readOnly ? (
        confirmDelete ? (
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmDelete(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={onDelete}><TrashIcon width={18} height={18} />Confirm delete</button>
          </>
        ) : (
          <>
            <button className="btn btn-secondary" onClick={onEdit}><EditIcon width={18} height={18} />Edit</button>
            <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}><TrashIcon width={18} height={18} />Delete</button>
          </>
        )
      ) : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="detail-color-bar" style={{ background: detailBar }} />
        <div style={{ fontWeight: 800, fontSize: 15 }}>
          {event.allDay ? `${format(new Date(event.start + 'T00:00:00'), 'EEE, MMM d')}${event.end !== addDays(new Date(event.start + 'T00:00:00'), 1).toISOString().slice(0, 10) ? ' – ' + format(addDays(new Date(event.end + 'T00:00:00'), -1), 'EEE, MMM d') : ''} · All day`
            : `${format(new Date(event.start), 'EEE, MMM d')} · ${formatTime(event.start, tz)} – ${formatTime(event.end, tz)}`}
        </div>
        {event.location && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-dim)', fontWeight: 700 }}>
            <LocationIcon width={18} height={18} />{event.location}
          </div>
        )}
        {event.rrule && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-dim)', fontWeight: 700 }}>
            <RepeatIcon width={18} height={18} />Repeats
          </div>
        )}
        {catLabel && <div style={{ color: 'var(--text-dim)', fontSize: 13, fontWeight: 700 }}>{catLabel}</div>}
        {members.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="chip-row">
              {members.map(m => (
                <button key={m.id} className={`chip ${chipMemberIds.includes(m.id) ? 'active' : ''}`} style={{ ['--chip-color' as string]: m.color }} onClick={() => toggleChip(m.id)}>
                  {m.avatar} {m.name}
                </button>
              ))}
            </div>
            {pendingMemberIds === null && scopeLabel && (
              <div style={{ color: 'var(--text-dim)', fontSize: 13, fontWeight: 700 }}>{scopeLabel}</div>
            )}
            {pendingMemberIds !== null && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button
                  className="btn btn-secondary btn-block"
                  style={{ minHeight: 56 }}
                  onClick={() => { onSaveScopedMembers(event.id, pendingMemberIds, 'occurrence'); setPendingMemberIds(null) }}
                >
                  This event
                </button>
                <button
                  className="btn btn-primary btn-block"
                  style={{ minHeight: 56 }}
                  onClick={() => { onSaveScopedMembers(event.id, pendingMemberIds, 'series'); setPendingMemberIds(null) }}
                >
                  All events in the series
                </button>
              </div>
            )}
          </div>
        )}
        {event.description && <div style={{ color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'pre-line' }}>{stripHtmlToText(event.description)}</div>}
        {event.readOnly && (
          <div style={{ color: 'var(--text-dim)', fontSize: 13, fontWeight: 700 }}>
            Only the family members are saved in Kinwall — the event itself comes from {calendarName}.
          </div>
        )}
      </div>
    </Sheet>
  )
}

function EventEditSheet({ event, prefill, calendars, members, categories, onClose, onSave }: {
  event: EventInstance | null; prefill?: Partial<EventInstance>; calendars: CalendarEntry[]
  members: { id: string; name: string; color: string; avatar: string }[]; categories: Category[]
  onClose: () => void
  onSave: (body: Partial<EventInstance>, id: string | null, seriesCategory?: { categoryId: string | null; scope: 'occurrence' | 'series' }) => void
}) {
  const writable = calendars.filter(c => c.writable)
  const base = event ?? prefill ?? {}
  const [title, setTitle] = useState(base.title ?? '')
  const [allDay, setAllDay] = useState(!!base.allDay)
  const [calendarId, setCalendarId] = useState(base.calendarId ?? writable[0]?.id ?? '')
  const [memberIds, setMemberIds] = useState<string[]>(base.memberIds ?? [])
  // Only an explicit override (categorySource 'event'/'series') pre-selects a category here - a
  // keyword/calendar-resolved categoryId shows as "Automatic" with a hint (see autoHint below),
  // same as how the detail sheet's memberScope label distinguishes an explicit tag from a fallback.
  const initialCategoryId = event && (event.categorySource === 'event' || event.categorySource === 'series') ? event.categoryId : null
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId)
  // A category on a recurring event usually means every occurrence (a yearly birthday), so the
  // series is the default; the choice only appears once the category actually changes.
  const categoryChanged = categoryId !== initialCategoryId
  const inSeries = !!event?.seriesId
  const [categoryScope, setCategoryScope] = useState<'occurrence' | 'series'>(event?.categorySource === 'event' ? 'occurrence' : 'series')
  const autoHint = event && categoryId === null ? categoryLabel(event, categories) : null
  const [location, setLocation] = useState(base.location ?? '')
  const initialRepeat: '' | 'daily' | 'weekly' | 'monthly' = base.rrule?.includes('DAILY') ? 'daily' : base.rrule?.includes('WEEKLY') ? 'weekly' : base.rrule?.includes('MONTHLY') ? 'monthly' : ''
  const [rrule, setRrule] = useState(initialRepeat)

  // All-day values are plain dates ('YYYY-MM-DD', end exclusive): read them as local days, never via
  // new Date('YYYY-MM-DD'), which is UTC midnight and shows the previous day west of UTC.
  const localDay = (d: string) => new Date(d + 'T00:00:00')
  const seedStart = base.start ? (base.allDay ? localDay(base.start) : new Date(base.start)) : new Date()
  const seedEnd = base.end
    ? (base.allDay ? addDays(localDay(base.end), -1) : new Date(base.end)) // all-day end shown inclusive
    : new Date(seedStart.getTime() + 3600000)
  const [startDate, setStartDate] = useState(format(seedStart, 'yyyy-MM-dd'))
  const [startTime, setStartTime] = useState(base.allDay ? '09:00' : format(seedStart, 'HH:mm'))
  const [endDate, setEndDate] = useState(format(seedEnd, 'yyyy-MM-dd'))
  const [endTime, setEndTime] = useState(base.allDay ? '10:00' : format(seedEnd, 'HH:mm'))
  // Moving the start past the end drags the end along, so the range never inverts.
  const changeStartDate = (d: string) => { setStartDate(d); if (d > endDate) setEndDate(d) }
  const endBeforeStart = allDay ? endDate < startDate : `${endDate}T${endTime}` <= `${startDate}T${startTime}`

  const toggleMember = (id: string) => setMemberIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])

  const submit = () => {
    if (!title.trim() || !calendarId) return
    // The menu only knows plain daily/weekly/monthly: an untouched menu keeps the real rule
    // (e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR) instead of flattening it.
    const rruleStr = rrule === initialRepeat && base.rrule ? base.rrule
      : rrule === 'daily' ? 'FREQ=DAILY' : rrule === 'weekly' ? 'FREQ=WEEKLY' : rrule === 'monthly' ? 'FREQ=MONTHLY' : null
    if (endBeforeStart) return
    let start: string, end: string
    if (allDay) {
      start = startDate
      end = format(addDays(localDay(endDate), 1), 'yyyy-MM-dd') // stored exclusive
    } else {
      start = new Date(`${startDate}T${startTime}:00`).toISOString()
      end = new Date(`${endDate}T${endTime}:00`).toISOString()
    }
    // Server's EventInput.location is string|undefined (not nullable) — send undefined, not null, when empty.
    // Only send categoryId when it changed, so saving an unrelated edit never pins the auto category.
    // On a series it goes as its own scoped PATCH, leaving the rest of the edit on this occurrence.
    const body: Partial<EventInstance> = { title: title.trim(), calendarId, location: location.trim() || undefined, memberIds, rrule: rruleStr }
    // A repeating event opens on one occurrence; sending its dates back unchanged would restart the
    // whole series there and drop the earlier occurrences. Only send the timing when it was edited.
    const timingChanged = !event || allDay !== !!event.allDay || start !== (event.allDay ? event.start : new Date(event.start).toISOString())
      || end !== (event.allDay ? event.end : new Date(event.end).toISOString())
    if (timingChanged) Object.assign(body, { allDay, start, end })
    if (categoryChanged && !inSeries) body.categoryId = categoryId
    onSave(body, event?.id ?? null, categoryChanged && inSeries ? { categoryId, scope: categoryScope } : undefined)
  }

  return (
    <Sheet title={event ? 'Edit event' : 'New event'} onClose={onClose}
      actions={<button className="btn btn-primary btn-block" onClick={submit} disabled={endBeforeStart}>{event ? 'Save changes' : 'Add event'}</button>}>
      <div className="field">
        <label>Title</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" autoFocus />
      </div>
      <div className="toggle-row">
        <label>All day</label>
        <button className={`switch ${allDay ? 'on' : ''}`} onClick={() => setAllDay(v => !v)}><span className="knob" /></button>
      </div>
      <div className={allDay ? 'row-2' : 'row-datetime'}>
        <div className="field">
          <label>Starts</label>
          <input type="date" value={startDate} onChange={e => changeStartDate(e.target.value)} />
        </div>
        {!allDay && (
          <div className="field">
            <label>&nbsp;</label>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} aria-label="Start time" />
          </div>
        )}
        <div className="field">
          <label>Ends</label>
          <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        {!allDay && (
          <div className="field">
            <label>&nbsp;</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} aria-label="End time" />
          </div>
        )}
      </div>
      {endBeforeStart && <p className="field-error">The end has to be after the start.</p>}
      <div className="field">
        <label>Calendar</label>
        <select value={calendarId} onChange={e => setCalendarId(e.target.value)}>
          {writable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Location</label>
        <input type="text" value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" />
      </div>
      <div className="field">
        <label>Who</label>
        <div className="chip-row">
          {members.map(m => (
            <button key={m.id} className={`chip ${memberIds.includes(m.id) ? 'active' : ''}`} style={{ ['--chip-color' as string]: m.color }} onClick={() => toggleMember(m.id)}>
              {m.avatar} {m.name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Repeat</label>
        <select value={rrule} onChange={e => setRrule(e.target.value as typeof rrule)}>
          <option value="">Does not repeat</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>
      <div className="field">
        <label>Category</label>
        <select value={categoryId ?? ''} onChange={e => setCategoryId(e.target.value || null)}>
          <option value="">Automatic</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>)}
        </select>
        {autoHint && <div className="settings-row-sub">{autoHint}</div>}
        {inSeries && categoryChanged && (
          <div className="segmented" style={{ marginTop: 10 }}>
            <button className={categoryScope === 'series' ? 'active' : ''} onClick={() => setCategoryScope('series')}>All events</button>
            <button className={categoryScope === 'occurrence' ? 'active' : ''} onClick={() => setCategoryScope('occurrence')}>This event</button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
