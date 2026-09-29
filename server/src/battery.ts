// The energy battery (routes/insights.ts GET /api/members/{id}/battery, notify.ts heads-up): a rough
// daily guess at how much energy a person has, for someone who finds a full day hard to keep up with.
// Pure and deterministic, no AI. Each day starts from a charge (sleep, feelings, recent days) and
// drains with what the day asks (events, chore points, a goal). Every point comes with its reason, so
// nothing is a hidden score. The person's own evening "How drained do you feel?" answers (sealed with
// the day's Temp check) calibrate it: `calibrate` compares what it said with how they felt, and the
// average gap nudges their drain. The method is in docs/using/battery.md.
//
// The weights are a rough guide picked by hand, not a measurement: keep them here, in one place,
// and keep the docs' table in step with them.
import { LATE_AFTER, type Sleep } from './insights.ts';

export const SLEEP_CHARGE: Record<Sleep, number> = { great: 90, good: 75, ok: 60, poorly: 40, terrible: 25 };
export const USUAL_CHARGE = 65; // no sleep answers in the last week to go on
export const FEELING_COST: Record<string, number> = { tired: 10, awful: 10, sore: 5, bad: 5 };
export const LATE_YESTERDAY = 10; // an event ended after 8 PM the day before
export const RECENT_DAYS = 3; // busy days this far back lower the start...
export const BUSY_DAY = 40; // ...a day that drained this much or more...
export const BUSY_COST = 5; // ...by this much each
export const EVENT = 10; // each timed event: getting ready, going, switching back
export const LONG_HOUR = 5; // each hour an event runs past its first...
export const LONG_MAX = 3; // ...up to this many hours
export const BACK_TO_BACK = 5; // an event starting under 15 minutes after the one before ends
export const BACK_TO_BACK_MINUTES = 15;
export const LATE_EVENING = 10; // the day's events end after 8 PM
export const CHORE_POINTS = 2; // chores drain 1 for every this many points (rounded up)...
export const CHORE_MAX = 15; // ...up to this much a day
export const GOAL = 5; // a Temp check goal for the day
export const LOW = 25; // a day ending under this (with something planned) gets a heads-up
export const HISTORY_DAYS = 7; // today and the 6 days before
export const FORECAST_DAYS = 3; // after today
// Calibration from "How drained do you feel?": each answer's range of levels by evening.
export const DRAINED_ANSWERS = ['full', 'ok', 'low', 'empty'] as const;
export type Drained = (typeof DRAINED_ANSWERS)[number];
export const FELT: Record<Drained, [number, number]> = { full: [75, 100], ok: [50, 74], low: [25, 49], empty: [0, 24] };
export const CALIBRATE_DAYS = 28; // answers from the last 4 weeks...
export const CALIBRATE_MIN = 10; // ...at least this many before it adjusts anything...
export const CALIBRATE_SHRINK = 5; // ...the average gap x n / (n + this), so few answers move it less...
export const CALIBRATE_MAX = 25; // ...and never more than this either way

export type BatteryEvent = { title: string; start: string; end: string }; // HH:MM household time; end '24:00' past midnight
// chores: how many of theirs are due (for the heads-up's words). choreDone: points of chores they
// finished that day; choreDue: points of their chores due and not done yet.
export type BatteryInput = { date: string; sleep: Sleep | null; feelings: string[]; goalSet: boolean; chores: number; choreDone: number; choreDue: number; events: BatteryEvent[] };
export type Reason = { text: string; points: number };
export type BatteryDay = { date: string; forecast: boolean; start: number; drain: number; level: number; reasons: Reason[]; lowBefore: string | null };
export type BatteryWarning = { date: string; text: string; suggestions: string[] };
// answered: their check-ins in the last 28 days; adjust: points added to each day's level (null until CALIBRATE_MIN).
export type Calibration = { answered: number; adjust: number | null };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lateEnd = (d: BatteryInput | undefined) => !!d?.events.some((e) => e.end > LATE_AFTER);
const weekday = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** What each of the day's events costs, in time order (long, back to back, the late evening on the one ending last). */
function eventCosts(events: BatteryEvent[]) {
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const last = sorted.reduce((l, e, i) => (e.end >= sorted[l].end ? i : l), 0);
  return sorted.map((e, i) => {
    const long = Math.min(LONG_MAX, Math.max(0, Math.ceil((minutes(e.end) - minutes(e.start)) / 60) - 1));
    const b2b = i > 0 && minutes(e.start) - minutes(sorted[i - 1].end) < BACK_TO_BACK_MINUTES;
    const late = i === last && e.end > LATE_AFTER;
    return { e, long, b2b, late, cost: EVENT + long * LONG_HOUR + (b2b ? BACK_TO_BACK : 0) + (late ? LATE_EVENING : 0) };
  });
}

/** The points a day's chores count for: what they did on days gone; today, what they did plus
 * what's still due (so ticking one off never adds more); days ahead, what's due. */
const chorePoints = (d: BatteryInput, today: string) => (d.date < today ? d.choreDone : d.choreDone + d.choreDue);
const choreDrain = (points: number) => Math.min(CHORE_MAX, Math.ceil(points / CHORE_POINTS));

/** How far off the battery has been for them: for each answered day in the last 28 up to today,
 * the gap from its level by evening to the range they said they felt (0 inside it). The average,
 * times n / (n + 5), within ±25; null until 10 answers. Skip isn't an answer. */
