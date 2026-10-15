// Trackers (server: routes/trackers.ts): the family's reading log, memories journal and health
// visits. Reading and Memories work on the wall; Health is for phones and computers only - the
// server refuses it to display keys, and this screen only offers it once GET /api/me says admin.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { DAY, formatDate, intlLocale, msg, t, tc, tm, tn } from './i18n.ts'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce, Segmented } from './a11y.tsx'
import BookLookup from './BookLookup.tsx'
import Library, { AddBookSheet } from './Library.tsx'
import { addDayKeys } from './library.ts'
import { todayKeyInTz } from './date.ts'
import { formatTime } from './timeFormat.ts'
import { CheckIcon, ChevronDown, ChevronRight, PlusIcon } from './icons.tsx'
import { useIsPhone } from './useIsPhone.ts'
import Sheet from './Sheet.tsx'
import { preparePhoto, PhotoFormatError } from './photos.ts'
import type { EventInstance, HealthData, HealthType, Member, MemoryData, Photo, ReadingData, ReadingFormat, ReadingStatus, TrackerEntry, TrackerInput, TrackerKind } from './types.ts'
import { dayAmount, FINISHED_SHOWN, STATUS_EMOJI, STATUS_WORDS, hoursMinutes, shelfBooks, isAudiobook, left, recentDays, logReachesEnd, readingPercent, shelfLine, shelfTotals, splitMinutes, toMinutes } from './reading.ts'
import { trackerKinds } from './types.ts'
import { MedicineList } from './MedicationSettings.tsx'
import PickField from './PickField.tsx'
import { forPerson, HEALTH_PERSON_KEY, personIn, startPerson } from './trackerPerson.ts'
import { Face, ChipFace } from './Face'
import { hashPath, hashQuery } from './hashQuery.ts'
import { looksMedical, visitFromEvent, type VisitDraft } from './visit-from-event.ts'
import BookCover from './BookCover.tsx'

// ponytail: TABS, SUB_TO_KIND and trackerKinds() (types.ts, for App's nav) list the kinds in the same order.
// The views, like the home page's: tabs where they fit, one button and a sheet on a phone (TrackerViewPicker).
// The library comes with Reading: the family's books, apart from who's reading what (Library.tsx).
type TrackerView = TrackerKind | 'library'
const TABS: { key: TrackerView; label: string; emoji: string; hint: string }[] = [
  { key: 'reading', label: msg('Reading'), emoji: '📖', hint: msg("Who's reading what, and how far along") },
  { key: 'library', label: msg('Library'), emoji: '📚', hint: msg('The books your family owns, and who has them') },
  { key: 'memory', label: msg('Memories'), emoji: '📝', hint: msg('A family journal, a moment a day') },
  { key: 'health', label: msg('Health'), emoji: '🩺', hint: msg('Checkups, visits and medicines') },
]
const SUB_TO_VIEW: Record<string, TrackerView> = { reading: 'reading', library: 'library', memories: 'memory', health: 'health' }
const VIEW_TO_SUB: Record<TrackerView, string> = { reading: 'reading', library: 'library', memory: 'memories', health: 'health' }
const STATUS = (['want', 'reading', 'finished'] as ReadingStatus[]).map(key => ({ key, label: STATUS_WORDS[key] })) // labels marked: tm()
const HEALTH_TYPES: { key: HealthType; label: string; emoji: string }[] = [
  { key: 'checkup', label: msg('Checkup'), emoji: '🩺' }, { key: 'dentist', label: msg('Dentist'), emoji: '🦷' }, { key: 'specialist', label: msg('Specialist'), emoji: '👩‍⚕️' },
  { key: 'vaccine', label: msg('Vaccine'), emoji: '💉' }, { key: 'sick', label: msg('Sick visit'), emoji: '🤒' }, { key: 'other', label: msg('Other'), emoji: '📋' },
]
const MOODS = ['😊', '😂', '🥰', '🎉', '😴', '😢', '😮', '🌟']
const FAMILY = { id: null as string | null, name: msg('Family'), color: '#C7B8A8', avatar: '🏠' }
/** FAMILY with its name in the current language. */
const family = () => ({ ...FAMILY, name: tm(FAMILY.name) })
const FORMER = '__former' // the form's "who" for an entry that belonged to a removed member
const ASK = '__ask' // the form's "who" for a visit from an event with no one, or several people, on it: pick one
type Who = { id: string | null; name: string; color: string; avatar: string; former?: string }
/** A removed member's entries keep their name: "Leo (removed)", in gray. */
const formerWho = (name: string): Who => ({ id: null, name: t('{name} (removed)', { name }), color: '#B8B2AB', avatar: name[0] ?? '?', former: name })
const isFamily = (e: TrackerEntry) => e.memberId === null && !e.formerMember

const niceDate = (d: string, withYear = false) => formatDate(new Date(`${d}T12:00:00`), withYear ? { ...DAY, year: 'numeric' } : DAY)
const errMsg = (e: unknown, fallback: string) => e instanceof ApiError ? e.message : fallback

/** Phones: the views don't fit as tabs, so one button shows the view and opens a sheet of them (the
 * home page's ViewPicker, Calendar.tsx). Compact (emoji and ▾) when the row has the view's own tools
 * next to it: the library's search, whose placeholder names the view. */
