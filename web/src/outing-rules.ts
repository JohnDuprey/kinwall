// Outings' rules (docs/using/outings.md): who an outing is for, when it's on, and which ones a
// filter keeps. Pure, no dependencies. Dates are YYYY-MM-DD in household time.
//
// Two copies, kept identical (a test checks): server/src/outing-rules.ts (the API and MCP) and
// web/src/outing-rules.ts (the app's filters, and the demo, which has no server).
// The Docker and web builds each see only their own folder.

export type Audience = 'kids' | 'family' | 'grownups';
export type InterestLevel = 'interested' | 'really';
export interface OutingFacts {
  kind: 'upcoming' | 'place';
  categoryId: string | null;
  startsOn: string | null;
  endsOn: string | null;
  priceCents: number | null;
  audience: Audience[];
  memberIds: string[];
  ageMin: number | null;
  ageMax: number | null;
  interest: { memberId: string; level: InterestLevel }[];
}
export interface PersonFacts { id: string; grownUp: boolean; birthday: string | null }

/** The "Is this for me?" boxes: 'just' names the person, 'age' is For kids (a kid whose age fits)
 * or For grown-ups (a grown-up), 'family' is for the whole family. */
export type ForBox = 'just' | 'age' | 'family';
export const FOR_BOXES: readonly ForBox[] = ['just', 'age', 'family'];

/** Whole years on `today`, or null without a birth year (birthdays may be --MM-DD). */
export function ageOn(birthday: string | null, today: string): number | null {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const years = Number(today.slice(0, 4)) - Number(birthday.slice(0, 4));
  return today.slice(5) < birthday.slice(5) ? years - 1 : years;
}

/** Which of a person's boxes an outing ticks. A kid with no known age fits any age range. */
export function forBoxes(o: OutingFacts, p: PersonFacts, today: string): ForBox[] {
  const age = ageOn(p.birthday, today);
  const fits = age === null || ((o.ageMin === null || age >= o.ageMin) && (o.ageMax === null || age <= o.ageMax));
  const out: ForBox[] = [];
  if (o.memberIds.includes(p.id)) out.push('just');
  if (p.grownUp ? o.audience.includes('grownups') : o.audience.includes('kids') && fits) out.push('age');
  if (o.audience.includes('family')) out.push('family');
  return out;
}

export const isForPerson = (o: OutingFacts, p: PersonFacts, today: string, boxes: readonly ForBox[] = FOR_BOXES) => forBoxes(o, p, today).some((b) => boxes.includes(b));

/** For grown-ups and nobody else: kids' own devices don't list it, unless it names that kid. */
export const grownUpsOnly = (o: Pick<OutingFacts, 'audience'>) => o.audience.includes('grownups') && !o.audience.includes('kids') && !o.audience.includes('family');
export const hiddenFromKid = (o: Pick<OutingFacts, 'audience' | 'memberIds'>, kidId: string) => grownUpsOnly(o) && !o.memberIds.includes(kidId);

/** The last day it's on: a run's end, else its day. Null for places and dates not announced yet. */
export const lastDay = (o: Pick<OutingFacts, 'kind' | 'startsOn' | 'endsOn'>) => (o.kind === 'place' ? null : o.endsOn ?? o.startsOn);
export const isPast = (o: Pick<OutingFacts, 'kind' | 'startsOn' | 'endsOn'>, today: string) => {
  const last = lastDay(o);
  return last !== null && last < today;
};
/** On at some point from `from` to `to` (inclusive). Places always are; an undated outing never is. */
export const onBetween = (o: Pick<OutingFacts, 'kind' | 'startsOn' | 'endsOn'>, from: string, to: string) =>
  o.kind === 'place' || (!!o.startsOn && o.startsOn <= to && (o.endsOn ?? o.startsOn) >= from);

export const interestOf = (o: Pick<OutingFacts, 'interest'>, memberId: string): InterestLevel | null => o.interest.find((i) => i.memberId === memberId)?.level ?? null;

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();
/** This weekend's Saturday and Sunday: today's on a weekend, else the coming one. */
export function weekendOf(today: string): [string, string] {
  const wd = weekday(today);
  const sat = wd === 0 ? addDays(today, -1) : addDays(today, 6 - wd);
  return [sat, addDays(sat, 1)];
}

