// Trips (docs/using/trips.md; server: routes/trips.ts): plans for going somewhere together, from
// "someday" to the drive home. The tab lists Ideas, Upcoming and Past. A trip opens on one overview
// page (what's next, what needs a decision, then a row for each part); each row opens that part on
// its own page: places to stay (TripStays.tsx), getting there and the day plan (TripPlan.tsx),
// lists, the calendar and who sees booking details.
//
// Who does what: a grown-up's (parent's) device everything; kids see every family trip's plans,
// suggest things to do and vote on stays for trips they're going on; a wall reads and votes after
// "Who?". Booking details (rental addresses, codes, confirmation numbers) come only from the server,
// only to devices this trip allows; nothing here hides them on its own, and nothing is kept offline.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { api, getKey } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { LoadError, Segmented } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import PickField from './PickField.tsx'
import { Face } from './Face'
import { ChevronRight, PlusIcon } from './icons.tsx'
import { formatTime } from './timeFormat.ts'
import { t, tn } from './i18n.ts'
import { hashQuery } from './hashQuery.ts'
import { daysBetween } from './upkeep-rules.ts'
import { careSummary, checkLine, clockLine, nextUp, toggledAt, tripFailed, tripFor, tripLoaded, tripToday, viewerCheck, type TripLoad } from './trips.ts'
import { CARE_EMOJI, dayPlan, legClock, LEG_EMOJI, STAY_EMOJI, tally, tripCountdown, tripDayLabel, tripPhase, tripSections, tripWhen } from './trips.ts'
import { Choose, errText, Faces, Labeled, tripsChanged, useActingAs, useTripsTick, useTripWho, ZoneField } from './tripShared.tsx'
import { StaysPage } from './TripStays.tsx'
import { StopsPage, stopsSummary } from './TripStops.tsx'
import { PlanPage, TravelPage } from './TripPlan.tsx'
import { CarePage } from './TripCare.tsx'
import { tripClock } from './travelContext.ts'
import { tzName } from './timezone.ts'
import type { CalendarEntry, List } from './types.ts'
import type { DateChangePreview, MarkKind, Trip, TripInput, TripStatus, TripSummary } from './trip-types.ts'
import './meals.css'
import './outings.css'
import './trips.css'

export type TripPart = 'stops' | 'stays' | 'travel' | 'plan' | 'care' | 'lists' | 'packing' | 'calendar' | 'details'
const PARTS: TripPart[] = ['stops', 'stays', 'travel', 'plan', 'care', 'lists', 'packing', 'calendar', 'details']

/** Where the address points: the list, a trip (#/trips?trip=<id>) or one of its parts (&part=stays). */
function readRoute(): { trip: string | null; part: TripPart | null } {
  if (!location.hash.startsWith('#/trips')) return { trip: null, part: null }
  const q = hashQuery(location.hash)
  const part = q.get('part') as TripPart | null
  return { trip: q.get('trip'), part: part && PARTS.includes(part) ? part : null }
}
/** Goes to the list, a trip or a part: a real address, so Back steps out again. */
export const tripHref = (trip?: string | null, part?: TripPart | null) =>
  trip ? `#/trips?${new URLSearchParams({ trip, ...(part && { part }) })}` : '#/trips'

export const STATUS: Record<TripStatus, { emoji: string; label: () => string }> = {
  idea: { emoji: '💭', label: () => t('Idea') },
  planning: { emoji: '🗺️', label: () => t('Planning') },
  ready: { emoji: '✅', label: () => t('Ready') },
}
/** The status chip's words: the family's own status, or Underway / Past from the dates. */
export function statusChip(x: TripSummary, today: string): string {
  if (x.canceledAt) return t('✕ Not this time')
  const phase = tripPhase(x, today)
  if (phase === 'underway') return t('🧳 Underway')
  if (phase === 'past') return t('📸 Past')
  return `${STATUS[x.status].emoji} ${STATUS[x.status].label()}`
}

export default function Trips() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const read = () => setRoute(readRoute())
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  return route.trip ? <TripPage key={route.trip} id={route.trip} part={route.part} /> : <TripList />
}

/** The trips, kept fresh: on a change, on the app's refresh, never while Trips is off. */
export function useTrips() {
  const { settings, refreshTick } = useApp()
  const on = !!settings.features.trips
  const [trips, setTrips] = useState<TripSummary[] | null>(null)
  const [error, setError] = useState('')
  const [tick, retry] = useTripsTick()
  useEffect(() => {
    if (!on) return
    let canceled = false
    api.getTrips(true).then(x => { if (!canceled) { setTrips(x); setError('') } }).catch(e => { if (!canceled) setError(errText(e, t('Could not load trips.'))) })
    return () => { canceled = true }
  }, [on, refreshTick, tick])
  return { trips: on ? trips ?? [] : [], loaded: !!trips, error, retry }
}

function TripList() {
  const who = useTripWho()
  const { members } = useApp()
  const { trips, loaded, error, retry } = useTrips()
  const [view, setView] = useState<'ideas' | 'upcoming' | 'past'>('upcoming')
  const [adding, setAdding] = useState(false)
  const s = tripSections(trips, who.today)
  const soon = s.upcoming.filter(x => { const p = tripPhase(x, tripToday(x, who.today)); return p === 'underway' || (p === 'soon' && daysBetween(who.today, x.startDate!) <= 30) })
  const later = s.upcoming.filter(x => !soon.includes(x))
  const groups: { key: string; title: string; trips: TripSummary[] }[] = view === 'ideas' ? [{ key: 'ideas', title: '', trips: s.ideas }]
    : view === 'past' ? [{ key: 'past', title: '', trips: s.past }]
    : [{ key: 'soon', title: t('Soon'), trips: soon }, { key: 'later', title: t('Later'), trips: later }].filter(g => g.trips.length)
  const empty = groups.every(g => !g.trips.length)
  return <div className="meals-view outings-view trips-view scroll-y">
    <div className="meals-heading"><div><h1>{t('Trips')}</h1><p className="field-hint">{t('Plan trips together, from “someday” to the drive home.')}</p></div>
      {who.parent && <div className="meal-actions"><button className="btn btn-primary" onClick={() => setAdding(true)}><PlusIcon /> {t('Add trip')}</button></div>}
    </div>
    <Segmented tabs idBase="trips-tab" label={t('Trips sections')} value={view} onChange={setView}
      options={[{ key: 'ideas', label: t('Ideas') }, { key: 'upcoming', label: t('Upcoming') }, { key: 'past', label: t('Past') }]} />
    <section role="tabpanel" aria-labelledby={`trips-tab-${view}`}>
      {error && <LoadError what="trips" error={error} onRetry={retry} />}
      {!loaded && !error ? <p role="status">{t('Loading trips…')}</p> : <>
        {empty && <div className="state-card trip-empty">
          <p><span aria-hidden="true">🧳 </span>{view === 'ideas' ? t('No trip ideas yet. Start with just a name, like “Beach week” or “Visit family”. Dates and places can wait.')
            : view === 'past' ? t('Trips you’ve been on show here.')
            : t('No trips planned yet. Ideas become plans when a grown-up sets them to Planning.')}</p>
          {who.parent && view !== 'past' && <button className="btn btn-primary trip-fit" onClick={() => setAdding(true)}><PlusIcon /> {t('Add a trip idea')}</button>}
        </div>}
        {groups.filter(g => g.trips.length).map(g => <section key={g.key} className="outing-section" aria-labelledby={g.title ? `trips-sec-${g.key}` : undefined}>
          {g.title && <h2 id={`trips-sec-${g.key}`}>{g.title}</h2>}
          <div className="outing-list">{g.trips.map(x => <TripRow key={x.id} x={x} today={who.today} members={members} />)}</div>
        </section>)}
        {view === 'ideas' && s.ideas.length > 0 && <p className="field-hint">{t('Mark the ideas you like with 👀 Interested or ⭐ Really want to go, so everyone can see what the family is excited about.')}</p>}
        {who.parent && s.closed.length > 0 && <details className="settings-disclosure trip-closed">
          <summary>{tn(s.closed.length, 'Put away ({n})', 'Put away ({n})')}</summary>
          <div className="outing-list">{s.closed.map(x => <TripRow key={x.id} x={x} today={who.today} members={members} />)}</div>
        </details>}
      </>}
      <p className="trip-away-link"><a className="btn btn-secondary trip-fit" href="#/away"><span aria-hidden="true">✈️</span> {t('Away days')}</a>
        <span className="field-hint">{t('Pause chores for people who are away, with or without a trip.')}</span></p>
    </section>
    {adding && <TripEditSheet trip={null} onClose={() => setAdding(false)} onSaved={x => { setAdding(false); location.hash = tripHref(x.id) }} />}
  </div>
}

