// Outings (docs/using/outings.md; server: routes/outings.ts): things to do and places to go, kept
// apart from the calendar. The tab has Upcoming and Places with filters; each outing opens a sheet
// where everyone marks interest (👀 / ⭐) and a parent can add it to the calendar. Home's Board has an
// Outings button next to Polls that opens a tray (this weekend, coming up).
//
// Who does what: a parent's device everything; a kid's own device adds outings, edits the ones it
// added and marks interest only for that kid (grown-ups-only outings aren't listed there); a shared
// wall marks interest after picking who. The server checks all of it too.
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { Segmented } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import PickField from './PickField.tsx'
import { Face } from './Face'
import { ChevronRight, FilterIcon, LinkIcon, PlusIcon } from './icons.tsx'
import { todayKeyInTz } from './date.ts'
import { formatTime } from './timeFormat.ts'
import { mapHref, parsePrice } from './restaurants.ts'
import { hashQuery, withHashParam } from './hashQuery.ts'
import { FOR_BOXES, interestOf, type ForBox } from './outing-rules.ts'
import { audienceLabel, boxLabel, filterChips, placeSections, priceLabel, reallyCount, shownOutings, startFilters, trayRows, upcomingSections, whenLabel, type Cost, type Filters, type When } from './outings.ts'
import type { CalendarEntry, Member, Outing, OutingAudience, OutingCategory, OutingInput } from './types.ts'
import './meals.css'
import './outings.css'

const CHANGED = 'kinwall:outings'
/** Tells every outings list, sheet and tray on this screen to read again. */
const changed = () => window.dispatchEvent(new Event(CHANGED))

/** Outings and their categories, kept fresh: on a change here, on the app's refresh, never while off. */
export function useOutings() {
  const { settings, refreshTick } = useApp()
  const on = settings.features.outings !== false
  const [data, setData] = useState<{ outings: Outing[]; categories: OutingCategory[] } | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener(CHANGED, bump)
    return () => window.removeEventListener(CHANGED, bump)
  }, [])
  useEffect(() => {
    if (!on) return
    let canceled = false
    Promise.all([api.getOutings(), api.getOutingCategories()])
      .then(([outings, categories]) => { if (!canceled) { setData({ outings, categories }); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof Error ? e.message : 'Could not load outings.') })
    return () => { canceled = true }
  }, [on, refreshTick, tick])
  return { outings: on ? data?.outings ?? [] : [], categories: data?.categories ?? [], loaded: !!data, error, retry: () => setTick(t => t + 1) }
}

/** What this device may do: a parent everything, a kid's own device add and edit its own, a wall neither. */
function useWho() {
  const { members, parentDevice, meMemberId, settings } = useApp()
  const kidId = !parentDevice && meMemberId && members.find(m => m.id === meMemberId)?.grownUp === false ? meMemberId : null
  const today = todayKeyInTz(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  return { kidId, parent: parentDevice, canAdd: parentDevice || !!kidId, canEdit: (o: Outing) => parentDevice || (!!kidId && o.addedBy === kidId), today }
}

/** A PickField with its label shown above it, like the other fields. */
function LabeledPick(props: Parameters<typeof PickField>[0]) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{props.label}</label><PickField id={id} {...props} /></div>
}

const emojiOf = (o: Outing, categories: OutingCategory[]) => categories.find(c => c.id === o.categoryId)?.emoji || (o.kind === 'place' ? '📍' : '🎟')

/** Small faces of who marked it, with ⭐ / 👀 words beside them. */
function Marks({ o, members }: { o: Outing; members: Member[] }) {
  const who = o.interest.map(i => ({ m: members.find(x => x.id === i.memberId), level: i.level })).filter(x => x.m)
  if (!who.length) return null
  const stars = reallyCount(o), eyes = who.length - stars
  const words = [stars && `⭐ ${stars}`, eyes && `👀 ${eyes}`].filter(Boolean).join(' ')
  return <span className="outing-marks" role="img" aria-label={who.map(x => `${x.m!.name} ${x.level === 'really' ? 'really wants to go' : 'is interested'}`).join(', ')}>
    <span className="outing-faces" aria-hidden="true">{who.slice(0, 4).map(x => <Face key={x.m!.id} m={x.m!} />)}</span>
    <span aria-hidden="true" className="outing-marks-n">{words}</span>
  </span>
}

/** One outing in a list: its emoji, name, when and where, cost and who it's for, and who marked it. */
function OutingRow({ o, categories, onOpen, today, compact = false }: { o: Outing; categories: OutingCategory[]; onOpen: (o: Outing) => void; today: string; compact?: boolean }) {
  const { members } = useApp()
  const price = priceLabel(o)
  const who = audienceLabel(o, members)
  const ticket = !o.gotTickets && o.buyBy && o.buyBy >= today ? `Get tickets by ${new Date(`${o.buyBy}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : !o.gotTickets && o.ticketsOnSaleAt && o.ticketsOnSaleAt.slice(0, 10) >= today ? 'Tickets not on sale yet' : o.gotTickets ? '✓ We have tickets' : null
  return <button type="button" className={`outing-row ${compact ? 'outing-row-compact' : ''}`} aria-haspopup="dialog" onClick={() => onOpen(o)}>
    <span className="outing-emoji" aria-hidden="true">{emojiOf(o, categories)}</span>
    <span className="outing-row-main">
      <strong>{o.title}</strong>
      <span className="outing-row-meta">{[whenLabel(o, today), o.placeName].filter(Boolean).join(' · ')}</span>
      {!compact && (price || who || ticket || o.calendarEventId) && <span className="outing-tags">
        {price && <span className="chip chip-static">{price}</span>}
        {who && <span className="chip chip-static">{who}</span>}
        {ticket && <span className="chip chip-static outing-ticket">🎟 {ticket}</span>}
        {o.calendarEventId && <span className="chip chip-static">📅 On our calendar</span>}
      </span>}
    </span>
    <Marks o={o} members={members} />
    <ChevronRight />
  </button>
}