/** What a list of outings can be narrowed to. Every part is optional; all given parts must match.
 * from/to: on in that window (undated ones drop out). past: only past ones (else past ones drop out).
 * for: any of these people (their ticked boxes) or audiences. markedBy: 'any' (anyone marked it),
 * 'really' (anyone ⭐), or member ids (any of them marked it). */
export interface OutingFilter {
  kind?: OutingFacts['kind'];
  from?: string;
  to?: string;
  past?: boolean;
  categoryIds?: string[];
  for?: { people?: PersonFacts[]; boxes?: readonly ForBox[]; audiences?: Audience[] };
  markedBy?: 'any' | 'really' | string[];
  reallyOnly?: boolean;
  free?: boolean;
  maxPriceCents?: number;
}

export function matchesFilter(o: OutingFacts, f: OutingFilter, today: string): boolean {
  if (f.kind && o.kind !== f.kind) return false;
  if (f.past ? !isPast(o, today) : isPast(o, today)) return false;
  if ((f.from || f.to) && !onBetween(o, f.from ?? '0000-01-01', f.to ?? '9999-12-31')) return false;
  if (f.categoryIds?.length && !(o.categoryId && f.categoryIds.includes(o.categoryId))) return false;
  if (f.for && ((f.for.people?.length ?? 0) > 0 || (f.for.audiences?.length ?? 0) > 0)) {
    const person = f.for.people?.some((p) => isForPerson(o, p, today, f.for!.boxes));
    if (!person && !f.for.audiences?.some((a) => o.audience.includes(a))) return false;
  }
  const marks = o.interest.filter((i) => !f.reallyOnly || i.level === 'really');
  if (f.markedBy === 'any' && !marks.length) return false;
  if (f.markedBy === 'really' && !marks.some((i) => i.level === 'really')) return false;
  if (Array.isArray(f.markedBy) && !marks.some((i) => (f.markedBy as string[]).includes(i.memberId))) return false;
  if (!Array.isArray(f.markedBy) && f.reallyOnly && !marks.length) return false;
  if (f.free && o.priceCents !== 0) return false;
  if (f.maxPriceCents !== undefined && (o.priceCents === null || o.priceCents > f.maxPriceCents)) return false;
  return true;
}

// ---------- Ideas (the Outings tab's Ideas, the Board tray's column, MCP suggest_outings) ----------
// Ready-made questions answered by simple rules from what's saved, the family's busy events and the
// forecast. No AI. Every card is the same on every screen for the same day ("Surprise me" is picked
// from the date). Category ids are the default ones (migration 0111); a family's own categories are
// neither indoor nor outdoor.

/** What an idea needs to know about an outing, beyond OutingFacts. */
export interface IdeaOuting extends OutingFacts {
  id: string;
  title: string;
  startTime: string | null;
  endTime: string | null;
  visitStatus: 'want' | 'been' | null;
  lastVisitedOn: string | null;
  buyBy: string | null;
  archived: boolean;
}
/** A busy stretch on a household day, in minutes from midnight (an all-day busy event: 0 to 1440). */
export interface BusyStretch { day: string; from: number; to: number }
/** A day of the forecast: rainChance in percent, code the WMO weather code. */
export interface ForecastDay { date: string; rainChance: number | null; code: number }
export interface Idea { key: string; emoji: string; title: string; note: string | null; outingIds: string[] }

