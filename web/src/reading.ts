// Books and audiobooks (Trackers.tsx, Snapshot.tsx): progress is pages for a book, minutes for an
// audiobook; an entry without a format is a book. Pure, so web/test/reading.test.ts covers it.
// server/src/reading.ts is the server's copy - keep in step.
import type { ReadingData, ReadingDay } from './types.ts'

export const isAudiobook = (d: Pick<ReadingData, 'format'>) => d.format === 'audiobook'

/** How far along, 0-100, or null without a length. */
export function readingPercent(d: ReadingData): number | null {
  const [done, total] = isAudiobook(d) ? [d.minutesListened, d.totalMinutes] : [d.pagesRead, d.totalPages]
  return total ? Math.min(100, Math.round(((done ?? 0) / total) * 100)) : null
}

/** Logging this page (or minute) reaches the end, so saving marks it finished. */
export const logReachesEnd = (d: ReadingData, n: number) => {
  const total = isAudiobook(d) ? d.totalMinutes : d.totalPages
  return !!total && n >= total
}

/** 130 → "2h 10m", 60 → "1h", 45 → "45m". */
export const hoursMinutes = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** A shelf row's progress: "2h 10m left" for an audiobook with a length, else the percent or page. */
export function left(d: ReadingData): string {
  if (isAudiobook(d)) {
    if (d.totalMinutes) return `${hoursMinutes(Math.max(0, d.totalMinutes - (d.minutesListened ?? 0)))} left`
    return d.minutesListened ? hoursMinutes(d.minutesListened) : ''
  }
  const pct = readingPercent(d)
  return pct !== null ? `${pct}%` : d.pagesRead ? `p. ${d.pagesRead}` : ''
}

/** Hours and minutes fields to minutes (digits only; minutes past 59 carry over). Both blank = null. */
export function toMinutes(h: string, m: string): number | null {
  const hh = h.replace(/\D/g, ''), mm = m.replace(/\D/g, '')
  return hh === '' && mm === '' ? null : Number(hh || 0) * 60 + Number(mm || 0)
}
export const splitMinutes = (min?: number | null): [string, string] => min == null ? ['', ''] : [String(Math.floor(min / 60)), String(min % 60)]

/** This year's finished books, and pages and minutes: finished ones' lengths plus progress on ones in progress. */
export function shelfTotals(books: ReadingData[], year: string) {
  let finished = 0, pages = 0, minutes = 0
  for (const d of books) {
    const audio = isAudiobook(d)
    if (d.status === 'finished' && d.finishedOn?.startsWith(year)) {
      finished++
      if (audio) minutes += d.totalMinutes ?? d.minutesListened ?? 0
      else pages += d.totalPages ?? d.pagesRead ?? 0
    } else if (d.status === 'reading') {
      if (audio) minutes += d.minutesListened ?? 0
      else pages += d.pagesRead ?? 0
    }
  }
  return { finished, pages, minutes }
}

export const shelfLine = (year: string, t: { finished: number; pages: number; minutes: number }) =>
  [`${t.finished} book${t.finished === 1 ? '' : 's'} finished in ${year}`, t.pages ? `${t.pages.toLocaleString('en-US')} pages` : '', t.minutes ? `${hoursMinutes(t.minutes)} listened` : '']
    .filter(Boolean).join(' · ')

/** The last `n` days up to `today` (YYYY-MM-DD), each with what was read then (0 when nothing). */
export function recentDays(log: ReadingDay[] | undefined, today: string, n = 14): ReadingDay[] {
  const by = new Map((log ?? []).map(d => [d.date, d.amount]))
  const t = Date.parse(`${today}T12:00:00Z`)
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(t - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10)
    return { date, amount: by.get(date) ?? 0 }
  })
}

/** One day's reading in words: "12 pages", "1 page", or "1h 15m" for an audiobook. */
export const dayAmount = (d: Pick<ReadingData, 'format'>, amount: number) =>
  isAudiobook(d) ? hoursMinutes(amount) : `${amount} page${amount === 1 ? '' : 's'}`

/** Finished books a shelf shows before "Show all". */
export const FINISHED_SHOWN = 3
/** A shelf's books in order: reading, want to read, then finished, newest finished first (finishedOn,
 * else when it was last changed). Past FINISHED_SHOWN finished ones are held back unless `all`;
 * `more` is how many. */
export function shelfBooks<T>(books: T[], d: (b: T) => { status: string; finishedOn?: string; updatedAt?: string }, all: boolean): { shown: T[]; more: number } {
  const order = ['reading', 'want', 'finished']
  const when = (b: T) => d(b).finishedOn ?? d(b).updatedAt?.slice(0, 10) ?? ''
  const sorted = [...books].sort((a, b) => order.indexOf(d(a).status) - order.indexOf(d(b).status) || (d(a).status === 'finished' ? when(b).localeCompare(when(a)) : 0))
  const finished = sorted.filter(b => d(b).status === 'finished')
  const more = all ? 0 : Math.max(0, finished.length - FINISHED_SHOWN)
  return { shown: more ? sorted.slice(0, sorted.length - more) : sorted, more }
}
