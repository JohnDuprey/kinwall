// Trackers (server: routes/trackers.ts): the family's reading log, memories journal and health
// visits. Reading and Memories work on the wall; Health is for phones and computers only - the
// server refuses it to display keys, and this screen only offers it once GET /api/me says admin.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce, Segmented } from './a11y.tsx'
import BookLookup from './BookLookup.tsx'
import Library, { AddBookSheet } from './Library.tsx'
import { addDayKeys } from './library.ts'
import { todayKeyInTz } from './date.ts'
import { formatTime } from './timeFormat.ts'
import { CheckIcon, ChevronDown, PlusIcon } from './icons.tsx'
import { useIsPhone } from './useIsPhone.ts'
import Sheet from './Sheet.tsx'
import { preparePhoto, PhotoFormatError } from './photos.ts'
import type { HealthData, HealthType, Member, MemoryData, Photo, ReadingData, ReadingFormat, ReadingStatus, TrackerEntry, TrackerInput, TrackerKind } from './types.ts'
import { dayAmount, FINISHED_SHOWN, STATUS_EMOJI, STATUS_WORDS, hoursMinutes, shelfBooks, isAudiobook, left, recentDays, logReachesEnd, readingPercent, shelfLine, shelfTotals, splitMinutes, toMinutes } from './reading.ts'
import { trackerKinds } from './types.ts'
import { MedicineList } from './MedicationSettings.tsx'
import PickField from './PickField.tsx'
import { forPerson, HEALTH_PERSON_KEY, personIn, startPerson } from './trackerPerson.ts'
import { Face, ChipFace } from './Face'
import BookCover from './BookCover.tsx'

// ponytail: TABS, SUB_TO_KIND and trackerKinds() (types.ts, for App's nav) list the kinds in the same order.
// The views, like the home page's: tabs where they fit, one button and a sheet on a phone (TrackerViewPicker).
// The library comes with Reading: the family's books, apart from who's reading what (Library.tsx).
type TrackerView = TrackerKind | 'library'
const TABS: { key: TrackerView; label: string; emoji: string; hint: string }[] = [
  { key: 'reading', label: 'Reading', emoji: '📖', hint: "Who's reading what, and how far along" },
  { key: 'library', label: 'Library', emoji: '📚', hint: 'The books your family owns, and who has them' },
  { key: 'memory', label: 'Memories', emoji: '📝', hint: 'A family journal, a moment a day' },
  { key: 'health', label: 'Health', emoji: '🩺', hint: 'Checkups, visits and medicines' },
]
const SUB_TO_VIEW: Record<string, TrackerView> = { reading: 'reading', library: 'library', memories: 'memory', health: 'health' }
const VIEW_TO_SUB: Record<TrackerView, string> = { reading: 'reading', library: 'library', memory: 'memories', health: 'health' }
const STATUS = (['want', 'reading', 'finished'] as ReadingStatus[]).map(key => ({ key, label: STATUS_WORDS[key] }))
const HEALTH_TYPES: { key: HealthType; label: string; emoji: string }[] = [
  { key: 'checkup', label: 'Checkup', emoji: '🩺' }, { key: 'dentist', label: 'Dentist', emoji: '🦷' }, { key: 'specialist', label: 'Specialist', emoji: '👩‍⚕️' },
  { key: 'vaccine', label: 'Vaccine', emoji: '💉' }, { key: 'sick', label: 'Sick visit', emoji: '🤒' }, { key: 'other', label: 'Other', emoji: '📋' },
]
const MOODS = ['😊', '😂', '🥰', '🎉', '😴', '😢', '😮', '🌟']
const FAMILY = { id: null as string | null, name: 'Family', color: '#C7B8A8', avatar: '🏠' }
const FORMER = '__former' // the form's "who" for an entry that belonged to a removed member
type Who = { id: string | null; name: string; color: string; avatar: string; former?: string }
/** A removed member's entries keep their name: "Leo (removed)", in gray. */
const formerWho = (name: string): Who => ({ id: null, name: `${name} (removed)`, color: '#B8B2AB', avatar: name[0] ?? '?', former: name })
const isFamily = (e: TrackerEntry) => e.memberId === null && !e.formerMember

const niceDate = (d: string, withYear = false) => format(new Date(`${d}T12:00:00`), withYear ? 'EEE, MMM d, yyyy' : 'EEE, MMM d')
const errMsg = (e: unknown, fallback: string) => e instanceof ApiError ? e.message : fallback

/** Phones: the views don't fit as tabs, so one button shows the view and opens a sheet of them (the
 * home page's ViewPicker, Calendar.tsx). Compact (emoji and ▾) when the row has the view's own tools
 * next to it: the library's search, whose placeholder names the view. */
