// Trips' labels, groupings and the day plan (Trips.tsx; server: routes/trips.ts). Pure, so
// web/test/trips.test.ts covers it.
import { addDays, daysBetween } from './upkeep-rules.ts'
import { DAY, formatDate, intlLocale, t, tn } from './i18n.ts'
import { formatTime } from './timeFormat.ts'
import { exactInstant, type TravelDay } from './travelContext.ts'
import { tzInfo, tzName } from './timezone.ts'
import type { CareArrangement, CareKind, CareStatus, PlanCheck, StayGroup, StayOption, StayPoll, StayPrice, TripStop, Trip, TripItem, TripLeg, TripSummary } from './trip-types.ts'

const day = (d: string) => new Date(`${d}T12:00:00`)
export const longDay = (d: string) => formatDate(day(d), DAY)
const closed = (x: TripSummary) => !!x.archivedAt || !!x.canceledAt
const lastDay = (x: Pick<TripSummary, 'startDate' | 'endDate'>) => x.endDate ?? x.startDate

/** Where a trip is by its dates: under way, done, coming, or nothing to go on (no dates). */
export function tripPhase(x: Pick<TripSummary, 'startDate' | 'endDate'>, today: string): 'soon' | 'underway' | 'past' | null {
  if (!x.startDate) return null
  if (lastDay(x)! < today) return 'past'
  return x.startDate <= today ? 'underway' : 'soon'
}

const byDate = (a: TripSummary, b: TripSummary) =>
  a.startDate && b.startDate ? a.startDate.localeCompare(b.startDate) : a.startDate ? -1 : b.startDate ? 1 : a.title.localeCompare(b.title)

/** The Trips tab's sections: Ideas, Upcoming (soonest first, undated last) and Past (newest
 * first), each trip by its own today (tripToday). Archived and called-off trips are kept apart (`closed`). */
export function tripSections<T extends TripSummary>(trips: T[], today: string): { ideas: T[]; upcoming: T[]; past: T[]; closed: T[] } {
  const open = trips.filter(x => !closed(x))
  const past = open.filter(x => tripPhase(x, tripToday(x, today)) === 'past').sort((a, b) => lastDay(b)!.localeCompare(lastDay(a)!))
  const rest = open.filter(x => !past.includes(x)).sort(byDate)
  return { ideas: rest.filter(x => x.status === 'idea'), upcoming: rest.filter(x => x.status !== 'idea'), past, closed: trips.filter(closed) }
}

/** When, in words: "Sat, Jul 10 – Sat, Jul 17", one day, the family's own words, or "No dates yet". */
export function tripWhen(x: Pick<TripSummary, 'startDate' | 'endDate' | 'dateNote'>): string {
  if (!x.startDate) return x.dateNote || t('No dates yet')
  if (!x.endDate || x.endDate === x.startDate) return longDay(x.startDate)
  return t('{from} – {to}', { from: longDay(x.startDate), to: longDay(x.endDate) })
}

/** "Day 3 of 8" while it's under way, else null. */
export function tripDayLabel(x: Pick<TripSummary, 'startDate' | 'endDate'>, today: string): string | null {
  if (tripPhase(x, today) !== 'underway') return null
  return t('Day {n} of {total}', { n: daysBetween(x.startDate!, today) + 1, total: daysBetween(x.startDate!, lastDay(x)!) + 1 })
}

/** How far off it is: "Today", "Tomorrow", "In 12 days". */
export function tripCountdown(x: Pick<TripSummary, 'startDate'>, today: string): string | null {
  if (!x.startDate || x.startDate < today) return null
  const n = daysBetween(today, x.startDate)
  return n === 0 ? t('Starts today') : n === 1 ? t('Starts tomorrow') : tn(n, 'In {n} day', 'In {n} days')
}

/** Nights between arriving and the morning you leave; null without both dates or backwards. */
export function nights(checkIn: string | null, checkOut: string | null): number | null {
  if (!checkIn || !checkOut) return null
  const n = daysBetween(checkIn, checkOut)
  return n < 0 ? null : n
}

/** A price as listed: "$212 a night", "$1,480.50 for the stay, before fees". Its own currency, with
 * that currency's decimals (¥ has none); never converted. */
