// What a synced to-do item looks like on both sides (tasks/sync.ts), and the rules for merging them.
// Pure: no I/O, so test/task-map.test.ts covers it directly.

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

/** The fields that sync, in Kinwall's terms. priority is null where the other app has none (Google Tasks). */
export type TaskFields = { title: string; notes: string | null; due: string | null; done: boolean; priority: Priority | null };

export const FIELDS = ['title', 'notes', 'due', 'done', 'priority'] as const satisfies readonly (keyof TaskFields)[];

/** Todoist's API numbers priority backwards from its app: 4 is the red "P1", 1 the plain "P4" (no
 * priority). Kinwall's normal is "no flag", so it pairs with P4; low is P3, the one flag below the
 * rest; high is P2 and urgent P1. One to one, so a round trip never changes a level. */
const TO_TODOIST: Record<Priority, number> = { normal: 1, low: 2, high: 3, urgent: 4 };
const FROM_TODOIST: Record<number, Priority> = { 1: 'normal', 2: 'low', 3: 'high', 4: 'urgent' };
export const todoistPriority = (p: Priority): number => TO_TODOIST[p];
export const fromTodoistPriority = (p: unknown): Priority => FROM_TODOIST[Number(p)] ?? 'normal';

/** The calendar day of an instant in a time zone, 'YYYY-MM-DD'. */
export function dayIn(tz: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** A Todoist due as a Kinwall due date (a day: Kinwall items have no time).
 * - all-day: date is 'YYYY-MM-DD', taken as is;
 * - floating time ('2026-10-20T15:00:00', no zone): the day as written;
 * - fixed time ('…Z' or with an offset, in datetime or date): the day it falls on in the family's zone. */
export function fromTodoistDue(due: { date?: string | null; datetime?: string | null } | null | undefined, tz: string): string | null {
  const v = due?.datetime || due?.date;
  if (!v) return null;
  if (/(Z|[+-]\d\d:?\d\d)$/.test(v)) {
    const at = new Date(v);
    return Number.isNaN(at.getTime()) ? v.slice(0, 10) : dayIn(tz, at);
  }
  return v.slice(0, 10);
}

/** Google Tasks keeps only a day and sends it as midnight UTC ('2026-10-20T00:00:00.000Z'): the
 * date part is the day. Converting it to the family's zone would move it to the day before in the
 * Americas, so it's never converted. */
export const fromGoogleDue = (due: string | null | undefined): string | null => (due ? due.slice(0, 10) : null);
export const toGoogleDue = (day: string | null): string | null => (day ? `${day}T00:00:00.000Z` : null);

/** Microsoft To Do's importance has three levels: Kinwall's urgent is high there (one way: a task
 * that's high in To Do is high in Kinwall). */
export const msImportance = (p: Priority): 'low' | 'normal' | 'high' => (p === 'urgent' ? 'high' : p);
export const fromMsImportance = (v: unknown): Priority => (v === 'low' || v === 'high' ? v : 'normal');

/** To Do keeps a due day as midnight in a zone it names ({ dateTime: '2026-10-20T00:00:00.0000000',
 * timeZone }): the date part is the day, in that zone, so it's never converted. */
export const fromMsDue = (due: { dateTime?: string | null } | null | undefined): string | null => (due?.dateTime ? due.dateTime.slice(0, 10) : null);

export const cleanNotes = (s: string | null | undefined): string | null => (s && s.trim() ? s : null);

/** Merging one item. Each field on its own, against what both sides last agreed (`base`):
 * - the same on both sides: nothing to do;
 * - changed on one side only: that side's value wins;
 * - changed on both: the side changed last wins, by its updated time (`localNewer`; a tie goes to
 *   Kinwall);
 * - never synced (no base: an item matched by title on the first sync): a field set on one side
 *   only (notes, a due date, a priority other than normal) is kept; set on both, the newer wins.
 * `keys` are the fields this app syncs. */
export function mergeFields(base: TaskFields | null, local: TaskFields, remote: TaskFields, localNewer: boolean, keys: readonly (keyof TaskFields)[] = FIELDS): TaskFields {
  const out: TaskFields = { ...local };
  for (const k of keys) {
    const l = local[k], r = remote[k];
    if (l === r) continue;
    const take = base
      ? (l === base[k] ? r : r === base[k] ? l : localNewer ? l : r)
      : (unset(l) ? r : unset(r) ? l : localNewer ? l : r);
    (out as Record<string, unknown>)[k] = take;
  }
  return out;
}

const unset = (v: unknown) => v === null || v === 'normal';

/** The fields of `next` that differ from `from`. */
export function changed(from: TaskFields, next: TaskFields, keys: readonly (keyof TaskFields)[] = FIELDS): Partial<TaskFields> {
  const out: Partial<TaskFields> = {};
  for (const k of keys) if (from[k] !== next[k]) (out as Record<string, unknown>)[k] = next[k];
  return out;
}