function TripRow({ x, today: homeToday, members }: { x: TripSummary; today: string; members: ReturnType<typeof useApp>['members'] }) {
  const today = tripToday(x, homeToday)
  const meta = [tripWhen(x), tripCountdown(x, today) ?? tripDayLabel(x, today), x.location].filter(Boolean).join(' · ')
  const chips = [
    statusChip(x, today),
    x.counts.openVotes > 0 && t('🗳 Vote open'),
    x.counts.stayGroups > 1 && tn(x.counts.stayGroups, '{n} stop', '{n} stops'),
    x.counts.staysBooked > 0 && tn(x.counts.staysBooked, '✓ {n} stay set', '✓ {n} stays set'),
    x.counts.legsBooked > 0 && tn(x.counts.legsBooked, '✓ {n} leg booked', '✓ {n} legs booked'),
  ].filter(Boolean) as string[]
  return <a className="outing-row trip-row" href={tripHref(x.id)}>
    <span className="outing-emoji" aria-hidden="true">{x.emoji || '🧳'}</span>
    <span className="outing-row-main">
      <strong>{x.title}</strong>
      <span className="outing-row-meta">{meta}</span>
      <span className="outing-tags">{chips.map(c => <span key={c} className="chip chip-static">{c}</span>)}</span>
    </span>
    {x.status === 'idea' ? <MarkFaces marks={x.marks} members={members} /> : <Faces ids={x.memberIds} members={members} />}
    <ChevronRight />
  </a>
}

/** Who marked an idea, as faces with ⭐ / 👀 counts beside them. */
export function MarkFaces({ marks, members }: { marks: Trip['marks']; members: ReturnType<typeof useApp>['members'] }) {
  const who = marks.map(m => ({ m: members.find(x => x.id === m.memberId), kind: m.kind })).filter(x => x.m)
  if (!who.length) return null
  const stars = who.filter(x => x.kind === 'really').length, eyes = who.length - stars
  return <span className="outing-marks" role="img" aria-label={who.map(x => x.kind === 'really' ? t('{name} really wants to go', { name: x.m!.name }) : t('{name} is interested', { name: x.m!.name })).join(', ')}>
    <span className="outing-faces" aria-hidden="true">{who.slice(0, 4).map(x => <Face key={x.m!.id} m={x.m!} />)}</span>
    <span aria-hidden="true" className="outing-marks-n">{[stars && `⭐ ${stars}`, eyes && `👀 ${eyes}`].filter(Boolean).join(' ')}</span>
  </span>
}

/** One trip, read for this device, and a way to change it: each change answers with the whole trip
 * again. A stale revision (someone else changed it) reads it again and says so. */
export type TripApi = { trip: Trip; save: (work: (revision: number) => Promise<Trip>, done?: string | null) => Promise<boolean>; busy: boolean }

function useTrip(id: string) {
  const { refreshTick, toast } = useApp()
  const [load, setLoad] = useState<TripLoad<Trip> | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, retry] = useTripsTick()
  // Which sign-in this page is reading for. A read or save that answers after a switch (here, or in
  // another tab) was for the old sign-in and can hold care or booking details: it's dropped unseen,
  // with no toast, and the trip is read again as the new sign-in.
  const viewer = useRef(0)
  const viewerNow = () => `${viewer.current}|${getKey() ?? ''}`
  const forget = () => { viewer.current++; setLoad(null); retry() }
  useEffect(() => {
    let canceled = false
    const still = viewerCheck(viewerNow)
    api.getTrip(id).then(x => { if (canceled) return; if (!still()) forget(); else setLoad(tripLoaded(id, x)) })
      .catch(e => { if (canceled) return; if (!still()) forget(); else setLoad(prev => tripFailed(prev, id, e ?? true)) })
    return () => { canceled = true }
  }, [id, refreshTick, tick]) // eslint-disable-line react-hooks/exhaustive-deps -- viewerNow and forget read refs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'kinwall.apiKey') forget() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [retry]) // eslint-disable-line react-hooks/exhaustive-deps -- forget reads refs
  const { trip, error, stale } = tripFor(load, id)
  const save: TripApi['save'] = async (work, done) => {
    if (!trip) return false
    setBusy(true)
    const still = viewerCheck(viewerNow)
    try {
      const next = await work(trip.revision)
      if (!still()) { forget(); return false }
      setLoad(tripLoaded(id, next)); tripsChanged()
      if (done) toast(done)
      return true
    } catch (e) {
      if (!still()) { forget(); return false }
      toast(errText(e, t('Could not save.')), true)
      const status = (e as { status?: number }).status
      if (status === 409) retry()
      if (status === 403 || status === 404) setLoad(prev => tripFailed(prev, id, e))
      return false
    } finally { setBusy(false) }
  }
  return { trip, missing: error, stale, retry, save, busy }
}

function TripPage({ id, part }: { id: string; part: TripPart | null }) {
  const { trip, missing, stale, retry, save, busy } = useTrip(id)
  const who = useTripWho()
  if (missing && !trip) {
    const gone = (missing as { status?: number }).status === 404
    return <div className="meals-view outings-view trips-view scroll-y">
      <a className="link-btn trip-back" href={tripHref()}>‹ {t('Trips')}</a>
      {gone ? <p className="state-card">{t('This trip isn’t here anymore.')}</p> : <LoadError what="trip" error={missing} onRetry={retry} />}
    </div>
  }
  if (!trip) return <div className="meals-view outings-view trips-view scroll-y"><a className="link-btn trip-back" href={tripHref()}>‹ {t('Trips')}</a><p role="status">{t('Loading…')}</p></div>
  const api_: TripApi = { trip, save, busy }
  const can = trip.can ?? { edit: who.parent, addStays: who.parent, choose: who.parent, suggest: true, vote: who.parent || (!!who.kidId && trip.memberIds.includes(who.kidId)) }
  const staleNote = stale && <div className="state-card" role="alert">{t('Couldn’t refresh this trip. What’s shown may be out of date.')} <button className="btn btn-secondary trip-fit" onClick={retry}>{t('Try again')}</button></div>
  const back = part ? <a className="link-btn trip-back" href={tripHref(trip.id)}>‹ {trip.emoji ? `${trip.emoji} ` : ''}{trip.title}</a> : <a className="link-btn trip-back" href={tripHref()}>‹ {t('Trips')}</a>
  return <div className="meals-view outings-view trips-view trip-page scroll-y">
    {back}
    {staleNote}
    {part === 'stops' ? <StopsPage t_={api_} canEdit={can.edit} />
      : part === 'stays' ? <StaysPage t_={api_} can={can} />
      : part === 'travel' ? <TravelPage t_={api_} can={can} />
      : part === 'plan' ? <PlanPage t_={api_} can={can} />
      : part === 'care' ? <CarePage t_={api_} />
      : (part === 'lists' || part === 'packing') ? <TripListsPage t_={api_} canEdit={can.edit} />
      : part === 'calendar' && can.edit ? <CalendarPage t_={api_} />
      : part === 'details' && can.edit ? <DetailsPage t_={api_} />
      : <Overview t_={api_} canEdit={can.edit} />}
  </div>
}