export function priceLabel(p: StayPrice): string {
  const f = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: p.currency })
  const digits = f.resolvedOptions().maximumFractionDigits ?? 2
  const value = p.amountMinor / 10 ** digits
  const amount = new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: p.currency, ...(value % 1 ? {} : { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }).format(value)
  const basis = p.basis === 'night' ? t('{amount} a night', { amount }) : p.basis === 'stay' ? t('{amount} for the stay', { amount }) : p.basis === 'week' ? t('{amount} a week', { amount }) : p.basis === 'person' ? t('{amount} a person', { amount }) : amount
  return p.fees === 'extra' ? t('{price}, before fees', { price: basis }) : p.fees === 'included' ? t('{price}, fees included', { price: basis }) : basis
}

/** What a place to stay costs, in words. "Not set yet" is never shown as free. */
export function costLabel(o: Pick<StayOption, 'cost' | 'price'>): string {
  if (o.cost === 'free') return t('Free')
  if (o.cost === 'contribution') return t('We’ll offer to chip in')
  if (o.cost === 'price' && o.price) return priceLabel(o.price)
  return t('Cost not set yet')
}

/** Sort by price only compares like with like: two or more prices, one currency, one basis. */
export function sortableByPrice(options: Pick<StayOption, 'cost' | 'price'>[]): boolean {
  if (options.length < 2 || options.some(o => o.cost !== 'price' || !o.price)) return false
  const [first] = options
  return options.every(o => o.price!.currency === first.price!.currency && o.price!.basis === first.price!.basis)
}

/** The place to stay a vote is for (a vote may name the poll option or the stay itself). */
export const stayOfVote = (poll: Pick<StayPoll, 'options'>, optionId: string) => poll.options?.find(o => o.id === optionId)?.stayId ?? optionId
/** The poll option to send for a vote for this place to stay. */
export const pollOptionFor = (poll: Pick<StayPoll, 'options'>, stayId: string) => poll.options?.find(o => o.stayId === stayId)?.id ?? stayId

/** A stay vote's count: who voted out of who can (the people going), and who leads. No votes, no
 * leader; a tie is called a tie. null without a vote. */
export function tally(g: Pick<StayGroup, 'poll' | 'options'>): { voted: number; of: number; counts: Record<string, number>; leaders: string[]; tie: boolean } | null {
  if (!g.poll) return null
  const counts: Record<string, number> = Object.fromEntries(g.options.map(o => [o.id, 0]))
  const votes = g.poll.votes.map(v => ({ ...v, optionId: stayOfVote(g.poll!, v.optionId) })).filter(v => g.poll!.voterIds.includes(v.memberId) && v.optionId in counts)
  for (const v of votes) counts[v.optionId]++
  const top = Math.max(0, ...Object.values(counts))
  const leaders = top ? Object.keys(counts).filter(k => counts[k] === top) : []
  return { voted: votes.length, of: g.poll.voterIds.length, counts, leaders, tie: leaders.length > 1 }
}

/** The instant a wall clock in `tz` means (the first one, in a repeated daylight-saving hour). */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
  const offset = (t: number) => {
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map(x => [x.type, Number(x.value)]))
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - t
  }
  const first = wall - offset(wall)
  return new Date(wall - offset(first))
}
/** A zone's short name at the leg's own moment ("EDT", "GMT+2"). */
function zoneName(date: string, time: string, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(zonedInstant(date, time, tz))
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz
  } catch { return tz }
}
function endClock(date: string | null, time: string | null, tz: string | null): string | null {
  if (!time) return null
  const clock = formatTime(time)
  if (!tz) return t('{time} (local time)', { time: clock })
  return `${clock} ${zoneName(date ?? '2026-01-15', time, tz)}`
}

/** A leg's clocks, each in the zone where it happens ("7:05 AM EDT" → "9:12 AM CDT"), and how many
 * days later it arrives on the arrival clock ("+1"). A missing zone is labeled, never swapped for
 * home time. */
export function legClock(l: Pick<TripLeg, 'departDate' | 'departTime' | 'departTz' | 'arriveDate' | 'arriveTime' | 'arriveTz'>): { depart: string | null; arrive: string | null; plusDays: number } {
  const plusDays = l.departDate && l.arriveDate ? Math.max(0, daysBetween(l.departDate, l.arriveDate)) : 0
  return { depart: endClock(l.departDate, l.departTime, l.departTz), arrive: endClock(l.arriveDate ?? l.departDate, l.arriveTime, l.arriveTz), plusDays }
}