/** The Outings tab. */
export default function Outings() {
  const { members } = useApp()
  const who = useWho()
  const { outings, categories, loaded, error, retry } = useOutings()
  const [view, setView] = useState<'upcoming' | 'place'>('upcoming')
  // A kid's own device starts on "for me" (whose device it is can arrive after the first render).
  const [picked, setFilters] = useState<Filters | null>(null)
  const filters = picked ?? startFilters(who.kidId)
  const [filtering, setFiltering] = useState(false)
  const [open, setOpen] = useState<string | null>(() => hashQuery(location.hash).get('outing'))
  const [editing, setEditing] = useState<Outing | 'new' | null>(null)
  const [cats, setCats] = useState(false)
  // A link (#/outings?outing=<id>: the bell, the Board's tray, an event) opens that outing; it stays in the link while open.
  useEffect(() => {
    const read = () => { const id = hashQuery(location.hash).get('outing'); if (id && location.hash.startsWith('#/outings')) setOpen(id) }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  const openOne = useCallback((id: string | null) => { history.replaceState(null, '', withHashParam(location.hash, 'outing', id)); setOpen(id) }, [])
  const linked = open ? outings.find(o => o.id === open) : null
  useEffect(() => { if (linked?.kind) setView(linked.kind) }, [linked?.kind])

  const shown = shownOutings(outings, view, filters, members, who.today, who.kidId)
  const sections = view === 'place' ? placeSections(shown) : upcomingSections(shown, who.today)
  const chips = filterChips(view === 'place' ? { ...filters, when: 'any' } : filters, members, categories)
  return <div className="meals-view outings-view scroll-y">
    <div className="meals-heading"><div><h1>Outings</h1><p className="field-hint">Things to do and places to go. Mark what you’d like to do.</p></div>
      {who.canAdd && <div className="meal-actions"><button className="btn btn-primary" onClick={() => setEditing('new')}><PlusIcon /> Add</button></div>}
    </div>
    <Segmented tabs idBase="outings-tab" label="Outings sections" value={view} onChange={setView} options={[{ key: 'upcoming', label: 'Upcoming' }, { key: 'place', label: 'Places' }]} />
    <section role="tabpanel" aria-labelledby={`outings-tab-${view}`}>
      <div className="outing-filter-bar">
        {chips.map(c => <button key={c.label} type="button" className="btn btn-secondary outing-chip" aria-label={`Remove filter: ${c.label}`} onClick={() => setFilters(c.without)}>{c.label} <span aria-hidden="true">✕</span></button>)}
        <button type="button" className="btn btn-secondary outing-filter-btn" aria-haspopup="dialog" onClick={() => setFiltering(true)}><FilterIcon width={18} height={18} /> Filters{chips.length ? ` (${chips.length})` : ''}</button>
      </div>
      {error && <div role="alert" className="state-card">Could not load outings: {error} <button className="btn btn-secondary" onClick={retry}>Retry</button></div>}
      {!loaded && !error ? <p role="status">Loading outings…</p> : <>
        <p className="field-hint" role="status">{shown.length} {view === 'place' ? `place${shown.length === 1 ? '' : 's'}` : `outing${shown.length === 1 ? '' : 's'}`}</p>
        {!shown.length && <p className="state-card">{chips.length ? 'Nothing matches these filters.' : view === 'place'
          ? 'Keep the places you like to go here: parks, beaches, museums. Mark the ones you want to try.'
          : 'Keep things to do here: a fair, a concert, a movie coming out, a class. Mark what you’d like to do.'}</p>}
        {sections.map(s => <section key={s.key} className="outing-section" aria-labelledby={`outing-sec-${s.key}`}>
          <h2 id={`outing-sec-${s.key}`}>{s.title}</h2>
          <div className="outing-list">{s.outings.map(o => <OutingRow key={o.id} o={o} categories={categories} today={who.today} onOpen={x => openOne(x.id)} />)}</div>
        </section>)}
      </>}
    </section>
    {filtering && <FiltersSheet value={filters} place={view === 'place'} categories={categories} count={(f: Filters) => shownOutings(outings, view, f, members, who.today, who.kidId).length}
      onEditCategories={who.parent ? () => { setFiltering(false); setCats(true) } : undefined} onClose={() => setFiltering(false)} onApply={f => { setFilters(f); setFiltering(false) }} />}
    {open && <OutingSheet id={open} onClose={() => openOne(null)} onEdit={o => setEditing(o)} />}
    {editing && <OutingEditSheet outing={editing === 'new' ? null : editing} kind={view} categories={categories} onClose={() => setEditing(null)} onSaved={o => { setEditing(null); setView(o.kind); openOne(o.id) }} />}
    {cats && <CategoriesSheet categories={categories} onClose={() => setCats(false)} />}
  </div>
}

/** Filters: when, categories, who it's for (a person's boxes), marked by, cost. */
function FiltersSheet({ value, place, categories, count, onClose, onApply, onEditCategories }: {
  value: Filters; place: boolean; categories: OutingCategory[]; count: (f: Filters) => number; onClose: () => void; onApply: (f: Filters) => void; onEditCategories?: () => void
}) {
  const { members } = useApp()
  const who = useWho()
  const id = useId()
  const [f, setF] = useState(value)
  const person = members.find(m => m.id === f.who)
  const n = count(f)
  return <Sheet title="Filters" onClose={onClose} actions={<>
    <button className="btn btn-secondary" onClick={() => setF({ ...startFilters(null) })}>Clear</button>
    <button className="btn btn-primary" onClick={() => onApply(f)}>Show {n} {place ? `place${n === 1 ? '' : 's'}` : `outing${n === 1 ? '' : 's'}`}</button>
  </>}>
    {!place && <div className="field"><label htmlFor={`${id}-when`}>When</label><select id={`${id}-when`} value={f.when} onChange={e => setF({ ...f, when: e.target.value as When })}>
      <option value="any">Any time</option><option value="weekend">This weekend</option><option value="week">Next 7 days</option><option value="month">Next 30 days</option><option value="past">Past</option>
    </select></div>}
    <LabeledPick label="Categories" multiple none="Any" value={f.categoryIds} onChange={v => setF({ ...f, categoryIds: v })} options={categories.map(c => ({ value: c.id, label: c.name, lead: <span aria-hidden="true">{c.emoji}</span> }))} />
    <div className="field"><label htmlFor={`${id}-who`}>Who it’s for</label><select id={`${id}-who`} value={f.who} onChange={e => setF({ ...f, who: e.target.value, boxes: [...FOR_BOXES] })}>
      <option value="">Anyone</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select></div>
    {person && <fieldset className="meal-fieldset outing-boxes"><legend className="sr-only">What counts as for {person.name}</legend>
      {FOR_BOXES.map(b => <label key={b} className="meal-check"><input type="checkbox" checked={f.boxes.includes(b)} onChange={e => setF({ ...f, boxes: e.target.checked ? FOR_BOXES.filter(x => x === b || f.boxes.includes(x)) : f.boxes.filter(x => x !== b) as ForBox[] })} /> {boxLabel(b, person)}</label>)}
    </fieldset>}
    <div className="field"><label htmlFor={`${id}-marked`}>Marked by</label><select id={`${id}-marked`} value={f.markedBy} onChange={e => setF({ ...f, markedBy: e.target.value })}>
      <option value="">Anyone or no one</option><option value="any">Someone marked it</option><option value="really">⭐ Really want to go</option>
      {who.kidId && <option value={who.kidId}>Me</option>}
      {members.filter(m => m.id !== who.kidId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select></div>
    <div className="field"><label htmlFor={`${id}-cost`}>Cost</label><select id={`${id}-cost`} value={f.cost} onChange={e => setF({ ...f, cost: e.target.value as Cost })}>
      <option value="any">Any cost</option><option value="free">Free only</option><option value="10">Under $10</option><option value="25">Under $25</option>
    </select></div>
    {onEditCategories && <button type="button" className="link-btn" onClick={onEditCategories}>Edit categories</button>}
  </Sheet>
}

const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** One outing: when, where, cost, tickets, who it's for, interest marks, and (parents) Add to our calendar. */
export function OutingSheet({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit?: (o: Outing) => void }) {
  const { members, meMemberId, toast, refreshTick, settings } = useApp()
  const who = useWho()
  const dialog = useDialog()
  const [o, setO] = useState<Outing | null>(null)
  const [categories, setCategories] = useState<OutingCategory[]>([])
  const [missing, setMissing] = useState(false)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [calendar, setCalendar] = useState(false)
  // A member's own device marks only for them; a parent's device starts on its owner; a wall on nobody.
  const lockedTo = !who.parent && meMemberId ? meMemberId : null
  const [marker, setMarker] = useState<string | null>(lockedTo ?? (who.parent ? meMemberId : null))
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener(CHANGED, bump)
    return () => window.removeEventListener(CHANGED, bump)
  }, [])
  useEffect(() => {
    let canceled = false
    Promise.all([api.getOuting(id), api.getOutingCategories()]).then(([x, c]) => { if (!canceled) { setO(x); setCategories(c) } }).catch(() => { if (!canceled) setMissing(true) })
    return () => { canceled = true }
  }, [id, refreshTick, tick])
  if (missing) return <Sheet title="Outing" onClose={onClose}><p className="state-card">This outing isn’t here anymore.</p></Sheet>
  if (!o) return <Sheet title="Outing" onClose={onClose}><p role="status">Loading…</p></Sheet>
  const name = (memberId: string | null) => members.find(m => m.id === memberId)?.name ?? 'Someone'
  const category = categories.find(c => c.id === o.categoryId)
  const run = async (work: () => Promise<Outing | null>, done: string | null) => {
    setBusy(true)
    try { const saved = await work(); if (saved) setO(saved); changed(); if (done) toast(done) } catch (e) { toast(e instanceof Error ? e.message : 'Could not save.', true) } finally { setBusy(false) }
  }
  const mark = (level: 'interested' | 'really') => {
    if (!marker) return
    const next = interestOf(o, marker) === level ? null : level // tapping your mark again clears it
    void run(() => api.markOuting(o.id, marker, next), next === 'really' ? `${name(marker)} really wants to go` : next ? `${name(marker)} is interested` : `Cleared ${name(marker)}’s mark`)
    if (!lockedTo && !who.parent) setMarker(null) // a shared wall: ready for the next person
  }
  const more = async (action: string) => {
    if (action === 'edit') onEdit?.(o)
    if (action === 'archive') void run(() => api.updateOuting(o.id, { archived: !o.archived }), o.archived ? 'Back on the list' : 'Marked “Not for us”')
    if (action === 'been') void run(() => api.updateOuting(o.id, { visitStatus: 'been', lastVisitedOn: who.today }), 'Marked as been there today')
    if (action === 'tickets') void run(() => api.updateOuting(o.id, { gotTickets: !o.gotTickets }), o.gotTickets ? 'Tickets unmarked' : 'Marked: we have tickets')
    if (action === 'delete' && await dialog.confirm({ title: `Delete “${o.title}”?`, body: 'It and everyone’s marks go away. Its calendar event stays.', confirmLabel: 'Delete outing', danger: true })) {
      void run(async () => { await api.deleteOuting(o.id); onClose(); return null }, 'Outing deleted')
    }
  }
  const mine = marker ? interestOf(o, marker) : null
  const price = priceLabel(o)
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const canEdit = who.canEdit(o)
  const options = [
    canEdit && onEdit && <option key="edit" value="edit">Edit</option>,
    canEdit && o.kind === 'place' && <option key="been" value="been">We went today</option>,
    who.parent && o.kind === 'upcoming' && (o.ticketsUrl || o.buyBy || o.ticketsOnSaleAt || o.gotTickets) && <option key="tickets" value="tickets">{o.gotTickets ? 'We don’t have tickets' : 'We have tickets'}</option>,
    canEdit && <option key="archive" value="archive">{o.archived ? 'Put it back on the list' : 'Not for us'}</option>,
    who.parent && <option key="delete" value="delete">Delete outing…</option>,
  ].filter(Boolean)
  const actions = <>
    {options.length > 0 && <select className="settings-select actions-select" aria-label="Outing actions" value="" disabled={busy} onChange={e => void more(e.target.value)}><option value="" disabled hidden>More…</option>{options}</select>}
    {who.parent && !o.calendarEventId && <button className="btn btn-primary" disabled={busy} onClick={() => setCalendar(true)}>Add to our calendar</button>}
  </>
  const facts: [string, ReactNode][] = [
    ['📅', whenLabel(o, who.today) + (o.kind === 'upcoming' && o.startsOn && !o.endsOn ? ` · ${longDay(o.startsOn)}` : '')],
    ...(o.placeName || o.address ? [['📍', <>{[o.placeName, o.address].filter(Boolean).join(', ')}{(o.address || o.placeName) && <> · <a href={mapHref([o.placeName, o.address].filter(Boolean).join(', '))} target="_blank" rel="noopener noreferrer">Map</a></>}</>] as [string, ReactNode]] : []),
    ...(price || o.priceNote ? [['💵', [price === 'Free' ? 'Free' : price && `From ${price}`, o.priceNote].filter(Boolean).join(' · ')] as [string, ReactNode]] : []),
    ...(o.kind === 'upcoming' && (o.ticketsOnSaleAt || o.buyBy || o.ticketsUrl || o.gotTickets) ? [['🎟', <>{[
      o.gotTickets && '✓ We have tickets',
      !o.gotTickets && o.ticketsOnSaleAt && `Tickets on sale ${longDay(o.ticketsOnSaleAt.slice(0, 10))} at ${formatTime(o.ticketsOnSaleAt, tz)}`,
      !o.gotTickets && o.buyBy && `Get tickets or sign up by ${longDay(o.buyBy)}`,
    ].filter(Boolean).join(' · ')}{o.ticketsUrl && <> · <a href={o.ticketsUrl} target="_blank" rel="noopener noreferrer">Ticket page</a></>}</>] as [string, ReactNode]] : []),
    ...(o.calendarEventId && o.calendarEventStart ? [['🗓', <>On our calendar: {longDay(o.calendarEventStart.length === 10 ? o.calendarEventStart : new Date(o.calendarEventStart).toLocaleDateString('en-CA', { timeZone: tz }))} · <a href={`#/calendar?event=${encodeURIComponent(o.calendarEventId)}&at=${o.calendarEventStart.slice(0, 10)}`} onClick={onClose}>Open the event</a></>] as [string, ReactNode]] : []),
    ...(o.kind === 'place' && o.visitStatus ? [['🏡', o.visitStatus === 'been' ? `Been there${o.lastVisitedOn ? `, last on ${longDay(o.lastVisitedOn)}` : ''}` : 'Want to go'] as [string, ReactNode]] : []),
  ]
  return <Sheet title={`${emojiOf(o, categories)} ${o.title}`} onClose={onClose} actions={actions}>
    <p className="outing-meta">{[category?.name, audienceLabel(o, members), o.addedBy && `Added by ${name(o.addedBy)}`, o.archived && 'Not for us'].filter(Boolean).join(' · ')}</p>
    <ul className="outing-facts">{facts.map(([icon, text], i) => <li key={i}><span aria-hidden="true">{icon}</span><span>{text}</span></li>)}</ul>
    <section className="outing-interest" aria-label="Who wants to go">
      {lockedTo ? <p className="poll-voting-as"><Face m={members.find(m => m.id === lockedTo) ?? { name: '?', color: 'var(--bg-alt)' }} /> Marking for {name(lockedTo)}</p>
        : <div className="poll-who">
          <p className="poll-who-label" id={`outing-who-${o.id}`}>{marker ? `Marking for ${name(marker)}` : 'Who? Tap your name.'}</p>
          <div className="poll-who-row" role="group" aria-labelledby={`outing-who-${o.id}`}>
            {members.map(m => <button key={m.id} type="button" className={`news-who-btn poll-who-btn ${marker === m.id ? 'active' : ''}`} aria-pressed={marker === m.id} onClick={() => setMarker(m.id)}>
              <Face m={m} /><span>{m.name}</span>{interestOf(o, m.id) && <span className="poll-who-done">{interestOf(o, m.id) === 'really' ? '⭐' : '👀'}</span>}
            </button>)}
          </div>
        </div>}
      <div className="outing-interest-btns">
        <button type="button" className="btn btn-secondary outing-level" aria-pressed={mine === 'interested'} disabled={!marker || busy} onClick={() => mark('interested')}><span aria-hidden="true">👀</span> Interested</button>
        <button type="button" className="btn btn-secondary outing-level" aria-pressed={mine === 'really'} disabled={!marker || busy} onClick={() => mark('really')}><span aria-hidden="true">⭐</span> Really want to go</button>
      </div>
      {o.interest.length > 0 && <ul className="outing-marked">{o.interest.map(i => { const m = members.find(x => x.id === i.memberId); return m && <li key={i.memberId}><Face m={m} /> {m.name} {i.level === 'really' ? '⭐ really wants to go' : '👀 is interested'}</li> })}</ul>}
    </section>
    {o.notes && <section className="restaurant-section"><h3>Details</h3><p className="meal-prose">{o.notes}</p></section>}
    {o.url && <p><a className="btn btn-secondary outing-link" href={o.url} target="_blank" rel="noopener noreferrer"><LinkIcon /> More info</a></p>}
    {calendar && <OutingCalendarSheet outing={o} onClose={() => setCalendar(false)} onSaved={x => { setO(x); changed(); setCalendar(false) }} />}
  </Sheet>
}

type Draft = Omit<OutingInput, 'priceCents'> & { title: string; price: string; free: boolean; run: boolean; sale: string }
const toDraft = (o: Outing | null, kind: Outing['kind']): Draft => ({
  title: o?.title ?? '', kind: o?.kind ?? kind, categoryId: o?.categoryId ?? null, startsOn: o?.startsOn ?? null, endsOn: o?.endsOn ?? null, startTime: o?.startTime ?? null, endTime: o?.endTime ?? null,
  hours: o?.hours ?? null, placeName: o?.placeName ?? null, address: o?.address ?? null, priceNote: o?.priceNote ?? null, audience: o?.audience ?? [], memberIds: o?.memberIds ?? [],
  ageMin: o?.ageMin ?? null, ageMax: o?.ageMax ?? null, url: o?.url ?? null, ticketsUrl: o?.ticketsUrl ?? null, buyBy: o?.buyBy ?? null, visitStatus: o?.visitStatus ?? (o ? null : kind === 'place' ? 'want' : null),
  lastVisitedOn: o?.lastVisitedOn ?? null, notes: o?.notes ?? null,
  price: o?.priceCents ? (o.priceCents / 100).toFixed(o.priceCents % 100 ? 2 : 0) : '', free: o?.priceCents === 0, run: !!o?.endsOn,
  sale: o?.ticketsOnSaleAt ? (() => { const d = new Date(o.ticketsOnSaleAt); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) })() : '',
})

/** Add or edit an outing or a place. */
function OutingEditSheet({ outing, kind, categories, onClose, onSaved }: { outing: Outing | null; kind: Outing['kind']; categories: OutingCategory[]; onClose: () => void; onSaved: (o: Outing) => void }) {
  const { members, toast } = useApp()
  const id = useId()
  const [d, setD] = useState<Draft>(() => toDraft(outing, kind))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }))
  const text = (k: 'placeName' | 'address' | 'hours' | 'priceNote' | 'url' | 'ticketsUrl' | 'notes', v: string) => set(k, v.trim() ? v : null)
  const upcoming = d.kind === 'upcoming'
  const save = async () => {
    const cents = d.free ? 0 : d.price.trim() ? parsePrice(d.price) : null
    if (!d.title.trim()) { setError('Give it a name.'); return }
    if (cents === undefined) { setError('Check the cost: a number like 15 or 12.50.'); return }
    if (upcoming && d.run && (!d.startsOn || !d.endsOn)) { setError('A run needs its first and last day.'); return }
    const { price: _p, free: _f, run: _r, sale, ...rest } = d
    const body: OutingInput & { title: string } = {
      ...rest, title: d.title.trim(), priceCents: cents,
      ...(upcoming ? { endsOn: d.run ? d.endsOn : null, ticketsOnSaleAt: sale ? new Date(sale).toISOString() : null } : { startsOn: null, endsOn: null, startTime: null, endTime: null, buyBy: null, ticketsOnSaleAt: null }),
      ...(!d.audience?.includes('kids') && { ageMin: null, ageMax: null }),
    }
    setBusy(true); setError('')
    try {
      const saved = outing ? await api.updateOuting(outing.id, body) : await api.createOuting(body)
      changed(); toast(`Saved: ${saved.title}`); onSaved(saved)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.') } finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  const field = (k: 'placeName' | 'address' | 'hours' | 'priceNote' | 'url' | 'ticketsUrl', label: string, extra: Record<string, string> = {}) =>
    <div className="field"><label htmlFor={`${id}-${k}`}>{label}</label><input id={`${id}-${k}`} type={k.endsWith('rl') ? 'url' : 'text'} maxLength={k.endsWith('rl') ? 2000 : 200} {...extra} value={d[k] ?? ''} onChange={e => text(k, e.target.value)} /></div>
  const aud = (a: OutingAudience, label: string) => <label className="meal-check"><input type="checkbox" checked={!!d.audience?.includes(a)} onChange={e => set('audience', e.target.checked ? [...(d.audience ?? []), a] : (d.audience ?? []).filter(x => x !== a))} /> {label}</label>
  return <Sheet title={outing ? `Edit ${outing.title}` : upcoming ? 'Add an outing' : 'Add a place'} onClose={close} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${id}-kind`}>What is it?</label><select id={`${id}-kind`} value={d.kind} onChange={e => set('kind', e.target.value as Outing['kind'])}><option value="upcoming">Something happening</option><option value="place">A place to visit any time</option></select></div>
        <div className="field"><label htmlFor={`${id}-title`}>Name</label><input id={`${id}-title`} type="text" required maxLength={200} placeholder={upcoming ? 'Fall fest, kids’ sewing class…' : 'Nature preserve, the beach…'} value={d.title} onChange={e => set('title', e.target.value)} /></div>
        <LabeledPick label="Category" none="None" value={d.categoryId ? [d.categoryId] : []} onChange={v => set('categoryId', v[0] || null)} options={[{ value: '', label: 'None' }, ...categories.map(c => ({ value: c.id, label: c.name, lead: <span aria-hidden="true">{c.emoji}</span> }))]} />
        {upcoming && <>
          <h3>When</h3>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${id}-start`}>{d.run ? 'First day' : 'Day'}</label><input id={`${id}-start`} type="date" value={d.startsOn ?? ''} onChange={e => set('startsOn', e.target.value || null)} /></div>
            {d.run && <div className="field"><label htmlFor={`${id}-end`}>Last day</label><input id={`${id}-end`} type="date" min={d.startsOn ?? undefined} value={d.endsOn ?? ''} onChange={e => set('endsOn', e.target.value || null)} /></div>}
          </div>
          {!d.startsOn && <p className="field-hint">No day yet? Leave it empty: it shows as “Date not announced yet”.</p>}
          <label className="meal-check"><input type="checkbox" checked={d.run} onChange={e => set('run', e.target.checked)} /> Runs for a while (open on several days)</label>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${id}-t1`}>Starts</label><input id={`${id}-t1`} type="time" value={d.startTime ?? ''} onChange={e => set('startTime', e.target.value || null)} /></div>
            <div className="field"><label htmlFor={`${id}-t2`}>Ends</label><input id={`${id}-t2`} type="time" value={d.endTime ?? ''} onChange={e => set('endTime', e.target.value || null)} /></div>
          </div>
          {d.run && field('hours', 'Days and hours', { placeholder: 'Fri–Sun, 9 AM to 5 PM' })}
        </>}
        <h3>Where</h3>
        {field('placeName', 'Place', { placeholder: 'Town Green, the library…' })}
        {field('address', 'Address', { placeholder: 'For the Map button' })}
        <h3>Cost</h3>
        <label className="meal-check"><input type="checkbox" checked={d.free} onChange={e => set('free', e.target.checked)} /> Free</label>
        {!d.free && <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-price`}>From (per person)</label><input id={`${id}-price`} type="text" inputMode="decimal" maxLength={10} placeholder="15" value={d.price} onChange={e => set('price', e.target.value)} /></div>
          {field('priceNote', 'Price note', { placeholder: 'Kids under 5 free' })}
        </div>}
        <h3>Who it’s for</h3>
        {aud('family', 'The whole family')}{aud('kids', 'Kids')}{aud('grownups', 'Grown-ups')}
        {d.audience?.includes('kids') && <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-amin`}>Youngest age</label><input id={`${id}-amin`} type="number" min={0} max={120} inputMode="numeric" value={d.ageMin ?? ''} onChange={e => set('ageMin', e.target.value === '' ? null : Number(e.target.value))} /></div>
          <div className="field"><label htmlFor={`${id}-amax`}>Oldest age</label><input id={`${id}-amax`} type="number" min={0} max={120} inputMode="numeric" value={d.ageMax ?? ''} onChange={e => set('ageMax', e.target.value === '' ? null : Number(e.target.value))} /></div>
        </div>}
        <LabeledPick label="Just for" multiple none="Nobody in particular" value={d.memberIds ?? []} onChange={v => set('memberIds', v)} options={members.map(m => ({ value: m.id, label: m.name, lead: <Face m={m} /> }))} />
        {upcoming && <>
          <h3>Tickets or sign-up</h3>
          {field('ticketsUrl', 'Ticket or sign-up page')}
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${id}-sale`}>Tickets go on sale</label><input id={`${id}-sale`} type="datetime-local" value={d.sale} onChange={e => set('sale', e.target.value)} /></div>
            <div className="field"><label htmlFor={`${id}-buy`}>Get tickets by</label><input id={`${id}-buy`} type="date" value={d.buyBy ?? ''} onChange={e => set('buyBy', e.target.value || null)} /></div>
          </div>
        </>}
        {!upcoming && <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-visit`}>Been there?</label><select id={`${id}-visit`} value={d.visitStatus ?? ''} onChange={e => set('visitStatus', (e.target.value || null) as Outing['visitStatus'])}><option value="want">Want to go</option><option value="been">Been there</option><option value="">Not sure</option></select></div>
          {d.visitStatus === 'been' && <div className="field"><label htmlFor={`${id}-last`}>Last visit</label><input id={`${id}-last`} type="date" value={d.lastVisitedOn ?? ''} onChange={e => set('lastVisitedOn', e.target.value || null)} /></div>}
        </div>}
        <h3>Details</h3>
        {field('url', 'Info page')}
        <div className="field"><label htmlFor={`${id}-notes`}>Notes</label><textarea id={`${id}-notes`} maxLength={10000} placeholder="What to bring, parking, bring cash…" value={d.notes ?? ''} onChange={e => text('notes', e.target.value)} /></div>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}

/** Add to our calendar: the day (a run or an undated outing asks which), the time, the calendar and who's going. */
function OutingCalendarSheet({ outing: o, onClose, onSaved }: { outing: Outing; onClose: () => void; onSaved: (o: Outing) => void }) {
  const { members, toast } = useApp()
  const who = useWho()
  const id = useId()
  const [calendars, setCalendars] = useState<CalendarEntry[] | null>(null)
  const [calendarId, setCalendarId] = useState('')
  const [date, setDate] = useState(o.endsOn ? (o.startsOn && o.startsOn > who.today ? o.startsOn : who.today) : o.startsOn ?? '')
  const [allDay, setAllDay] = useState(!o.startTime)
  const [start, setStart] = useState(o.startTime ?? '10:00')
  const [end, setEnd] = useState(o.endTime ?? '')
  const [going, setGoing] = useState(() => [...new Set([...o.interest.filter(i => i.level === 'really').map(i => i.memberId), ...o.memberIds])])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let canceled = false
    api.getCalendars().then(cals => {
      if (canceled) return
      const writable = cals.filter(c => c.writable && c.enabled && c.canEditEvents !== false)
      setCalendars(writable); setCalendarId((writable.find(c => c.default) ?? writable[0])?.id ?? '')
    }).catch(e => { if (!canceled) setError(e instanceof Error ? e.message : 'Could not load calendars.') })
    return () => { canceled = true }
  }, [])
  const save = async () => {
    if (!date) { setError('Pick a day.'); return }
    setBusy(true); setError('')
    try {
      const saved = await api.addOutingToCalendar(o.id, { date, startTime: allDay ? null : start, endTime: allDay || !end ? null : end, ...(calendarId ? { calendarId } : {}), memberIds: going })
      toast(`On the calendar: ${saved.title}`); onSaved(saved)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it to the calendar.') } finally { setBusy(false) }
  }
  return <Sheet title="Add to our calendar" onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    <button className="btn btn-primary" disabled={busy || !calendars} onClick={() => void save()}>{busy ? 'Adding…' : 'Add to calendar'}</button>
  </>}>
    <p>{o.title}{o.placeName ? ` · ${o.placeName}` : ''}</p>
    <fieldset className="meal-fieldset" disabled={busy}>
      <div className="field"><label htmlFor={`${id}-day`}>{o.endsOn ? 'Which day are you going?' : 'Day'}</label><input id={`${id}-day`} type="date" min={o.startsOn ?? undefined} max={o.endsOn ?? o.startsOn ?? undefined} value={date} onChange={e => setDate(e.target.value)} /></div>
      <label className="meal-check"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> All day</label>
      {!allDay && <div className="meal-form-row">
        <div className="field"><label htmlFor={`${id}-t1`}>Starts</label><input id={`${id}-t1`} type="time" value={start} onChange={e => setStart(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-t2`}>Ends</label><input id={`${id}-t2`} type="time" value={end} onChange={e => setEnd(e.target.value)} /></div>
      </div>}
      {calendars && calendars.length > 1 && <div className="field"><label htmlFor={`${id}-cal`}>Calendar</label><select id={`${id}-cal`} value={calendarId} onChange={e => setCalendarId(e.target.value)}>{calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
      <LabeledPick label="Who’s going" multiple none="Everyone" value={going} onChange={setGoing} options={members.map(m => ({ value: m.id, label: m.name, lead: <Face m={m} /> }))} />
      <p className="field-hint">It goes on the calendar as a normal event in the 🎟 Outing category, with the place, notes and links. Change it there any time.</p>
    </fieldset>
    {!calendars && !error && <p role="status">Loading calendars…</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </Sheet>
}

/** Parents rename, reorder, add and delete outing categories. */
function CategoriesSheet({ categories, onClose }: { categories: OutingCategory[]; onClose: () => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const [rows, setRows] = useState(() => categories.map(c => ({ ...c, key: c.id, isNew: false })))
  const [busy, setBusy] = useState(false)
  const set = (key: string, patch: Partial<(typeof rows)[number]>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  const move = (i: number, by: number) => setRows(rs => { const next = [...rs]; const [r] = next.splice(i, 1); next.splice(i + by, 0, r); return next })
  const save = async () => {
    const gone = categories.filter(c => !rows.some(r => r.id === c.id))
    if (rows.some(r => !r.name.trim())) { toast('Give each category a name.', true); return }
    if (gone.length && !await dialog.confirm({ title: `Delete ${gone.map(c => c.name).join(', ')}?`, body: 'Their outings stay, with no category.', confirmLabel: 'Delete', danger: true })) return
    setBusy(true)
    try {
      for (const c of gone) await api.deleteOutingCategory(c.id)
      for (const [sort, r] of rows.entries()) {
        const was = categories.find(c => c.id === r.id)
        if (r.isNew) await api.createOutingCategory({ name: r.name.trim(), emoji: r.emoji || null }).then(c => api.updateOutingCategory(c.id, { sort }))
        else if (!was || was.name !== r.name || was.emoji !== r.emoji || was.sort !== sort) await api.updateOutingCategory(r.id, { name: r.name.trim(), emoji: r.emoji || null, sort })
      }
      changed(); toast('Categories saved'); onClose()
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save the categories.', true) } finally { setBusy(false) }
  }
  return <Sheet title="Outing categories" onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
  </>}>
    <ul className="outing-cats">{rows.map((r, i) => <li key={r.key}>
      <input aria-label={`Emoji for ${r.name || 'new category'}`} className="outing-cat-emoji" maxLength={8} value={r.emoji ?? ''} onChange={e => set(r.key, { emoji: e.target.value })} />
      <input aria-label="Category name" maxLength={60} value={r.name} onChange={e => set(r.key, { name: e.target.value })} />
      <button type="button" className="icon-btn" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
      <button type="button" className="icon-btn" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
      <button type="button" className="icon-btn" aria-label={`Delete ${r.name}`} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>✕</button>
    </li>)}</ul>
    <button type="button" className="btn btn-secondary" onClick={() => setRows(rs => [...rs, { id: '', key: crypto.randomUUID(), name: '', emoji: '', sort: rs.length, isNew: true }])}><PlusIcon /> Add a category</button>
  </Sheet>
}

/** Home's Outings button (Board view, beside Polls): opens the tray. */
export function OutingsButton() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="btn btn-secondary polls-btn outings-btn" aria-haspopup="dialog" aria-label="Outings" onClick={() => setOpen(true)}><span aria-hidden="true">🎟</span><span className="polls-btn-label outings-btn-label"> Outings</span></button>
    {open && <OutingsTray onClose={() => setOpen(false)} />}
  </>
}

/** The Board's Outings tray: this weekend and coming up, a tap opens an outing (marking interest
 * asks who first on a wall), See all goes to the tab. */
export function OutingsTray({ onClose, extra }: { onClose: () => void; extra?: ReactNode }) {
  const who = useWho()
  const { outings, categories, loaded } = useOutings()
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const { weekend, coming } = trayRows(outings, who.today, who.kidId)
  const row = (o: Outing, note?: string | null) => <div key={o.id + (note ?? '')}>
    <OutingRow o={o} categories={categories} today={who.today} compact onOpen={x => setOpen(x.id)} />
    {note && <p className="outing-tray-note">🎟 {note}</p>}
  </div>
  return <Sheet title="🎟 Outings" onClose={onClose} actions={<>
    <a className="btn btn-secondary" href="#/outings" onClick={onClose}>See all outings</a>
    {who.canAdd && <button className="btn btn-primary" onClick={() => setAdding(true)}><PlusIcon /> Add</button>}
  </>}>
    {!loaded ? <p role="status">Loading outings…</p> : <div className="outing-tray">
      <section aria-labelledby="tray-weekend"><h3 id="tray-weekend">This weekend</h3>
        {weekend.length ? weekend.map(o => row(o)) : <p className="state-card">Nothing saved for this weekend yet.</p>}</section>
      <section aria-labelledby="tray-coming"><h3 id="tray-coming">Coming up</h3>
        {coming.length ? coming.map(c => row(c.outing, c.note)) : <p className="state-card">Mark something ⭐ and it shows here, along with ticket dates.</p>}</section>
      {extra}
    </div>}
    {open && <OutingSheet id={open} onClose={() => setOpen(null)} />}
    {adding && <OutingEditSheet outing={null} kind="upcoming" categories={categories} onClose={() => setAdding(false)} onSaved={o => { setAdding(false); setOpen(o.id) }} />}
  </Sheet>
}

/** On an event made from an outing: where it came from, with a link back. */
export function EventOuting({ eventId }: { eventId: string }) {
  const [o, setO] = useState<Outing | null>(null)
  useEffect(() => {
    let canceled = false
    api.getEventOuting(eventId).then(r => { if (!canceled) setO(r.outing) }).catch(() => {})
    return () => { canceled = true }
  }, [eventId])
  if (!o) return null
  const price = priceLabel(o)
  return <section className="event-outing" aria-label="From Outings">
    <a className="sheet-link" href={`#/outings?outing=${encodeURIComponent(o.id)}`}><span aria-hidden="true">🎟</span>
      <span>From Outings: {o.title}<small>{[price && (price === 'Free' ? 'Free' : `From ${price}`), o.gotTickets && '✓ We have tickets', o.ticketsUrl && 'Ticket page inside'].filter(Boolean).join(' · ') || 'Open it in Outings'}</small></span><ChevronRight /></a>
    {o.ticketsUrl && <a className="btn btn-secondary" href={o.ticketsUrl} target="_blank" rel="noopener noreferrer"><LinkIcon /> Ticket page</a>}
  </section>
}

