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
