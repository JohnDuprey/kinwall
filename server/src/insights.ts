// Insights from check-ins (routes/insights.ts): plain summaries and "connections" computed from a
// person's per-day series. Pure and deterministic, no AI. The method is in docs/using/insights.md:
// compare how often something happened on two kinds of days, and say so only with enough days on
// both sides and a big enough difference. Never causal wording, always the counts.
//
// The per-day series (InsightDay) is meant to be reused (e.g. spotting heavy days ahead), so keep
// it about one person and one household day, with nothing that isn't needed.

import { formatTime } from './timeFormat.ts';

export type Sleep = 'great' | 'good' | 'ok' | 'poorly' | 'terrible';
export type Outcome = 'yes' | 'partly' | 'no';
export type InsightDay = {
  date: string; // household day
  checkedIn: boolean; // answered any Temp check question that day
  sleep: Sleep | null;
  feelings: string[];
  goalSet: boolean;
  goalOutcome: Outcome | null; // the evening goal check
  journalEntries: number;
  journalMoods: string[]; // entry moods (emoji), never the words
  chores: number; // approved chore completions credited to them
  points: number; // points from those chores
  activityMinutes: number; // activity plugin play time
  booksFinished: number;
  events: number; // timed events starting that day: theirs and the family's (untagged)
  lastEventEnd: string | null; // HH:MM household time, latest end of those; '24:00' past midnight
};

export const MIN_CHECKIN_DAYS = 21; // about 3 weeks of check-ins before any connection
export const MIN_GROUP = 5; // days on each side
export const MIN_DIFF = 20; // percentage points
export const CLEAR = { group: 10, diff: 30 }; // "Clear pattern" from here; below it "Early sign"
export const LATE_AFTER = '20:00'; // an event ending after 8 PM household time is a late one
export const BUSY_EVENTS = 3;

export type Tally = { hit: number; n: number };
export type Connection = { id: string; text: string; detail: string; confidence: 'early' | 'clear'; a: Tally; b: Tally };

const sleptWell = (d: InsightDay) => d.sleep === 'great' || d.sleep === 'good';
const late = (d: InsightDay | undefined) => !!d?.lastEventEnd && d.lastEventEnd > LATE_AFTER;
const pct = (t: Tally) => (t.hit / t.n) * 100;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

type Candidate = {
  id: string;
  /** Which side a day is on ('a' is the condition), or null to leave it out. */
  side: (d: InsightDay, before: InsightDay | undefined) => 'a' | 'b' | null;
  hit: (d: InsightDay) => boolean;
  text: (more: 'more' | 'less') => string;
  detail: string;
};

const CANDIDATES: Candidate[] = [
  {
    id: 'sleep-goal',
    side: (d) => (d.goalOutcome && d.sleep ? (sleptWell(d) ? 'a' : 'b') : null),
    hit: (d) => d.goalOutcome === 'yes',
    text: (m) => `Goals were met ${m} often after good sleep`,
    detail: 'Days after sleeping well or great, compared with other days. Only days with a goal check count.',
  },
  {
    id: 'late-sleep',
    side: (d, before) => (before && d.sleep ? (late(before) ? 'a' : 'b') : null),
    hit: sleptWell,
    text: (m) => `Slept well ${m} often after a late event`,
    detail: 'Nights after an event that ended after {late}, compared with other nights. "Well" means well or great.',
  },
  {
    id: 'late-tired',
    side: (d, before) => (before && d.feelings.length ? (late(before) ? 'a' : 'b') : null),
    hit: (d) => d.feelings.some((f) => f.toLowerCase() === 'tired'),
    text: (m) => `Felt tired ${m} often the day after a late event`,
    detail: 'Days after an event that ended after {late}, compared with other days. Only days with feelings count.',
  },
  {
    id: 'busy-goal',
    side: (d) => (d.goalOutcome ? (d.events >= BUSY_EVENTS ? 'a' : 'b') : null),
    hit: (d) => d.goalOutcome === 'yes',
    text: (m) => `Goals were met ${m} often on busy days, with ${BUSY_EVENTS} or more events`,
    detail: `Days with ${BUSY_EVENTS} or more timed events on the calendar, compared with quieter days. Only days with a goal check count.`,
  },
  {
    id: 'chores-mood',
    side: (d) => (d.feelings.length ? (d.chores > 0 ? 'a' : 'b') : null),
    hit: (d) => d.feelings.some((f) => ['great', 'good'].includes(f.toLowerCase())),
    text: (m) => `Felt great or good ${m} often on days with chores done`,
    detail: 'Days with at least one chore done, compared with days without. Only days with feelings count.',
  },
];