/** The trip's overview: header and status, today on the trip (while it's under way), what's next,
 * what needs a decision, then one row per part. */
function Overview({ t_: { trip, save, busy }, canEdit }: { t_: TripApi; canEdit: boolean }) {
  const who = useTripWho()
  const { members, settings } = useApp()
  const dialog = useDialog()
  const [editing, setEditing] = useState(false)
  const [clockEdit, setClockEdit] = useState(false)
  const now = useMinute()
  // Today on the trip: the clock where the family is (a stop's or a leg's zone), else home's. Away
  // days and care keep home dates.
  const clock = tripClock(trip, now, who.tz)
  const phase = tripPhase(trip, clock.today)
  const plan = dayPlan(trip)
  const going = trip.memberIds.length === members.length && members.length > 1 ? t('Everyone going') : trip.memberIds.length ? tn(trip.memberIds.length, '{n} going', '{n} going') : t('Nobody picked yet')
  const more = async (action: string) => {
    if (action === 'cancel') void save(rev => api.updateTrip(trip.id, { revision: rev, ...toggledAt('canceledAt', trip.canceledAt) }), trip.canceledAt ? t('Back on: {title}', { title: trip.title }) : t('Not this time: {title}', { title: trip.title }))
    if (action === 'archive') void save(rev => api.updateTrip(trip.id, { revision: rev, ...toggledAt('archivedAt', trip.archivedAt) }), trip.archivedAt ? t('Back on the list: {title}', { title: trip.title }) : t('Put away: {title}', { title: trip.title }))
    if (action === 'delete' && await dialog.confirm({ title: t('Delete “{title}”?', { title: trip.title }), body: t('Its places to stay, legs and plan go. Calendar events, meals, outings and away days made from it stay.'), confirmLabel: t('Delete trip'), danger: true })) {
      try { await api.deleteTrip(trip.id, trip.revision); tripsChanged(); location.hash = tripHref() } catch (e) { void dialog.confirm({ title: errText(e, t('Could not delete.')), confirmLabel: t('OK') }) }
    }
  }
  const decisions: { key: string; emoji: string; title: string; sub: string; href: string; action: string }[] = []
  for (const g of trip.stayGroups) {
    const n = tally(g)
    if (g.poll?.status === 'open' && n) {
      const lead = n.leaders.length === 1 ? g.options.find(o => o.id === n.leaders[0])?.name : null
      decisions.push({ key: `vote-${g.id}`, emoji: '🗳', title: t('Where to stay in {place}', { place: g.label }), sub: [t('{voted} of {of} voted', { voted: n.voted, of: n.of }), lead ? t('{name} is in the lead', { name: lead }) : n.tie ? t('It’s a tie so far') : null].filter(Boolean).join(' · '), href: tripHref(trip.id, 'stays'), action: t('Vote') })
    } else if (canEdit && !g.chosenOptionId && g.options.length > 0) {
      decisions.push({ key: `pick-${g.id}`, emoji: '🏠', title: t('Choose where to stay in {place}', { place: g.label }), sub: tn(g.options.length, '{n} place to compare', '{n} places to compare'), href: tripHref(trip.id, 'stays'), action: t('Open') })
    }
  }
  if (canEdit) for (const l of trip.legs) if (l.booking === 'none' && ['flight', 'train', 'bus', 'ferry', 'rental'].includes(l.mode)) {
    decisions.push({ key: `leg-${l.id}`, emoji: LEG_EMOJI[l.mode], title: t('{leg} isn’t booked yet', { leg: l.title || [l.from, l.to].filter(Boolean).join(' → ') || t('A leg') }), sub: l.departDate ? tripWhen({ startDate: l.departDate, endDate: null, dateNote: null }) : t('No date yet'), href: tripHref(trip.id, 'travel'), action: t('Open') })
  }
  if (trip.canEditCare && phase !== 'past') for (const c of trip.care ?? []) if (c.status === 'needed') {
    decisions.push({ key: `care-${c.id}`, emoji: CARE_EMOJI[c.kind], title: t('{name}: still needs someone', { name: c.title }), sub: t('Home and pet care'), href: tripHref(trip.id, 'care'), action: t('Open') })
  }
  if (canEdit && trip.startDate && trip.memberIds.length && !trip.awayPeriodIds.length && phase !== 'past') {
    decisions.push({ key: 'away', emoji: '🏠', title: t('While we’re away'), sub: t('Away days aren’t set up. Chores would still be due.'), href: `#/away?trip=${encodeURIComponent(trip.id)}`, action: t('Set up') })
  }
  const next = phase !== 'past' ? nextUp(plan.days.flatMap(d => d.entries), now, clock) : null
  const checks = trip.status !== 'idea' && trip.startDate && !trip.canceledAt ? trip.checks ?? null : null
  const stays = trip.stayGroups.map(g => {
    const chosen = g.options.find(o => o.id === g.chosenOptionId)
    const state = chosen?.booking === 'booked' ? t('✓ Booked') : chosen?.booking === 'confirmed_family' ? t('🏡 Confirmed with family') : chosen ? t('★ Chosen') : g.poll?.status === 'open' ? t('voting') : g.options.length ? tn(g.options.length, '{n} idea', '{n} ideas') : t('nothing yet')
    return `${g.label} ${state}`
  })
  const onCal = (trip.calendar.span ? 1 : 0) + trip.calendar.items.filter(i => i.link.state === 'added').length
  const rows: { part: TripPart | 'away'; emoji: string; title: string; sub: string; href: string }[] = [
    ...(canEdit || trip.stops.length ? [{ part: 'stops' as const, emoji: '📍', title: t('Stops'), sub: stopsSummary(trip) ? `${tn(trip.stops.length, '{n} stop', '{n} stops')} · ${stopsSummary(trip)}` : t('One place, or add stops for a road trip'), href: tripHref(trip.id, 'stops') }] : []),
    { part: 'stays', emoji: '🏠', title: t('Places to stay'), sub: stays.length ? [trip.stayGroups.length > 1 ? tn(trip.stayGroups.length, '{n} stop', '{n} stops') : null, ...stays].filter(Boolean).join(' · ') : t('None yet'), href: tripHref(trip.id, 'stays') },
    { part: 'travel', emoji: '🧭', title: t('Getting there'), sub: trip.legs.length ? [tn(trip.legs.length, '{n} leg', '{n} legs'), t('{n} booked', { n: trip.counts.legsBooked }), t('times in each place’s own time zone')].join(' · ') : t('No legs yet'), href: tripHref(trip.id, 'travel') },
    { part: 'plan', emoji: '🗓️', title: t('Day plan'), sub: [plan.days.length ? tn(plan.days.length, '{n} day', '{n} days') : t('No dates yet'), tn(trip.counts.planned, '{n} thing planned', '{n} things planned'), tn(trip.counts.ideas, '{n} idea to sort', '{n} ideas to sort')].join(' · '), href: tripHref(trip.id, 'plan') },
    ...(trip.canSeeCare ? [{ part: 'care' as const, emoji: '🐾', title: t('Home and pet care'), sub: `🔒 ${careSummary(trip.care ?? [], !!trip.careUnavailable)}`, href: tripHref(trip.id, 'care') }] : []),
    { part: 'lists', emoji: '📋', title: t('Lists'), sub: trip.packingListIds.length ? tn(trip.packingListIds.length, '{n} linked list', '{n} linked lists') : t('Packing, groceries and things to do'), href: tripHref(trip.id, 'lists') },
    ...(canEdit ? [
      { part: 'calendar' as const, emoji: '📅', title: t('On our calendar'), sub: onCal ? tn(onCal, '{n} event added', '{n} events added') : t('Not added yet · you choose what goes on'), href: tripHref(trip.id, 'calendar') },
      { part: 'details' as const, emoji: '🔒', title: t('Booking details'), sub: [trip.detailsAudience === 'everyone' ? t('Everyone in the family') : t('Grown-ups only'), trip.detailsOnWall ? t('on the wall') : t('not on the wall')].join(' · '), href: tripHref(trip.id, 'details') },
      { part: 'away' as const, emoji: '✈️', title: t('Away days'), sub: trip.awayPeriodIds.length ? tn(trip.awayPeriodIds.length, '{n} set up', '{n} set up') : t('Not set up'), href: trip.awayPeriodIds.length === 1 ? `#/away?period=${encodeURIComponent(trip.awayPeriodIds[0])}` : `#/away?trip=${encodeURIComponent(trip.id)}` },
    ] : []),
  ]
  // Tonight: a chosen place (not a canceled one) whose nights cover today, else a stay still to choose.
  const covering = phase === 'underway' ? trip.stayGroups.filter(g => g.checkIn && g.checkOut && g.checkIn <= clock.today && clock.today < g.checkOut) : []
  const chosenIn = (g: Trip['stayGroups'][number]) => g.options.find(o => o.id === g.chosenOptionId && o.booking !== 'canceled')
  const tonight = covering.find(chosenIn) ?? covering.find(g => !g.chosenOptionId) ?? null
  const tonightOption = tonight ? chosenIn(tonight) : undefined
  const today = phase === 'underway' ? plan.days.find(d => d.date === clock.today)?.entries ?? [] : []
  return <>
    <header className="trip-head">
      <div className="trip-head-main">
        <h1><span aria-hidden="true">{trip.emoji || '🧳'} </span>{trip.title}</h1>
        <p className="trip-head-meta">
          <span className="chip chip-static">📅 {tripWhen(trip)}</span>
          {trip.location && <span className="chip chip-static">📍 {trip.location}</span>}
          <span className="chip chip-static trip-going"><Faces ids={trip.memberIds} members={members} /> {going}</span>
          <span className="chip chip-static">{statusChip(trip, who.today)}</span>
        </p>
      </div>
      {canEdit && <button type="button" className="btn btn-secondary" aria-haspopup="dialog" disabled={busy} onClick={() => setEditing(true)}>{t('Edit trip')}</button>}
    </header>
    {trip.description && <p className="meal-prose trip-about">{trip.description}</p>}

    {/* Wide screens: today on the left, what needs a look on the right. */}
    <div className="trip-overview">
      <div className="trip-col">
        {phase === 'underway' && <section className="trip-card trip-today" aria-labelledby="trip-today-h">
          <h2 id="trip-today-h">{t('Today on the trip')} <small>· {tripDayLabel(trip, clock.today)}</small></h2>
          <p className="trip-clock"><span><span aria-hidden="true">🕒 </span>{clockLine(clock, trip, new Date(now), who.tz)}</span>
            {canEdit && <button type="button" className="btn btn-secondary trip-fit" onClick={() => setClockEdit(true)}>{t('Change')}</button>}</p>
          {today.length ? <ul className="trip-plan-list">{today.map(e => <PlanLine key={`${e.kind}-${e.id}`} e={e} />)}</ul> : <p className="field-hint">{t('Nothing planned for today. Enjoy it.')}</p>}
          {tonight && <div className="trip-tonight">
            <h3>{t('Tonight')}</h3>
            <p><span aria-hidden="true">{tonightOption ? STAY_EMOJI[tonightOption.kind] : '🏠'} </span><strong>{tonightOption?.name ?? t('{place} stay · not chosen yet', { place: tonight.label })}</strong>{tonightOption?.town && ` · ${tonightOption.town}`}</p>
            {tonightOption?.details?.address && <p className="trip-detail-line">🔒 {tonightOption.details.address}</p>}
            {tonightOption?.hasDetails && !tonightOption.details && <p className="field-hint">{t('🔒 Booking details are for grown-ups.')}</p>}
          </div>}
          {next && next.date !== clock.today && <div className="trip-tonight">
            <h3>{t('Next up')}</h3>
            <ul className="trip-plan-list"><PlanLine e={next} withDate /></ul>
          </div>}
        </section>}

        {next && phase !== 'underway' && <section className="trip-card trip-next" aria-labelledby="trip-next-h">
          <h2 id="trip-next-h">{t('Next up')} <small>· {tripCountdown({ startDate: next.date }, clock.today) ?? ''}</small></h2>
          <ul className="trip-plan-list"><PlanLine e={next} withDate /></ul>
        </section>}
      </div>
      <div className="trip-col">
        {decisions.length > 0 && <section className="trip-card" aria-labelledby="trip-decide-h">
          <h2 id="trip-decide-h">{t('Needs a decision')} <span className="trip-count">{decisions.length}</span></h2>
          <ul className="trip-decisions">{decisions.map(d => <li key={d.key}>
            <span className="trip-decision-emoji" aria-hidden="true">{d.emoji}</span>
            <span className="trip-decision-main"><strong>{d.title}</strong><span>{d.sub}</span></span>
            <a className="btn btn-secondary trip-fit" href={d.href} aria-label={`${d.action}: ${d.title}`}>{d.action}</a>
          </li>)}</ul>
        </section>}

        {checks && <section className="trip-card" aria-labelledby="trip-checks-h">
          <h2 id="trip-checks-h">{t('Worth a look')} {checks.length > 0 && <span className="trip-count">{checks.length}</span>}</h2>
          {checks.length ? <>
            <p className="field-hint">{t('Things in the plan that may not line up. Many are fine on purpose; nothing changes unless you change it.')}</p>
            <ul className="trip-decisions trip-checks">{checks.map((c, i) => { const line = checkLine(c, trip); return <li key={`${c.code}-${i}`}>
              <span className="trip-decision-emoji" aria-hidden="true">{line.emoji}</span>
              <span className="trip-decision-main"><strong>{line.title}</strong><span>{line.sub}</span></span>
              <a className="btn btn-secondary trip-fit" href={tripHref(trip.id, c.part)} aria-label={`${t('Look')}: ${line.title}`}>{t('Look')}</a>
            </li> })}</ul>
          </> : <p className="field-hint">{t('Nothing to look at in what’s been added so far.')}</p>}
        </section>}
      </div>
    </div>

    <nav className="trip-parts" aria-label={t('Parts of this trip')}>
      {rows.map(r => <a key={r.part} className="outing-row trip-part-row" href={r.href}>
        <span className="outing-emoji" aria-hidden="true">{r.emoji}</span>
        <span className="outing-row-main"><strong>{r.title}</strong><span className="outing-row-meta">{r.sub}</span></span>
        <ChevronRight />
      </a>)}
    </nav>
    {!trip.canSeeDetails && <p className="field-hint trip-note">{t('You can see this trip’s plans. Booking details are for grown-ups unless they share them.')}</p>}
    {trip.status === 'idea' && <TripMarks trip={trip} save={save} />}
    {canEdit && <div className="sheet-danger-zone">
      <button type="button" className="link-btn" disabled={busy} onClick={() => void more('cancel')}>{trip.canceledAt ? t('Bring it back') : t('Not this time')}</button>
      <button type="button" className="link-btn" disabled={busy} onClick={() => void more('archive')}>{trip.archivedAt ? t('Put it back on the list') : t('Put away')}</button>
      <button type="button" className="link-btn link-danger" disabled={busy} onClick={() => void more('delete')}>{t('Delete trip…')}</button>
    </div>}
    {editing && <TripEditSheet trip={trip} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} save={save} tz={settings.timezone ?? undefined} />}
    {clockEdit && <ClockSheet trip={trip} save={save} onClose={() => setClockEdit(false)} />}
  </>
}

