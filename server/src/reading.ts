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