function connection(c: Candidate, days: InsightDay[], late: string): Connection | null {
  const a = { hit: 0, n: 0 };
  const b = { hit: 0, n: 0 };
  days.forEach((d, i) => {
    const side = c.side(d, days[i - 1]?.date === prevDay(d.date) ? days[i - 1] : undefined);
    if (!side) return;
    const t = side === 'a' ? a : b;
    t.n++;
    if (c.hit(d)) t.hit++;
  });
  if (a.n < MIN_GROUP || b.n < MIN_GROUP) return null;
  const diff = Math.round(pct(a) - pct(b));
  if (Math.abs(diff) < MIN_DIFF) return null;
  const clear = Math.min(a.n, b.n) >= CLEAR.group && Math.abs(diff) >= CLEAR.diff;
  return {
    id: c.id, text: `${c.text(diff > 0 ? 'more' : 'less')} (${a.hit} of ${a.n} vs ${b.hit} of ${b.n})`, detail: c.detail.replace('{late}', late),
    confidence: clear ? 'clear' : 'early', a, b,
  };
}

const prevDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

function duration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

function summarize(days: InsightDay[]) {
  const out: { id: string; text: string }[] = [];
  const add = (id: string, text: string) => out.push({ id, text });
  const sum = (f: (d: InsightDay) => number) => days.reduce((s, d) => s + f(d), 0);
  add('checkins', `Checked in on ${days.filter((d) => d.checkedIn).length} of ${plural(days.length, 'day')}`);
  const slept = days.filter((d) => d.sleep);
  if (slept.length) add('sleep', `Slept well or great on ${slept.filter(sleptWell).length} of ${plural(slept.length, 'night')}`);
  const goals = days.filter((d) => d.goalSet);
  if (goals.length) {
    const partly = goals.filter((d) => d.goalOutcome === 'partly').length;
    add('goals', `Met ${goals.filter((d) => d.goalOutcome === 'yes').length} of ${plural(goals.length, 'goal')}${partly ? `, and partly met ${partly} more` : ''}`);
  }
  const chores = sum((d) => d.chores);
  if (chores) add('chores', `Did ${plural(chores, 'chore')} for ${plural(sum((d) => d.points), 'point')}`);
  const minutes = sum((d) => d.activityMinutes);
  if (minutes) add('activity', `Spent ${duration(minutes)} on activities`);
  const books = sum((d) => d.booksFinished);
  if (books) add('books', `Finished ${plural(books, 'book')}`);
  const busiest = Math.max(0, ...days.map((d) => d.events));
  const busy = days.filter((d) => d.events >= BUSY_EVENTS).length;
  if (busy) add('busy', `${BUSY_EVENTS} or more events on ${plural(busy, 'day')} (busiest: ${busiest})`);
  else if (busiest) add('busy', `Busiest day had ${plural(busiest, 'event')}`);
  const entries = sum((d) => d.journalEntries);
  if (entries) add('journal', `Wrote ${plural(entries, 'journal entry', 'journal entries')}`);
  return out;
}

/** Summaries, the most common feelings and any connections for a run of consecutive days.
 * `h12`: the family's clock (timeFormat.ts), for "after 8 PM" / "after 20:00". */
export function analyze(days: InsightDay[], h12 = true) {
  const late = formatTime(LATE_AFTER, { h12, hourOnly: true });
  const counts = new Map<string, number>();
  for (const d of days) for (const f of new Set(d.feelings.map((f) => f.toLowerCase()))) counts.set(f, (counts.get(f) ?? 0) + 1);
  const topFeelings = [...counts].map(([feeling, n]) => ({ feeling, days: n })).sort((a, b) => b.days - a.days || a.feeling.localeCompare(b.feeling)).slice(0, 6);
  const daysWithCheckIns = days.filter((d) => d.checkedIn).length;
  const ready = daysWithCheckIns >= MIN_CHECKIN_DAYS;
  return {
    summary: summarize(days),
    topFeelings,
    connections: {
      ready, daysWithCheckIns, needed: MIN_CHECKIN_DAYS,
      list: ready ? CANDIDATES.map((c) => connection(c, days, late)).filter((c): c is Connection => !!c) : [],
    },
  };
}
