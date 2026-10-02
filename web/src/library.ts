// The family's library (Library.tsx): labels, and which scanned barcodes are books. Pure, so
// web/test/library.test.ts covers it.
import type { LibraryBook } from './types.ts'

/** A scanned barcode as an ISBN when it's a book's: an EAN-13 starting 978/979 (Bookland), or an
 * ISBN-10. Anything else (a cereal box's UPC) is null. */
export function isbnFromScan(code: string): string | null {
  return /^97[89]\d{10}$/.test(code) || /^\d{9}[\dXx]$/.test(code) ? code : null
}

/** "Warriors #1 · 2003 · 970L · 272 pages": what we know, in that order. */
export const bookDetails = (b: Pick<LibraryBook, 'series' | 'seriesNumber' | 'year' | 'lexile' | 'pages'>) =>
  [b.series ? `${b.series}${b.seriesNumber ? ` #${b.seriesNumber}` : ''}` : '', b.year ? String(b.year) : '', b.lexile !== null && b.lexile !== undefined ? `${b.lexile}L` : '', b.pages ? `${b.pages} pages` : '']
    .filter(Boolean).join(' · ')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Sep 23", with the year when it isn't this one. */
function day(key: string, today: string) {
  const [y, m, d] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}${String(y) === today.slice(0, 4) ? '' : `, ${y}`}`
}
/** "Lent to Grandma since Sep 23" ("today"; the year when it isn't this one), or null when it's home. */
export function lentLabel(b: Pick<LibraryBook, 'lentTo' | 'lentOn'>, today: string): string | null {
  if (!b.lentTo) return null
  if (!b.lentOn) return `Lent to ${b.lentTo}`
  if (b.lentOn === today) return `Lent to ${b.lentTo} today`
  return `Lent to ${b.lentTo} since ${day(b.lentOn, today)}`
}

/** A day key `n` days after `key` (YYYY-MM-DD). */
export function addDayKeys(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** How long a borrowed book is usually out, for a new due date. */
export const LOAN_DAYS = 21

export const isOverdue = (b: Pick<LibraryBook, 'borrowedFrom' | 'dueOn' | 'returnedOn'>, today: string) => !!b.borrowedFrom && !b.returnedOn && !!b.dueOn && b.dueOn < today
/** A borrowed book's due line: "Due back Oct 4" ("today", "tomorrow"), "Overdue since Sep 30" or
 * "Returned Sep 18"; null for the family's own books (or no due date). */
export function dueLabel(b: Pick<LibraryBook, 'borrowedFrom' | 'dueOn' | 'returnedOn'>, today: string): string | null {
  if (!b.borrowedFrom) return null
  if (b.returnedOn) return `Returned ${b.returnedOn === today ? 'today' : day(b.returnedOn, today)}`
  if (!b.dueOn) return null
  if (b.dueOn < today) return `Overdue since ${day(b.dueOn, today)}`
  return `Due back ${b.dueOn === today ? 'today' : b.dueOn === addDayKeys(today, 1) ? 'tomorrow' : day(b.dueOn, today)}`
}