export function calibrate(days: Pick<BatteryDay, 'date' | 'level'>[], felt: Record<string, string | null | undefined>, today: string): Calibration {
  const gaps = days.filter((d) => d.date <= today && d.date > addDays(today, -CALIBRATE_DAYS) && FELT[felt[d.date] as Drained]).map((d) => {
    const [lo, hi] = FELT[felt[d.date] as Drained];
    return d.level < lo ? lo - d.level : d.level > hi ? hi - d.level : 0;
  });
  const n = gaps.length;
  if (n < CALIBRATE_MIN) return { answered: n, adjust: null };
  const shrunk = Math.round((gaps.reduce((s, g) => s + g, 0) / n) * (n / (n + CALIBRATE_SHRINK)));
  return { answered: n, adjust: Math.max(-CALIBRATE_MAX, Math.min(CALIBRATE_MAX, shrunk)) || 0 };
}

/** Each day's charge, drain and reasons for consecutive `inputs` (oldest first), and heads-ups for
 * today and after. Days after `today` are forecasts: no sleep or feelings yet, so they start from
 * the person's usual night (their average over the last week). `cal` (from `calibrate`) adds its
 * adjustment to every day's drain (never under 0), or says how many check-ins it has so far. */
export function battery(inputs: BatteryInput[], today: string, cal: Calibration = { answered: 0, adjust: null }): { days: BatteryDay[]; warnings: BatteryWarning[] } {
  const week = inputs.filter((d) => d.date <= today && d.date > addDays(today, -7) && d.sleep);
  const usual = week.length ? Math.round(week.reduce((s, d) => s + SLEEP_CHARGE[d.sleep!], 0) / week.length) : USUAL_CHARGE;
  const days: BatteryDay[] = [];
  const warnings: BatteryWarning[] = [];
  inputs.forEach((d, i) => {
    const forecast = d.date > today;
    const reasons: Reason[] = [];
    const add = (text: string, points: number) => { if (points) reasons.push({ text, points }); };
    // The start: sleep, feelings, and the days before.
    if (d.sleep && !forecast) add(`Sleep: ${d.sleep}`, SLEEP_CHARGE[d.sleep]);
    else add(forecast ? 'Sleep: usual' : 'Sleep: no answer yet', usual);
    if (!forecast) for (const f of new Set(d.feelings.map((f) => f.toLowerCase()))) add(`Feeling ${f}`, -(FEELING_COST[f] ?? 0));
    const before = inputs[i - 1]?.date === addDays(d.date, -1) ? inputs[i - 1] : undefined;
    if (lateEnd(before)) add('Late evening yesterday', -LATE_YESTERDAY);
    const busy = days.slice(-RECENT_DAYS).filter((p) => p.date >= addDays(d.date, -RECENT_DAYS) && p.drain >= BUSY_DAY).length;
    add(`${plural(busy, 'busy day')} before`, -busy * BUSY_COST);
    const start = clamp(reasons.reduce((s, r) => s + r.points, 0));
    // The drain: what the day asks.
    const costs = eventCosts(d.events);
    const goal = !forecast && d.goalSet;
    add(plural(costs.length, 'event'), -costs.length * EVENT);
    add('Long events', -costs.reduce((s, c) => s + c.long, 0) * LONG_HOUR);
    add(`${costs.filter((c) => c.b2b).length} back-to-back`, -costs.filter((c) => c.b2b).length * BACK_TO_BACK);
    add('Late evening', costs.some((c) => c.late) ? -LATE_EVENING : 0);
    const points = chorePoints(d, today);
    const chores = choreDrain(points);
    add(`Chores: ${plural(points, 'point')}`, -chores);
    add('Goal for today', goal ? -GOAL : 0);
    const planned = chores + (goal ? GOAL : 0) + costs.reduce((s, c) => s + c.cost, 0);
    // How they've felt lately: a positive adjustment takes off at most what the day drains.
    const adjust = cal.adjust === null ? 0 : Math.max(-planned, -cal.adjust);
    add("Adjusted for how you've felt lately", -adjust);
    if (cal.adjust === null && cal.answered && d.date === today) reasons.push({ text: `Learning: ${cal.answered} of ${CALIBRATE_MIN} check-ins`, points: 0 });
    const drain = planned + adjust;
    // The first event that takes it under LOW (chores, the goal and the adjustment count from the morning).
    let running = start - chores - (goal ? GOAL : 0) - adjust;
    const lowBefore = costs.find((c) => (running -= c.cost) < LOW)?.e.title ?? null;
    const day = { date: d.date, forecast, start, drain, level: Math.max(0, start - drain), reasons, lowBefore };
    days.push(day);
    if (d.date < today || !drain || day.level >= LOW) return;
    const parts = [costs.length && plural(costs.length, 'event'), chores && d.chores && plural(d.chores, 'chore'), costs.some((c) => c.late) && 'a late evening'].filter((p): p is string => !!p);
    const when = d.date === today ? 'Today' : d.date === addDays(today, 1) ? 'Tomorrow' : weekday(d.date);
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? 'a goal';
    warnings.push({
      date: d.date,
      text: `${when} looks full: ${list}. Maybe plan a rest or move something?`,
      suggestions: [lowBefore ? `Rest before ${lowBefore}` : 'Plan a rest in the middle of the day', 'Pick one thing to skip'],
    });
  });
  return { days, warnings };
}