export type PlanEntry =
  | { kind: 'leg'; id: string; date: string; time: string | null; leg: TripLeg }
  | { kind: 'checkin' | 'checkout'; id: string; date: string; time: null; group: StayGroup; option: StayOption | null }
  | { kind: 'item'; id: string; date: string; time: string | null; item: TripItem }

/** The day plan: one day per date of the trip, each with its legs and check-in/-out (from their own
 * records) and its items, by time; undated activities as ideas; dated things outside the trip's
 * dates kept, on their own, rather than lost. */
export function dayPlan(trip: Pick<Trip, 'startDate' | 'endDate' | 'legs' | 'stayGroups' | 'items'>): { days: { date: string; entries: PlanEntry[] }[]; ideas: TripItem[]; outside: PlanEntry[] } {
  const entries: PlanEntry[] = []
  for (const leg of trip.legs) if (leg.departDate && leg.booking !== 'canceled') entries.push({ kind: 'leg', id: leg.id, date: leg.departDate, time: leg.departTime, leg })
  for (const group of trip.stayGroups) {
    const option = group.options.find(o => o.id === group.chosenOptionId) ?? null
    if (group.checkIn) entries.push({ kind: 'checkin', id: group.id, date: group.checkIn, time: null, group, option })
    if (group.checkOut) entries.push({ kind: 'checkout', id: group.id, date: group.checkOut, time: null, group, option })
  }
  for (const item of trip.items) if (item.date) entries.push({ kind: 'item', id: item.id, date: item.date, time: item.time, item })
  // Within a day: timed things by time, check-out first thing, check-in last, untimed items after.
  const rank = (e: PlanEntry) => e.kind === 'checkout' ? '00:00' : e.time ?? (e.kind === 'checkin' ? '23:58' : '23:59')
  entries.sort((a, b) => a.date.localeCompare(b.date) || rank(a).localeCompare(rank(b)))
  const days: { date: string; entries: PlanEntry[] }[] = []
  const last = lastDay(trip)
  if (trip.startDate && last && daysBetween(trip.startDate, last) < 400) {
    for (let d = trip.startDate; d <= last; d = addDays(d, 1)) days.push({ date: d, entries: entries.filter(e => e.date === d) })
  }
  const inside = new Set(days.map(d => d.date))
  return { days, ideas: trip.items.filter(i => !i.date).sort((a, b) => a.sort - b.sort), outside: entries.filter(e => !inside.has(e.date)) }
}

export const STAY_EMOJI: Record<StayOption['kind'], string> = { hotel: '🏨', rental: '🏠', family: '🏡', camping: '⛺', other: '📍' }
export const LEG_EMOJI: Record<TripLeg['mode'], string> = { flight: '✈️', drive: '🚗', train: '🚆', bus: '🚌', ferry: '⛴️', rental: '🚙', other: '🧭' }

/** Only the fields that differ from what's saved, so an edit doesn't touch what it didn't change
 * (a stay's choice and its vote stay put when only Booked or notes change). `null` and a missing
 * field count as the same. */
export function changedFields<T extends Record<string, unknown>>(saved: Record<string, unknown> | null, next: T): Partial<T> {
  if (!saved) return next
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return Object.fromEntries(Object.entries(next).filter(([k, v]) => !same(saved[k], v))) as Partial<T>
}

/** One trip page's load: the trip only ever belongs to the id it was read for. A refresh that
 * fails because the trip is gone or no longer allowed (404, 403) drops what was shown; any other
 * failure (offline) keeps it, marked stale. */
export type TripLoad<T> = { id: string; trip: T | null; error: unknown; stale: boolean }
export function tripLoaded<T>(id: string, trip: T): TripLoad<T> { return { id, trip, error: null, stale: false } }
export function tripFailed<T>(prev: TripLoad<T> | null, id: string, error: unknown): TripLoad<T> {
  const status = (error as { status?: number } | null)?.status
  const keep = prev?.id === id && status !== 403 && status !== 404 ? prev.trip : null
  return { id, trip: keep, error, stale: !!keep }
}
/** Whether an answer is still for the sign-in that asked: `current` is read when the request starts
 * and again when it answers (signed in as someone else, in this tab or another, drops it). */
