// Outings' list, filters and labels (Outings.tsx; server: routes/outings.ts). Pure, so
// web/test/outings.test.ts covers it. Who an outing is for and the filter itself are outing-rules.ts
// (the same file as the server's).
import { addDays, forBoxes, hiddenFromKid, isPast, matchesFilter, onBetween, weekendOf, type ForBox, type OutingFilter, type PersonFacts } from './outing-rules.ts'
import type { Member, Outing } from './types.ts'
import { DAY, formatDate, t } from './i18n.ts'

const day = (d: string, options: Intl.DateTimeFormatOptions) => formatDate(new Date(`${d}T12:00:00`), options)
const clock = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`
}
/** "10 AM – 4 PM", "7:30 PM", or '' for all day. */
export const timeLabel = (o: Pick<Outing, 'startTime' | 'endTime'>) => o.startTime ? `${clock(o.startTime)}${o.endTime ? ` – ${clock(o.endTime)}` : ''}` : ''

/** When it's on, short: "Sat 10 AM – 4 PM" this week, "Sat, Oct 24, 1 PM" later, "Until Oct 31" for
 * a run that's open, "Date not announced yet", "Any time" for a place. */
export function whenLabel(o: Outing, today: string): string {
  if (o.kind === 'place') return t('Any time')
  if (!o.startsOn) return t('Date not announced yet')
  const time = timeLabel(o)
  if (o.endsOn && o.endsOn !== o.startsOn) {
    const range = o.startsOn <= today ? t('Until {date}', { date: day(o.endsOn, { month: 'short', day: 'numeric' }) }) : t('{from} to {to}', { from: day(o.startsOn, { month: 'short', day: 'numeric' }), to: day(o.endsOn, { month: 'short', day: 'numeric' }) })
    return [range, o.hours ?? time].filter(Boolean).join(' · ')
  }
  const soon = o.startsOn >= today && o.startsOn <= addDays(today, 6)
  const d = o.startsOn === today ? t('Today') : o.startsOn === addDays(today, 1) ? t('Tomorrow') : day(o.startsOn, soon ? { weekday: 'short' } : { weekday: 'short', month: 'short', day: 'numeric', ...(o.startsOn.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }) })
  return time ? `${d}, ${time}` : d
}

export const priceLabel = (o: Pick<Outing, 'priceCents'>) => o.priceCents === null ? null : o.priceCents === 0 ? t('Free') : `$${(o.priceCents / 100).toFixed(o.priceCents % 100 ? 2 : 0)}`

/** Who it's for, in a few words: "Family", "Kids 7–10", "Grown-ups", "For Maya". */
export function audienceLabel(o: Pick<Outing, 'audience' | 'memberIds' | 'ageMin' | 'ageMax'>, members: Pick<Member, 'id' | 'name'>[]): string {
  const kids = o.ageMin !== null && o.ageMax !== null ? t('Kids {min}–{max}', { min: o.ageMin, max: o.ageMax }) : o.ageMin !== null ? t('Kids {min} and up', { min: o.ageMin }) : o.ageMax !== null ? t('Kids up to {max}', { max: o.ageMax }) : t('Kids')
  const parts = [o.audience.includes('family') && t('Family'), o.audience.includes('kids') && kids, o.audience.includes('grownups') && t('Grown-ups')].filter(Boolean) as string[]
  const names = members.filter(m => o.memberIds.includes(m.id)).map(m => m.name)
  if (names.length) parts.push(t('For {names}', { names: names.length > 1 ? t('{list} and {last}', { list: names.slice(0, -1).join(', '), last: names.at(-1)! }) : names[0] }))
  return parts.join(' · ')
}

export const reallyCount = (o: Pick<Outing, 'interest'>) => o.interest.filter(i => i.level === 'really').length

/** The Upcoming list's sections, in order: This week, This weekend, Later this month, one per month
 * after that, Open now (runs already going), Date not announced yet. Empty ones are left out. */
export function upcomingSections(outings: Outing[], today: string): { key: string; title: string; outings: Outing[] }[] {
  const [sat, sun] = weekendOf(today)
  const monthEnd = `${today.slice(0, 7)}-31`
  const out = new Map<string, { key: string; title: string; outings: Outing[] }>()
  const add = (key: string, title: string, o: Outing) => { if (!out.has(key)) out.set(key, { key, title, outings: [] }); out.get(key)!.outings.push(o) }
  const sorted = [...outings].sort((a, b) => (a.startsOn ?? '9').localeCompare(b.startsOn ?? '9') || (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.title.localeCompare(b.title))
  for (const o of sorted.filter(o => !o.startsOn)) add('tba', t('Date not announced yet'), o)
  for (const o of sorted.filter(o => o.startsOn)) {
    const s = o.startsOn!
    if (o.endsOn && s < today) add('open', t('Open now'), o)
    else if (s < sat) add('week', t('This week'), o)
    else if (s <= sun) add('weekend', t('This weekend · {dates}', { dates: `${day(sat, { month: 'short', day: 'numeric' })}–${sat.slice(0, 7) === sun.slice(0, 7) ? day(sun, { day: 'numeric' }) : day(sun, { month: 'short', day: 'numeric' })}` }), o)
    else if (s <= monthEnd) add('month', t('Later this month'), o)
    else add(s.slice(0, 7), day(s, { month: 'long', ...(s.slice(0, 4) !== today.slice(0, 4) && { year: 'numeric' }) }), o)
  }
  const order = (k: string) => ({ week: 0, weekend: 1, month: 2, open: 1e9, tba: 1e9 + 1 } as Record<string, number>)[k] ?? 3 + Number(k.replace('-', ''))
  return [...out.values()].sort((a, b) => order(a.key) - order(b.key))
}

/** Places: Want to go (and unmarked), then Been there, by name. */
export function placeSections(outings: Outing[]): { key: string; title: string; outings: Outing[] }[] {
  const byName = (list: Outing[]) => [...list].sort((a, b) => a.title.localeCompare(b.title))
  return [
    { key: 'want', title: t('Want to go'), outings: byName(outings.filter(o => o.visitStatus !== 'been')) },
    { key: 'been', title: t('Been there'), outings: byName(outings.filter(o => o.visitStatus === 'been')) },
  ].filter(s => s.outings.length)
}

// The filter sheet's choices. who: a member id whose boxes are ticked ('' = anyone).
export type When = 'any' | 'weekend' | 'week' | 'month' | 'past'
export type Cost = 'any' | 'free' | '10' | '25'
export interface Filters { when: When; categoryIds: string[]; who: string; boxes: ForBox[]; markedBy: string; cost: Cost }
export const NO_FILTERS: Filters = { when: 'any', categoryIds: [], who: '', boxes: ['just', 'age', 'family'], markedBy: '', cost: 'any' }
/** A kid's own device starts on "for me"; a wall or a parent's phone on everyone. */
export const startFilters = (kidId: string | null): Filters => ({ ...NO_FILTERS, who: kidId ?? '' })

const persons = (members: Pick<Member, 'id' | 'grownUp' | 'birthday'>[]): PersonFacts[] => members.map(m => ({ id: m.id, grownUp: !!m.grownUp, birthday: m.birthday ?? null }))

/** The filters as outing-rules.ts takes them. */
export function toRuleFilter(f: Filters, members: Pick<Member, 'id' | 'grownUp' | 'birthday'>[], today: string): OutingFilter {
  const [sat, sun] = weekendOf(today)
  const window = f.when === 'weekend' ? { from: sat, to: sun } : f.when === 'week' ? { from: today, to: addDays(today, 6) } : f.when === 'month' ? { from: today, to: addDays(today, 30) } : {}
  return {
    ...window, past: f.when === 'past', categoryIds: f.categoryIds,
    for: f.who ? { people: persons(members).filter(p => p.id === f.who), boxes: f.boxes } : undefined,
    markedBy: f.markedBy === 'any' || f.markedBy === 'really' ? f.markedBy : f.markedBy ? [f.markedBy] : undefined,
    free: f.cost === 'free', maxPriceCents: f.cost === '10' ? 1000 : f.cost === '25' ? 2500 : undefined,
  }
}

/** What the list shows of `kind`: not "Not for us", not grown-ups-only on a kid's own device, then the filters. */
export function shownOutings(outings: Outing[], kind: Outing['kind'], f: Filters, members: Pick<Member, 'id' | 'grownUp' | 'birthday'>[], today: string, kidId: string | null): Outing[] {
  const rule = toRuleFilter(kind === 'place' ? { ...f, when: 'any' } : f, members, today)
  return outings.filter(o => o.kind === kind && !o.archived && !(kidId && hiddenFromKid(o, kidId)) && matchesFilter(o, rule, today))
}

/** Each filter that's on, as a chip: its words and the filters without it. */
export function filterChips(f: Filters, members: Pick<Member, 'id' | 'name' | 'grownUp'>[], categories: { id: string; name: string }[]): { label: string; without: Filters }[] {
  const chips: { label: string; without: Filters }[] = []
  const WHEN: Record<When, string> = { any: '', weekend: t('This weekend'), week: t('Next 7 days'), month: t('Next 30 days'), past: t('Past') }
  if (f.when !== 'any') chips.push({ label: WHEN[f.when], without: { ...f, when: 'any' } })
  const who = members.find(m => m.id === f.who)
  if (who) {
    const words = f.boxes.map(b => b === 'just' ? who.name : b === 'age' ? (who.grownUp ? t('grown-ups') : t('kids')) : t('family'))
    chips.push({ label: t('For {names}', { names: words.join(', ') || who.name }), without: { ...f, who: '' } })
  }
  if (f.categoryIds.length) chips.push({ label: categories.filter(c => f.categoryIds.includes(c.id)).map(c => c.name).join(', ') || t('Categories'), without: { ...f, categoryIds: [] } })
  if (f.markedBy) chips.push({ label: f.markedBy === 'any' ? t('Marked by someone') : f.markedBy === 'really' ? t('⭐ only') : t('Marked by {name}', { name: members.find(m => m.id === f.markedBy)?.name ?? t('someone') }), without: { ...f, markedBy: '' } })
  if (f.cost !== 'any') chips.push({ label: f.cost === 'free' ? t('Free') : t('Under ${amount}', { amount: f.cost }), without: { ...f, cost: 'any' } })
  return chips
}

/** The "Who it's for" boxes' words for a person: "Just for Maya", "For kids (Maya's age)", "For the family". */
export const boxLabel = (b: ForBox, m: Pick<Member, 'name' | 'grownUp'>) =>
  b === 'just' ? t('Just for {name}', { name: m.name }) : b === 'age' ? (m.grownUp ? t('For grown-ups') : t('For kids ({name}’s age)', { name: m.name })) : t('For the family')

/** Why an outing is for someone, for the sheet ("For Maya: kids 7–10"). Exposed for tests. */
export const whyForPerson = (o: Outing, m: Pick<Member, 'id' | 'grownUp' | 'birthday'>, today: string) => forBoxes(o, { id: m.id, grownUp: !!m.grownUp, birthday: m.birthday ?? null }, today)

/** The Board's Outings tray: this weekend (outings on Sat or Sun, then places someone ⭐), and coming
 * up in the next 30 days: ⭐ outings, and ticket dates (on sale, buy by) not yet handled. */
export function trayRows(outings: Outing[], today: string, kidId: string | null): { weekend: Outing[]; coming: { outing: Outing; note: string | null; on: string }[] } {
  const live = outings.filter(o => !o.archived && !isPast(o, today) && !(kidId && hiddenFromKid(o, kidId)))
  const [sat, sun] = weekendOf(today)
  const weekendOuts = live.filter(o => o.kind === 'upcoming' && onBetween(o, sat, sun))
  const places = live.filter(o => o.kind === 'place' && o.visitStatus !== 'been' && reallyCount(o) > 0).sort((a, b) => reallyCount(b) - reallyCount(a))
  const weekend = [...weekendOuts.sort((a, b) => reallyCount(b) - reallyCount(a) || (a.startsOn ?? '').localeCompare(b.startsOn ?? '')), ...places].slice(0, 5)
  const end = addDays(today, 30)
  const coming: { outing: Outing; note: string | null; on: string }[] = []
  for (const o of live) {
    if (weekend.includes(o) || o.kind === 'place') continue
    const sale = o.ticketsOnSaleAt?.slice(0, 10)
    if (!o.gotTickets && sale && sale >= today && sale <= end) coming.push({ outing: o, note: t('Tickets go on sale {date}', { date: day(sale, DAY) }), on: sale })
    else if (!o.gotTickets && o.buyBy && o.buyBy >= today && o.buyBy <= end) coming.push({ outing: o, note: t('Get tickets by {date}', { date: day(o.buyBy, DAY) }), on: o.buyBy })
    else if (reallyCount(o) > 0 && o.startsOn && o.startsOn > sun && o.startsOn <= end) coming.push({ outing: o, note: null, on: o.startsOn })
  }
  return { weekend, coming: coming.sort((a, b) => a.on.localeCompare(b.on)).slice(0, 5) }
}