/** The time now, each minute (and on coming back to the tab), so today on a trip turns over at
 * midnight there and across a daylight-saving change without a reload. */
function useMinute() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 30_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [])
  return now
}

/** Which clock today on the trip follows: a grown-up's pick when the plan can't tell, or back to
 * working it out from the stops and legs. Only the view: no date or time in the plan moves. */
function ClockSheet({ trip, save, onClose }: { trip: Trip; save: TripApi['save']; onClose: () => void }) {
  const [zone, setZone] = useState<string | null>(trip.viewTimeZone ?? null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const ok = await save(rev => api.updateTrip(trip.id, { revision: rev, viewTimeZone: zone }), zone ? t('Today follows {zone} time', { zone: tzName(zone) }) : t('Today follows the plan’s time zones'))
    setBusy(false)
    if (ok) onClose()
  }
  return <Sheet title={t('Today on the trip')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} variant="dialog" actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <Labeled label={t('Follow the time in')}>{id => <ZoneField id={id} label={t('Follow the time in')} value={zone} onChange={setZone} />}</Labeled>
    <p className="field-hint">{t('Not sure: Kinwall follows the stops’ and legs’ time zones, and home time when it can’t tell. This changes only what Today shows, never a date or time in the plan.')}</p>
  </Sheet>
}

