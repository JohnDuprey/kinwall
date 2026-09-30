// Settings → Calendars → a calendar → Filter (docs/using/calendar.md "Calendar filters"): pick
// which of the calendar's events the family sees, with a live preview of the next 3 months.
import { useEffect, useMemo, useState } from 'react'
import { addMonths, format } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import Sheet from './Sheet.tsx'
import PickField, { PickSwatch } from './PickField.tsx'
import { ChevronRight, EyeIcon } from './icons.tsx'
import { formatTime } from './timeFormat.ts'
import { FILTER_PRESETS, NO_FILTER, filterActive, parseKeywordList, previewFilter, type CalendarFilter } from './calendarFilter.ts'
import type { CalendarEntry, EventInstance, HiddenEvent } from './types.ts'

const PREVIEW_ROWS = 40

function eventWhen(ev: Pick<EventInstance, 'start' | 'allDay'>, tz: string): string {
  return ev.allDay ? format(new Date(`${ev.start.slice(0, 10)}T00:00:00`), 'EEE, MMM d') : `${format(new Date(ev.start), 'EEE, MMM d')} · ${formatTime(ev.start, tz)}`
}

export default function CalendarFilterSheet({ calendar, onClose, onSaved }: { calendar: CalendarEntry; onClose: () => void; onSaved: (filter: CalendarFilter) => void }) {
  const { categories, settings, toast } = useApp()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [filter, setFilter] = useState<CalendarFilter>(calendar.filter ?? NO_FILTER)
  const [keywordText, setKeywordText] = useState((calendar.filter ?? NO_FILTER).keywords.join(', '))
  const [events, setEvents] = useState<EventInstance[] | null>(null)
  const [preset, setPreset] = useState('')
  const [saving, setSaving] = useState(false)
  const draft = useMemo(() => ({ ...filter, keywords: parseKeywordList(keywordText) }), [filter, keywordText])
  // The preview follows typing a moment later, so long calendars don't redo it on every key.
  const [previewed, setPreviewed] = useState(draft)
  useEffect(() => { const t = setTimeout(() => setPreviewed(draft), 250); return () => clearTimeout(t) }, [draft])

  useEffect(() => {
    const now = new Date()
    api.getEvents(now.toISOString(), addMonths(now, 3).toISOString(), undefined, calendar.id, true).then(setEvents).catch(() => setEvents([]))
  }, [calendar.id])
  const preview = useMemo(() => events && previewFilter(events, previewed), [events, previewed])

  const pickPreset = (id: string) => {
    const p = FILTER_PRESETS.find(x => x.id === id)
    if (!p) return
    setPreset(id)
    setFilter(p.filter)
    setKeywordText(p.filter.keywords.join(', '))
  }
  const save = async () => {
    setSaving(true)
    try {
      await api.updateCalendar(calendar.id, { filter: draft })
      onSaved(draft)
      toast(filterActive(draft) ? `Filter saved: ${calendar.name}` : `Showing every event: ${calendar.name}`)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save the filter', true)
    } finally { setSaving(false) }
  }
  const active = filterActive(draft)

  return (
    <Sheet title={`Filter: ${calendar.name}`} onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save} disabled={saving}>Save</button>}>
      <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>Decide which events the family sees from this calendar, everywhere: the calendar, the Board, reminders and the assistant. Nothing is deleted, and you can change it any time.</p>
      <div className="field">
        <label htmlFor="filter-preset">Start from a preset</label>
        <select id="filter-preset" value={preset} onChange={e => pickPreset(e.target.value)}>
          <option value="">Choose…</option>
          {FILTER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="filter-mode">Show</label>
        <select id="filter-mode" value={filter.mode} onChange={e => setFilter(f => ({ ...f, mode: e.target.value as CalendarFilter['mode'] }))}>
          <option value="all">All events</option>
          <option value="only">Only events that match</option>
          <option value="except">All except events that match</option>
        </select>
      </div>
      {filter.mode !== 'all' && <>
        <div className="field">
          <label htmlFor="filter-keywords">Words in the title</label>
          <textarea id="filter-keywords" rows={3} value={keywordText} onChange={e => setKeywordText(e.target.value)} placeholder="no school, half day, break" aria-describedby="filter-keywords-sub" />
          <div className="settings-row-sub" id="filter-keywords-sub">Separate with commas. Whole words, any case: "break" matches "Winter Break" but not "Breakfast".</div>
        </div>
        <div className="field">
          <label htmlFor="filter-allday">All-day or timed</label>
          <select id="filter-allday" value={filter.allDay} onChange={e => setFilter(f => ({ ...f, allDay: e.target.value as CalendarFilter['allDay'] }))}>
            <option value="any">Either</option>
            <option value="allDay">All-day only</option>
            <option value="timed">Timed only</option>
          </select>
        </div>
        {categories.length > 0 && <div className="field">
          <label htmlFor="filter-cats">Categories</label>
          <PickField id="filter-cats" label="Categories" multiple none="Any category" value={filter.categoryIds} onChange={ids => setFilter(f => ({ ...f, categoryIds: ids }))}
            options={categories.map(c => ({ value: c.id, label: `${c.emoji ? c.emoji + ' ' : ''}${c.name}`, lead: <PickSwatch color={c.color} /> }))} />
        </div>}
        <p className="settings-row-sub">{active ? 'An event matches when it has one of the words, and fits the other choices you made.' : 'Add a word, a category or all-day to filter.'}</p>
      </>}

      <section className="filter-preview" aria-labelledby="filter-preview-title" aria-live="polite">
        <h3 id="filter-preview-title">{!preview ? 'Loading the next 3 months…' : `Showing ${preview.shown.length} of ${preview.shown.length + preview.hidden.length} events in the next 3 months`}</h3>
        {preview && <>
          <PreviewList title="Shown" events={preview.shown} tz={tz} />
          <PreviewList title="Hidden" events={preview.hidden} tz={tz} hidden />
        </>}
      </section>
    </Sheet>
  )
}