export function viewerCheck(current: () => string): () => boolean {
  const asked = current()
  return () => current() === asked
}
/** What to show for `id`: nothing from another trip's load. */
export const tripFor = <T,>(load: TripLoad<T> | null, id: string): TripLoad<T> => load?.id === id ? load : { id, trip: null, error: null, stale: false }

/** The stops in order, each with the sort it should have: their place in the list. */
export function reorderStops(stops: Pick<TripStop, 'id' | 'sort'>[], id: string, by: -1 | 1): { id: string; sort: number }[] {
  const list = [...stops].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
  const i = list.findIndex(s => s.id === id), j = i + by
  if (i < 0 || j < 0 || j >= list.length) return []
  ;[list[i], list[j]] = [list[j], list[i]]
  return list.map((s, sort) => ({ id: s.id, sort })).filter(x => stops.find(s => s.id === x.id)!.sort !== x.sort)
}


/** The PATCH for Not this time / Bring it back and Put away / Put it back: the API takes the moment
 * (an ISO time) or null, never a true/false. */
export const toggledAt = (field: 'canceledAt' | 'archivedAt', current: string | null, now = new Date()) => ({ [field]: current ? null : now.toISOString() }) as { canceledAt?: string | null; archivedAt?: string | null }

/** The instant a plan entry starts, when that's known exactly: a leg leaving at a time in a known
 * zone, or an activity at a time with its zone. null for anything else. */
export function entryInstant(e: PlanEntry): number | null {
  const at = e.kind === 'leg' ? exactInstant(e.date, e.leg.departTime, e.leg.departTz)
    : e.kind === 'item' && e.item.kind === 'activity' ? exactInstant(e.date, e.item.time, e.item.tz ?? null) : null
  return at ? at.getTime() : null
}

/** Next up: the first thing on the plan that hasn't started, in time order. Exact times compare as
 * instants, each in its own zone (a 9 AM flight in Denver comes after an 8 AM one in Boston); the
 * rest go by their date and time on the trip's clock, and an untimed one counts as ahead all day. */
export function nextUp(entries: PlanEntry[], now: number, clock: { today: string; timeZone: string }): PlanEntry | null {
  const key = (e: PlanEntry) => {
    const exact = entryInstant(e)
    if (exact !== null) return { at: exact, ahead: exact > now }
    const rank = e.kind === 'checkout' ? '00:00' : e.time ?? (e.kind === 'checkin' ? '23:58' : '23:59')
    const at = exactInstant(e.date, rank, clock.timeZone)?.getTime() ?? Date.parse(`${e.date}T${rank}:00Z`)
    return { at, ahead: e.time ? at > now : e.date >= clock.today }
  }
  const ahead = entries.map(e => ({ e, ...key(e) })).filter(x => x.ahead)
  ahead.sort((a, b) => a.at - b.at)
  return ahead[0]?.e ?? null
}

/** What a trip's id stands for, in words: a stop, a stay, a leg or a plan item. */
export function tripThingName(trip: Pick<Trip, 'stops' | 'stayGroups' | 'legs' | 'items'>, id: string): string | null {
  const stop = trip.stops.find(s => s.id === id)
  if (stop) return stop.label
  const group = trip.stayGroups.find(g => g.id === id)
  if (group) return group.options.find(o => o.id === group.chosenOptionId)?.name ?? group.label
  const option = trip.stayGroups.flatMap(g => g.options).find(o => o.id === id)
  if (option) return option.name
  const leg = trip.legs.find(l => l.id === id)
  if (leg) return leg.title || [leg.from, leg.to].filter(Boolean).join(' → ') || t('A leg')
  const item = trip.items.find(i => i.id === id)
  if (item) return item.kind === 'activity' ? item.title : item.label
  return null
}

/** A plan check in plain words: what it noticed and why it may be fine. Never an error: plans can be
 * incomplete on purpose, and families split up or travel overnight. */