/** 👀 / ⭐ on a trip idea, for whoever's using this device. */
function TripMarks({ trip, save }: { trip: Trip; save: TripApi['save'] }) {
  const { members } = useApp()
  const acting = useActingAs()
  const mine = acting.who ? trip.marks.find(m => m.memberId === acting.who)?.kind ?? null : null
  const mark = (kind: MarkKind) => {
    if (!acting.who) return
    const next = mine === kind ? null : kind
    const name = acting.name(acting.who)
    void save(() => api.markTrip(trip.id, acting.who!, next), next === 'really' ? t('{name} really wants to go', { name }) : next ? t('{name} is interested', { name }) : t('Cleared {name}’s mark', { name }))
    acting.done()
  }
  return <section className="outing-interest trip-marks" aria-label={t('Who wants to go')}>
    {acting.picker('mark')}
    <div className="outing-interest-btns">
      <button type="button" className="btn btn-secondary outing-level" aria-pressed={mine === 'interested'} disabled={!acting.who} onClick={() => mark('interested')}><span aria-hidden="true">👀</span> {t('Interested')}</button>
      <button type="button" className="btn btn-secondary outing-level" aria-pressed={mine === 'really'} disabled={!acting.who} onClick={() => mark('really')}><span aria-hidden="true">⭐</span> {t('Really want to go')}</button>
    </div>
    {trip.marks.length > 0 && <ul className="outing-marked">{trip.marks.map(m => { const p = members.find(x => x.id === m.memberId); return p && <li key={m.memberId}><Face m={p} /> {m.kind === 'really' ? t('{name} ⭐ really wants to go', { name: p.name }) : t('{name} 👀 is interested', { name: p.name })}</li> })}</ul>}
  </section>
}

/** One line of a day: the time (in that place's zone for a leg), what it is and where it came from. */
export function PlanLine({ e, withDate = false }: { e: ReturnType<typeof dayPlan>['days'][number]['entries'][number]; withDate?: boolean }) {
  const when = (time: string | null) => time ?? ''
  const day = withDate ? tripWhen({ startDate: e.date, endDate: null, dateNote: null }) : null
  if (e.kind === 'leg') {
    const c = legClock(e.leg)
    return <li className="trip-plan-line"><span className="trip-plan-time">{when(c.depart)}</span>
      <span aria-hidden="true" className="trip-plan-emoji">{LEG_EMOJI[e.leg.mode]}</span>
      <span className="trip-plan-main"><strong>{e.leg.title || [e.leg.from, e.leg.to].filter(Boolean).join(' → ')}</strong>
        <span>{[day, c.arrive && (c.plusDays ? t('arrives {time} (+{n})', { time: c.arrive, n: c.plusDays }) : t('arrives {time}', { time: c.arrive })), t('From Getting there')].filter(Boolean).join(' · ')}</span></span></li>
  }
  if (e.kind === 'checkin' || e.kind === 'checkout') {
    const name = e.option?.name ?? t('{place} stay · not chosen yet', { place: e.group.label })
    return <li className="trip-plan-line"><span className="trip-plan-time">{when(null)}</span>
      <span aria-hidden="true" className="trip-plan-emoji">{e.kind === 'checkin' ? '🔑' : '👋'}</span>
      <span className="trip-plan-main"><strong>{e.kind === 'checkin' ? t('Arrive: {name}', { name }) : t('Leave: {name}', { name })}</strong><span>{[day, t('From Places to stay')].filter(Boolean).join(' · ')}</span></span></li>
  }
  if (e.kind !== 'item') return null
  const it = e.item
  const source = it.kind === 'outing' ? t('From Outings') : it.kind === 'meal' ? t('From Meals') : it.kind === 'event' ? t('From the calendar') : t('Trip activity')
  return <li className="trip-plan-line"><span className="trip-plan-time">{when(e.time ? formatTime(e.time) : null)}</span>
    <span aria-hidden="true" className="trip-plan-emoji">{it.kind === 'outing' ? '🎟' : it.kind === 'meal' ? '🍽️' : it.kind === 'event' ? '📅' : '⭐'}</span>
    <span className="trip-plan-main"><strong>{it.kind === 'activity' ? it.title : it.label}</strong><span>{[day, it.kind !== 'activity' && it.missing ? t('No longer there') : source].filter(Boolean).join(' · ')}</span></span></li>
}