function PreviewList({ title, events, tz, hidden }: { title: string; events: EventInstance[]; tz: string; hidden?: boolean }) {
  const [all, setAll] = useState(false)
  const rows = all ? events : events.slice(0, PREVIEW_ROWS)
  return (
    <div className={`filter-preview-group ${hidden ? 'is-hidden' : ''}`}>
      <h4>{hidden ? '🚫' : '✓'} {title} ({events.length})</h4>
      {events.length === 0 ? <p className="settings-row-sub">None</p> : <ul>
        {rows.map(ev => <li key={`${ev.id}@${ev.start}`}><span className="filter-preview-when">{eventWhen(ev, tz)}</span><span>{ev.title}</span></li>)}
      </ul>}
      {events.length > rows.length && <button type="button" className="sheet-link" onClick={() => setAll(true)}><span>Show all {events.length}</span><ChevronRight /></button>}
    </div>
  )
}

/** Settings → Calendars → a calendar → Hidden events: what's been hidden one by one, to show again. */
export function HiddenEventsSheet({ calendar, hidden, onClose, onChanged }: { calendar: CalendarEntry; hidden: HiddenEvent[]; onClose: () => void; onChanged: (hidden: HiddenEvent[]) => void }) {
  const { settings, toast, reloadCore } = useApp()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const show = async (h: HiddenEvent) => {
    try {
      await api.showHiddenEvent(calendar.id, h.id)
      onChanged(hidden.filter(x => x.id !== h.id))
      reloadCore()
      toast(`Showing again: ${h.title}`)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not show the event', true) }
  }
  return (
    <Sheet title={`Hidden: ${calendar.name}`} onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={onClose}>Done</button>}>
      <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>Events a parent hid from the family. Events the filter leaves out aren't listed here: change the filter to bring those back.</p>
      {hidden.length === 0 ? <p className="settings-row-sub">Nothing hidden. To hide an event, open it on the calendar and tap Hide.</p> : <div className="hidden-list">
        {hidden.map(h => (
          <div key={h.id} className="hidden-row">
            <span>{h.title}<small>{h.scope === 'series' ? `Every one in the series, from ${eventWhen(h, tz)}` : eventWhen(h, tz)}</small></span>
            <button type="button" className="btn btn-secondary" onClick={() => show(h)} aria-label={`Show ${h.title} again`}><EyeIcon width={18} height={18} />Show again</button>
          </div>
        ))}
      </div>}
    </Sheet>
  )
}