const INDOOR = ['oc-art', 'oc-library', 'oc-movies', 'oc-shows'];
const OUTDOOR = ['oc-outdoors', 'oc-water'];
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
export const rainy = (f: ForecastDay | undefined) => !!f && ((f.rainChance ?? 0) >= 50 || RAIN_CODES.has(f.code));
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${m % 720 === 0 ? 12 : Math.floor(m / 60) % 12 || 12}${m % 60 ? `:${String(m % 60).padStart(2, '0')}` : ''} ${m < 720 ? 'AM' : 'PM'}`;

/** ⭐ counts 3, 👀 1, per person. */
export const interestScore = (o: Pick<OutingFacts, 'interest'>) => o.interest.reduce((n, i) => n + (i.level === 'really' ? 3 : 1), 0);

/** Open stretches of at least `min` minutes between 9 AM and 8 PM on `day`, around busy events. */
export function openStretches(day: string, busy: BusyStretch[], min = 180): { from: number; to: number }[] {
  const taken = busy.filter((b) => b.day === day).sort((a, b) => a.from - b.from);
  const out: { from: number; to: number }[] = [];
  let at = 9 * 60;
  for (const b of taken) {
    if (b.from - at >= min) out.push({ from: at, to: Math.min(b.from, 20 * 60) });
    at = Math.max(at, b.to);
  }
  if (20 * 60 - at >= min) out.push({ from: at, to: 20 * 60 });
  return out.filter((s) => s.to - s.from >= min);
}

/** Clashes with a busy event: a timed outing on `day` whose time overlaps one. */
const clashes = (o: IdeaOuting, day: string, busy: BusyStretch[]) => {
  if (!o.startTime) return busy.some((b) => b.day === day && b.from === 0 && b.to >= 1440);
  const from = mins(o.startTime), to = o.endTime ? mins(o.endTime) : from + 60;
  return busy.some((b) => b.day === day && b.from < to && b.to > from);
};

/** A pick that's the same all day, everywhere: a hash of the date. */
export function dayPick<T>(items: T[], today: string, weight: (x: T) => number = () => 1): T | null {
  if (!items.length) return null;
  let h = 2166136261;
  for (const ch of today) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const total = items.reduce((n, x) => n + Math.max(weight(x), 0.01), 0);
  let r = ((h >>> 0) / 4294967296) * total;
  for (const x of items) { r -= Math.max(weight(x), 0.01); if (r < 0) return x; }
  return items[items.length - 1];
}

/** The idea cards, in order. `outings` are what this viewer may see; `grownUp`: a grown-up's device
 * gets Date night. Cards with nothing in them are left out. */
export function outingIdeas(all: IdeaOuting[], today: string, busy: BusyStretch[], forecast: ForecastDay[], opts: { grownUp: boolean }): Idea[] {
  const live = all.filter((o) => !o.archived && !isPast(o, today));
  const places = live.filter((o) => o.kind === 'place');
  const [sat, sun] = weekendOf(today);
  const rain = (day: string) => rainy(forecast.find((f) => f.date === day));
  const weekendRain = rain(sat) || rain(sun);
  const rank = (list: IdeaOuting[], wet = false) => [...list].sort((a, b) =>
    (wet ? Number(OUTDOOR.includes(a.categoryId ?? '')) - Number(OUTDOOR.includes(b.categoryId ?? '')) || Number(INDOOR.includes(b.categoryId ?? '')) - Number(INDOOR.includes(a.categoryId ?? '')) : 0)
    || interestScore(b) - interestScore(a) || Number(b.audience.includes('family')) - Number(a.audience.includes('family')) || Number(b.priceCents === 0) - Number(a.priceCents === 0) || a.title.localeCompare(b.title));
  const ids = (list: IdeaOuting[], n = 5) => list.slice(0, n).map((o) => o.id);
  const ideas: Idea[] = [];
  const add = (i: Idea) => { if (i.outingIds.length) ideas.push(i); };

  // This weekend: on Sat or Sun and not clashing with a busy event, plus places someone wants to go.
  const weekend = live.filter((o) => o.kind === 'upcoming' && [sat, sun].some((d) => onBetween(o, d, d) && !clashes(o, d, busy)));
  add({ key: 'weekend', emoji: '🗓', title: 'This weekend', note: null, outingIds: ids(rank([...weekend, ...places.filter((p) => p.visitStatus !== 'been' && interestScore(p) > 0)], weekendRain)) });

  // An open stretch on the weekend, and what fits in it.
  for (const day of [sat, sun]) {
    if (day < today) continue;
    const s = openStretches(day, busy)[0];
    if (!s) continue;
    const part = s.to <= 13 * 60 ? ' morning' : s.from >= 17 * 60 ? ' evening' : s.from >= 12 * 60 ? ' afternoon' : '';
    const fits = live.filter((o) => o.kind === 'place' || (onBetween(o, day, day) && !clashes(o, day, busy) && (!o.startTime || (mins(o.startTime) >= s.from && mins(o.startTime) < s.to))));
    add({ key: `open-${day}`, emoji: '☀️', title: `${DAY_NAME[weekday(day)]}${part} is open`, note: `${hhmm(s.from)} to ${hhmm(s.to)}`, outingIds: ids(rank(fits, rain(day)), 3) });
    break;
  }

  // Rain on the weekend: indoor things first.
  if (weekendRain) {
    const day = rain(sat) ? sat : sun;
    add({ key: 'rain', emoji: '🌧', title: `Rain ${DAY_NAME[weekday(day)]}: indoor ideas`, note: null, outingIds: ids(rank(live.filter((o) => INDOOR.includes(o.categoryId ?? '') && (o.kind === 'place' || onBetween(o, day, day))))) });
  }

  // Next weekend with nothing busy, and what's marked on it.
  const [nsat, nsun] = [addDays(sat, 7), addDays(sun, 7)];
  if (!busy.some((b) => b.day === nsat || b.day === nsun)) {
    const marked = live.filter((o) => o.kind === 'upcoming' && onBetween(o, nsat, nsun) && o.interest.length);
    add({ key: 'next-weekend', emoji: '🆓', title: 'Nothing planned next weekend', note: marked.length ? null : 'Places you want to go', outingIds: ids(rank(marked.length ? marked : places.filter((p) => p.visitStatus !== 'been'))) });
  }

  // Free things in the next 30 days, and free places.
  add({ key: 'free', emoji: '🎈', title: 'Free things', note: null, outingIds: ids(rank(live.filter((o) => o.priceCents === 0 && (o.kind === 'place' || onBetween(o, today, addDays(today, 30)))))) });

  // Next month, ⭐ first; ones you need tickets for are flagged.
  const nm = new Date(`${today.slice(0, 7)}-15T12:00:00Z`); nm.setUTCMonth(nm.getUTCMonth() + 1);
  const month = nm.toISOString().slice(0, 7);
  const nextMonth = live.filter((o) => o.kind === 'upcoming' && o.startsOn?.startsWith(month));
  const tickets = nextMonth.filter((o) => o.buyBy).length;
  add({ key: 'next-month', emoji: '📆', title: `In ${nm.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })}`, note: tickets ? `${tickets} need${tickets === 1 ? 's' : ''} tickets ahead` : null, outingIds: ids(rank(nextMonth)) });

  // Date night: grown-ups' evening outings, soonest first (grown-ups' devices only).
  if (opts.grownUp) {
    const night = live.filter((o) => o.kind === 'upcoming' && o.startsOn && o.audience.includes('grownups') && !o.audience.includes('kids') && (!o.startTime || mins(o.startTime) >= 17 * 60));
    add({ key: 'date-night', emoji: '🌙', title: 'Date night', note: null, outingIds: ids([...night].sort((a, b) => (a.startsOn ?? '').localeCompare(b.startsOn ?? ''))) });
  }

  // Places you haven't been in a while (6 months), and ones you want to try.
  const longAgo = addDays(today, -182);
  add({ key: 'a-while', emoji: '🧭', title: 'Haven’t been in a while', note: null, outingIds: ids(rank(places.filter((p) => p.visitStatus === 'want' || (p.visitStatus === 'been' && (!p.lastVisitedOn || p.lastVisitedOn < longAgo))))) });

  // Surprise me: one weighted pick from the next 30 days and the places.
  const pool = live.filter((o) => o.kind === 'place' || onBetween(o, today, addDays(today, 30)));
  const pick = dayPick(pool, today, (o) => 1 + interestScore(o));
  if (pick) add({ key: 'surprise', emoji: '🎲', title: 'Surprise me', note: null, outingIds: [pick.id] });
  return ideas;
}
