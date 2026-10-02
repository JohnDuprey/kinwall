// Books and audiobooks (ReadingData): progress is pages for a book, minutes for an audiobook. An entry
// without a format is a book. web/src/reading.ts is the web's copy - keep in step.
export type ReadingProgress = { format?: string; pagesRead?: number; totalPages?: number; minutesListened?: number; totalMinutes?: number };

export const isAudiobook = (d: ReadingProgress) => d.format === 'audiobook';

/** How far along, 0-100, or null without a length. */
export function readingPercent(d: ReadingProgress): number | null {
  const [done, total] = isAudiobook(d) ? [d.minutesListened, d.totalMinutes] : [d.pagesRead, d.totalPages];
  return total ? Math.min(100, Math.round(((done ?? 0) / total) * 100)) : null;
}

/** A finished book's pages, or null for an audiobook (and the other way round for minutes). */
export const pagesOf = (d: ReadingProgress) => (isAudiobook(d) ? null : d.totalPages ?? d.pagesRead ?? null);
export const minutesOf = (d: ReadingProgress) => (isAudiobook(d) ? d.totalMinutes ?? d.minutesListened ?? null : null);

/** One day's reading on a book: pages for a book, minutes for an audiobook. */
export type ReadingDay = { date: string; amount: number };
const KEEP_DAYS = 366;

/** The book's log once its progress moves from `old` to `next` on `today` (the household's day):
 * today grows by what was read, a same-day correction comes off it (never below zero), going back
 * on a later day (starting over) logs nothing, and switching between book and audiobook starts the
 * log over (undefined). Unchanged progress keeps the same log. About a year is kept. */
export function logReading(old: ReadingProgress & { log?: ReadingDay[] }, next: ReadingProgress, today: string): ReadingDay[] | undefined {
  if ((old.format ?? 'book') !== (next.format ?? 'book')) return undefined;
  const at = (d: ReadingProgress) => (isAudiobook(d) ? d.minutesListened : d.pagesRead) ?? 0;
  const delta = at(next) - at(old);
  const log = old.log ?? [];
  const last = log.at(-1);
  const isToday = last?.date === today;
  if (!delta || (delta < 0 && !isToday)) return old.log;
  const amount = Math.max(0, (isToday ? last.amount : 0) + delta);
  const out = [...(isToday ? log.slice(0, -1) : log), ...(amount ? [{ date: today, amount }] : [])].slice(-KEEP_DAYS);
  return out.length ? out : undefined;
}
