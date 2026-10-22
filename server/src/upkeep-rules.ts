// Home upkeep's dates (routes/upkeep.ts, notify.ts runUpkeep, docs/using/upkeep.md): when a job is
// next due, where it stands today, and which notes the morning tick owes. Pure, so
// test/upkeep-rules.test.ts covers it without a database. web/src/upkeep-rules.ts is an identical
// copy (the test checks), so the app shows the same dates the server works with.
//
//   once    due_on (else start_on, else the day it was added); done once, it's never due again.
//   after   every N days/weeks/months/years from the last time it was done. Done late, the next one
//           moves too. Never done: start_on, else the day it was added.
//   on      fixed months and a day (March 1; March and September). Done up to heads_up_days early
//           still counts for that date.
// Snooze ("Not this week") only moves the date shown; Skip ("Skip this time") counts as if done on
// that due date. Both go when the job is done.

export type RepeatKind = 'once' | 'after' | 'on';
export type Unit = 'day' | 'week' | 'month' | 'year';
export type UpkeepStatus = 'overdue' | 'due' | 'soon' | 'later' | 'done';

export interface JobFacts {
  repeatKind: RepeatKind;
  every: number | null;
  unit: Unit | null;
  onMonths: number[];
  onDay: number | null;
  startOn: string | null;
  dueOn: string | null;
  headsUpDays: number;
  snoozedUntil: string | null;
  skippedUntil: string | null;
  createdOn: string; // YYYY-MM-DD, the day it was added
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b later: positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m: 1-12
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** A day moved on by `every` units. Months and years keep the day of the month, or the month's last
 * day when it has fewer (every month from January 31: February 28, then March 28). */
export function addInterval(day: string, every: number, unit: Unit): string {
  if (unit === 'day') return addDays(day, every);
  if (unit === 'week') return addDays(day, every * 7);
  const [y, m, d] = day.split('-').map(Number);
  const months = (m - 1) + every * (unit === 'year' ? 12 : 1);
  const ny = y + Math.floor(months / 12), nm = (months % 12) + 1;
  return iso(ny, nm, Math.min(d, lastDayOf(ny, nm)));
}

/** The first of the job's fixed dates on or after `from`. */
export function nextOnDate(months: number[], day: number, from: string): string | null {
  const ms = [...new Set(months.filter((m) => m >= 1 && m <= 12))].sort((a, b) => a - b);
  if (!ms.length) return null;
  const [y] = from.split('-').map(Number);
  for (let year = y; year <= y + 1; year++) {
    for (const m of ms) {
      const d = iso(year, m, Math.min(Math.max(day, 1), lastDayOf(year, m)));
      if (d >= from) return d;
    }
  }
  return null;
}

/** When the job is due before any snooze: null once a one-off is done, or a schedule that can't be. */
export function scheduledDue(job: JobFacts, lastDone: string | null): string | null {
  const first = job.startOn ?? job.createdOn;
  if (job.repeatKind === 'once') return lastDone ? null : job.dueOn ?? first;
  if (job.repeatKind === 'after') {
    if (!job.every || !job.unit) return null;
    const base = lastDone && job.skippedUntil ? (lastDone > job.skippedUntil ? lastDone : job.skippedUntil) : lastDone ?? job.skippedUntil;
    return base ? addInterval(base, job.every, job.unit) : first;
  }
  if (!job.onDay) return null;
  // Done a little early still covers that date: the next one is past the heads-up window.
  const covered = [lastDone && addDays(lastDone, job.headsUpDays + 1), job.skippedUntil && addDays(job.skippedUntil, 1)].filter((d): d is string => !!d).sort().at(-1);
  return nextOnDate(job.onMonths, job.onDay, covered && covered > first ? covered : first);
}

/** When the job is due as shown: a snooze later than the schedule wins. */
export function nextDue(job: JobFacts, lastDone: string | null): string | null {
  const due = scheduledDue(job, lastDone);
  if (!due) return null;
  return job.snoozedUntil && job.snoozedUntil > due ? job.snoozedUntil : due;
}

export function statusOf(due: string | null, today: string, headsUpDays: number): UpkeepStatus {
  if (!due) return 'done';
  if (due < today) return 'overdue';
  if (due === today) return 'due';
  return daysBetween(today, due) <= headsUpDays ? 'soon' : 'later';
}

// The morning tick's notes, each once by its key (sent_notifications), so a missed morning catches
// up and nothing repeats. Overdue reminders: 7 days late, then every 14 days, three at most.
export const LATE_FIRST = 7;
export const LATE_EVERY = 14;
export const LATE_MAX = 3;
export const WARRANTY_DAYS = 30;

export type UpkeepNote =
  | { key: string; kind: 'heads-up' | 'due' | 'late'; jobId: string; due: string; late?: number }
  | { key: string; kind: 'warranty'; thingId: string; until: string };

export function dueNotes(jobs: { id: string; due: string | null; headsUpDays: number }[], things: { id: string; warrantyUntil: string | null; archived: boolean }[], today: string): UpkeepNote[] {
  const out: UpkeepNote[] = [];
  for (const j of jobs) {
    if (!j.due) continue;
    const gap = daysBetween(today, j.due); // days until due; negative: late
    if (gap > 0 && gap <= j.headsUpDays) out.push({ key: 'upkeep:heads-up:' + j.id + ':' + j.due, kind: 'heads-up', jobId: j.id, due: j.due });
    else if (gap <= 0 && -gap < LATE_FIRST) out.push({ key: 'upkeep:due:' + j.id + ':' + j.due, kind: 'due', jobId: j.id, due: j.due });
    else if (-gap >= LATE_FIRST) {
      const n = Math.min(LATE_MAX, Math.floor((-gap - LATE_FIRST) / LATE_EVERY) + 1);
      out.push({ key: 'upkeep:late' + n + ':' + j.id + ':' + j.due, kind: 'late', jobId: j.id, due: j.due, late: -gap });
    }
  }
  for (const t of things) {
    if (t.archived || !t.warrantyUntil) continue;
    const gap = daysBetween(today, t.warrantyUntil);
    if (gap >= 0 && gap <= WARRANTY_DAYS) out.push({ key: 'upkeep:warranty:' + t.id + ':' + t.warrantyUntil, kind: 'warranty', thingId: t.id, until: t.warrantyUntil });
  }
  return out;
}

/** Whether a job's supplies go on the list today (once per due date, by key). */
export const suppliesDue = (due: string | null, suppliesDays: number, today: string) => !!due && daysBetween(today, due) <= suppliesDays;