function TrackerViewPicker({ views, value, onChange, compact }: { views: typeof TABS; value: TrackerView; onChange: (v: TrackerView) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const current = views.find(v => v.key === value) ?? views[0]
  return (
    <>
      <button type="button" className="btn btn-secondary view-pick" aria-haspopup="dialog" aria-label={`${current?.label} — switch view`} onClick={() => setOpen(true)}>
        <span aria-hidden="true">{current?.emoji}</span>{!compact && <span>{current?.label}</span>}<ChevronDown width={16} height={16} />
      </button>
      {open && (
        <Sheet title="View" onClose={() => setOpen(false)}>
          <div className="sheet-links">
            {views.map(v => (
              <button key={v.key} type="button" className="sheet-link" aria-pressed={v.key === value} onClick={() => { onChange(v.key); setOpen(false) }}>
                <span className="lib-emoji" aria-hidden="true">{v.emoji}</span><span>{v.label}<small>{v.hint}</small></span>{v.key === value && <CheckIcon className="pick-check" />}
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
  const tabs = TABS.filter(t => on.includes(VIEW_TO_SUB[t.key === 'library' ? 'reading' : t.key]) && (t.key !== 'health' || admin))
  const view = tabs.find(t => t.key === SUB_TO_VIEW[sub ?? ''])?.key ?? tabs[0]?.key ?? 'reading'
  const library = view === 'library'
  const go = (v: TrackerView) => { location.hash = `#/trackers/${VIEW_TO_SUB[v]}` }
  const kind: TrackerKind = library ? 'reading' : view // the library's readers come from reading entries
  const isPhone = useIsPhone()
  const [tools, setTools] = useState<HTMLDivElement | null>(null) // the library's search sits here, beside the view picker

  const [entries, setEntries] = useState<TrackerEntry[] | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [editing, setEditing] = useState<TrackerEntry | { new: true; date?: string } | null>(null)
  const [libAdding, setLibAdding] = useState(false)
  const load = () => api.getTrackers(kind).then(setEntries).catch(e => { setEntries([]); toast(errMsg(e, "Couldn't load trackers."), true) })
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
  const people: Who[] = [...members.filter(m => !personId || m.id === personId), FAMILY, ...formers]

  const save = async (e: TrackerEntry, body: TrackerInput, msg?: string) => {
    setEntries(list => list && list.map(x => x.id === e.id ? { ...x, ...body, data: { ...x.data, ...body.data } as never } : x)) // optimistic
    try { await api.updateTracker(e.id, body); if (msg) announce(msg); load() } catch (err) { toast(errMsg(err, 'Could not save'), true); load() }
  }

  return (
    <div className="content trackers">
      <div className="trackers-head">
        {isPhone
          ? <><TrackerViewPicker views={tabs} value={view} onChange={go} compact={library} />{library && <div className="trackers-tools" ref={setTools} />}</>
          : <><Segmented tabs idBase="trk-tab" label="Tracker" value={view} onChange={go}
            options={tabs.map(t => ({ key: t.key, label: <><span aria-hidden="true">{t.emoji}</span> {t.label}</> }))} />{library && <div className="trackers-tools" ref={setTools} />}</>}
      </div>
      <div className="trackers-body scroll-y" role="tabpanel" aria-labelledby={isPhone ? undefined : `trk-tab-${view}`} aria-label={isPhone ? tabs.find(t => t.key === view)?.label : undefined}>
        {entries === null ? <div className="state-card">Loading…</div>
          : library ? <Library bar={tools} adding={libAdding} onAdded={() => setLibAdding(false)} onStarted={load} />
          : kind === 'reading' ? <Reading entries={shown} people={people} canEdit={canEdit} onEdit={setEditing} onSave={save} />
          : kind === 'memory' ? <Memories entries={shown} today={today} onEdit={setEditing} onAdd={() => setEditing({ new: true, date: today })} />
          : <Health entries={shown} today={today} onEdit={setEditing} onSave={save} meds={settings.medications} memberId={healthPerson} switcher={
            <div className="field">
              <label htmlFor="trk-person">Whose health</label>
              <PickField id="trk-person" label="Whose health" title="Whose health?" value={[healthPerson ?? '']} onChange={([v]) => pickHealthPerson(v || null)}
                options={[{ value: '', label: 'Everyone', lead: <Avatar m={FAMILY} size={26} /> }, ...members.map(m => ({ value: m.id, label: m.name, lead: <Avatar m={m} size={26} /> }))]} />
            </div>} />}
      </div>
      <button className="fab" onClick={() => (library ? setLibAdding(true) : setEditing({ new: true }))} aria-label={library ? 'Add a book to the library' : kind === 'reading' ? 'Add a book' : kind === 'memory' ? 'Add a memory' : 'Add a health visit'}><PlusIcon /></button>
      {editing && (
        <EntrySheet kind={kind} entry={'new' in editing ? null : editing} date={'new' in editing ? editing.date ?? today : undefined}
          admin={admin} kid={kid} photos={photos} memberId={personId}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

function Avatar({ m, size = 30 }: { m: Pick<Member, 'name' | 'color' | 'avatar'>; size?: number }) {
  return <Face m={m} className="member-avatar-sm" aria-hidden="true" style={{width: size, height: size }} />
}
function useWho() {
  const { members } = useApp()
  return (e: TrackerEntry): Who => members.find(m => m.id === e.memberId) ?? (e.formerMember ? formerWho(e.formerMember) : FAMILY)
}
const belongs = (e: TrackerEntry, p: Who) => p.former ? !e.memberId && e.formerMember === p.former : p.id ? e.memberId === p.id : isFamily(e)

/** Five tap targets; tapping the current rating clears it. */
function Stars({ value, onChange, label }: { value?: number; onChange?: (v: number | null) => void; label: string }) {
  if (!onChange) return value ? <span className="trk-stars" role="img" aria-label={`${value} of 5 stars`}>{'★'.repeat(value)}<span className="trk-stars-off">{'★'.repeat(5 - value)}</span></span> : null
  return (
    <div className="trk-stars-edit" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" className={n <= (value ?? 0) ? 'on' : ''} aria-pressed={n === value}
          aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange(n === value ? null : n)}>★</button>
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

  if (!shelves.length) return <div className="empty-card"><span className="emoji">📚</span>No books yet. Tap + to add what someone is reading.</div>
  return (
    <div className="trk-grid">
      {shelves.map(({ p, key, books, more, all, finished, totals }) => (
        <section key={key} className="trk-card" aria-label={`${p.name}'s books`}>
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
                  <button className="trk-book-main trk-book-row" onClick={() => onEdit(b)} aria-label={`${b.title}${audio ? ', audiobook' : ''}, ${STATUS_WORDS[d.status]}${progress && d.status === 'reading' ? `, ${progress}` : ''}. Edit`}>
                    <BookCover className="trk-cover" src={d.coverUrl ? api.trackerCoverUrl(b) : null} title={b.title ?? ''} audio={audio} />
                    <span className="trk-book-text">
                      <span className="trk-book-title">{audio && <span aria-hidden="true">🎧 </span>}{b.title}</span>
                      {(d.author || (audio && d.narrator)) && <span className="trk-sub">{[d.author, audio && d.narrator ? `read by ${d.narrator}` : ''].filter(Boolean).join(' · ')}</span>}
                      {d.status === 'want' && <span className="trk-tag">{STATUS_EMOJI.want} {STATUS_WORDS.want}</span>}
                      {d.status === 'finished' && <span className="trk-sub">{STATUS_EMOJI.finished} {STATUS_WORDS.finished} {d.finishedOn ? niceDate(d.finishedOn) : ''}</span>}
                    </span>
                  </button>
                  {d.status === 'reading' && canEdit(b) && (
                    <div className="trk-progress-row">
                      <div className="trk-progress" role="progressbar" aria-label={`${b.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0}>
                        <div style={{ width: `${pct ?? 0}%`, background: p.color }} />
                      </div>
                      <span className="trk-sub trk-pct">{progress}</span>
                      <button className="btn btn-secondary trk-small-btn" onClick={() => setLogFor(b)}>{audio ? 'Log listening' : 'Log pages'}</button>
                    </div>
                  )}
                  {d.status === 'finished' && <Stars value={d.rating} label={`Rate ${b.title}`} onChange={!canEdit(b) ? undefined : v => onSave(b, { data: { rating: v } }, v ? `${b.title}: ${v} stars` : 'Rating cleared')} />}
                </li>
              )
            })}
          </ul>
          {(more > 0 || (all && finished > FINISHED_SHOWN)) && (
            <button type="button" className="link-btn trk-more" aria-expanded={all}
              onClick={() => setAllFinished(s => { const n = new Set(s); if (all) n.delete(key); else n.add(key); return n })}>
              {all ? 'Show fewer' : `Show all ${finished} finished`}
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
  const label = (date: string) => date === today ? 'Today' : niceDate(date)
  return (
    <div className="field">
      <label id="trk-days">{isAudiobook(d) ? 'Listening by day' : 'Reading by day'}</label>
      <div className="trk-days-chart" role="img" aria-label={`Last 14 days: ${dayAmount(d, total)} on ${read} day${read === 1 ? '' : 's'}`}>
        {days.map(x => <div key={x.date} className="trk-days-bar" style={{ height: `${Math.max(x.amount ? 8 : 2, (x.amount / max) * 100)}%` }} title={`${label(x.date)}: ${dayAmount(d, x.amount)}`} />)}
      </div>
      <div className="trk-days-axis" aria-hidden="true"><span>{niceDate(days[0].date)}</span><span>Today</span></div>
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
    ? onSave({ logDay: { date: day, amount: n } }, n ? `${audio ? hoursMinutes(n) : `${n} page${n === 1 ? '' : 's'}`} on ${niceDate(day)}` : `${niceDate(day)} cleared`)
    : onSave({ data: done ? { [field]: n, status: 'finished' } : { [field]: n } }, done ? `${book.title} finished` : audio ? `${hoursMinutes(n)} listened` : `On page ${n}`)
  return (
    <Sheet variant="dialog" title={`${audio ? 'Log listening' : 'Log pages'} · ${book.title}`} onClose={onClose}
      actions={<>
        {!past && <button className="btn btn-secondary" onClick={() => onSave({ data: { status: 'finished' } }, `${book.title} finished`)}>Finished it! 🎉</button>}
        <button className="btn btn-primary" data-autofocus onClick={save}>Save</button>
      </>}>
      <div className="field">
        <label htmlFor="trk-log-day">Day</label>
        <input id="trk-log-day" type="date" value={day} max={today} min={addDayKeys(today, -365)} onChange={e => pickDay(e.target.value)} />
      </div>
      {audio ? <>
        <HoursMinutes id="trk-listened" label={past ? 'Listened that day' : `Listened so far${d.totalMinutes ? ` (of ${hoursMinutes(d.totalMinutes)})` : ''}`} value={hm} onChange={setHm} />
        <div className="chip-row" role="group" aria-label="Add listening time">
          {([[15, '+15m'], [30, '+30m'], [60, '+1h']] as const).map(([k, l]) => <button key={k} type="button" className="chip" onClick={() => setHm(splitMinutes(n + k))}>{l}</button>)}
        </div>
      </> : <>
        <div className="field">
          <label htmlFor="trk-page">{past ? 'Pages read that day' : `Page you're on${d.totalPages ? ` (of ${d.totalPages})` : ''}`}</label>
          <input id="trk-page" type="text" inputMode="numeric" value={page} onChange={e => setPage(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="chip-row" role="group" aria-label="Add pages">
          {[5, 10, 20, 50].map(k => <button key={k} type="button" className="chip" onClick={() => setPage(String(n + k))}>+{k}</button>)}
        </div>
      </>}
      {past && <p className="field-hint">{loggedOn(day) ? `Logged ${audio ? hoursMinutes(loggedOn(day)) : `${loggedOn(day)} pages`} that day. Save replaces it, and your place in the book moves by the difference; 0 clears the day.` : 'Your place in the book moves on by the same amount.'}</p>}
      {done && <p className="field-hint">{audio ? "That's the end" : "That's the last page"}, so Save marks it finished.</p>}
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
        <input id={id} type="text" inputMode="numeric" aria-label={`${label}, hours`} value={h} onChange={e => onChange([digits(e.target.value), m])} />
        <span aria-hidden="true">h</span>
        <input type="text" inputMode="numeric" aria-label={`${label}, minutes`} value={m} onChange={e => onChange([h, digits(e.target.value)])} />
        <span aria-hidden="true">m</span>
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
          <span className="sr-only">{m.name}'s memory. Edit</span>
        </button>
      </li>
    )
  }
  return (
    <div className="trk-journal">
      <button className="btn btn-primary trk-today-btn" onClick={onAdd}>{hasToday ? '✏️ Add another memory for today' : "📝 Add today's memory"}</button>
      {onThisDay.length > 0 && (
        <section className="trk-card trk-onthisday" aria-label="On this day">
          <h3>🕰️ On this day</h3>
          <ul className="trk-memories">{onThisDay.map(e => card(e, true))}</ul>
        </section>
      )}
      {entries.length === 0
        ? <div className="empty-card"><span className="emoji">📝</span>No memories yet. Write down one good thing from today.</div>
        : <ul className="trk-memories">{entries.map(e => card(e, e.date.slice(0, 4) !== today.slice(0, 4)))}</ul>}
    </div>
  )
}

// ---------- Health ----------
function measureText(d: HealthData) {
  return [d.height && `${d.height.value} ${d.height.unit}`, d.weight && `${d.weight.value} ${d.weight.unit}`, d.temperature && `${d.temperature.value} °${d.temperature.unit}`].filter(Boolean).join(' · ')
}

// Health visits and, when medication reminders are on, each person's medicines (parent devices only).
function Health({ entries, today, onEdit, onSave, meds, memberId, switcher }: { entries: TrackerEntry[]; today: string; onEdit: (e: TrackerEntry) => void; onSave: (e: TrackerEntry, body: TrackerInput, msg?: string) => void; meds: boolean; memberId: string | null; switcher: ReactNode }) {
  const who = useWho()
  const { toast } = useApp()
  const upcoming = entries.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = entries.filter(e => e.date < today)
  const addToCalendar = async (e: TrackerEntry) => {
    try { onSave(e, { data: { eventId: (await addVisitToCalendar(e, who(e))).id } }, 'Added to the calendar') } catch (err) { toast(errMsg(err, 'Could not add it to the calendar'), true) }
  }
  const row = (e: TrackerEntry) => {
    const d = e.data as HealthData
    const t = HEALTH_TYPES.find(x => x.key === d.type) ?? HEALTH_TYPES[5]
    const m = who(e)
    const measures = measureText(d)
    const future = e.date >= today
    return (
      <li key={e.id} className="trk-visit">
        <button className="trk-visit-main" onClick={() => onEdit(e)}>
          <span className="trk-visit-emoji" aria-hidden="true">{t.emoji}</span>
          <span className="trk-memory-body">
            <span className="trk-book-title">{e.title || t.label}</span>
            <span className="trk-sub">{niceDate(e.date, true)}{d.time ? ` · ${formatTime(d.time)}` : ''}{d.provider ? ` · ${d.provider}` : ''}</span>
            {measures && <span className="trk-tag">{measures}</span>}
            {d.followUp && <span className="trk-sub">Follow-up {niceDate(d.followUp, true)}</span>}
          </span>
          <Avatar m={m} />
          <span className="sr-only">{m.name}, {t.label}. Edit</span>
        </button>
        {future && (d.eventId
          ? <span className="trk-sub trk-on-cal">📅 On the calendar</span>
          : <button className="btn btn-secondary trk-small-btn" onClick={() => addToCalendar(e)}>📅 Add to calendar</button>)}
      </li>
    )
  }
  return (
    <div className="trk-journal">
      {switcher}
      <p className="trk-privacy">🔒 Health stays on phones and computers, never on the wall screen.</p>
      {meds && <MedicineList memberId={memberId} />}
      {entries.length === 0 && <div className="empty-card"><span className="emoji">🩺</span>No visits yet. Tap + to log a checkup or a dentist visit.</div>}
      {upcoming.length > 0 && <section aria-label="Upcoming"><h3 className="trk-heading">Upcoming</h3><ul className="trk-visits">{upcoming.map(row)}</ul></section>}
      {past.length > 0 && <section aria-label="Past visits"><h3 className="trk-heading">Past visits</h3><ul className="trk-visits">{past.map(row)}</ul></section>}
    </div>
  )
}

/** A normal calendar event for a future visit: its type and who, never the reason, notes or measurements (the calendar is on the wall). */
async function addVisitToCalendar(e: TrackerEntry, m: { id: string | null; name: string }) {
  const d = e.data as HealthData
  const cals = (await api.getCalendars()).filter(c => c.writable && c.enabled && c.canEditEvents !== false)
  const cal = cals.find(c => c.kind === 'local') ?? cals[0]
  if (!cal) throw new Error('There is no calendar to add it to. Add one in Settings → Calendars.')
  const t = HEALTH_TYPES.find(x => x.key === d.type) ?? HEALTH_TYPES[5]
  const title = `${t.emoji} ${t.label}${m.id ? ` · ${m.name}` : ''}`
  const next = format(new Date(new Date(`${e.date}T12:00:00`).getTime() + 86_400_000), 'yyyy-MM-dd')
  const start = d.time ? new Date(`${e.date}T${d.time}`) : null
  return api.createEvent({
    calendarId: cal.id, title, memberIds: m.id ? [m.id] : [],
    ...(start ? { allDay: false, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString() } : { allDay: true, start: e.date, end: next }),
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

function EntrySheet({ kind, entry, date, admin, kid, photos, memberId, onClose, onSaved }: {
  kind: TrackerKind; entry: TrackerEntry | null; date?: string; admin: boolean; photos: Photo[]; memberId: string | null; onClose: () => void; onSaved: () => void
  kid: string | null // a kid's own device: their entries (and the family's) only; someone else's opens read-only
}) {
  const { members: everyone, settings, toast } = useApp()
  const members = kid ? everyone.filter(m => m.id === kid) : everyone
  const readOnly = !!(kid && entry?.memberId && entry.memberId !== kid)
  const dialog = useDialog()
  const imperial = settings.temperatureUnit === 'fahrenheit'
  const d = (entry?.data ?? {}) as Partial<ReadingData & MemoryData & HealthData>
  const num = (v?: number) => v === undefined ? '' : String(v)
  const [f, setF] = useState<Form>(() => ({
    memberId: entry ? (!entry.memberId && entry.formerMember ? FORMER : entry.memberId) : kid ?? memberId, date: entry?.date ?? date ?? '', title: entry?.title ?? '',
    photoId: entry?.photoId ?? null, photoOwned: !!entry?.photoOwned, photoFamily: !!entry?.photoFamily, pending: null,
    format: d.format ?? 'book', author: d.author ?? '', narrator: d.narrator ?? '', status: d.status ?? 'reading', pagesRead: num(d.pagesRead), totalPages: num(d.totalPages),
    listened: splitMinutes(d.minutesListened), length: splitMinutes(d.totalMinutes), finishedOn: d.finishedOn ?? '', rating: d.rating ?? null, notes: d.notes ?? '',
    coverUrl: d.coverUrl ?? '', coverThumb: entry && d.coverUrl ? api.trackerCoverUrl(entry) : null,
    text: d.text ?? '', mood: d.mood ?? null,
    type: d.type ?? 'checkup', time: d.time ?? '', provider: d.provider ?? '', followUp: d.followUp ?? '',
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
    try { await api.updateTracker(entry!.id, { data: { bookId: b.id } }); setBookId(b.id); announce(`${b.title} is in the library`) }
    catch (e) { toast(errMsg(e, 'Could not link it'), true) }
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
        height: measure(f.height, f.heightUnit), weight: measure(f.weight, f.weightUnit), temperature: measure(f.temperature, f.temperatureUnit) }
  const ready = kind === 'reading' ? !!f.title.trim() : kind === 'memory' ? !!(f.text.trim() || f.photoId || f.pending) : true

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
      announce(entry ? 'Saved' : 'Added')
      onSaved()
    } catch (e) { toast(errMsg(e, 'Could not save'), true) } finally { setBusy(false) }
  }
  const del = async () => {
    if (!entry || !await dialog.confirm({ title: 'Delete this entry?', body: 'It is gone for good.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteTracker(entry.id); onSaved() } catch (e) { toast(errMsg(e, 'Could not delete'), true) }
  }

  const noun = kind === 'reading' ? 'book' : kind === 'memory' ? 'memory' : 'visit'
  return (
    <Sheet title={readOnly ? `${everyone.find(m => m.id === entry?.memberId)?.name ?? 'Someone'}'s ${noun}` : entry ? `Edit ${noun}` : kind === 'reading' ? 'Add a book' : kind === 'memory' ? 'New memory' : 'Health visit'} onClose={onClose}
      actions={readOnly ? <button className="btn btn-primary" onClick={onClose}>Done</button> : <>
        {entry && (admin || (!!kid && entry.memberId === kid)) && <button className="btn btn-danger" onClick={del}>Delete</button>}
        <button className="btn btn-primary" onClick={submit} disabled={!ready || busy}>{entry ? 'Save' : 'Add'}</button>
      </>}>
      {/* Read-only: every field inside is disabled. */}
      <fieldset className="item-sheet-fields" disabled={readOnly}>
      {kind === 'health' && <p className="trk-privacy">🔒 Health stays on phones and computers, never on the wall screen.</p>}
      <div className="field">
        <label id="trk-who">Whose {noun}?</label>
        <div className="chip-row" role="group" aria-labelledby="trk-who">
          {entry?.formerMember && !entry.memberId && (
            <button type="button" className={`chip ${f.memberId === FORMER ? 'active' : ''}`} aria-pressed={f.memberId === FORMER} onClick={() => set({ memberId: FORMER })}>{entry.formerMember} (removed)</button>
          )}
          <button type="button" className={`chip ${f.memberId === null ? 'active' : ''}`} aria-pressed={f.memberId === null} onClick={() => set({ memberId: null })}>🏠 Family</button>
          {members.map(m => (
            <button key={m.id} type="button" className={`chip ${f.memberId === m.id ? 'active' : ''}`} aria-pressed={f.memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => set({ memberId: m.id })}><ChipFace m={m} /> {m.name}</button>
          ))}
        </div>
      </div>

      {kind === 'reading' && <>
        <div className="field">
          <label htmlFor="trk-format">Format</label>
          <select id="trk-format" value={f.format} onChange={e => set({ format: e.target.value as ReadingFormat })}>
            <option value="book">📖 Book</option>
            <option value="audiobook">🎧 Audiobook</option>
          </select>
        </div>
        <BookLookup initial={f.title} onPick={b => set({
          title: b.title, author: b.author ?? f.author, coverUrl: b.coverUrl ?? f.coverUrl, coverThumb: b.coverUrl ? api.bookThumbUrl(b) : f.coverThumb,
          ...(f.format === 'book' && b.pages ? { totalPages: String(b.pages) } : {}),
        })} />
        <div className="field"><label htmlFor="trk-title">Title</label><input id="trk-title" type="text" value={f.title} onChange={e => set({ title: e.target.value })} placeholder="Charlotte's Web" autoComplete="off" autoFocus={!entry} /></div>
        <div className="field"><label htmlFor="trk-author">Author</label><input id="trk-author" type="text" value={f.author} onChange={e => set({ author: e.target.value })} autoComplete="off" /></div>
        <div className="field">
          <label htmlFor="trk-cover">Cover link</label>
          <div className="trk-cover-field">
            <BookCover className="trk-cover" src={f.coverThumb} title={f.title} audio={f.format === 'audiobook'} />
            <input id="trk-cover" type="url" inputMode="url" value={f.coverUrl} onChange={e => set({ coverUrl: e.target.value, coverThumb: null })} placeholder="https://…/cover.jpg" autoComplete="off" />
          </div>
        </div>
        <div className="field">
          <label>Status</label>
          <Segmented label="Status" value={f.status} onChange={s => set({ status: s })} options={STATUS} className="trk-status" />
        </div>
        {f.format === 'audiobook' ? <>
          <div className="field"><label htmlFor="trk-narrator">Narrator</label><input id="trk-narrator" type="text" value={f.narrator} onChange={e => set({ narrator: e.target.value })} autoComplete="off" /></div>
          <div className="trk-field-pair">
            <HoursMinutes id="trk-listened" label="Listened" value={f.listened} onChange={listened => set({ listened })} />
            <HoursMinutes id="trk-length" label="Length" value={f.length} onChange={length => set({ length })} />
          </div>
        </> : (
          <div className="trk-field-pair">
            <div className="field"><label htmlFor="trk-read">Pages read</label><input id="trk-read" type="text" inputMode="numeric" value={f.pagesRead} onChange={e => set({ pagesRead: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="field"><label htmlFor="trk-total">Total pages</label><input id="trk-total" type="text" inputMode="numeric" value={f.totalPages} onChange={e => set({ totalPages: e.target.value.replace(/\D/g, '') })} /></div>
          </div>
        )}
        {entry && !!d.log?.length && <ReadingDays d={d as ReadingData} tz={settings.timezone ?? undefined} />}
        <div className="trk-field-pair">
          <div className="field"><label htmlFor="trk-date">Started</label><input id="trk-date" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></div>
          {f.status === 'finished' && <div className="field"><label htmlFor="trk-fin">Finished</label><input id="trk-fin" type="date" value={f.finishedOn} onChange={e => set({ finishedOn: e.target.value })} /></div>}
        </div>
        <div className="field"><label>Rating</label><Stars value={f.rating ?? undefined} label="Rating" onChange={v => set({ rating: v })} /></div>
        <div className="field"><label htmlFor="trk-notes">Notes</label><textarea id="trk-notes" value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder="Favorite part, who recommended it…" /></div>
        {entry && <div className="field">
          <label>Library</label>
          {bookId ? <><a className="btn btn-secondary" href={`#/trackers/library?book=${encodeURIComponent(bookId)}`} onClick={onClose}>📚 Open in the library</a><p className="field-hint">It's in the family's library: where it lives, lending, who else read it.</p></>
            : <><button type="button" className="btn btn-secondary" onClick={shelve}>📚 Save to library</button><p className="field-hint">Keep it with the books your family owns or has borrowed.</p></>}
        </div>}
      </>}

      {kind === 'memory' && <>
        <div className="field"><label htmlFor="trk-date">Day</label><input id="trk-date" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></div>
        <div className="field"><label htmlFor="trk-text">What happened?</label><textarea id="trk-text" value={f.text} onChange={e => set({ text: e.target.value })} placeholder="One good thing from today…" autoFocus={!entry} rows={4} /></div>
        <div className="field"><label htmlFor="trk-title">Headline (optional)</label><input id="trk-title" type="text" value={f.title} onChange={e => set({ title: e.target.value })} placeholder="First snow" autoComplete="off" /></div>
        <div className="field">
          <label id="trk-mood">Mood</label>
          <div className="emoji-swatch-row" role="group" aria-labelledby="trk-mood">
            {MOODS.map(m => <button key={m} type="button" className={`emoji-swatch ${f.mood === m ? 'active' : ''}`} aria-pressed={f.mood === m} onClick={() => set({ mood: f.mood === m ? null : m })}>{m}</button>)}
          </div>
        </div>
        <PhotoField f={f} set={set} photos={settings.features.photos ? photos : []} />
      </>}

      {kind === 'health' && <>
        <div className="field">
          <label id="trk-type">Type</label>
          <div className="chip-row" role="group" aria-labelledby="trk-type">
            {HEALTH_TYPES.map(t => <button key={t.key} type="button" className={`chip ${f.type === t.key ? 'active' : ''}`} aria-pressed={f.type === t.key} onClick={() => set({ type: t.key })}>{t.emoji} {t.label}</button>)}
          </div>
        </div>
        <div className="trk-field-pair">
          <div className="field"><label htmlFor="trk-date">Date</label><input id="trk-date" type="date" value={f.date} onChange={e => set({ date: e.target.value })} /></div>
          <div className="field"><label htmlFor="trk-time">Time</label><input id="trk-time" type="time" value={f.time} onChange={e => set({ time: e.target.value })} /></div>
        </div>
        <div className="field"><label htmlFor="trk-title">Reason</label><input id="trk-title" type="text" value={f.title} onChange={e => set({ title: e.target.value })} placeholder="Annual checkup" autoComplete="off" /></div>
        <div className="field"><label htmlFor="trk-provider">Doctor or office</label><input id="trk-provider" type="text" value={f.provider} onChange={e => set({ provider: e.target.value })} autoComplete="off" /></div>
        <fieldset className="trk-measures">
          <legend>Measurements (optional)</legend>
          <MeasureInput id="trk-height" label="Height" value={f.height} unit={f.heightUnit} units={['in', 'cm']} onValue={v => set({ height: v })} onUnit={u => set({ heightUnit: u as Form['heightUnit'] })} />
          <MeasureInput id="trk-weight" label="Weight" value={f.weight} unit={f.weightUnit} units={['lb', 'kg']} onValue={v => set({ weight: v })} onUnit={u => set({ weightUnit: u as Form['weightUnit'] })} />
          <MeasureInput id="trk-temp" label="Temperature" value={f.temperature} unit={f.temperatureUnit} units={['F', 'C']} onValue={v => set({ temperature: v })} onUnit={u => set({ temperatureUnit: u as Form['temperatureUnit'] })} />
        </fieldset>
        <div className="field"><label htmlFor="trk-notes">Notes</label><textarea id="trk-notes" value={f.notes} onChange={e => set({ notes: e.target.value })} placeholder="What the doctor said, medicine, next steps…" /></div>
        <div className="field"><label htmlFor="trk-follow">Follow-up</label><input id="trk-follow" type="date" value={f.followUp} onChange={e => set({ followUp: e.target.value })} /></div>
      </>}
      </fieldset>
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
      <select aria-label={`${label} unit`} value={unit} onChange={e => onUnit(e.target.value)}>
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
    } catch (e) { toast(e instanceof PhotoFormatError ? e.message : "Couldn't use that photo", true) } finally { setBusy(false) }
  }
  return (
    <div className="field">
      <label>Photo</label>
      {src && <div className="trk-photo-pick">
        <img src={src} alt="The memory's photo" />
        <div className="trk-photo-side">
          {own
            ? <div className="toggle-row">
                <label id="trk-photo-family">Also in family photos</label>
                <button type="button" className={`switch ${f.photoFamily ? 'on' : ''}`} role="switch" aria-checked={f.photoFamily} aria-labelledby="trk-photo-family"
                  onClick={() => set({ photoFamily: !f.photoFamily })}><span className="knob" /></button>
              </div>
            : <span className="trk-sub">From the family photos</span>}
          <button type="button" className="btn btn-secondary trk-small-btn" onClick={() => set({ photoId: null, pending: null, photoOwned: false })}>Remove</button>
        </div>
      </div>}
      {own && <p className="field-hint">{f.photoFamily ? 'It also shows in Photos, on the Board and the night screen.' : 'Only in this memory.'}</p>}
      <input ref={input} type="file" accept="image/*" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; choose(file) }} />
      <div className="trk-photo-actions">
        <button type="button" className="btn btn-secondary trk-small-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Adding…' : src ? '📷 Replace photo' : '📷 Add a photo'}</button>
        {photos.length > 0 && <button type="button" className="btn btn-secondary trk-small-btn" aria-expanded={picking} onClick={() => setPicking(v => !v)}>🖼️ From family photos</button>}
      </div>
      {picking && (
        <ul className="trk-photo-grid" aria-label="Family photos">
          {photos.map(p => (
            <li key={p.id}>
              <button type="button" className={`photo-tile ${p.id === f.photoId ? 'trk-photo-on' : ''}`} aria-pressed={p.id === f.photoId}
                aria-label={p.caption || `Photo from ${new Date(p.createdAt).toLocaleDateString()}`}
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
