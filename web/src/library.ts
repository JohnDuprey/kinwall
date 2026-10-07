// The family's library (Library.tsx): labels, and which scanned barcodes are books. Pure, so
// web/test/library.test.ts covers it.
import type { LibraryBook, ReadingData, TrackerEntry } from './types.ts'

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

const sameTitle = (a: string | null | undefined, b: string) => (a ?? '').trim().toLowerCase() === b.trim().toLowerCase()
/** "Read it" for someone who may already be tracking this book: their unfinished reading entry for it,
 * linked (data.bookId) or tracked on its own under the same title, so it's linked rather than doubled.
 * A finished one doesn't count: reading it again is a new entry. */
export function existingRead(entries: TrackerEntry[], memberId: string, book: Pick<LibraryBook, 'id' | 'title'>): TrackerEntry | null {
  return entries.find(e => {
    const d = e.data as ReadingData
    return e.kind === 'reading' && e.memberId === memberId && d.status !== 'finished' && (d.bookId === book.id || (!d.bookId && sameTitle(e.title, book.title)))
  }) ?? null
}

/** A steady number from a string (FNV-1a), for looks that stay put between renders. */
function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
/** The cloth color of a book with no cover (the cover view), the same every time for its title. */
export const clothColor = (title: string) => {
  const h = hash(title.trim().toLowerCase())
  return `hsl(${h % 360} ${40 + (h >>> 9) % 20}% ${30 + (h >>> 17) % 12}%)`
}
/** How a book stands on the shelf: a slight lean (degrees, most stand straight) and its height (% of the tallest). */
export function bookLean(id: string): { tilt: number; height: number } {
  const h = hash(id)
  const lean = h % 7 // 0–6: about a third lean a little either way
  return { tilt: lean === 0 ? -2.5 : lean === 1 ? 2 : lean === 2 ? -1 : 0, height: 88 + (h >>> 8) % 13 }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** The library-card tag on a borrowed book still out: "Due Fri" this week, "Due Oct 13" later,
 * "Overdue", or "Borrowed" without a date; null for the family's own books and returned ones. */
export function dueTag(b: Pick<LibraryBook, 'borrowedFrom' | 'dueOn' | 'returnedOn'>, today: string): string | null {
  if (!b.borrowedFrom || b.returnedOn) return null
  if (!b.dueOn) return 'Borrowed'
  if (b.dueOn < today) return 'Overdue'
  if (b.dueOn === today) return 'Due today'
  if (b.dueOn === addDayKeys(today, 1)) return 'Due tomorrow'
  if (b.dueOn <= addDayKeys(today, 6)) return `Due ${WEEKDAYS[new Date(`${b.dueOn}T12:00:00Z`).getUTCDay()]}`
  return `Due ${day(b.dueOn, today)}`
}

/** "Pick a book for me": any book on the shelf (not the wishlist, not one that went back), or null. */
export function pickBook<B extends Pick<LibraryBook, 'wanted' | 'returnedOn'>>(books: B[], random = Math.random): B | null {
  const shelf = books.filter(b => !b.wanted && !b.returnedOn)
  return shelf.length ? shelf[Math.floor(random() * shelf.length)] : null
}