function TrackerViewPicker({ views, value, onChange, compact }: { views: typeof TABS; value: TrackerView; onChange: (v: TrackerView) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const current = views.find(v => v.key === value) ?? views[0]
  return (
    <>
      <button type="button" className="btn btn-secondary view-pick" aria-haspopup="dialog" aria-label={t('{view} — switch view', { view: current ? tm(current.label) : '' })} onClick={() => setOpen(true)}>
        <span aria-hidden="true">{current?.emoji}</span>{!compact && <span>{current && tm(current.label)}</span>}<ChevronDown width={16} height={16} />
      </button>
      {open && (
        <Sheet title={t('View')} onClose={() => setOpen(false)}>
          <div className="sheet-links">
            {views.map(v => (
              <button key={v.key} type="button" className="sheet-link" aria-pressed={v.key === value} onClick={() => { onChange(v.key); setOpen(false) }}>
                <span className="lib-emoji" aria-hidden="true">{v.emoji}</span><span>{tm(v.label)}<small>{tm(v.hint)}</small></span>{v.key === value && <CheckIcon className="pick-check" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}

export default function Trackers({ sub }: { sub?: string }) {
  const { settings, members, selectedMemberId, refreshTick, toast, parentDevice, focusLocked, meMemberId } = useApp()
  // A kid's own device changes only their entries and the family's (the server refuses the rest).
  const kid = !parentDevice && focusLocked ? meMemberId : null
  const canEdit = (e: TrackerEntry) => !kid || !e.memberId || e.memberId === kid
  const tz = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = todayKeyInTz(tz)
  // Fail closed: Health only once the key is known to be admin (never on a wall display).
  const [admin, setAdmin] = useState(false)
  useEffect(() => { api.meStrict().then(me => setAdmin(me.scope === 'admin')).catch(() => setAdmin(false)) }, [])
  const on = trackerKinds(settings)
  const tabs = TABS.filter(tab => on.includes(VIEW_TO_SUB[tab.key === 'library' ? 'reading' : tab.key]) && (tab.key !== 'health' || admin))
  const view = tabs.find(tab => tab.key === SUB_TO_VIEW[sub ?? ''])?.key ?? tabs[0]?.key ?? 'reading'
  const library = view === 'library'
  const go = (v: TrackerView) => { location.hash = `#/trackers/${VIEW_TO_SUB[v]}` }
  const kind: TrackerKind = library ? 'reading' : view // the library's readers come from reading entries
  const isPhone = useIsPhone()
  const [tools, setTools] = useState<HTMLDivElement | null>(null) // the library's search sits here, beside the view picker

  const [entries, setEntries] = useState<TrackerEntry[] | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [editing, setEditing] = useState<TrackerEntry | { new: true; date?: string } | null>(null)
  const [libAdding, setLibAdding] = useState(false)
  const load = () => api.getTrackers(kind).then(setEntries).catch(e => { setEntries([]); toast(errMsg(e, t("Couldn't load trackers.")), true) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setEntries(null); load() }, [kind])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (entries) load() }, [refreshTick])
  useEffect(() => { if (kind === 'memory' && settings.features.photos) api.getPhotos().then(setPhotos).catch(() => {}) }, [kind, settings.features.photos, refreshTick])

  // Health has its own person switcher, remembered on this device and starting from the header's
  // member filter; it never changes that filter (the calendar's). Reading and Memories follow the header.
  const [healthPick, setHealthPick] = useState<string | null>(() => {
    let saved: string | null = null
    try { saved = localStorage.getItem(HEALTH_PERSON_KEY) } catch { /* storage blocked: everyone */ }
    return startPerson(selectedMemberId, saved)
  })
  const healthPerson = personIn(healthPick, members.map(m => m.id))
  const pickHealthPerson = (id: string | null) => {
    setHealthPick(id)
    try { localStorage.setItem(HEALTH_PERSON_KEY, id ?? '') } catch { /* storage blocked: this visit only */ }
  }
  const personId = kind === 'health' ? healthPerson : selectedMemberId
  // That member's entries (plus the family's, which are everyone's).
  const shown = forPerson(entries ?? [], personId)
  const formers = [...new Set(shown.filter(e => e.formerMember && !e.memberId).map(e => e.formerMember!))].map(formerWho)
  const people: Who[] = [...members.filter(m => !personId || m.id === personId), family(), ...formers]

  // #/trackers/health?visit=<id> (an event sheet's "Open the health visit"): that visit's sheet once loaded.
  useEffect(() => {
    const id = hashQuery(location.hash).get('visit')
    if (!entries || !id || kind !== 'health' || entries.some(e => e.kind !== 'health')) return // the Health list, not one still loading for another view
    history.replaceState(history.state, '', hashPath(location.hash))
    const e = entries.find(x => x.id === id)
    if (e) setEditing(e)
  }, [entries, kind])
  const [fromCal, setFromCal] = useState(false) // Health's "Add from the calendar"
  const [prefill, setPrefill] = useState<VisitPrefill | null>(null)

  const save = async (e: TrackerEntry, body: TrackerInput, msg?: string) => {
    setEntries(list => list && list.map(x => x.id === e.id ? { ...x, ...body, data: { ...x.data, ...body.data } as never } : x)) // optimistic
    try { await api.updateTracker(e.id, body); if (msg) announce(msg); load() } catch (err) { toast(errMsg(err, t('Could not save')), true); load() }
  }

  return (
    <div className="content trackers">
      <div className="trackers-head">
        {isPhone
          ? <><TrackerViewPicker views={tabs} value={view} onChange={go} compact={library} />{library && <div className="trackers-tools" ref={setTools} />}</>
          : <><Segmented tabs idBase="trk-tab" label={t('Tracker')} value={view} onChange={go}
            options={tabs.map(tab => ({ key: tab.key, label: <><span aria-hidden="true">{tab.emoji}</span> {tm(tab.label)}</> }))} />{library && <div className="trackers-tools" ref={setTools} />}</>}
      </div>
      <div className="trackers-body scroll-y" role="tabpanel" aria-labelledby={isPhone ? undefined : `trk-tab-${view}`} aria-label={isPhone ? (l => l && tm(l))(tabs.find(tab => tab.key === view)?.label) : undefined}>
        {entries === null ? <div className="state-card">{t('Loading…')}</div>
          : library ? <Library bar={tools} adding={libAdding} onAdded={() => setLibAdding(false)} onStarted={load} />
          : kind === 'reading' ? <Reading entries={shown} people={people} canEdit={canEdit} onEdit={setEditing} onSave={save} />
          : kind === 'memory' ? <Memories entries={shown} today={today} onEdit={setEditing} onAdd={() => setEditing({ new: true, date: today })} />
          : <Health entries={shown} today={today} onEdit={setEditing} onSave={save} onFromCalendar={() => setFromCal(true)} meds={settings.medications} memberId={healthPerson} switcher={
            <div className="field">
              <label htmlFor="trk-person">{t('Whose health')}</label>
              <PickField id="trk-person" label={t('Whose health')} title={t('Whose health?')} value={[healthPerson ?? '']} onChange={([v]) => pickHealthPerson(v || null)}
                options={[{ value: '', label: t('Everyone'), lead: <Avatar m={family()} size={26} /> }, ...members.map(m => ({ value: m.id, label: m.name, lead: <Avatar m={m} size={26} /> }))]} />
            </div>} />}
      </div>
      <button className="fab" onClick={() => (library ? setLibAdding(true) : setEditing({ new: true }))} aria-label={library ? t('Add a book to the library') : kind === 'reading' ? t('Add a book') : kind === 'memory' ? t('Add a memory') : t('Add a health visit')}><PlusIcon /></button>
      {editing && (
        <EntrySheet kind={kind} entry={'new' in editing ? null : editing} date={'new' in editing ? editing.date ?? today : undefined}
          admin={admin} kid={kid} photos={photos} memberId={personId}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
      {fromCal && <PickEventSheet linked={new Set((entries ?? []).map(e => (e.data as HealthData).eventId).filter((x): x is string => !!x))} tz={tz}
        onClose={() => setFromCal(false)} onPick={ev => { setFromCal(false); setPrefill({ draft: visitFromEvent(ev, tz), eventId: ev.id }) }} />}
      {prefill && <EntrySheet kind="health" entry={null} admin={admin} kid={null} photos={[]} memberId={null} prefill={prefill}
        onClose={() => setPrefill(null)} onSaved={() => { setPrefill(null); load() }} />}
    </div>
  )
}

function Avatar({ m, size = 30 }: { m: Pick<Member, 'name' | 'color' | 'avatar'>; size?: number }) {
  return <Face m={m} className="member-avatar-sm" aria-hidden="true" style={{width: size, height: size }} />
}
function useWho() {
  const { members } = useApp()
  return (e: TrackerEntry): Who => members.find(m => m.id === e.memberId) ?? (e.formerMember ? formerWho(e.formerMember) : family())
}
const belongs = (e: TrackerEntry, p: Who) => p.former ? !e.memberId && e.formerMember === p.former : p.id ? e.memberId === p.id : isFamily(e)

/** Five tap targets; tapping the current rating clears it. */
function Stars({ value, onChange, label }: { value?: number; onChange?: (v: number | null) => void; label: string }) {
  if (!onChange) return value ? <span className="trk-stars" role="img" aria-label={t('{n} of 5 stars', { n: value })}>{'★'.repeat(value)}<span className="trk-stars-off">{'★'.repeat(5 - value)}</span></span> : null
  return (
    <div className="trk-stars-edit" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={n <= (value ?? 0) ? 'on' : ''} aria-pressed={n === value}
          aria-label={tn(n, '{n} star', '{n} stars')} onClick={() => onChange(n === value ? null : n)}>★</button>
      ))}
    </div>
  )
}

// ---------- Reading ----------
function Reading({ entries, people, canEdit, onEdit, onSave }: {
  entries: TrackerEntry[]; people: Who[]; canEdit: (e: TrackerEntry) => boolean
  onEdit: (e: TrackerEntry) => void; onSave: (e: TrackerEntry, body: TrackerInput, msg?: string) => void
}) {
  const [logFor, setLogFor] = useState<TrackerEntry | null>(null)
  const [allFinished, setAllFinished] = useState<Set<string>>(new Set()) // shelves showing every finished book
  const year = String(new Date().getFullYear())
  const shelves = people.map(p => {
    const books = entries.filter(e => belongs(e, p))
    const d = (e: TrackerEntry) => e.data as ReadingData
    const key = p.id ?? p.former ?? 'family'
    const all = allFinished.has(key)
    const { shown, more } = shelfBooks(books, e => ({ ...d(e), updatedAt: e.updatedAt }), all)
    return { p, key, books: shown, more, all, finished: books.filter(e => d(e).status === 'finished').length, totals: shelfTotals(books.map(d), year) }
  }).filter(s => s.books.length > 0)

  if (!shelves.length) return <div className="empty-card"><span className="emoji">📚</span>{t('No books yet. Tap + to add what someone is reading.')}</div>
  return (
    <div className="trk-grid">
      {shelves.map(({ p, key, books, more, all, finished, totals }) => (
        <section key={key} className="trk-card" aria-label={t("{name}'s books", { name: p.name })}>
          <header className="trk-card-head">
            <Avatar m={p} size={40} />
            <div>
              <h3>{p.name}</h3>
              <div className="trk-sub">{shelfLine(year, totals)}</div>
            </div>
          </header>
          <ul className="trk-books">
            {books.map(b => {
              const d = b.data as ReadingData
              const pct = readingPercent(d)
              const audio = isAudiobook(d)
              const progress = left(d)
              return (
                <li key={b.id} className={`trk-book trk-book-${d.status}`}>
                  <button className="trk-book-main trk-book-row" onClick={() => onEdit(b)} aria-label={t('{book}. Edit', { book: [b.title, audio ? t('audiobook') : '', tm(STATUS_WORDS[d.status]), d.status === 'reading' ? progress : ''].filter(Boolean).join(', ') })}>
                    <BookCover className="trk-cover" src={d.coverUrl ? api.trackerCoverUrl(b) : null} title={b.title ?? ''} audio={audio} />
                    <span className="trk-book-text">
                      <span className="trk-book-title">{audio && <span aria-hidden="true">🎧 </span>}{b.title}</span>
                      {(d.author || (audio && d.narrator)) && <span className="trk-sub">{[d.author, audio && d.narrator ? t('read by {name}', { name: d.narrator }) : ''].filter(Boolean).join(' · ')}</span>}
                      {d.status === 'want' && <span className="trk-tag">{STATUS_EMOJI.want} {tm(STATUS_WORDS.want)}</span>}
                      {d.status === 'finished' && <span className="trk-sub">{STATUS_EMOJI.finished} {tm(STATUS_WORDS.finished)} {d.finishedOn ? niceDate(d.finishedOn) : ''}</span>}
                    </span>
                  </button>
                  {d.status === 'reading' && canEdit(b) && (
                    <div className="trk-progress-row">
                      <div className="trk-progress" role="progressbar" aria-label={t('{title} progress', { title: b.title ?? '' })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                        <div style={{ width: `${pct ?? 0}%`, background: p.color }} />
                      </div>
                      <span className="trk-sub trk-pct">{progress}</span>
                      <button className="btn btn-secondary trk-small-btn" onClick={() => setLogFor(b)}>{audio ? t('Log listening') : t('Log pages')}</button>
                    </div>
                  )}
                  {d.status === 'finished' && <Stars value={d.rating} label={t('Rate {title}', { title: b.title ?? '' })} onChange={!canEdit(b) ? undefined : v => onSave(b, { data: { rating: v } }, v ? tn(v, '{title}: {n} star', '{title}: {n} stars', { title: b.title ?? '' }) : t('Rating cleared'))} />}
                </li>
              )
            })}
          </ul>
          {(more > 0 || (all && finished > FINISHED_SHOWN)) && (
            <button type="button" className="link-btn trk-more" aria-expanded={all}
              onClick={() => setAllFinished(s => { const n = new Set(s); if (all) n.delete(key); else n.add(key); return n })}>
              {all ? t('Show fewer') : t('Show all {n} finished', { n: finished })}
            </button>
          )}
        </section>
      ))}
      {logFor && <LogSheet book={logFor} onClose={() => setLogFor(null)} onSave={(body, msg) => { onSave(logFor, body, msg); setLogFor(null) }} />}
    </div>
  )
}

/** A book's reading by day (ReadingData.log, kept by the server): the last 14 days as bars, then the
 * latest days read. Pages for a book, minutes for an audiobook. */
function ReadingDays({ d, tz }: { d: ReadingData; tz?: string }) {
  const today = todayKeyInTz(tz || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const days = recentDays(d.log, today)
  const max = Math.max(1, ...days.map(x => x.amount))
  const total = days.reduce((n, x) => n + x.amount, 0)
  const read = days.filter(x => x.amount).length
  const latest = [...(d.log ?? [])].reverse().slice(0, 7)
  const label = (date: string) => date === today ? t('Today') : niceDate(date)
  return (
    <div className="field">
      <label id="trk-days">{isAudiobook(d) ? t('Listening by day') : t('Reading by day')}</label>
      <div className="trk-days-chart" role="img" aria-label={tn(read, 'Last 14 days: {amount} on {n} day', 'Last 14 days: {amount} on {n} days', { amount: dayAmount(d, total) })}>
        {days.map(x => <div key={x.date} className="trk-days-bar" style={{ height: `${Math.max(x.amount ? 8 : 2, (x.amount / max) * 100)}%` }} title={`${label(x.date)}: ${dayAmount(d, x.amount)}`} />)}
      </div>
      <div className="trk-days-axis" aria-hidden="true"><span>{niceDate(days[0].date)}</span><span>{t('Today')}</span></div>
      <ul className="trk-days-list" aria-labelledby="trk-days">
        {latest.map(x => <li key={x.date}><span>{label(x.date)}</span><span>{dayAmount(d, x.amount)}</span></li>)}
      </ul>
    </div>
  )
}

/** Log pages for a book, or listening time for an audiobook. Reaching the end marks it finished. */
function LogSheet({ book, onClose, onSave }: { book: TrackerEntry; onClose: () => void; onSave: (body: TrackerInput, msg: string) => void }) {
  const { settings } = useApp()
  const d = book.data as ReadingData
  const audio = isAudiobook(d)
  const today = todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  // Today: where you are now (the server logs the difference). An earlier day: how much was read
  // that day (logDay), to catch up on a day you forgot or fix one.
  const [day, setDay] = useState(today)
  const past = day < today
  const loggedOn = (k: string) => d.log?.find(x => x.date === k)?.amount ?? 0
  const [page, setPage] = useState(String(d.pagesRead ?? 0))
  const [hm, setHm] = useState(() => splitMinutes(d.minutesListened ?? 0))
  const pickDay = (k: string) => {
    if (!k || k > today) return
    setDay(k)
    const was = k < today ? loggedOn(k) : null
    setPage(String(was ?? d.pagesRead ?? 0)); setHm(splitMinutes(was ?? d.minutesListened ?? 0))
  }
  const n = audio ? toMinutes(...hm) ?? 0 : Math.max(0, Number(page) || 0)
  const done = !past && logReachesEnd(d, n)
  const field = audio ? 'minutesListened' : 'pagesRead'
  const save = () => past
    ? onSave({ logDay: { date: day, amount: n } }, n ? t('{amount} on {day}', { amount: dayAmount(d, n), day: niceDate(day) }) : t('{day} cleared', { day: niceDate(day) }))
    : onSave({ data: done ? { [field]: n, status: 'finished' } : { [field]: n } }, done ? t('{title} finished', { title: book.title ?? '' }) : audio ? t('{time} listened', { time: hoursMinutes(n) }) : t('On page {n}', { n }))
  return (
    <Sheet variant="dialog" title={`${audio ? t('Log listening') : t('Log pages')} · ${book.title}`} onClose={onClose}
      actions={<>
        {!past && <button className="btn btn-secondary" onClick={() => onSave({ data: { status: 'finished' } }, t('{title} finished', { title: book.title ?? '' }))}>{t('Finished it! 🎉')}</button>}
        <button className="btn btn-primary" data-autofocus onClick={save}>{t('Save')}</button>
      </>}>
      <div className="field">
        <label htmlFor="trk-log-day">{t('Day')}</label>
        <input id="trk-log-day" type="date" value={day} max={today} min={addDayKeys(today, -365)} onChange={e => pickDay(e.target.value)} />
      </div>
      {audio ? <>
        <HoursMinutes id="trk-listened" label={past ? t('Listened that day') : d.totalMinutes ? t('Listened so far (of {time})', { time: hoursMinutes(d.totalMinutes) }) : t('Listened so far')} value={hm} onChange={setHm} />
        <div className="chip-row" role="group" aria-label={t('Add listening time')}>
          {[15, 30, 60].map(k => <button key={k} type="button" className="chip" onClick={() => setHm(splitMinutes(n + k))}>+{hoursMinutes(k)}</button>)}
        </div>
      </> : <>
        <div className="field">
          <label htmlFor="trk-page">{past ? t('Pages read that day') : d.totalPages ? t("Page you're on (of {total})", { total: d.totalPages }) : t("Page you're on")}</label>
          <input id="trk-page" type="text" inputMode="numeric" value={page} onChange={e => setPage(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="chip-row" role="group" aria-label={t('Add pages')}>
          {[5, 10, 20, 50].map(k => <button key={k} type="button" className="chip" onClick={() => setPage(String(n + k))}>+{k}</button>)}
        </div>
      </>}
      {past && <p className="field-hint">{loggedOn(day) ? t('Logged {amount} that day. Save replaces it, and your place in the book moves by the difference; 0 clears the day.', { amount: dayAmount(d, loggedOn(day)) }) : t('Your place in the book moves on by the same amount.')}</p>}
      {done && <p className="field-hint">{audio ? t("That's the end, so Save marks it finished.") : t("That's the last page, so Save marks it finished.")}</p>}
    </Sheet>
  )
}

/** Hours and minutes as two number fields (a phone's number pad has no colon). */
function HoursMinutes({ id, label, value: [h, m], onChange }: { id: string; label: string; value: [string, string]; onChange: (v: [string, string]) => void }) {
  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 4)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="trk-hm">
        <input id={id} type="text" inputMode="numeric" aria-label={t('{label}, hours', { label })} value={h} onChange={e => onChange([digits(e.target.value), m])} />
        <span aria-hidden="true">{tc('hours-unit', 'h')}</span>
        <input type="text" inputMode="numeric" aria-label={t('{label}, minutes', { label })} value={m} onChange={e => onChange([h, digits(e.target.value)])} />
        <span aria-hidden="true">{tc('minutes-unit', 'm')}</span>
      </div>
    </div>
  )
}

// ---------- Memories ----------
function Memories({ entries, today, onEdit, onAdd }: { entries: TrackerEntry[]; today: string; onEdit: (e: TrackerEntry) => void; onAdd: () => void }) {
  const who = useWho()
  const onThisDay = entries.filter(e => e.date.slice(5) === today.slice(5) && e.date < today.slice(0, 4))
  const hasToday = entries.some(e => e.date === today)
  const card = (e: TrackerEntry, withYear = false) => {
    const d = e.data as MemoryData
    const m = who(e)
    return (
      <li key={e.id}>
        <button className="trk-memory" onClick={() => onEdit(e)}>
          {e.photoId && <img className="trk-memory-photo" src={api.photoImageUrlById(e.photoId)} alt="" loading="lazy" decoding="async" />}
          <span className="trk-memory-body">
            <span className="trk-memory-date">{d.mood && <span className="trk-mood" aria-hidden="true">{d.mood}</span>}{niceDate(e.date, withYear)}</span>
            {e.title && <span className="trk-book-title">{e.title}</span>}
            {d.text && <span className="trk-memory-text">{d.text}</span>}
          </span>
          <Avatar m={m} />
          <span className="sr-only">{t("{name}'s memory. Edit", { name: m.name })}</span>
        </button>
      </li>
    )
  }
  return (
    <div className="trk-journal">
      <button className="btn btn-primary trk-today-btn" onClick={onAdd}>{hasToday ? t('✏️ Add another memory for today') : t("📝 Add today's memory")}</button>
      {onThisDay.length > 0 && (
        <section className="trk-card trk-onthisday" aria-label={t('On this day')}>
          <h3>🕰️ {t('On this day')}</h3>
          <ul className="trk-memories">{onThisDay.map(e => card(e, true))}</ul>
        </section>
      )}
      {entries.length === 0
        ? <div className="empty-card"><span className="emoji">📝</span>{t('No memories yet. Write down one good thing from today.')}</div>
        : <ul className="trk-memories">{entries.map(e => card(e, e.date.slice(0, 4) !== today.slice(0, 4)))}</ul>}
    </div>
  )
}

// ---------- Health ----------
function measureText(d: HealthData) {
  return [d.height && `${d.height.value} ${d.height.unit}`, d.weight && `${d.weight.value} ${d.weight.unit}`, d.temperature && `${d.temperature.value} °${d.temperature.unit}`].filter(Boolean).join(' · ')
}

// Health visits and, when medication reminders are on, each person's medicines (parent devices only).
function Health({ entries, today, onEdit, onSave, onFromCalendar, meds, memberId, switcher }: { entries: TrackerEntry[]; today: string; onEdit: (e: TrackerEntry) => void; onSave: (e: TrackerEntry, body: TrackerInput, msg?: string) => void; onFromCalendar: () => void; meds: boolean; memberId: string | null; switcher: ReactNode }) {
  const who = useWho()
  const { toast, settings } = useApp()
  const upcoming = entries.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = entries.filter(e => e.date < today)
  const addToCalendar = async (e: TrackerEntry) => {
    try { onSave(e, { data: { eventId: (await addVisitToCalendar(e, who(e), settings.defaultEventMinutes ?? 60)).id } }, t('Added to the calendar')) } catch (err) { toast(errMsg(err, t('Could not add it to the calendar')), true) }
  }
  const row = (e: TrackerEntry) => {
    const d = e.data as HealthData
    const ty = HEALTH_TYPES.find(x => x.key === d.type) ?? HEALTH_TYPES[5]
    const m = who(e)
    const measures = measureText(d)
    const future = e.date >= today
    return (
      <li key={e.id} className="trk-visit">
        <button className="trk-visit-main" onClick={() => onEdit(e)}>
          <span className="trk-visit-emoji" aria-hidden="true">{ty.emoji}</span>
          <span className="trk-memory-body">
            <span className="trk-book-title">{e.title || tm(ty.label)}</span>
            <span className="trk-sub">{niceDate(e.date, true)}{d.time ? ` · ${formatTime(d.time)}` : ''}{d.provider ? ` · ${d.provider}` : ''}</span>
            {measures && <span className="trk-tag">{measures}</span>}
            {d.followUp && <span className="trk-sub">{t('Follow-up {day}', { day: niceDate(d.followUp, true) })}</span>}
          </span>
          <Avatar m={m} />
          <span className="sr-only">{t('{name}, {type}. Edit', { name: m.name, type: tm(ty.label) })}</span>
        </button>
        {d.eventId
          ? <a className="btn btn-secondary trk-small-btn" href={eventHref(d.eventId, e.date)}>{t('📅 Open on the calendar')}</a>
          : future && <button className="btn btn-secondary trk-small-btn" onClick={() => addToCalendar(e)}>{t('📅 Add to calendar')}</button>}
      </li>
    )
  }
  return (
    <div className="trk-journal">
      {switcher}
      <p className="trk-privacy">{t('🔒 Health stays on phones and computers, never on the wall screen.')}</p>
      <button className="btn btn-secondary trk-small-btn" style={{ alignSelf: 'flex-start' }} onClick={onFromCalendar}>{t('📅 Add from the calendar')}</button>
      {meds && <MedicineList memberId={memberId} />}
      {entries.length === 0 && <div className="empty-card"><span className="emoji">🩺</span>{t('No visits yet. Tap + to log a checkup or a dentist visit.')}</div>}
      {upcoming.length > 0 && <section aria-label={t('Upcoming')}><h3 className="trk-heading">{t('Upcoming')}</h3><ul className="trk-visits">{upcoming.map(row)}</ul></section>}
      {past.length > 0 && <section aria-label={t('Past visits')}><h3 className="trk-heading">{t('Past visits')}</h3><ul className="trk-visits">{past.map(row)}</ul></section>}
    </div>
  )
}

/** A normal calendar event for a future visit: its type and who, never the reason, notes or measurements (the calendar is on the wall). */
async function addVisitToCalendar(e: TrackerEntry, m: { id: string | null; name: string }, minutes: number) {
  const d = e.data as HealthData
  const cals = (await api.getCalendars()).filter(c => c.writable && c.enabled && c.canEditEvents !== false)
  const cal = cals.find(c => c.default) ?? cals.find(c => c.kind === 'local') ?? cals[0]
  if (!cal) throw new Error(t('There is no calendar to add it to. Add one in Settings → Calendars.'))
  const ty = HEALTH_TYPES.find(x => x.key === d.type) ?? HEALTH_TYPES[5]
  const title = `${ty.emoji} ${tm(ty.label)}${m.id ? ` · ${m.name}` : ''}`
  const next = format(new Date(new Date(`${e.date}T12:00:00`).getTime() + 86_400_000), 'yyyy-MM-dd')
  const start = d.time ? new Date(`${e.date}T${d.time}`) : null
  return api.createEvent({
    calendarId: cal.id, title, memberIds: m.id ? [m.id] : [],
    ...(start ? { allDay: false, start: start.toISOString(), end: new Date(start.getTime() + minutes * 60000).toISOString() } : { allDay: true, start: e.date, end: next }),
    location: d.provider ?? null,
  })
}

// ---------- Add / edit ----------
type Pending = { blob: Blob; width: number; height: number; url: string } // a photo picked for the memory, uploaded on save
type Form = {
  memberId: string | null; date: string; title: string
  photoId: string | null; photoOwned: boolean; photoFamily: boolean; pending: Pending | null
  format: ReadingFormat; author: string; narrator: string; status: ReadingStatus; pagesRead: string; totalPages: string
  listened: [string, string]; length: [string, string]; finishedOn: string; rating: number | null; notes: string
  coverUrl: string; coverThumb: string | null // the picked result's thumbnail (a typed link can't be previewed until saved)
  text: string; mood: string | null
  type: HealthType; time: string; provider: string; followUp: string
  height: string; heightUnit: 'in' | 'cm'; weight: string; weightUnit: 'lb' | 'kg'; temperature: string; temperatureUnit: 'F' | 'C'
}

function EntrySheet({ kind, entry, date, admin, kid, photos, memberId, prefill, onClose, onSaved }: {
  kind: TrackerKind; entry: TrackerEntry | null; date?: string; admin: boolean; photos: Photo[]; memberId: string | null; onClose: () => void; onSaved: () => void
  kid: string | null // a kid's own device: their entries (and the family's) only; someone else's opens read-only
  prefill?: VisitPrefill // a new health visit from a calendar event, linked to it
}) {
  const { members: everyone, settings, toast } = useApp()
  const members = kid ? everyone.filter(m => m.id === kid) : everyone
  const readOnly = !!(kid && entry?.memberId && entry.memberId !== kid)
  const dialog = useDialog()
  const imperial = settings.temperatureUnit === 'fahrenheit'
  const d = (entry?.data ?? {}) as Partial<ReadingData & MemoryData & HealthData>
  const num = (v?: number) => v === undefined ? '' : String(v)
  const p = prefill?.draft
  const [f, setF] = useState<Form>(() => ({
    memberId: p ? p.memberId ?? ASK : entry ? (!entry.memberId && entry.formerMember ? FORMER : entry.memberId) : kid ?? memberId ?? (kind === 'health' ? ASK : null), date: p?.date ?? entry?.date ?? date ?? '', title: p?.title ?? entry?.title ?? '',
    photoId: entry?.photoId ?? null, photoOwned: !!entry?.photoOwned, photoFamily: !!entry?.photoFamily, pending: null,
    format: d.format ?? 'book', author: d.author ?? '', narrator: d.narrator ?? '', status: d.status ?? 'reading', pagesRead: num(d.pagesRead), totalPages: num(d.totalPages),
    listened: splitMinutes(d.minutesListened), length: splitMinutes(d.totalMinutes), finishedOn: d.finishedOn ?? '', rating: d.rating ?? null, notes: p?.notes ?? d.notes ?? '',
    coverUrl: d.coverUrl ?? '', coverThumb: entry && d.coverUrl ? api.trackerCoverUrl(entry) : null,
    text: d.text ?? '', mood: d.mood ?? null,
    type: p?.type ?? d.type ?? 'checkup', time: p?.time ?? d.time ?? '', provider: p?.provider ?? d.provider ?? '', followUp: d.followUp ?? '',
    height: num(d.height?.value), heightUnit: d.height?.unit ?? (imperial ? 'in' : 'cm'),
    weight: num(d.weight?.value), weightUnit: d.weight?.unit ?? (imperial ? 'lb' : 'kg'),
    temperature: num(d.temperature?.value), temperatureUnit: d.temperature?.unit ?? (imperial ? 'F' : 'C'),
  }))
  const set = (patch: Partial<Form>) => setF(x => ({ ...x, ...patch }))
  const [busy, setBusy] = useState(false)
  // Save to library: the Add a book sheet, started from this book; the entry then links to it (data.bookId).
  const [bookId, setBookId] = useState(d.bookId ?? null)
  const [shelving, setShelving] = useState<{ places: string[]; sources: string[] } | null>(null)
  const shelve = async () => {
    const books = await api.getLibrary().catch(() => [])
    const all = (k: 'location' | 'borrowedFrom') => [...new Set(books.map(b => b[k]).filter((v): v is string => !!v))].sort((a, z) => a.localeCompare(z))
    setShelving({ places: all('location'), sources: all('borrowedFrom') })
  }
  const shelved = async (b: { id: string; title: string }) => {
    setShelving(null)
    try { await api.updateTracker(entry!.id, { data: { bookId: b.id } }); setBookId(b.id); announce(t('{title} is in the library', { title: b.title })) }
    catch (e) { toast(errMsg(e, t('Could not link it')), true) }
  }

  const n = (s: string) => s.trim() === '' ? null : Number(s)
  const measure = (v: string, unit: string) => n(v) === null ? null : { value: n(v), unit }
  const data: Record<string, unknown> = kind === 'reading'
    ? { format: f.format, author: f.author.trim() || null, status: f.status,
      // Only the format's own progress is kept; switching format clears the other's.
      ...(f.format === 'audiobook'
        ? { narrator: f.narrator.trim() || null, minutesListened: toMinutes(...f.listened), totalMinutes: toMinutes(...f.length) || null, pagesRead: null, totalPages: null }
        : { narrator: null, minutesListened: null, totalMinutes: null, pagesRead: n(f.pagesRead), totalPages: n(f.totalPages) || null }),
      finishedOn: f.status === 'finished' ? f.finishedOn || null : null, rating: f.rating, notes: f.notes.trim() || null, coverUrl: f.coverUrl.trim() || null }
    : kind === 'memory'
      ? { text: f.text.trim(), mood: f.mood }
      : { type: f.type, time: f.time || null, provider: f.provider.trim() || null, notes: f.notes.trim() || null, followUp: f.followUp || null,
        height: measure(f.height, f.heightUnit), weight: measure(f.weight, f.weightUnit), temperature: measure(f.temperature, f.temperatureUnit),
        ...(prefill ? { eventId: prefill.eventId } : {}) }
  const ready = kind === 'reading' ? !!f.title.trim() : kind === 'memory' ? !!(f.text.trim() || f.photoId || f.pending) : f.memberId !== ASK

  const submit = async () => {
    if (!ready) return
    setBusy(true)
    try {
      // A new photo for the memory is its own: uploaded now, kept out of the family photos unless the switch says so.
      // ponytail: if saving then fails, the uploaded photo stays behind unattached (counted in Photos' "in memories").
      const photoId = f.pending ? (await api.uploadPhoto(f.pending.blob, f.pending.width, f.pending.height, undefined, false)).id : f.photoId
      const body = {
        ...(f.memberId === FORMER ? {} : { memberId: f.memberId }), title: f.title.trim() || null, photoId,
        ...(f.pending || f.photoOwned ? { photoFamily: f.photoFamily } : {}), data, ...(f.date ? { date: f.date } : {}),
      }
      if (entry) await api.updateTracker(entry.id, body)
      else await api.addTracker({ kind, ...body, data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null)) })
      announce(entry ? t('Saved') : t('Added'))
      onSaved()
    } catch (e) { toast(errMsg(e, t('Could not save')), true) } finally { setBusy(false) }
  }
  const del = async () => {
    const what = kind === 'reading' ? t('Delete this book?') : kind === 'memory' ? t('Delete this memory?') : t('Delete this visit?')
    if (!entry || !await dialog.confirm({ title: entry.title ? t('Delete “{title}”?', { title: entry.title }) : what, body: t('It is gone for good.'), confirmLabel: t('Delete'), danger: true })) return
    try { await api.deleteTracker(entry.id); onSaved() } catch (e) { toast(errMsg(e, t('Could not delete')), true) }
  }

  const owner = everyone.find(m => m.id === entry?.memberId)?.name ?? t('Someone')
  const sheetTitle = readOnly ? (kind === 'reading' ? t("{name}'s book", { name: owner }) : kind === 'memory' ? t("{name}'s memory", { name: owner }) : t("{name}'s visit", { name: owner }))
    : entry ? (kind === 'reading' ? t('Edit book') : kind === 'memory' ? t('Edit memory') : t('Edit visit'))
    : kind === 'reading' ? t('Add a book') : kind === 'memory' ? t('New memory') : t('Health visit')
  return (
    <Sheet title={sheetTitle} onClose={onClose} dirty={readOnly ? false : 'auto'}
      actions={readOnly ? <button className="btn btn-primary" onClick={onClose}>{t('Done')}</button> : <>
        <button className="btn btn-primary" onClick={submit} disabled={!ready || busy}>{entry ? t('Save') : kind === 'health' ? t('Add visit') : t('Add')}</button>
      </>}>
      {/* Read-only: every field inside is disabled. */}
      <fieldset className="item-sheet-fields" disabled={readOnly}>
      {kind === 'health' && <p className="trk-privacy">{t('🔒 Health stays on phones and computers, never on the wall screen.')}</p>}
      {prefill && <p className="field-hint item-read-only">{t('From the calendar. It stays linked to the event, and keeps its own date if the event moves. Nothing about the visit goes on the calendar.')}</p>}
      <div className="field">
        <label id="trk-who">{kind === 'reading' ? t('Whose book?') : kind === 'memory' ? t('Whose memory?') : t('Whose visit?')}</label>
        <div className="chip-row" role="group" aria-labelledby="trk-who">
          {entry?.formerMember && !entry.memberId && (
            <button type="button" className={`chip ${f.memberId === FORMER ? 'active' : ''}`} aria-pressed={f.memberId === FORMER} onClick={() => set({ memberId: FORMER })}>{t('{name} (removed)', { name: entry.formerMember })}</button>
          )}
          <button type="button" className={`chip ${f.memberId === null ? 'active' : ''}`} aria-pressed={f.memberId === null} onClick={() => set({ memberId: null })}>🏠 {t('Family')}</button>
          {members.map(m => (
            <button key={m.id} type="button" className={`chip ${f.memberId === m.id ? 'active' : ''}`} aria-pressed={f.memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => set({ memberId: m.id })}><ChipFace m={m} /> {m.name}</button>
          ))}
        </div>
        {f.memberId === ASK && <p className="field-hint">{t('Pick whose visit it is.')}</p>}
      </div>

      {kind === 'reading' && <>
        <div className="field">
          <label htmlFor="trk-format">{t('Format')}</label>
          <select id="trk-format" value={f.format} onChange={e => set({ format: e.target.value as ReadingFormat })}>
            <option value="book">{t('📖 Book')}</option>
            <option value="audiobook">{t('🎧 Audiobook')}</option>
          </select>
        </div>
        <BookLookup initial={f.title} onPick={b => set({
          title: b.title, author: b.author ?? f.author, coverUrl: b.coverUrl ?? f.coverUrl, coverThumb: b.coverUrl ? api.bookThumbUrl(b) : f.coverThumb,
          ...(f.format === 'book' && b.pages ? { totalPages: String(b.pages) } : {}),
        })} />
        <div className="field"><label htmlFor="trk-title">{t('Title')}</label><input id="trk-title" type="text" value={f.title} onChange={e => set({ title: e.target.value })} placeholder={t("Charlotte's Web")} autoComplete="off" autoFocus={!entry} /></div>
        <div className="field"><label htmlFor="trk-author">{t('Author')}</label><input id="trk-author" type="text" value={f.author} onChange={e => set({ author: e.target.value })} autoComplete="off" /></div>
        <div className="field">
          <label htmlFor="trk-cover">{t('Cover link')}</label>
          <div className="trk-cover-field">
            <BookCover className="trk-cover" src={f.coverThumb} title={f.title} audio={f.format === 'audiobook'} />
            <input id="trk-cover" type="url" inputMode="url" value={f.coverUrl} onChange={e => set({ coverUrl: e.target.value, coverThumb: null })} placeholder="https://…/cover.jpg" autoComplete="off" />
          </div>
        </div>
        <div className="field">
          <label>{t('Status')}</label>
          <Segmented label={t('Status')} value={f.status} onChange={s => set({ status: s })} options={STATUS.map(s => ({ ...s, label: tm(s.label) }))} className="trk-status" />
        </div>
        {f.format === 'audiobook' ? <>
          <div className="field"><label htmlFor="trk-narrator">{t('Narrator')}</label><input id="trk-narrator" type="text" value={f.narrator} onChange={e => set({ narrator: e.target.value })} autoComplete="off" /></div>
          <div className="trk-field-pair">
            <HoursMinutes id="trk-listened" label={t('Listened')} value={f.listened} onChange={listened => set({ listened })} />
            <HoursMinutes id="trk-length" label={t('Length')} value={f.length} onChange={length => set({ length })} />
          </div>
        </> : (
          <div className="trk-field-pair">
            <div className="field"><label htmlFor="trk-read">{t('Pages read')}</label><input id="trk-read" type="text" inputMode="numeric" value={f.pagesRead} onChange={e => set({ pagesRead: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field"><label htmlFor="trk-total">{t('Total pages')}</label><input id="trk-total" type="text" inputMode="numeric" value={f.totalPages} onChange={e => set({ totalPages: e.target.value.replace(/\D/g, '') })} /></div>
          </div>
        )}
        {entry && !!d.log?.length && <ReadingDays d={d as ReadingData} tz={settings.timezone ?? undefined} />}
        <div className="trk-field-pair">
          <div className="field"><label htmlFor="trk-date">{t('Started')}</label><input id="trk-date" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></div>
          {f.status === 'finished' && <div className="field"><label htmlFor="trk-fin">{t('Finished')}</label><input id="trk-fin" type="date" value={f.finishedOn} onChange={e => set({ finishedOn: e.target.value })} /></div>}
        </div>
        <div className="field"><label>{t('Rating')}</label><Stars value={f.rating ?? undefined} label={t('Rating')} onChange={v => set({ rating: v })} /></div>
        <div className="field"><label htmlFor="trk-notes">{t('Notes')}</label><textarea id="trk-notes" value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder={t('Favorite part, who recommended it…')} /></div>
        {entry && <div className="field">
          <label>{t('Library')}</label>
          {bookId ? <><a className="btn btn-secondary" href={`#/trackers/library?book=${encodeURIComponent(bookId)}`} onClick={onClose}>{t('📚 Open in the library')}</a><p className="field-hint">{t("It's in the family's library: where it lives, lending, who else read it.")}</p></>
            : <><button type="button" className="btn btn-secondary" onClick={shelve}>📚 {t('Save to library')}</button><p className="field-hint">{t('Keep it with the books your family owns or has borrowed.')}</p></>}
        </div>}
      </>}

      {kind === 'memory' && <>
        <div className="field"><label htmlFor="trk-date">{t('Day')}</label><input id="trk-date" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></div>
        <div className="field"><label htmlFor="trk-text">{t('What happened?')}</label><textarea id="trk-text" value={f.text} onChange={e => set({ text: e.target.value })} placeholder={t('One good thing from today…')} autoFocus={!entry} rows={4} /></div>
        <div className="field"><label htmlFor="trk-title">{t('Headline (optional)')}</label><input id="trk-title" type="text" value={f.title} onChange={e => set({ title: e.target.value })} placeholder={t('First snow')} autoComplete="off" /></div>
        <div className="field">
          <label id="trk-mood">{t('Mood')}</label>
          <div className="emoji-swatch-row" role="group" aria-labelledby="trk-mood">
            {MOODS.map(m => <button key={m} type="button" className={`emoji-swatch ${f.mood === m ? 'active' : ''}`} aria-pressed={f.mood === m} onClick={() => set({ mood: f.mood === m ? null : m })}>{m}</button>)}
          </div>
        </div>
        <PhotoField f={f} set={set} photos={settings.features.photos ? photos : []} />
      </>}

      {kind === 'health' && <>
        <div className="field">
          <label id="trk-type">{t('Type')}</label>
          <div className="chip-row" role="group" aria-labelledby="trk-type">
            {HEALTH_TYPES.map(ty => <button key={ty.key} type="button" className={`chip ${f.type === ty.key ? 'active' : ''}`} aria-pressed={f.type === ty.key} onClick={() => set({ type: ty.key })}>{ty.emoji} {tm(ty.label)}</button>)}
          </div>
        </div>
        <div className="trk-field-pair">
          <div className="field"><label htmlFor="trk-date">{t('Date')}</label><input id="trk-date" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></div>
          <div className="field"><label htmlFor="trk-time">{t('Time')}</label><input id="trk-time" type="time" value={f.time} onChange={e => set({ time: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="trk-title">{t('Reason')}</label><input id="trk-title" type="text" value={f.title} onChange={e => set({ title: e.target.value })} placeholder={t('Annual checkup')} autoComplete="off" /></div>
        <div className="field"><label htmlFor="trk-provider">{t('Doctor or office')}</label><input id="trk-provider" type="text" value={f.provider} onChange={e => set({ provider: e.target.value })} autoComplete="off" /></div>
        <fieldset className="trk-measures">
          <legend>{t('Measurements (optional)')}</legend>
          <MeasureInput id="trk-height" label={t('Height')} value={f.height} unit={f.heightUnit} units={['in', 'cm']} onValue={v => set({ height: v })} onUnit={u => set({ heightUnit: u as Form['heightUnit'] })} />
          <MeasureInput id="trk-weight" label={t('Weight')} value={f.weight} unit={f.weightUnit} units={['lb', 'kg']} onValue={v => set({ weight: v })} onUnit={u => set({ weightUnit: u as Form['weightUnit'] })} />
          <MeasureInput id="trk-temp" label={t('Temperature')} value={f.temperature} unit={f.temperatureUnit} units={['F', 'C']} onValue={v => set({ temperature: v })} onUnit={u => set({ temperatureUnit: u as Form['temperatureUnit'] })} />
        </fieldset>
        <div className="field"><label htmlFor="trk-notes">{t('Notes')}</label><textarea id="trk-notes" value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder={t('Next steps, what to bring next time…')} /></div>
        <div className="field"><label htmlFor="trk-follow">{t('Follow-up')}</label><input id="trk-follow" type="date" value={f.followUp} onChange={e => set({ followUp: e.target.value })} /></div>
        {entry && d.eventId && <a className="btn btn-secondary" href={eventHref(d.eventId, entry.date)} onClick={onClose}>{t('📅 Open on the calendar')}</a>}
      </>}
      </fieldset>
      {!readOnly && entry && (admin || (!!kid && entry.memberId === kid)) && <div className="sheet-danger-zone"><button className="link-btn link-danger" onClick={del}>{kind === 'reading' ? t('Delete book') : kind === 'memory' ? t('Delete memory') : t('Delete visit')}</button></div>}
      {shelving && entry && <AddBookSheet places={shelving.places} sources={shelving.sources} today={todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)}
        from={{ title: f.title.trim(), author: f.author.trim(), pages: n(f.totalPages), coverUrl: f.coverUrl.trim() || null }} onClose={() => setShelving(null)} onAdded={shelved} />}
    </Sheet>
  )
}

function MeasureInput({ id, label, value, unit, units, onValue, onUnit }: { id: string; label: string; value: string; unit: string; units: string[]; onValue: (v: string) => void; onUnit: (u: string) => void }) {
  return (
    <div className="trk-measure">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="text" inputMode="decimal" value={value} onChange={e => onValue(e.target.value.replace(/[^\d.]/g, ''))} />
      <select aria-label={t('{label} unit', { label })} value={unit} onChange={e => onUnit(e.target.value)}>
        {units.map(u => <option key={u} value={u}>{u === 'F' || u === 'C' ? `°${u}` : u}</option>)}
      </select>
    </div>
  )
}

/** A memory's one photo: a new one (the memory's own, and in the family photos only if asked) or one
 * already in the family photos (just referenced, so it stays there whatever happens to the memory). */
function PhotoField({ f, set, photos }: { f: Form; set: (patch: Partial<Form>) => void; photos: Photo[] }) {
  const { toast } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const src = f.pending?.url ?? (f.photoId ? api.photoImageUrlById(f.photoId) : null)
  const own = !!f.pending || (!!f.photoId && f.photoOwned)
  const choose = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const { blob, width, height } = await preparePhoto(file)
      set({ pending: { blob, width, height, url: URL.createObjectURL(blob) }, photoId: null, photoOwned: true, photoFamily: false })
    } catch (e) { toast(e instanceof PhotoFormatError ? e.message : t("Couldn't use that photo"), true) } finally { setBusy(false) }
  }
  return (
    <div className="field">
      <label>{t('Photo')}</label>
      {src && <div className="trk-photo-pick">
        <img src={src} alt={t("The memory's photo")} />
        <div className="trk-photo-side">
          {own
            ? <div className="toggle-row">
                <label id="trk-photo-family">{t('Also in family photos')}</label>
                <button type="button" className={`switch ${f.photoFamily ? 'on' : ''}`} role="switch" aria-checked={f.photoFamily} aria-labelledby="trk-photo-family"
                  onClick={() => set({ photoFamily: !f.photoFamily })}><span className="knob" /></button>
              </div>
            : <span className="trk-sub">{t('From the family photos')}</span>}
          <button type="button" className="btn btn-secondary trk-small-btn" onClick={() => set({ photoId: null, pending: null, photoOwned: false })}>{t('Remove')}</button>
        </div>
      </div>}
      {own && <p className="field-hint">{f.photoFamily ? t('It also shows in Photos, on the Board and the night screen.') : t('Only in this memory.')}</p>}
      <input ref={input} type="file" accept="image/*" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; choose(file) }} />
      <div className="trk-photo-actions">
        <button type="button" className="btn btn-secondary trk-small-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? t('Adding…') : src ? t('📷 Replace photo') : t('📷 Add a photo')}</button>
        {photos.length > 0 && <button type="button" className="btn btn-secondary trk-small-btn" aria-expanded={picking} onClick={() => setPicking(v => !v)}>{t('🖼️ From family photos')}</button>}
      </div>
      {picking && (
        <ul className="trk-photo-grid" aria-label={t('Family photos')}>
          {photos.map(p => (
            <li key={p.id}>
              <button type="button" className={`photo-tile ${p.id === f.photoId ? 'trk-photo-on' : ''}`} aria-pressed={p.id === f.photoId}
                aria-label={p.caption || t('Photo from {day}', { day: new Date(p.createdAt).toLocaleDateString(intlLocale()) })}
                onClick={() => { set({ photoId: p.id, pending: null, photoOwned: false }); setPicking(false) }}>
                <img src={api.photoImageUrl(p)} alt="" loading="lazy" decoding="async" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Visits from the calendar ----------
// A visit made from a calendar event keeps the link on its own sealed data (data.eventId, the same
// field "Add to calendar" sets); nothing about the visit is written to the event, which may sync back.
type VisitPrefill = { draft: VisitDraft; eventId: string }
const eventHref = (eventId: string, date: string) => `#/calendar?event=${encodeURIComponent(eventId)}&at=${date}`
const eventWhen = (ev: EventInstance, tz: string) => ev.allDay ? niceDate(ev.start.slice(0, 10)) : `${niceDate(visitFromEvent(ev, tz).date)} · ${formatTime(ev.start, tz)}`

/** Health's "Add from the calendar": the last month's and the next three months' events that look
 * like a doctor's or dentist's visit, not yet made into one. */
function PickEventSheet({ linked, tz, onClose, onPick }: { linked: Set<string>; tz: string; onClose: () => void; onPick: (ev: EventInstance) => void }) {
  const [events, setEvents] = useState<EventInstance[] | null>(null)
  useEffect(() => {
    const now = Date.now(), day = 86_400_000
    api.getEvents(new Date(now - 31 * day).toISOString(), new Date(now + 92 * day).toISOString())
      .then(list => setEvents(list.filter(e => looksMedical(e.title) && !linked.has(e.id)).sort((a, z) => a.start.localeCompare(z.start))))
      .catch(() => setEvents([]))
  }, [linked])
  return (
    <Sheet title={t('Add from the calendar')} onClose={onClose}>
      <p className="field-hint">{t("Events from the last month and the next three that look like a doctor's or dentist's visit.")}</p>
      {events === null ? <div className="state-card">{t('Loading…')}</div>
        : events.length === 0 ? <div className="empty-card"><span className="emoji">📅</span>{t('No events look like a visit. Open one on the calendar and tap "Make it a health visit".')}</div>
        : <div className="sheet-links">{events.map(ev => (
          <button key={`${ev.id}:${ev.start}`} type="button" className="sheet-link" onClick={() => onPick(ev)}>
            <span className="lib-emoji" aria-hidden="true">🩺</span><span>{ev.title}<small>{eventWhen(ev, tz)}{ev.location ? ` · ${ev.location}` : ''}</small></span>
          </button>
        ))}</div>}
    </Sheet>
  )
}

/** On a calendar event's sheet (parents' and grown-ups' own devices, Health on): its health visit,
 * or "Make it a health visit". A repeating event's visit is the one on that day. */
export function EventHealthVisit({ event }: { event: EventInstance }) {
  const { settings, members } = useApp()
  const tz = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const [visits, setVisits] = useState<TrackerEntry[] | null>(null)
  const [making, setMaking] = useState(false)
  const load = () => api.getTrackers('health').then(setVisits).catch(() => setVisits(null))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [event.id])
  if (!visits) return null
  const day = visitFromEvent(event, tz).date
  const repeats = !!(event.rrule || event.seriesId)
  const visit = visits.find(v => (v.data as HealthData).eventId === event.id && (!repeats || v.date === day))
  if (visit) {
    const ty = HEALTH_TYPES.find(x => x.key === (visit.data as HealthData).type) ?? HEALTH_TYPES[5]
    const who = members.find(m => m.id === visit.memberId)?.name ?? visit.formerMember ?? t('Family')
    return <a className="sheet-link" href={`#/trackers/health?visit=${encodeURIComponent(visit.id)}`}><span className="lib-emoji" aria-hidden="true">{ty.emoji}</span>
      <span>{t('Health visit: {type}', { type: tm(ty.label) })} · {who}<small>{t('Open the health visit')}</small></span><ChevronRight /></a>
  }
  return <>
    <button type="button" className="btn btn-secondary trk-small-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setMaking(true)}>{t('🩺 Make it a health visit')}</button>
    {making && <EntrySheet kind="health" entry={null} admin kid={null} photos={[]} memberId={null} prefill={{ draft: visitFromEvent(event, tz), eventId: event.id }}
      onClose={() => setMaking(false)} onSaved={() => { setMaking(false); announce(t('Saved as a health visit')); load() }} />}
  </>
}