export function checkLine(c: PlanCheck, trip: Pick<Trip, 'stops' | 'stayGroups' | 'legs' | 'items'>): { emoji: string; title: string; sub: string } {
  const names = c.ids.map(id => tripThingName(trip, id)).filter((n): n is string => !!n)
  const list = (fallback: string) => names.length ? new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(names) : fallback
  const when = c.from ? tripWhen({ startDate: c.from, endDate: c.to && c.to !== c.from ? c.to : null, dateNote: null }) : null
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(' · ')
  if (c.code === 'uncovered_nights') {
    const n = c.count ?? nights(c.from, c.to) ?? 1
    // to is the morning after the last night, like a check-out
    const lastNight = c.to ? addDays(c.to, -1) : c.from
    const span = c.from ? (lastNight && lastNight !== c.from ? t('{from} – {to}', { from: longDay(c.from), to: longDay(lastNight) }) : longDay(c.from)) : null
    return { emoji: '🌙', title: tn(n, 'No place to stay yet for {n} night', 'No place to stay yet for {n} nights'), sub: join(span, t('Fine if it’s a night on the road or a red-eye.')) }
  }
  if (c.code === 'overlapping_stays') return { emoji: '🏠', title: t('Places to stay overlap: {names}', { names: list(t('two stays')) }), sub: join(when, t('Fine if the family splits up for those nights.')) }
  if (c.code === 'outside_trip') return { emoji: '📅', title: t('Outside the trip’s dates: {names}', { names: list(t('something')) }), sub: join(when, t('Check the date, or change the trip’s dates.')) }
  if (c.code === 'travel_overlap') return { emoji: '🧭', title: t('Travel times overlap: {names}', { names: list(t('two legs')) }), sub: join(when, t('Fine if different people take each one.')) }
  return { emoji: '⏱️', title: t('Arrives before it leaves: {names}', { names: list(t('a leg')) }), sub: join(when, t('Check its times and time zones.')) }
}

// ---- home and pet care --------------------------------------------------------------------------

export const CARE_EMOJI: Record<CareKind, string> = { pet: '🐾', home: '🏠', plants: '🪴', other: '🧺' }
export const careStatusLabel = (s: CareStatus) =>
  s === 'needed' ? t('Need someone') : s === 'asked' ? t('Asked, waiting to hear') : s === 'confirmed' ? t('✓ Confirmed') : t('✕ Canceled')

/** The overview row's line: how many are set and what still needs someone. When some couldn't be
 * opened, it says so rather than "nothing set up" (never how many, or what). */
export function careSummary(care: Pick<CareArrangement, 'status'>[], unavailable = false): string {
  const open = care.filter(c => c.status !== 'canceled')
  if (!open.length && !unavailable) return t('Pets, plants and the house while you’re away')
  const need = open.filter(c => c.status === 'needed' || c.status === 'asked').length
  const set = open.length - need
  return [unavailable && t('Some can’t be opened right now'), set && tn(set, '{n} confirmed', '{n} confirmed'), need && tn(need, '{n} still needs someone', '{n} still need someone')].filter(Boolean).join(' · ')
}

// ---- today on the trip ---------------------------------------------------------------------------

/** A trip's today for its row and the Board: the server's travel day when it follows a place on the
 * trip, else home's. The trip page works it out again each minute from the stops and legs. */
export const tripToday = (x: Pick<TripSummary, 'travelDay'>, homeToday: string) => x.travelDay && x.travelDay.source !== 'home' ? x.travelDay.today : homeToday

/** Whose clock today on the trip follows, in words, with the time there. Home time says why, so it's
 * never mistaken for the local day. */
export function clockLine(clock: TravelDay, trip: Pick<Trip, 'stops' | 'legs'>, now: Date, homeZone: string): string {
  const { time } = tzInfo(clock.timeZone, now)
  const place = clock.stopId ? trip.stops.find(s => s.id === clock.stopId)?.label : null
  if (clock.source === 'override') return t('Today follows {zone} time, as a grown-up set it · {time}', { zone: tzName(clock.timeZone, now), time })
  if (clock.source === 'stop' && place) return t('Today follows {place} time · {time}', { place, time })
  if (clock.source === 'stop' || clock.source === 'leg') return t('Today follows {zone} time · {time}', { zone: tzName(clock.timeZone, now), time })
  const known = trip.stops.some(s => s.timezone) || trip.legs.some(l => l.departTz || l.arriveTz)
  return known ? t('Home time ({zone}): the plan doesn’t say which time zone you’re in right now · {time}', { zone: tzName(homeZone, now), time })
    : t('Home time ({zone}): add stops with their time zones to follow the local day · {time}', { zone: tzName(homeZone, now), time })
}
