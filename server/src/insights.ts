// Insights from check-ins (routes/insights.ts): plain summaries and "connections" computed from a
// person's per-day series. Pure and deterministic, no AI. The method is in docs/using/insights.md:
// compare how often something happened on two kinds of days, and say so only with enough days on
// both sides and a big enough difference. Never causal wording, always the counts.
//
// The per-day series (InsightDay) is meant to be reused (e.g. spotting heavy days ahead), so keep
// it about one person and one household day, with nothing that isn't needed.

import { formatTime } from './timeFormat.ts';
import { msg, tm, words, type Lang } from './i18n.ts';

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

type Candidate = {
  id: string;
  /** Which side a day is on ('a' is the condition), or null to leave it out. */
  side: (d: InsightDay, before: InsightDay | undefined) => 'a' | 'b' | null;
  hit: (d: InsightDay) => boolean;
  /** "more" or "less" often: both whole sentences, so each language words them its own way. */
  text: (lang: Lang, more: boolean) => string;
  detail: string; // msg(): shown with tm(lang, detail, { late, n })
};

const CANDIDATES: Candidate[] = [
  {
    id: 'sleep-goal',
    side: (d) => (d.goalOutcome && d.sleep ? (sleptWell(d) ? 'a' : 'b') : null),
    hit: (d) => d.goalOutcome === 'yes',
    text: (lang, more) => { const { t } = words(lang); return more ? t('Goals were met more often after good sleep') : t('Goals were met less often after good sleep'); },
    detail: msg('Days after sleeping well or great, compared with other days. Only days with a goal check count.'),
  },
  {
    id: 'late-sleep',
    side: (d, before) => (before && d.sleep ? (late(before) ? 'a' : 'b') : null),
    hit: sleptWell,
    text: (lang, more) => { const { t } = words(lang); return more ? t('Slept well more often after a late event') : t('Slept well less often after a late event'); },
    detail: msg('Nights after an event that ended after {late}, compared with other nights. "Well" means well or great.'),
  },
  {
    id: 'late-tired',
    side: (d, before) => (before && d.feelings.length ? (late(before) ? 'a' : 'b') : null),
    hit: (d) => d.feelings.some((f) => f.toLowerCase() === 'tired'),
    text: (lang, more) => { const { t } = words(lang); return more ? t('Felt tired more often the day after a late event') : t('Felt tired less often the day after a late event'); },
    detail: msg('Days after an event that ended after {late}, compared with other days. Only days with feelings count.'),
  },
  {
    id: 'busy-goal',
    side: (d) => (d.goalOutcome ? (d.events >= BUSY_EVENTS ? 'a' : 'b') : null),
    hit: (d) => d.goalOutcome === 'yes',
    text: (lang, more) => { const { t } = words(lang); const n = BUSY_EVENTS; return more ? t('Goals were met more often on busy days, with {n} or more events', { n }) : t('Goals were met less often on busy days, with {n} or more events', { n }); },
    detail: msg('Days with {n} or more timed events on the calendar, compared with quieter days. Only days with a goal check count.'),
  },
  {
    id: 'chores-mood',
    side: (d) => (d.feelings.length ? (d.chores > 0 ? 'a' : 'b') : null),
    hit: (d) => d.feelings.some((f) => ['great', 'good'].includes(f.toLowerCase())),
    text: (lang, more) => { const { t } = words(lang); return more ? t('Felt great or good more often on days with chores done') : t('Felt great or good less often on days with chores done'); },
    detail: msg('Days with at least one chore done, compared with days without. Only days with feelings count.'),
  },
];

function connection(c: Candidate, days: InsightDay[], late: string, lang: Lang): Connection | null {
  const { t } = words(lang);
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
    id: c.id, text: t('{text} ({a} of {an} vs {b} of {bn})', { text: c.text(lang, diff > 0), a: a.hit, an: a.n, b: b.hit, bn: b.n }), detail: tm(lang, c.detail, { late, n: BUSY_EVENTS }),
    confidence: clear ? 'clear' : 'early', a, b,
  };
}

const prevDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

function duration(minutes: number, lang: Lang) {
  const { t } = words(lang);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? t('{h} h {m} min', { h, m }) : t('{h} h', { h })) : t('{m} min', { m });
}

function summarize(days: InsightDay[], lang: Lang) {
  const { t, tn } = words(lang);
  const out: { id: string; text: string }[] = [];
  const add = (id: string, text: string) => out.push({ id, text });
  const sum = (f: (d: InsightDay) => number) => days.reduce((s, d) => s + f(d), 0);
  add('checkins', tn(days.length, 'Checked in on {x} of {n} day', 'Checked in on {x} of {n} days', { x: days.filter((d) => d.checkedIn).length }));
  const slept = days.filter((d) => d.sleep);
  if (slept.length) add('sleep', tn(slept.length, 'Slept well or great on {x} of {n} night', 'Slept well or great on {x} of {n} nights', { x: slept.filter(sleptWell).length }));
  const goals = days.filter((d) => d.goalSet);
  if (goals.length) {
    const partly = goals.filter((d) => d.goalOutcome === 'partly').length;
    const x = goals.filter((d) => d.goalOutcome === 'yes').length;
    add('goals', partly
      ? tn(goals.length, 'Met {x} of {n} goal, and partly met {partly} more', 'Met {x} of {n} goals, and partly met {partly} more', { x, partly })
      : tn(goals.length, 'Met {x} of {n} goal', 'Met {x} of {n} goals', { x }));
  }
  const chores = sum((d) => d.chores);
  if (chores) add('chores', t('Did {chores} for {points}', { chores: tn(chores, '{n} chore', '{n} chores'), points: tn(sum((d) => d.points), '{n} point', '{n} points') }));
  const minutes = sum((d) => d.activityMinutes);
  if (minutes) add('activity', t('Spent {time} on activities', { time: duration(minutes, lang) }));
  const books = sum((d) => d.booksFinished);
  if (books) add('books', tn(books, 'Finished {n} book', 'Finished {n} books'));
  const busiest = Math.max(0, ...days.map((d) => d.events));
  const busy = days.filter((d) => d.events >= BUSY_EVENTS).length;
  if (busy) add('busy', tn(busy, '{x} or more events on {n} day (busiest: {most})', '{x} or more events on {n} days (busiest: {most})', { x: BUSY_EVENTS, most: busiest }));
  else if (busiest) add('busy', tn(busiest, 'Busiest day had {n} event', 'Busiest day had {n} events'));
  const entries = sum((d) => d.journalEntries);
  if (entries) add('journal', tn(entries, 'Wrote {n} journal entry', 'Wrote {n} journal entries'));
  return out;
}

/** Summaries, the most common feelings and any connections for a run of consecutive days.
 * `h12`: the family's clock (timeFormat.ts), for "after 8 PM" / "after 20:00"; `lang`: the words'. */
export function analyze(days: InsightDay[], h12 = true, lang: Lang = 'en') {
  const late = formatTime(LATE_AFTER, { h12, hourOnly: true });
  const counts = new Map<string, number>();
  for (const d of days) for (const f of new Set(d.feelings.map((f) => f.toLowerCase()))) counts.set(f, (counts.get(f) ?? 0) + 1);
  const topFeelings = [...counts].map(([feeling, n]) => ({ feeling, days: n })).sort((a, b) => b.days - a.days || a.feeling.localeCompare(b.feeling)).slice(0, 6);
  const daysWithCheckIns = days.filter((d) => d.checkedIn).length;
  const ready = daysWithCheckIns >= MIN_CHECKIN_DAYS;
  return {
    summary: summarize(days, lang),
    topFeelings,
    connections: {
      ready, daysWithCheckIns, needed: MIN_CHECKIN_DAYS,
      list: ready ? CANDIDATES.map((c) => connection(c, days, late, lang)).filter((c): c is Connection => !!c) : [],
    },
  };
}