/** Add or edit a trip: its name, dates (or the family's own words for when), where, about and who's
 * going. New dates on a trip with things tied to the old ones show those first; saving changes only
 * the trip's dates, never a booking, an event or away days. */
function TripEditSheet({ trip, onClose, onSaved, save, tz }: { trip: Trip | null; onClose: () => void; onSaved: (x: Trip) => void; save?: TripApi['save']; tz?: string }) {
  const { members, toast } = useApp()
  const id = useId()
  const [d, setD] = useState<TripInput & { title: string }>(() => ({
    title: trip?.title ?? '', emoji: trip?.emoji ?? null, startDate: trip?.startDate ?? null, endDate: trip?.endDate ?? null, dateNote: trip?.dateNote ?? null,
    location: trip?.location ?? null, description: trip?.description ?? null, memberIds: trip?.memberIds ?? members.map(m => m.id), status: trip?.status ?? 'idea',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<DateChangePreview | null>(null)
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(x => ({ ...x, [k]: v }))
  const text = (k: 'emoji' | 'location' | 'description' | 'dateNote', v: string) => set(k, v.trim() ? v : null)
  const datesMoved = !!trip && (trip.startDate !== d.startDate || trip.endDate !== d.endDate)
  const submit = async (reviewed = false) => {
    if (!d.title.trim()) { setError(t('Give it a name.')); return }
    if (!d.startDate && d.endDate) { setError(t('Add the first day too, or leave the last day empty.')); return }
    if (d.startDate && d.endDate && d.endDate < d.startDate) { setError(t('The last day is before the first day.')); return }
    const body = { ...d, title: d.title.trim() }
    setError('')
    if (trip && save) {
      if (datesMoved && !reviewed) {
        setBusy(true)
        try {
          const p = await api.previewTripDates(trip.id, d.startDate ?? null, d.endDate ?? null)
          if (p.away.length + p.events.length + p.meals.length + p.bookedLegs.length + p.bookedStays.length + (p.care?.length ?? 0)) { setReview(p); return }
        } catch (e) { setError(errText(e, t('Could not check the dates.'))); return } finally { setBusy(false) }
      }
      setBusy(true)
      const ok = await save(rev => api.updateTrip(trip.id, { ...body, revision: rev }), t('Saved: {title}', { title: body.title }))
      setBusy(false)
      if (ok) { setReview(null); onSaved(trip) }
      return
    }
    setBusy(true)
    try { const x = await api.createTrip(body); tripsChanged(); toast(t('Saved: {title}', { title: x.title })); onSaved(x) } catch (e) { setError(errText(e, t('Could not save.'))) } finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  if (review && trip) return <DateReviewSheet trip={trip} review={review} busy={busy} onBack={() => setReview(null)} onSave={() => void submit(true)} />
  return <Sheet title={trip ? t('Edit {title}', { title: trip.title }) : t('Add a trip')} onClose={close} dismissable={!busy} dirty="auto" actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={close}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void submit() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="meal-form-row trip-name-row">
          <div className="field trip-emoji-field"><label htmlFor={`${id}-emoji`}>{t('Emoji')}</label><input id={`${id}-emoji`} type="text" maxLength={8} placeholder="🧳" value={d.emoji ?? ''} onChange={e => text('emoji', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-title`}>{t('Name')}</label><input id={`${id}-title`} type="text" required maxLength={200} placeholder={t('Beach week, visit Grandma…')} value={d.title} onChange={e => set('title', e.target.value)} /></div>
        </div>
        {!trip?.canceledAt && <div className="field"><label id={`${id}-status`}>{t('Plan status')}</label>
          <Segmented label={t('Plan status')} value={d.status ?? 'idea'} onChange={s => set('status', s)}
            options={(['idea', 'planning', 'ready'] as const).map(s => ({ key: s, label: <><span aria-hidden="true">{STATUS[s].emoji} </span>{STATUS[s].label()}</> }))} />
          <p className="field-hint">{t('Ready means “we’re set”, not “we paid”: a stay at a family home with nothing to book can be Ready.')}</p></div>}
        <h3>{t('When')}</h3>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-start`}>{t('First day')}</label><input id={`${id}-start`} type="date" value={d.startDate ?? ''} onChange={e => set('startDate', e.target.value || null)} /></div>
          <div className="field"><label htmlFor={`${id}-end`}>{t('Last day')}</label><input id={`${id}-end`} type="date" min={d.startDate ?? undefined} value={d.endDate ?? ''} onChange={e => set('endDate', e.target.value || null)} /></div>
        </div>
        <div className="field"><label htmlFor={`${id}-note`}>{t('Or say when in words')}</label><input id={`${id}-note`} type="text" maxLength={120} placeholder={t('Sometime in February, next summer…')} value={d.dateNote ?? ''} onChange={e => text('dateNote', e.target.value)} />
          <p className="field-hint">{t('Words are shown as written. They never become dates and never start away days.')}</p></div>
        {datesMoved && <p className="field-hint">{t('Before the new dates are saved, you’ll see what else is tied to the old ones. Nothing else moves by itself.')}</p>}
        <h3>{t('Where and who')}</h3>
        <div className="field"><label htmlFor={`${id}-loc`}>{t('Where')}</label><input id={`${id}-loc`} type="text" maxLength={200} placeholder={t('Harbor Point, Grandma’s…')} value={d.location ?? ''} onChange={e => text('location', e.target.value)} /></div>
        <Labeled label={t('Who’s going')}>{fid => <PickField id={fid} label={t('Who’s going')} multiple none={t('Nobody yet')} value={d.memberIds ?? []} onChange={v => set('memberIds', v)} options={members.map(m => ({ value: m.id, label: m.name, lead: <Face m={m} /> }))} />}</Labeled>
        <div className="field"><label htmlFor={`${id}-about`}>{t('About this trip')}</label><textarea id={`${id}-about`} maxLength={5000} placeholder={t('Beach first, then the mountains.')} value={d.description ?? ''} onChange={e => text('description', e.target.value)} />
          <p className="field-hint">{t('Everyone in the family sees this. Keep door codes and confirmation numbers in booking details.')}</p></div>
        {tz && <p className="field-hint">{t('Trip days follow the family’s home calendar.')}</p>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}

/** Before new trip dates are saved: what else is tied to the old ones. Only the trip moves; each of
 * these is changed (or not) by a person afterward. */
function DateReviewSheet({ trip, review, busy, onBack, onSave }: { trip: Trip; review: DateChangePreview; busy: boolean; onBack: () => void; onSave: () => void }) {
  const name = (e: { title?: string | null; label?: string | null }) => e.title || e.label || t('Untitled')
  const section = (title: string, hint: string, list: DateChangePreview['away'], href?: (id: string) => string) => list.length > 0 && <section className="trip-review-sec">
    <h3>{title}</h3><p className="field-hint">{hint}</p>
    <ul>{list.map(e => <li key={e.id}>{href ? <a href={href(e.id)}>{name(e)}</a> : name(e)}{e.date && ` · ${tripWhen({ startDate: e.date, endDate: null, dateNote: null })}`}</li>)}</ul>
  </section>
  return <Sheet title={t('Change the trip’s dates?')} onClose={onBack} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onBack}>{t('Back')}</button>
    <button className="btn btn-primary" disabled={busy} onClick={onSave}>{busy ? t('Saving…') : t('Change the dates')}</button>
  </>}>
    <p>{t('These are tied to {title}’s old dates. Saving changes only the trip; check each of these yourself afterward.', { title: trip.title })}</p>
    {section(t('✈️ Away days'), t('They keep their dates until a grown-up changes them.'), review.away, id => `#/away?period=${encodeURIComponent(id)}`)}
    {section(t('📅 Calendar events'), t('They stay where they are on the calendar.'), review.events)}
    {section(t('🍽️ Meals'), t('They keep their days in Meals.'), review.meals)}
    {section(t('✈️ Booked travel'), t('Kinwall can’t change a booking. Check with whoever you booked with.'), review.bookedLegs)}
    {section(t('🏠 Booked places to stay'), t('Kinwall can’t change a booking. Check with whoever you booked with.'), review.bookedStays)}
    {section(t('🔒 Home and pet care'), t('They keep their days at home. Check with whoever is helping.'), review.care ?? [], () => tripHref(trip.id, 'care'))}
  </Sheet>
}

/** Links existing lists without copying their items or changing their normal behavior. */
function TripListsPage({ t_: { trip, save, busy }, canEdit }: { t_: TripApi; canEdit: boolean }) {
  const { settings, toast } = useApp()
  const [lists, setLists] = useState<List[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [creating, setCreating] = useState(false)
  const [kind, setKind] = useState<'reusable' | 'groceries' | 'shopping' | 'todo' | 'pantry'>('reusable')
  const [name, setName] = useState('')
  const [making, setMaking] = useState(false)
  const formId = useId()
  useEffect(() => {
    if (!settings.features.lists) return
    let canceled = false
    api.getLists().then(x => { if (!canceled) { setLists(x.filter(l => !l.archived)); setLoadError(false) } }).catch(() => { if (!canceled) setLoadError(true) })
    return () => { canceled = true }
  }, [settings.features.lists])
  const linked = trip.packingListIds.map(id => (lists ?? []).find(l => l.id === id)).filter((l): l is List => !!l)
  const label = (l: List) => l.kind === 'reusable' ? t('Reusable') : l.kind === 'shopping' ? l.catalog === 'shopping' ? t('Shopping') : t('Groceries') : l.purpose === 'pantry' ? t('Pantry') : t('To-do')
  const make = async () => {
    if (!name.trim()) return
    setMaking(true)
    try {
      const l = await api.createList({ name: name.trim(), emoji: kind === 'reusable' ? '🧳' : kind === 'groceries' ? '🥕' : kind === 'shopping' ? '🛍️' : kind === 'pantry' ? '🥫' : '📋',
        kind: kind === 'groceries' || kind === 'shopping' ? 'shopping' : kind === 'pantry' ? 'todo' : kind,
        ...(kind === 'groceries' || kind === 'shopping' ? { catalog: kind } : {}), ...(kind === 'pantry' ? { purpose: 'pantry' as const } : {}) })
      setLists(x => [...(x ?? []), l])
      const ok = await save(rev => api.updateTrip(trip.id, { revision: rev, packingListIds: [...trip.packingListIds, l.id] }), t('Made the list: {name}', { name: l.name }))
      if (ok) setCreating(false)
      else { setCreating(false); toast(t('The list was created. Choose it in Linked lists to add it to this trip.'), true) }
    } catch (e) { toast(errText(e, t('Could not make the list.')), true) }
    finally { setMaking(false) }
  }
  return <>
    <div className="meals-heading"><div><h1>{t('Lists')}</h1><p className="field-hint">{t('Packing, groceries, shopping and things to do. Each list works as usual in Lists.')}</p></div>
      {canEdit && settings.features.lists && lists && <div className="meal-actions"><button className="btn btn-primary" disabled={busy} onClick={() => { setName(''); setKind('reusable'); setCreating(true) }}><PlusIcon /> {t('Make a list')}</button></div>}
    </div>
    {!settings.features.lists ? <p className="state-card">{t('Lists is turned off, so there’s nothing to link. A grown-up can turn it on in Settings → Features.')}</p> : loadError ? <p role="alert">{t('Could not load lists. Open this page again to try again.')}</p> : <>
      {!lists ? <p role="status">{t('Loading…')}</p> : <>
        {linked.length ? <div className="outing-list">{linked.map(l => <a key={l.id} className="outing-row" href={`#/lists/${encodeURIComponent(l.id)}`}>
          <span className="outing-emoji" aria-hidden="true">{l.emoji || '📋'}</span>
          <span className="outing-row-main"><strong>{l.name}</strong><span className="outing-row-meta">{label(l)} · {t('{done} of {total} checked', { done: (l.itemCount ?? 0) - (l.openCount ?? 0), total: l.itemCount ?? 0 })}</span></span>
          <ChevronRight />
        </a>)}</div> : <p className="state-card">{t('No lists linked yet.')}</p>}
        {canEdit && <div className="trip-actions trip-list-actions">
          <Labeled label={t('Linked lists')}>{fid => <PickField id={fid} label={t('Linked lists')} multiple none={t('None')} value={trip.packingListIds} onChange={v => void save(rev => api.updateTrip(trip.id, { revision: rev, packingListIds: v }), t('Saved: {title}', { title: trip.title }))}
            options={lists.map(l => ({ value: l.id, label: l.name, detail: label(l), lead: <span aria-hidden="true">{l.emoji || '📋'}</span> }))} />}</Labeled>
        </div>}
        <p className="field-hint">{t('Unlinking a list or deleting this trip keeps the list and its items.')}</p>
      </>}
    </>}
    {creating && <Sheet title={t('Make a list')} onClose={() => { if (!making) setCreating(false) }} dismissable={!making} dirty="auto" actions={<>
      <button className="btn btn-secondary" disabled={making} onClick={() => setCreating(false)}>{t('Cancel')}</button>
      <button className="btn btn-primary" form={formId} type="submit" disabled={making || busy || !name.trim()}>{making ? t('Saving…') : t('Create and link')}</button>
    </>}><form id={formId} onSubmit={e => { e.preventDefault(); void make() }}><fieldset className="meal-fieldset" disabled={making}>
      <Labeled label={t('Name')}>{id => <input id={id} value={name} maxLength={200} onChange={e => setName(e.target.value)} required />}</Labeled>
      <Choose label={t('List type')} value={kind} onChange={setKind} options={[
        { value: 'reusable', emoji: '🧳', label: t('Packing / reusable') }, { value: 'groceries', emoji: '🥕', label: t('Groceries') }, { value: 'shopping', emoji: '🛍️', label: t('Shopping') },
        { value: 'todo', emoji: '📋', label: t('To-do') }, { value: 'pantry', emoji: '🥫', label: t('Pantry') }]} />
    </fieldset></form></Sheet>}
  </>
}

/** Add to our calendar: only what a grown-up ticks. Trying again adds only what's missing. */
function CalendarPage({ t_: { trip, save, busy } }: { t_: TripApi }) {
  const [calendars, setCalendars] = useState<CalendarEntry[] | null>(null)
  const [calendarId, setCalendarId] = useState('')
  const [error, setError] = useState('')
  const linkOf = (kind: 'leg' | 'stay' | 'item', id: string) => trip.calendar.items.find(i => i.kind === kind && i.id === id)?.link ?? null
  const legs = trip.legs.filter(l => l.departDate && l.departTime && l.departTz && l.booking !== 'canceled')
  const stays = trip.stayGroups.filter(g => g.chosenOptionId && g.checkIn).map(g => ({ g, o: g.options.find(o => o.id === g.chosenOptionId)! }))
  const items = trip.items.filter(i => i.kind === 'activity' && i.date && i.time && i.tz)
  const [picked, setPicked] = useState<Set<string>>(() => new Set([...(trip.startDate && !trip.calendar.span ? ['span'] : [])]))
  useEffect(() => {
    let canceled = false
    api.getCalendars().then(cals => {
      if (canceled) return
      const writable = cals.filter(c => c.writable && c.enabled && c.canEditEvents !== false)
      setCalendars(writable); setCalendarId((writable.find(c => c.default) ?? writable[0])?.id ?? '')
    }).catch(e => { if (!canceled) setError(errText(e, t('Could not load calendars.'))) })
    return () => { canceled = true }
  }, [])
  const toggle = (k: string) => setPicked(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const box = (key: string, label: ReactNode, link: Trip['calendar']['span'], disabledWhy?: string) => <li key={key} className="trip-cal-row">
    <label className="meal-check"><input type="checkbox" disabled={!!disabledWhy || link?.state === 'added' || link?.state === 'pending'} checked={link?.state === 'added' || picked.has(key)} onChange={() => toggle(key)} /> <span>{label}</span></label>
    {link?.state === 'added' && <span className="chip chip-static">{t('✓ On the calendar')}</span>}
    {link?.state === 'failed' && <span className="field-error">{link.error || t('Couldn’t add this one.')}</span>}
    {link?.state === 'pending' && <span className="chip chip-static">{t('⏳ Not sure it was added')}</span>}
    {link?.state === 'pending' && <span className="field-hint">{link.error || t('Check the calendar before adding it again.')} {t('Kinwall won’t add it again by itself, so it can’t end up there twice.')}</span>}
    {disabledWhy && <span className="field-hint">{disabledWhy}</span>}
  </li>
  const add = () => {
    if (!calendarId) { setError(t('Pick a calendar.')); return }
    const ids = (prefix: string) => [...picked].filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length))
    void save(rev => api.publishTrip(trip.id, rev, { calendarId, span: picked.has('span'), legs: ids('leg:'), stays: ids('stay:'), items: ids('item:') }), t('Added to the calendar'))
      .then(ok => { if (ok) setPicked(new Set()) })
  }
  const failed = trip.calendar.items.filter(i => i.link.state === 'failed').length + (trip.calendar.span?.state === 'failed' ? 1 : 0)
  return <>
    <div className="meals-heading"><div><h1>{t('On our calendar')}</h1><p className="field-hint">{t('Nothing goes on the calendar until you pick it. If something fails, trying again adds only what’s missing.')}</p></div></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {!calendars ? <p role="status">{t('Loading calendars…')}</p> : <>
      <Labeled label={t('Calendar')}>{id => <PickField id={id} label={t('Calendar')} value={calendarId ? [calendarId] : []} onChange={v => setCalendarId(v[0] ?? '')}
        options={calendars.map(c => ({ value: c.id, label: c.name }))} />}</Labeled>
      <ul className="trip-cal-list">
        {box('span', <><strong>{trip.emoji || '🧳'} {trip.title}</strong> · {t('all day, {when}', { when: tripWhen(trip) })}</>, trip.calendar.span, trip.startDate ? undefined : t('Add the trip’s dates first.'))}
        {legs.map(l => { const c = legClock(l); return box(`leg:${l.id}`, <>{LEG_EMOJI[l.mode]} {l.title || [l.from, l.to].filter(Boolean).join(' → ')} · {tripWhen({ startDate: l.departDate, endDate: null, dateNote: null })} {c.depart}</>, linkOf('leg', l.id)) })}
        {stays.map(({ g, o }) => box(`stay:${o.id}`, <>{STAY_EMOJI[o.kind]} {o.name} · {tripWhen({ startDate: g.checkIn, endDate: g.checkOut, dateNote: null })}</>, linkOf('stay', o.id)))}
        {items.map(i => box(`item:${i.id}`, <>⭐ {i.kind === 'activity' ? i.title : ''} · {tripWhen({ startDate: i.date, endDate: null, dateNote: null })} {i.time && formatTime(i.time)}</>, linkOf('item', i.id)))}
      </ul>
      {(trip.legs.some(l => l.departDate && (!l.departTime || !l.departTz)) || trip.items.some(i => i.kind === 'activity' && i.date && (!i.time || !i.tz))) && <p className="field-hint">{t('A leg or an activity needs its date, time and time zone to go on the calendar.')}</p>}
      {failed > 0 && <p className="field-hint">{t('Something didn’t go on. Tick it again and tap Add to try once more.')}</p>}
      <div className="trip-actions"><button className="btn btn-primary trip-fit" disabled={busy || !picked.size} onClick={add}>{tn(picked.size, 'Add {n} event', 'Add {n} events')}</button></div>
    </>}
  </>
}

/** Who sees this trip's booking details: Grown-ups only or Everyone in the family, and a separate
 * Show on wall (only with Everyone). The words and rules match Contacts' sharing settings. */
function DetailsPage({ t_: { trip, save, busy } }: { t_: TripApi }) {
  const everyone = trip.detailsAudience === 'everyone'
  return <>
    <div className="meals-heading"><div><h1>{t('Booking details')}</h1><p className="field-hint">{t('Rental and family-home street addresses, door, lockbox and Wi-Fi codes, confirmation numbers, booking links and host contacts.')}</p></div></div>
    <div className="field"><label id="trip-aud">{t('Who can see booking details')}</label>
      <Segmented label={t('Who can see booking details')} value={trip.detailsAudience} disabled={busy}
        options={[{ key: 'grownups' as const, label: t('🔒 Grown-ups only') }, { key: 'everyone' as const, label: t('👨‍👩‍👧 Everyone in the family') }]}
        onChange={v => void save(rev => api.updateTrip(trip.id, { revision: rev, detailsAudience: v, ...(v === 'grownups' && { detailsOnWall: false }) }), t('Saved: {title}', { title: trip.title }))} />
      <p className="field-hint">{everyone ? t('Grown-ups’ and kids’ own devices. Wall screens only with Show on wall.') : t('Parents’ devices and grown-ups’ own devices. Never kids’ devices or the wall.')}</p></div>
    <div className="toggle-row">
      <div><label id="trip-wall-label">{t('Show on wall')}</label><div className="settings-row-sub" id="trip-wall-sub">{everyone ? t('Wall screens show booking details too.') : t('Choose Everyone in the family first.')}</div></div>
      <button className={`switch ${trip.detailsOnWall ? 'on' : ''}`} role="switch" aria-checked={trip.detailsOnWall} aria-labelledby="trip-wall-label" aria-describedby="trip-wall-sub" disabled={busy || !everyone}
        onClick={() => void save(rev => api.updateTrip(trip.id, { revision: rev, detailsOnWall: !trip.detailsOnWall }), t('Saved: {title}', { title: trip.title }))}><span className="knob" /></button>
    </div>
    <p className="field-hint">{t('Trip names, dates, towns, place names, prices and travel times are plans everyone sees. Where details are hidden, the row says “For grown-ups”, so kids know to ask. Connected apps never get booking details.')}</p>
  </>
}
