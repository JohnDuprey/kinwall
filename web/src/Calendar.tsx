import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError, stripHtmlToText } from './api.ts'
import type { CalendarEntry, Category, EventInstance, List, ListItem } from './types.ts'
import { REMINDER_OPTIONS, reminderLabel } from './types.ts'
import { dateKey, formatTime, minutesSinceMidnight, zonedDayKey } from './date.ts'
import { inkFor } from './color.ts'
import Sheet from './Sheet.tsx'
import { CheckIcon, ChevronLeft, ChevronRight, FilterIcon, LocationIcon, PlusIcon, RepeatIcon, TrashIcon, EditIcon } from './icons.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { announce, pressable, Segmented, useRovingGrid } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { effectiveDensity, useDeviceAppearance } from './useTheme.ts'
import { NowNextCard, TransitionWarnings } from './NowNext.tsx'
import NotesThread from './NotesThread.tsx'
import Board from './Board.tsx'

const PHONE_WEEK_DAYS = 3
const NEW_LOCAL_CALENDAR = '__new_local'
const CATEGORY_FILTER_KEY = 'kinwall.categoryFilter'
const NO_CATEGORY = '__none'
const TASK_LIST_KEY = 'kinwall.taskList' // list the event sheet's "Add task…" last used

type ViewMode = 'week' | 'day' | 'month' | 'schedule' | 'board'
const viewLabel = (v: ViewMode, isPhone: boolean) => v === 'week' ? (isPhone ? '3 Day' : 'Week') : v[0].toUpperCase() + v.slice(1)
// Matches --hour-h in styles.css (comfortable/compact) so JS-computed pixel offsets in the time
// grid line up with the CSS row heights.
function hourPx(density: string): number {
  return density === 'compact' ? 40 : 60
}
/** Row height for the density actually applied on this device (household, device override, low-stim). */
function useHourPx() {
  const { settings } = useApp()
  return hourPx(effectiveDensity(settings.density, useDeviceAppearance()))
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
function layoutColumns(evs: EventInstance[], tz: string, minMinutes = 20) {
  const withMin = evs
    .map(ev => ({ ev, s: minutesSinceMidnight(ev.start, tz), e: Math.max(minutesSinceMidnight(ev.end, tz), minutesSinceMidnight(ev.start, tz) + minMinutes) }))
    .sort((a, b) => a.s - b.s)
  // Columns are counted per cluster of overlapping events, not per day - otherwise one 9am
  // clash would halve the width of every other event that day.
  const out: ((typeof withMin)[number] & { col: number; totalCols: number })[] = []
  let cluster: ((typeof withMin)[number] & { col: number })[] = []
  let colEnds: number[] = []
  let clusterEnd = -1
  const flush = () => { for (const p of cluster) out.push({ ...p, totalCols: Math.max(1, colEnds.length) }) }
  for (const item of withMin) {
    if (item.s >= clusterEnd) { flush(); cluster = []; colEnds = [] }
    let col = colEnds.findIndex(end => end <= item.s)
    if (col === -1) { col = colEnds.length; colEnds.push(item.e) } else { colEnds[col] = item.e }
    cluster.push({ ...item, col })
    clusterEnd = Math.max(clusterEnd, item.e)
  }
  flush()
  return out
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
  const dialog = useDialog()
  const { settings, members, categories, selectedMemberId, focusMemberId, focusShowsShared, toast, reloadCore, refreshTick } = useApp()
  const device = useDeviceAppearance()
  const isPhone = useIsPhone()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  // Phones default to the agenda view (a 7-day grid is unreadable that narrow); the wall iPad
  // keeps Week. Only the initial default differs — switching views afterward still works either way.
  // A device can lock the view (This display → Lock view): the switcher goes and it never changes.
  const [chosenView, setViewMode] = useState<ViewMode>('board') // the board is the default everywhere; a display can still lock any view
  const viewMode: ViewMode = device.lockView ?? chosenView
  // The board carries its own big clock, so the header drops its clock while it's showing.
  useEffect(() => { document.documentElement.dataset.view = viewMode; return () => { delete document.documentElement.dataset.view } }, [viewMode])
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
    // anchor is "now" after Today/initial load - start at midnight so today's earlier events show.
    if (viewMode === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) }
    if (viewMode === 'month') {
      const from = startOfWeek(startOfMonth(anchor), { weekStartsOn: settings.weekStart })
      const to = addDays(startOfWeek(endOfMonth(anchor), { weekStartsOn: settings.weekStart }), 7)
      return { from, to }
    }
    return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 30) } // schedule: rolling 30-day agenda
  }, [viewMode, anchor, settings.weekStart, weekDays])

  useEffect(() => {
    let canceled = false
    setLoading(true)
    api.getEvents(range.from.toISOString(), range.to.toISOString())
      .then(evs => { if (!canceled) { setEvents(evs); setError(false) } })
      .catch(() => { if (!canceled) setError(true) })
      .finally(() => { if (!canceled) setLoading(false) })
    return () => { canceled = true }
  }, [range.from, range.to, refreshTick])

  // #/calendar?event=<id>&at=<start> (a tapped notification): jump to that day, then open the event
  // once it's loaded. Also handled on hashchange, for when the app was already open.
  const [pendingEventId, setPendingEventId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(location.hash.split('?')[1] || '')
      const id = q.get('event')
      if (!id) return
      const at = q.get('at')
      if (at) setAnchor(at.length === 10 ? new Date(at + 'T00:00:00') : new Date(at))
      setViewMode(v => (v === 'month' ? 'schedule' : v))
      setPendingEventId(id)
      history.replaceState(null, '', '#/calendar')
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  // Kept until the event shows up in a load (the jump above triggers a new fetch); give up after 10s.
  useEffect(() => {
    if (!pendingEventId) return
    const ev = events.find(e => e.id === pendingEventId)
    if (ev) { setDetail(ev); setPendingEventId(null); return }
    const t = setTimeout(() => setPendingEventId(null), 10000)
    return () => clearTimeout(t)
  }, [pendingEventId, events])

  useEffect(() => {
    const onIdle = () => { setDetail(null); setEditState(null); setViewMode('week'); setAnchor(new Date()) }
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => window.removeEventListener(IDLE_RESET_EVENT, onIdle)
  }, [])

  // Category filter: [] shows everything; otherwise only the picked categories ('__none' = events
  // with no category). Saved per device, since a wall display may want e.g. work events hidden for
  // good. Applied here, so every view (week/3-day, day, month, schedule) honors it.
  const [categoryFilter, setCategoryFilterState] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CATEGORY_FILTER_KEY) || '[]') } catch { return [] }
  })
  const setCategoryFilter = (ids: string[]) => {
    setCategoryFilterState(ids)
    try { localStorage.setItem(CATEGORY_FILTER_KEY, JSON.stringify(ids)) } catch { /* private mode */ }
  }
  const [filterOpen, setFilterOpen] = useState(false)
  // Ignore ids of categories that have since been deleted, or a stale filter could hide everything.
  const activeCategoryFilter = categoryFilter.filter(id => id === NO_CATEGORY || categories.some(c => c.id === id))

  const shows = useMemo(
    () => (e: EventInstance) =>
      (!selectedMemberId || e.memberIds.includes(selectedMemberId) || (!!focusMemberId && focusShowsShared && e.memberIds.length === 0)) &&
      (activeCategoryFilter.length === 0 || activeCategoryFilter.includes(e.categoryId ?? NO_CATEGORY)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMemberId, focusMemberId, focusShowsShared, activeCategoryFilter.join()],
  )
  const visibleEvents = useMemo(() => events.filter(shows), [events, shows])

  // Today's instances for Now / Next and transition warnings, taken from whatever range is loaded
  // while it covers today, and kept (not refetched) while the user pages to another week/month.
  const [todayEvents, setTodayEvents] = useState<EventInstance[]>([])
  useEffect(() => {
    const todayKey = dateKey(new Date())
    if (loading || range.from > new Date() || range.to <= new Date()) return
    setTodayEvents(visibleEvents.filter(e => e.allDay ? isAllDayOnDate(e, todayKey) : isTimedOnDate(e, todayKey, tz)))
  }, [visibleEvents, loading, range.from, range.to, tz])
  const showNowNext = device.nowNext ?? true

  // Which way the last period change went, so the new period slides in from that side.
  const [slideDir, setSlideDir] = useState<1 | -1 | 0>(0)
  const step = (dir: 1 | -1) => {
    setSlideDir(dir)
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
  // Opening a day from the week/month grid replaces the focused cell; land focus on the new
  // period heading instead of dropping it to the top of the page.
  const periodRef = useRef<HTMLHeadingElement>(null)
  const openDay = (d: Date) => { setAnchor(d); setViewMode('day'); requestAnimationFrame(() => periodRef.current?.focus()) }
  const openEdit = (ev: EventInstance) => { setDetail(null); setEditState({ event: ev }) }

  const saveEvent = async (body: Partial<EventInstance>, id: string | null, seriesCategory?: { categoryId: string | null; scope: 'occurrence' | 'series' }) => {
    try {
      if (body.calendarId === NEW_LOCAL_CALENDAR) {
        const cal = await api.createCalendar({ kind: 'local', name: 'Kinwall', color: '#F2A27A' })
        setCalendars(cs => [...cs, cal])
        body = { ...body, calendarId: cal.id }
      }
      if (id) await api.updateEvent(id, body)
      else await api.createEvent(body)
      if (id && seriesCategory) await api.updateEvent(id, seriesCategory)
      setEditState(null)
      reloadCore()
      setEvents(evs => [...evs]) // no-op to be explicit; real refetch happens via refreshTick after reloadCore bump isn't guaranteed for mock — force refetch:
      api.getEvents(range.from.toISOString(), range.to.toISOString()).then(setEvents).catch(() => {})
      toast(id ? 'Event updated' : 'Event added')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save event', true)
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
      toast(e instanceof ApiError ? e.message : 'Could not update members', true)
    }
  }
  // Used once the user picks "This event" / "All events in the series" for a recurring synced event.
  const saveDetailMembers = async (id: string, memberIds: string[], scope: 'occurrence' | 'series') => {
    try {
      const updated = await api.updateEvent(id, { memberIds, scope })
      setDetail(updated)
      setEvents(evs => evs.map(e => e.id === updated.id ? updated : e))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update members', true)
    }
  }

  // Travel time is a Kinwall-only annotation, so the detail sheet saves it straight away - even on a
  // read-only (ICS/holiday) event, like the member chips.
  const saveTravel = async (travelMinutes: number | null, remindBeforeLeave: boolean) => {
    if (!detail) return
    try {
      const updated = await api.updateEvent(detail.id, { travelMinutes, remindBeforeLeave })
      setDetail(updated)
      setEvents(evs => evs.map(e => e.id === updated.id ? updated : e))
      announce(travelMinutes ? `Travel time ${travelMinutes} minutes${updated.leaveAt ? `, leave by ${formatTime(updated.leaveAt, tz)}` : ''}` : 'Travel time removed')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save travel time', true)
    }
  }

  const deleteEvent = async (id: string) => {
    if (!await dialog.confirm({ title: 'Delete this event?', body: 'If it came from Google or Outlook it is deleted there too.', confirmLabel: 'Delete', danger: true })) return
    try {
      await api.deleteEvent(id)
      setDetail(null)
      setEvents(evs => evs.filter(e => e.id !== id))
      toast('Event deleted')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not delete event', true)
    }
  }

  return (
    <div className="content">
      {showNowNext && <NowNextCard events={todayEvents} tz={tz} />}
      {!!device.warnings?.length && <TransitionWarnings events={todayEvents} minutes={device.warnings} sound={!!device.warningSound} settings={settings} />}
      {(!device.lockView || viewMode !== 'board' || categories.length > 0) && <div className="calendar-toolbar">
        {!device.lockView && (
          <Segmented tabs idBase="calview" label="Calendar view" value={viewMode} onChange={setViewMode}
            options={(['board', 'week', 'day', 'month', 'schedule'] as ViewMode[]).map(v => ({ key: v, label: viewLabel(v, isPhone) }))} />
        )}
        <div className="toolbar-nav">
          {/* The board always shows today onward: no paging. */}
          {viewMode !== 'board' && <>
          <button className="icon-btn" onClick={() => step(-1)} aria-label={`Previous ${viewMode === 'schedule' ? '30 days' : viewMode === 'week' && isPhone ? '3 days' : viewMode}`}><ChevronLeft width={20} height={20} /></button>
          <button className="today-btn" onClick={() => { setSlideDir(0); setAnchor(new Date()) }}>Today</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label={`Next ${viewMode === 'schedule' ? '30 days' : viewMode === 'week' && isPhone ? '3 days' : viewMode}`}><ChevronRight width={20} height={20} /></button>
          <h2 className="period-label" aria-live="polite" ref={periodRef} tabIndex={-1}>{periodLabel}</h2>
          </>}
          {categories.length > 0 && (
            <button className={`icon-btn filter-btn ${activeCategoryFilter.length ? 'active' : ''}`} onClick={() => setFilterOpen(true)}
              aria-label={activeCategoryFilter.length ? `Filter: ${activeCategoryFilter.length} categories` : 'Filter by category'}>
              <FilterIcon width={20} height={20} />
              {activeCategoryFilter.length > 0 && <span className="filter-badge">{activeCategoryFilter.length}</span>}
            </button>
          )}
        </div>
      </div>}

      {filterOpen && (
        <Sheet title="Show categories" onClose={() => setFilterOpen(false)}
          actions={<>
            <button className="btn btn-secondary" onClick={() => setCategoryFilter([])} disabled={activeCategoryFilter.length === 0}>Show all</button>
            <button className="btn btn-primary" onClick={() => setFilterOpen(false)}>Done</button>
          </>}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>Pick one or more. With none picked, every event shows.</p>
          <div className="chip-row" role="group" aria-label="Categories">
            {[...categories.map(c => ({ id: c.id, label: `${c.emoji ? c.emoji + ' ' : ''}${c.name}`, color: c.color })), { id: NO_CATEGORY, label: 'No category', color: undefined }].map(c => {
              const on = activeCategoryFilter.includes(c.id)
              return (
                <button key={c.id} className={`chip ${on ? 'active' : ''}`} aria-pressed={on} style={c.color ? { ['--chip-color' as string]: c.color } : undefined}
                  onClick={() => setCategoryFilter(on ? activeCategoryFilter.filter(x => x !== c.id) : [...activeCategoryFilter, c.id])}>
                  {c.label}
                </button>
              )
            })}
          </div>
        </Sheet>
      )}

      <div className="swipe-area" {...(viewMode === 'board' ? {} : swipe)} role={device.lockView ? 'region' : 'tabpanel'}
        aria-labelledby={device.lockView ? undefined : `calview-${viewMode}`} aria-label={device.lockView ? `${viewLabel(viewMode, isPhone)} view` : undefined}>
        {/* Keyed by view + period so each change re-mounts and plays the slide/fade in. */}
        <div key={viewMode === 'board' ? 'board' : `${viewMode}:${dateKey(range.from)}`} className={`view-anim ${slideDir === 1 ? 'from-right' : slideDir === -1 ? 'from-left' : ''}`}>
        {viewMode === 'board' ? (
          <Board show={shows} onTap={setDetail} />
        ) : error ? (
          <div className="state-card">Couldn't load events. Pull to retry or check your connection.</div>
        ) : !loading && visibleEvents.length === 0 && viewMode === 'schedule' ? (
          <div className="empty-card"><span className="emoji">🗓️</span>{activeCategoryFilter.length ? 'No events in the next 30 days match the category filter.' : 'No events in the next 30 days.'}</div>
        ) : viewMode === 'week' ? (
          <WeekView days={weekDays} events={visibleEvents} tz={tz} members={members} categories={categories} onTap={setDetail} onSlotTap={openAdd} onDayTap={openDay} />
        ) : viewMode === 'day' ? (
          <DayView anchor={anchor} events={visibleEvents} tz={tz} members={members} categories={categories} onlyMemberId={focusMemberId} onTap={setDetail} onSlotTap={openAdd} />
        ) : viewMode === 'month' ? (
          <MonthView anchor={anchor} events={visibleEvents} tz={tz} weekStart={settings.weekStart} members={members} categories={categories} onTap={setDetail} onDayTap={openDay} />
        ) : (
          <ScheduleView anchor={anchor} events={visibleEvents} tz={tz} members={members} categories={categories} onTap={setDetail} />
        )}
        </div>
      </div>

      {/* Not on the board: it would sit over the Due soon card, and the board is for reading. */}
      {viewMode !== 'board' && <button className="fab" onClick={() => openAdd()} aria-label="Add event"><PlusIcon /></button>}

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
          onSaveTravel={saveTravel}
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

type ChipMember = { id: string; name: string; color: string; avatar: string }
type ChipCategory = { id: string; name: string; color: string; emoji: string | null }

/** What a screen reader hears for an event block: "4:00 PM Soccer Practice, Sam, Park field". */
function eventLabel(ev: EventInstance, tz: string, members: ChipMember[], categories: ChipCategory[]): string {
  const who = members.filter(m => ev.memberIds.includes(m.id)).map(m => m.name).join(' and ')
  const category = ev.categoryId ? categories.find(c => c.id === ev.categoryId)?.name : undefined
  return [`${ev.allDay ? 'All day' : formatTime(ev.start, tz)} ${ev.title}`, who, ev.location, category, ev.leaveAt && `leave by ${formatTime(ev.leaveAt, tz)}`, ev.noteCount && `${ev.noteCount} note${ev.noteCount === 1 ? '' : 's'}`].filter(Boolean).join(', ')
}

/** Solid category color (overrides member color entirely) when the event has one, else: solid
 * member color for a single-member event, calendar/event color for zero members, or diagonal
 * stripes cycling through each assigned member's color (in family sort order, so a shared pair
 * always stripes the same way) for 2+. Single helper used by every view - routes the category
 * override through the same place every view already gets its background/avatars/ink from.
 * `ink` is the best-contrast text color for that background (any member/category/custom color
 * can be very light or very dark) - for stripes it's picked across all assigned colors, with the
 * title's translucent pill (see EventTitle) as an extra safety net. */
function eventVisual(ev: EventInstance, members: ChipMember[], categories: ChipCategory[], stripeWidth: number): { background: string; avatars: string[]; ink: string; emoji: string | null; pill: boolean; solid: string } {
  const assigned = members.filter(m => ev.memberIds.includes(m.id))
  const category = ev.categoryId ? categories.find(c => c.id === ev.categoryId) : undefined
  if (category) {
    // Category color always wins, but member avatars stay visible - without stripes, a solid
    // category color alone wouldn't say who's assigned.
    return { background: category.color, avatars: assigned.map(m => m.avatar || m.name[0]), ink: inkFor(category.color), emoji: category.emoji, pill: true, solid: category.color }
  }
  if (assigned.length <= 1) {
    const color = assigned[0]?.color ?? ev.color
    // The avatar too, not just the color: who it's for must not depend on telling colors apart.
    return { background: color, avatars: assigned.map(m => m.avatar || m.name[0]), ink: inkFor(color), emoji: null, pill: false, solid: color }
  }
  const stops = assigned.map((m, i) => `${m.color} ${i * stripeWidth}px ${(i + 1) * stripeWidth}px`).join(', ')
  return { background: `repeating-linear-gradient(135deg, ${stops})`, avatars: assigned.map(m => m.avatar || m.name[0]), ink: inkFor(assigned.map(m => m.color)), emoji: null, pill: true, solid: assigned[0].color }
}

/** Inline fill for an event block. `--ev-bg` lets low-stimulation mode (styles.css) swap the filled
 * block for a neutral card with just a thin bar of the same color/stripes. */
const evFill = (background: string, ink: string) => ({ background, color: ink, ['--ev-bg' as string]: background })

/** Dashed line across an event's column at its leave-by time (same day only), in its color. */
function LeaveMarker({ ev, tz, dayKey, hourPx, left, width, color }: { ev: EventInstance; tz: string; dayKey: string; hourPx: number; left: string; width: string; color: string }) {
  if (!ev.leaveAt || zonedDayKey(ev.leaveAt, tz) !== dayKey) return null
  return <div className="leave-marker" aria-hidden="true" style={{ top: (minutesSinceMidnight(ev.leaveAt, tz) / 60) * hourPx, left, width, borderColor: color }}><span>🚗</span></div>
}

/** Title text (truncating), optionally prefixed with a category emoji, plus - for striped
 * multi-member or categorized events - an inline avatar row and a translucent backing pill so
 * text stays readable over the stripes/category color. */
function EventTitle({ title, avatars, emoji, pill }: { title: string; avatars: string[]; emoji?: string | null; pill?: boolean }) {
  // The emoji is its own span so icon-first density can enlarge it apart from the title.
  const text = emoji ? <><span className="event-emoji">{emoji}</span> {title}</> : title
  if (avatars.length === 0) return <span className="event-title-text">{text}</span>
  return (
    <>
      <span className={`event-title-text ${pill ? 'event-title-pill' : ''}`}>{text}</span>
      <span className="event-avatars">{avatars.join(' ')}</span>
    </>
  )
}

function EventChip({ ev, tz, members, categories, small, onTap }: { ev: EventInstance; tz: string; members: ChipMember[]; categories: ChipCategory[]; small?: boolean; onTap: () => void }) {
  const { background, avatars, ink, emoji, pill } = eventVisual(ev, members, categories, small ? 7 : 10)
  return (
    <div className={small ? 'allday-chip' : 'event-chip'} style={evFill(background, ink)} {...pressable(onTap)} aria-label={eventLabel(ev, tz, members, categories)}>
      <EventTitle title={ev.title} avatars={avatars} emoji={emoji} pill={pill} />
    </div>
  )
}

/** Renders an N-day time grid (all-day row, now-line, auto-scroll, overlap columns). Used for
 * both the wall iPad's 7-day Week and the phone's 3-day view — `days` is the only thing that
 * changes between them, decided by the caller (CalendarView's `weekDays`). */
function WeekView({ days, events, tz, members, categories, onTap, onSlotTap, onDayTap }: {
  days: Date[]; events: EventInstance[]; tz: string; members: ChipMember[]; categories: ChipCategory[]
  onTap: (e: EventInstance) => void; onSlotTap: (prefill: Partial<EventInstance>) => void; onDayTap: (d: Date) => void
}) {
  const HOUR_PX = useHourPx()
  const todayStr = dateKey(new Date())
  const isCurrentWeek = days.some(d => dateKey(d) === todayStr)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nowMinutes = useNowMinutes(tz)
  useGridAutoScroll(scrollRef, nowMinutes, isCurrentWeek, days[0].getTime(), HOUR_PX)

  const dayKeys = days.map(dateKey)
  const allDayByDay = dayKeys.map(k => events.filter(e => e.allDay && isAllDayOnDate(e, k)))
  const timedByDay = dayKeys.map(k => events.filter(e => !e.allDay && isTimedOnDate(e, k, tz)))
  const maxAllDay = Math.max(0, ...allDayByDay.map(a => a.length))
  // Day headers are the keyboard way into the grid: arrows move between days, Enter opens that day.
  const roving = useRovingGrid(days.length, dayKeys.indexOf(todayStr))
  const minMinutes = (24 / HOUR_PX) * 60 // same 24px floor as .timed-event's min-height

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className="grid-head">
        <div className="week-header" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))` }} onKeyDown={roving.onKeyDown}>
          <div />
          {days.map((d, i) => {
            const count = allDayByDay[i].length + timedByDay[i].length
            return (
              <button key={i} type="button" data-roving className={`week-header-cell ${dateKey(d) === todayStr ? 'today' : ''}`} tabIndex={roving.tabIndex(i)}
                aria-current={dateKey(d) === todayStr ? 'date' : undefined}
                aria-label={`${format(d, 'EEEE, MMMM d')}, ${count} event${count === 1 ? '' : 's'}. Open day`} onClick={() => onDayTap(d)}>
                <div className="wd">{format(d, 'EEE')}</div>
                <div className="dn">{format(d, 'd')}</div>
              </button>
            )
          })}
        </div>
        {maxAllDay > 0 && (
          <div className="allday-row" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))`, minHeight: maxAllDay * 26 + 6 }}>
            <div />
            {allDayByDay.map((list, i) => (
              <div className="allday-cell" key={i}>
                {list.map(ev => <EventChip key={ev.id} ev={ev} tz={tz} members={members} categories={categories} small onTap={() => onTap(ev)} />)}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="timegrid" style={{ gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
        <div className="time-gutter">
          {Array.from({ length: 24 }, (_, h) => <div className="time-label" key={h}>{h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}</div>)}
        </div>
        {days.map((d, i) => {
          const laidOut = layoutColumns(timedByDay[i], tz, minMinutes)
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
                const { background, avatars, ink, emoji, pill, solid } = eventVisual(ev, members, categories, 10)
                const left = `calc(${(col / totalCols) * 100}% + 2px)`, width = `calc(${100 / totalCols}% - 4px)`
                return (
                  <Fragment key={ev.id}>
                    <LeaveMarker ev={ev} tz={tz} dayKey={dayKeys[i]} hourPx={HOUR_PX} left={left} width={width} color={solid} />
                    <div className="timed-event"
                      style={{ top: (s / 60) * HOUR_PX, height: Math.max(((e - s) / 60) * HOUR_PX - 2, 24), left, width, ...evFill(background, ink) }}
                      {...pressable(() => onTap(ev))} aria-label={eventLabel(ev, tz, members, categories)}>
                      <div className="event-title-row"><EventTitle title={ev.title} avatars={avatars} emoji={emoji} pill={pill} /></div>
                      <span style={{ opacity: 0.85 }}>{formatTime(ev.start, tz)}</span>
                    </div>
                  </Fragment>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DayView({ anchor, events, tz, members, categories, onlyMemberId, onTap, onSlotTap }: {
  anchor: Date; events: EventInstance[]; tz: string; members: ChipMember[]; categories: ChipCategory[]; onlyMemberId: string | null
  onTap: (e: EventInstance) => void; onSlotTap: (prefill: Partial<EventInstance>) => void
}) {
  const HOUR_PX = useHourPx()
  const shown = onlyMemberId ? members.filter(m => m.id === onlyMemberId) : members
  const cols = shown.length > 0 ? shown : [{ id: '__none', name: 'Everyone', color: '#888', avatar: '' }]
  const key = dateKey(anchor)
  const isToday = key === dateKey(new Date())
  const allDay = events.filter(e => e.allDay && isAllDayOnDate(e, key))
  const scrollRef = useRef<HTMLDivElement>(null)
  const nowMinutes = useNowMinutes(tz)
  useGridAutoScroll(scrollRef, nowMinutes, isToday, key, HOUR_PX)

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className="grid-head">
        <div className="week-header" style={{ gridTemplateColumns: `50px repeat(${cols.length}, minmax(0, 1fr))` }}>
          <div />
          {cols.map(m => (
            <div key={m.id} className="week-header-cell">
              <div aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', background: m.color, color: inkFor(m.color), margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem' }}>{m.avatar}</div>
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
                  <EventChip key={ev.id} ev={ev} tz={tz} members={members} categories={categories} small onTap={() => onTap(ev)} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="timegrid" style={{ gridTemplateColumns: `50px repeat(${cols.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
        <div className="time-gutter">
          {Array.from({ length: 24 }, (_, h) => <div className="time-label" key={h}>{h === 0 ? '' : format(new Date(2000, 0, 1, h), 'h a')}</div>)}
        </div>
        {isToday && <div className="now-line" style={{ top: (nowMinutes / 60) * HOUR_PX, left: 50, right: 0 }}><span className="now-dot" /></div>}
        {cols.map(m => {
          const dayEvents = events.filter(e => !e.allDay && isTimedOnDate(e, key, tz) && (m.id === '__none' || e.memberIds.includes(m.id) || e.memberIds.length === 0))
          const laidOut = layoutColumns(dayEvents, tz, (24 / HOUR_PX) * 60)
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
                const { background, avatars, ink, emoji, pill, solid } = eventVisual(ev, members, categories, 10)
                const left = `calc(${(col / totalCols) * 100}% + 2px)`, width = `calc(${100 / totalCols}% - 4px)`
                return (
                  <Fragment key={ev.id}>
                    <LeaveMarker ev={ev} tz={tz} dayKey={key} hourPx={HOUR_PX} left={left} width={width} color={solid} />
                    <div className="timed-event"
                      style={{ top: (s / 60) * HOUR_PX, height: Math.max(((e - s) / 60) * HOUR_PX - 2, 24), left, width, ...evFill(background, ink) }}
                      {...pressable(() => onTap(ev))} aria-label={eventLabel(ev, tz, members, categories)}>
                      {/* The column already says whose it is; a lone avatar would only repeat it. */}
                      <div className="event-title-row"><EventTitle title={ev.title} avatars={pill ? avatars : []} emoji={emoji} pill={pill} /></div>
                      <span style={{ opacity: 0.85 }}>{formatTime(ev.start, tz)}</span>
                    </div>
                  </Fragment>
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
  const isPhone = useIsPhone()
  const days = useMemo(() => {
    const from = startOfWeek(startOfMonth(anchor), { weekStartsOn: weekStart })
    const to = addDays(startOfWeek(endOfMonth(anchor), { weekStartsOn: weekStart }), 6)
    const out: Date[] = []
    for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
    return out
  }, [anchor, weekStart])
  const todayStr = dateKey(new Date())
  const weeks = days.length / 7
  const roving = useRovingGrid(7, Math.max(days.findIndex(d => dateKey(d) === todayStr), days.findIndex(d => isSameMonth(d, anchor))))

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
      <div className="month-grid" ref={gridRef} style={{ height: '100%', gridTemplateRows: `24px repeat(${weeks}, minmax(0, 1fr))` }} onKeyDown={roving.onKeyDown}>
        {/* From the real first week, so a Monday-start week is labeled M T W… (was always S M T…). */}
        {days.slice(0, 7).map((d, i) => (
          <div key={i} aria-hidden="true" style={{ textAlign: 'center', fontSize: '0.6875rem', fontWeight: 800, color: 'var(--text-dim)', paddingTop: 4 }}>{format(d, 'EEEEE')}</div>
        ))}
        {days.map((d, i) => {
          const key = dateKey(d)
          const dayEvents = events.filter(e => e.allDay ? isAllDayOnDate(e, key) : isTimedOnDate(e, key, tz))
          const overflow = dayEvents.length > maxFit
          const shown = overflow ? dayEvents.slice(0, Math.max(1, maxFit - 1)) : dayEvents
          const hidden = dayEvents.length - shown.length
          return (
            <div key={i} className={`month-cell ${isSameMonth(d, anchor) ? '' : 'dim'}`} onClick={() => onDayTap(d)}>
              <button type="button" data-roving tabIndex={roving.tabIndex(i)} className={`month-daynum ${key === todayStr ? 'today' : ''}`}
                aria-current={key === todayStr ? 'date' : undefined}
                aria-label={`${format(d, 'EEEE, MMMM d')}, ${dayEvents.length} event${dayEvents.length === 1 ? '' : 's'}. Open day`}
                onClick={e => { e.stopPropagation(); onDayTap(d) }}>{format(d, 'd')}</button>
              {shown.map(ev => {
                const { background, avatars, ink, emoji, pill } = eventVisual(ev, members, categories, 6)
                return (
                  <div key={ev.id} className="month-chip" style={evFill(background, ink)} {...pressable(() => onTap(ev))} aria-label={eventLabel(ev, tz, members, categories)}>
                    {/* A phone's month cell is ~50px wide: time or avatars alone filled it, so show just the title. */}
                    <EventTitle title={`${ev.allDay || isPhone ? '' : formatTime(ev.start, tz) + ' '}${ev.title}`} avatars={isPhone ? [] : avatars} emoji={emoji} pill={pill} />
                  </div>
                )
              })}
              {hidden > 0 && <div className="month-more" aria-hidden="true">+{hidden} more</div>}
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
              // The whole row is tappable; its title is the real button (the location link can't nest in one).
              <div key={ev.id} className="schedule-item" onClick={() => onTap(ev)}>
                <div className="schedule-color-bar" style={{ background }} />
                <div className="schedule-time" aria-hidden="true">{ev.allDay ? 'All day' : formatTime(ev.start, tz)}</div>
                <div>
                  <button type="button" className="plain-btn schedule-title" aria-label={eventLabel(ev, tz, members, categories)}
                    onClick={e => { e.stopPropagation(); onTap(ev) }}>{emoji && <><span className="event-emoji">{emoji}</span> </>}{ev.title}{avatars.length > 0 && <span className="event-avatars schedule-avatars">{avatars.join(' ')}</span>}{!!ev.noteCount && <span className="schedule-notes" aria-hidden="true">💬 {ev.noteCount}</span>}</button>
                  {ev.leaveAt && <div className="leave-by" aria-hidden="true">🚗 Leave by {formatTime(ev.leaveAt, tz)}</div>}
                  {ev.location && (() => {
                    const href = locationHref(ev.location)
                    // stopPropagation: tapping the address opens maps; the rest of the row opens the event.
                    return <div className="schedule-loc">{href ? <a className="location-link" href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{ev.location}</a> : ev.location}</div>
                  })()}
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
  return `${cat.emoji ? cat.emoji + ' ' : ''}${cat.name}`
}

/** Where an event's location should link: the URL itself if it is one (a Zoom link), else a maps
 * search - Apple Maps on Apple devices, Google Maps elsewhere. Obviously non-physical locations
 * ("Microsoft Teams Meeting", "TBD") stay plain text. */
function locationHref(location: string): string | null {
  const text = location.trim()
  const url = text.match(/https?:\/\/\S+/)
  if (url) return url[0]
  if (/\b(zoom|teams|google meet|webex|online|virtual|tbd|tba)\b/i.test(text)) return null
  const q = encodeURIComponent(text)
  return /iPhone|iPad|Macintosh/.test(navigator.userAgent) ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`
}

function EventDetailSheet({ event, members, categories, calendars, tz, onClose, onEdit, onDelete, onToggleMember, onSaveScopedMembers, onSaveTravel }: {
  event: EventInstance; members: { id: string; name: string; color: string; avatar: string }[]; categories: Category[]; calendars: CalendarEntry[]; tz: string
  onClose: () => void; onEdit: () => void; onDelete: () => void; onToggleMember: (memberId: string) => void
  onSaveScopedMembers: (id: string, memberIds: string[], scope: 'occurrence' | 'series') => void
  onSaveTravel: (travelMinutes: number | null, remindBeforeLeave: boolean) => void
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
        <div style={{ fontWeight: 800, fontSize: '0.9375rem' }}>
          {event.allDay ? `${format(new Date(event.start + 'T00:00:00'), 'EEE, MMM d')}${event.end !== addDays(new Date(event.start + 'T00:00:00'), 1).toISOString().slice(0, 10) ? ' – ' + format(addDays(new Date(event.end + 'T00:00:00'), -1), 'EEE, MMM d') : ''} · All day`
            : `${format(new Date(event.start), 'EEE, MMM d')} · ${formatTime(event.start, tz)} – ${formatTime(event.end, tz)}`}
        </div>
        {event.location && (() => {
          const href = locationHref(event.location)
          return (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-dim)', fontWeight: 700 }}>
              <LocationIcon width={18} height={18} style={{ flexShrink: 0 }} />
              {href ? <a className="location-link" href={href} target="_blank" rel="noopener noreferrer">{event.location}</a> : event.location}
            </div>
          )
        })()}
        {event.rrule && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-dim)', fontWeight: 700 }}>
            <RepeatIcon width={18} height={18} />Repeats
          </div>
        )}
        {catLabel && <div style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', fontWeight: 700 }}>{catLabel}</div>}
        {reminderLabel(event.reminders) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-dim)', fontSize: '0.8125rem', fontWeight: 700 }}>
            🔔 {reminderLabel(event.reminders)}{event.remindBeforeLeave && event.leaveAt ? ' leaving' : ''}{event.reminderSource === 'default' ? ' · default' : ''}
          </div>
        )}
        {event.leaveAt && <div className="leave-by">🚗 Leave by {formatTime(event.leaveAt, tz)}</div>}
        {/* Read-only events have no edit sheet, so their travel time is set right here. */}
        {event.readOnly && !event.allDay && (
          <TravelFields minutes={event.travelMinutes} remind={event.remindBeforeLeave} onChange={onSaveTravel} />
        )}
        {members.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="chip-row">
              {members.map(m => (
                <button key={m.id} className={`chip ${chipMemberIds.includes(m.id) ? 'active' : ''}`} aria-pressed={chipMemberIds.includes(m.id)} style={{ ['--chip-color' as string]: m.color }} onClick={() => toggleChip(m.id)}>
                  {m.avatar} {m.name}
                </button>
              ))}
            </div>
            {pendingMemberIds === null && scopeLabel && (
              <div style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', fontWeight: 700 }}>{scopeLabel}</div>
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
        <EventTasks eventId={event.id} />
        <NotesThread target={`event:${event.id}`} />
        {event.readOnly && (
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', fontWeight: 700 }}>
            Only the family members and travel time are saved in Kinwall — the event itself comes from {calendarName}.
          </div>
        )}
      </div>
    </Sheet>
  )
}

/** List items linked to this event: tick them off, or add one to a list (the last one used).
 * The add form stays folded behind "+ Add task" so every event sheet isn't a form. */
function EventTasks({ eventId }: { eventId: string }) {
  const { toast } = useApp()
  const [items, setItems] = useState<(ListItem & { listName: string })[]>([])
  const [lists, setLists] = useState<List[]>([])
  const [listId, setListId] = useState(() => { try { return localStorage.getItem(TASK_LIST_KEY) ?? '' } catch { return '' } })
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const collapse = () => { setAdding(false); setDraft(''); requestAnimationFrame(() => addBtnRef.current?.focus()) }
  const load = () => api.getEventItems(eventId).then(setItems).catch(() => setItems([]))
  useEffect(() => {
    load()
    api.getLists().then(ls => {
      setLists(ls)
      setListId(id => ls.some(l => l.id === id) ? id : (ls.find(l => l.kind === 'todo') ?? ls[0])?.id ?? '')
    }).catch(() => setLists([]))
  }, [eventId]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async (item: ListItem) => {
    try { await api.updateListItem(item.listId, item.id, { done: !item.done }); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update task', true) }
  }
  const add = async () => {
    const title = draft.trim()
    if (!title || !listId) return
    setDraft('')
    try { localStorage.setItem(TASK_LIST_KEY, listId) } catch { /* private mode */ }
    try { await api.addListItems(listId, { title, eventId }); load(); announce(`Added ${title}`) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add task', true) }
  }
  if (lists.length === 0 && items.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.length > 0 && <h3 style={{ fontWeight: 800, fontSize: '0.8125rem', color: 'var(--text-dim)', margin: 0 }}>Tasks</h3>}
      {items.map(i => (
        <div key={i.id} className={`list-item-row ${i.done ? 'done' : ''}`}>
          <button className={`list-item-check ${i.done ? 'done' : ''}`} onClick={() => toggle(i)} role="checkbox" aria-checked={i.done} aria-label={i.title}>{i.done && <CheckIcon width={20} height={20} />}</button>
          <div className="list-item-body">
            <div className="list-item-title">{i.title}</div>
            <div className="list-item-meta">{i.listName}</div>
          </div>
        </div>
      ))}
      {lists.length > 0 && !adding && (
        <button ref={addBtnRef} className="link-btn" style={{ alignSelf: 'flex-start' }} aria-expanded={adding} aria-controls={`tasks-add-${eventId}`}
          onClick={() => setAdding(true)}>+ Add task</button>
      )}
      {lists.length > 0 && adding && (
        // One composite field: text, list chip, go. Escape or leaving it empty folds it back. Capture
        // phase: the sheet's own Escape would close the whole sheet.
        <div id={`tasks-add-${eventId}`} className="task-add" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget) && !draft.trim()) setAdding(false) }}
          onKeyDownCapture={e => { if (e.key === 'Escape') { e.stopPropagation(); collapse() } }}>
          <div className="task-add-field">
            <input type="text" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} autoFocus
              enterKeyHint="done" placeholder="New task" aria-label="New task" />
            <button type="button" className="task-add-go" onClick={add} disabled={!draft.trim()} aria-label="Add task"><PlusIcon width={20} height={20} /></button>
          </div>
          <div className="chip-row task-add-lists" role="radiogroup" aria-label="Add to list">
            {lists.map(l => (
              <button key={l.id} type="button" role="radio" aria-checked={listId === l.id} className={`chip ${listId === l.id ? 'active' : ''}`} onClick={() => setListId(l.id)}>
                {l.emoji ? <span aria-hidden="true">{l.emoji} </span> : null}{l.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const TRAVEL_PRESETS = [10, 15, 30, 45, 60]

/** Travel time (None / presets / custom minutes) and, once set, "remind me before I need to leave".
 * Kinwall-only: never written to Google/Outlook, so it works on any event. A custom value commits on
 * blur/Enter, so the detail sheet (which saves on change) doesn't save on every keystroke. */
function TravelFields({ minutes, remind, onChange }: { minutes: number | null; remind: boolean; onChange: (minutes: number | null, remind: boolean) => void }) {
  const [custom, setCustom] = useState(minutes !== null && !TRAVEL_PRESETS.includes(minutes))
  const [draft, setDraft] = useState(minutes ? String(minutes) : '')
  const commit = () => {
    const n = Math.min(600, parseInt(draft, 10) || 0)
    if ((n || null) !== minutes) onChange(n || null, n ? remind : false)
  }
  return (
    <>
      <div className="field">
        <label>Travel time</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={custom ? 'custom' : minutes === null ? 'none' : String(minutes)} style={{ flex: 1, minWidth: 0 }}
            onChange={e => {
              const v = e.target.value
              if (v === 'custom') { setCustom(true); setDraft(minutes ? String(minutes) : ''); return }
              setCustom(false)
              onChange(v === 'none' ? null : Number(v), v === 'none' ? false : remind)
            }}>
            <option value="none">None</option>
            {TRAVEL_PRESETS.map(m => <option key={m} value={m}>{m} min</option>)}
            <option value="custom">Custom…</option>
          </select>
          {custom && (
            <input type="number" inputMode="numeric" min={1} max={600} value={draft} placeholder="Minutes" aria-label="Travel time in minutes"
              style={{ width: '7em' }} autoFocus onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
          )}
        </div>
        <div className="settings-row-sub">Only in Kinwall — not added to Google/Outlook.</div>
      </div>
      {minutes !== null && (
        <div className="toggle-row">
          <label id="travel-remind-label">Remind me before I need to leave</label>
          <button className={`switch ${remind ? 'on' : ''}`} role="switch" aria-checked={remind} aria-labelledby="travel-remind-label" onClick={() => onChange(minutes, !remind)}><span className="knob" /></button>
        </div>
      )}
    </>
  )
}

function EventEditSheet({ event, prefill, calendars, members, categories, onClose, onSave }: {
  event: EventInstance | null; prefill?: Partial<EventInstance>; calendars: CalendarEntry[]
  members: { id: string; name: string; color: string; avatar: string }[]; categories: Category[]
  onClose: () => void
  onSave: (body: Partial<EventInstance>, id: string | null, seriesCategory?: { categoryId: string | null; scope: 'occurrence' | 'series' }) => void
}) {
  const writable = calendars.filter(c => c.writable && c.enabled) // no read-only (holiday/shared) or switched-off calendars
  const base = event ?? prefill ?? {}
  const [title, setTitle] = useState(base.title ?? '')
  const [allDay, setAllDay] = useState(!!base.allDay)
  const [calendarId, setCalendarId] = useState(base.calendarId ?? writable[0]?.id ?? NEW_LOCAL_CALENDAR)
  const calKind = calendarId === NEW_LOCAL_CALENDAR ? 'local' : calendars.find(c => c.id === calendarId)?.kind
  const remindersEditable = calKind === 'local' || calKind === 'google' || calKind === 'microsoft'
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
  // reminderSource says whether the reminders are the event's own or the default. The event's own
  // ones pre-select a matching preset, or show as "keep" when they don't fit one (e.g. 10 min + 1 day
  // from Google); no reminders on an existing event means they were turned off.
  const ownReminders = base.reminderSource === 'event' ? base.reminders ?? [] : null
  const initialReminder = !event || base.reminderSource === 'default' ? 'default'
    : ownReminders === null || ownReminders.length === 0 ? 'none'
    : ownReminders.length === 1 && REMINDER_OPTIONS.some(o => o.minutes[0] === ownReminders[0]) ? String(ownReminders[0])
    : 'keep'
  const [reminder, setReminder] = useState(initialReminder)
  const [travel, setTravel] = useState<{ minutes: number | null; remind: boolean }>({ minutes: base.travelMinutes ?? null, remind: !!base.remindBeforeLeave })

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
    const body: Partial<EventInstance> = { title: title.trim(), calendarId, location: location.trim() || undefined, rrule: rruleStr }
    // Only send people when they changed: re-sending the inherited list would pin it as a per-event
    // tag, so "From the calendar" events stopped following the calendar after any unrelated edit.
    const initialMembers = base.memberIds ?? []
    if (!event || memberIds.length !== initialMembers.length || memberIds.some(id => !initialMembers.includes(id))) body.memberIds = memberIds
    // A repeating event opens on one occurrence; sending its dates back unchanged would restart the
    // whole series there and drop the earlier occurrences. Only send the timing when it was edited.
    const timingChanged = !event || allDay !== !!event.allDay || start !== (event.allDay ? event.start : new Date(event.start).toISOString())
      || end !== (event.allDay ? event.end : new Date(event.end).toISOString())
    if (timingChanged) Object.assign(body, { allDay, start, end })
    if (categoryChanged && !inSeries) body.categoryId = categoryId
    // Only when changed (same "don't pin an inherited value" reasoning as memberIds). On Google and
    // Outlook this writes the reminder to the event there.
    if (remindersEditable && reminder !== initialReminder && reminder !== 'keep') {
      body.reminders = reminder === 'default' ? null : reminder === 'none' ? [] : [Number(reminder)]
    }
    // Kinwall-only, so it rides along on any calendar; only sent when changed.
    const travelMinutes = allDay ? null : travel.minutes
    if (travelMinutes !== (base.travelMinutes ?? null)) body.travelMinutes = travelMinutes
    if ((travelMinutes !== null && travel.remind) !== !!base.remindBeforeLeave) body.remindBeforeLeave = travelMinutes !== null && travel.remind
    onSave(body, event?.id ?? null, categoryChanged && inSeries ? { categoryId, scope: categoryScope } : undefined)
  }

  return (
    <Sheet title={event ? 'Edit event' : 'New event'} onClose={onClose}
      actions={<button className="btn btn-primary btn-block" onClick={submit} disabled={endBeforeStart}>{event ? 'Save changes' : 'Add event'}</button>}>
      <div className="field">
        <label>Title</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Event title" autoFocus={!event} /* new events only: on a phone, opening Edit shouldn't throw up the keyboard */ />
      </div>
      <div className="toggle-row">
        <label id="event-allday-label">All day</label>
        <button className={`switch ${allDay ? 'on' : ''}`} role="switch" aria-checked={allDay} aria-labelledby="event-allday-label" onClick={() => setAllDay(v => !v)}><span className="knob" /></button>
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
          <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)}
            aria-invalid={endBeforeStart || undefined} aria-describedby={endBeforeStart ? 'event-end-error' : undefined} />
        </div>
        {!allDay && (
          <div className="field">
            <label>&nbsp;</label>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} aria-label="End time"
              aria-invalid={endBeforeStart || undefined} aria-describedby={endBeforeStart ? 'event-end-error' : undefined} />
          </div>
        )}
      </div>
      {endBeforeStart && <p className="field-error" id="event-end-error" role="alert">The end has to be after the start.</p>}
      <div className="field">
        <label>Calendar</label>
        <select value={calendarId} onChange={e => setCalendarId(e.target.value)}>
          {writable.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          {/* No local calendar yet: offer one, created on save, for events that live only in Kinwall */}
          {!event && !writable.some(c => c.kind === 'local') && <option value={NEW_LOCAL_CALENDAR}>Kinwall only (not synced)</option>}
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
            <button key={m.id} className={`chip ${memberIds.includes(m.id) ? 'active' : ''}`} aria-pressed={memberIds.includes(m.id)} style={{ ['--chip-color' as string]: m.color }} onClick={() => toggleMember(m.id)}>
              {m.avatar} {m.name}
            </button>
          ))}
        </div>
      </div>
      {remindersEditable && (
        <div className="field">
          <label>Reminder</label>
          <select value={reminder} onChange={e => setReminder(e.target.value)}>
            {initialReminder === 'keep' && <option value="keep">{reminderLabel(ownReminders)}</option>}
            {/* Outlook has no "use the default" setting to write back */}
            {calKind !== 'microsoft' && <option value="default">{calKind === 'google' ? 'Google calendar default' : 'Household default'}</option>}
            {REMINDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      {!allDay && <TravelFields minutes={travel.minutes} remind={travel.remind} onChange={(minutes, remind) => setTravel({ minutes, remind })} />}
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
          <Segmented label="Apply the category to" style={{ marginTop: 10 }} value={categoryScope} onChange={setCategoryScope}
            options={[{ key: 'series', label: 'All events' }, { key: 'occurrence', label: 'This event' }]} />
        )}
      </div>
    </Sheet>
  )
}
