// The family's library (Library.tsx): labels, and which scanned barcodes are books. Pure, so
// web/test/library.test.ts covers it.
import type { LibraryBook, ReadingData, TrackerEntry } from './types.ts'
import { minutesLabel } from './meal-date.ts'

/** A scanned barcode as an ISBN when it's a book's: an EAN-13 starting 978/979 (Bookland), or an
 * ISBN-10. Anything else (a cereal box's UPC) is null. */
export function isbnFromScan(code: string): string | null {
  return /^97[89]\d{10}$/.test(code) || /^\d{9}[\dXx]$/.test(code) ? code : null
}

/** "Warriors #1 · 2003 · 970L · 272 pages": what we know, in that order. */
export const bookDetails = (b: Pick<LibraryBook, 'series' | 'seriesNumber' | 'year' | 'lexile' | 'pages'>) =>
  [b.series ? `${b.series}${b.seriesNumber ? ` #${b.seriesNumber}` : ''}` : '', b.year ? String(b.year) : '', b.lexile !== null && b.lexile !== undefined ? `${b.lexile}L` : '', b.pages ? `${b.pages} pages` : '']
    .filter(Boolean).join(' · ')

// Typical Lexile measures by grade (MetaMetrics' middle half of readers, rounded), for a rough band.
const GRADES: [string, number, number][] = [['1', 190, 530], ['2', 420, 650], ['3', 520, 820], ['4', 740, 940], ['5', 830, 1010], ['6', 925, 1070], ['7', 970, 1120], ['8', 1010, 1185], ['9', 1050, 1260], ['10', 1080, 1335], ['11', 1185, 1385], ['12', 1185, 1385]]
/** "660L · about grade 3", "840L · about grades 4–5"; an early reader under 190L (BR when below 0). */
export function readingLevel(lexile: number | null | undefined): string | null {
  if (lexile === null || lexile === undefined) return null
  const label = lexile < 0 ? `BR${-lexile}L` : `${lexile}L`
  if (lexile < 190) return `${label} · early reader`
  const fit = GRADES.filter(([, lo, hi]) => lexile >= lo && lexile <= hi).map(([g]) => g)
  if (!fit.length) return `${label} · high school and up`
  return `${label} · about ${fit.length === 1 ? `grade ${fit[0]}` : `grades ${fit[0]}–${fit[fit.length - 1]}`}`
}

/** "Warriors #2", or null. */
export const seriesLabel = (b: Pick<LibraryBook, 'series' | 'seriesNumber'>) => b.series ? `${b.series}${b.seriesNumber ? ` #${b.seriesNumber}` : ''}` : null

/** An audiobook's "🎧 Audiobook · read by Nora Bell · 3 hr 45 min", from what its listeners' reading entries know; null for a book. */
export function listenLabel(b: Pick<LibraryBook, 'format' | 'readers'>): string | null {
  if (b.format !== 'audiobook') return null
  const narrator = b.readers.find(r => r.narrator)?.narrator
  const minutes = b.readers.find(r => r.totalMinutes)?.totalMinutes
  return ['🎧 Audiobook', narrator ? `read by ${narrator}` : '', minutes ? minutesLabel(minutes) : ''].filter(Boolean).join(' · ')
}

/** "★ 4.2 · 210 ratings": Open Library readers', once enough have rated it to mean something. */
export const ratingLabel = (b: Pick<LibraryBook, 'ratingsAverage' | 'ratingsCount'>) =>
  b.ratingsAverage && b.ratingsCount && b.ratingsCount >= 5 ? `★ ${b.ratingsAverage.toFixed(1)} · ${b.ratingsCount.toLocaleString('en-US')} ratings` : null

/** The book on Open Library: its work, else its ISBN; null when neither is known. */
export const openLibraryUrl = (b: Pick<LibraryBook, 'workKey' | 'isbn'>) =>
  b.workKey ? `https://openlibrary.org${b.workKey}` : b.isbn ? `https://openlibrary.org/isbn/${b.isbn}` : null

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

/** Only "want to read" so far: someone has it on their shelf, nobody has started it. */
export const wantOnly = (b: Pick<LibraryBook, 'readers'>): boolean => b.readers.length > 0 && b.readers.every(r => r.status === 'want')

/** The library's Filters sheet. Show: which books (any of them; none = the default shelf). Where: the
 * places it lives. Who: whose reading shelf it's on. Any one in a group, every group that has one. */
export type LibraryStatus = 'unread' | 'reading' | 'want' | 'finished' | 'lent' | 'borrowed' | 'returned' | 'wishlist'
export interface LibraryFilters { show: LibraryStatus[]; places: string[]; who: string[] }
export const NO_FILTERS: LibraryFilters = { show: [], places: [], who: [] }
export const STATUS_LABEL: Record<LibraryStatus, string> = {
  unread: 'Not read yet', reading: '📖 Reading now', want: '🔖 Want to read', finished: '📗 Finished',
  lent: '🤝 Lent out', borrowed: '📅 Borrowed', returned: '↩️ Returned', wishlist: '⭐ Wishlist',
}
type Filterable = Pick<LibraryBook, 'readers' | 'wanted' | 'returnedOn' | 'borrowedFrom' | 'dueOn' | 'lentTo' | 'location'>
const has = (b: Filterable) => !b.wanted && !b.returnedOn // on our shelves: not the wishlist, not gone back
const reads = (b: Filterable, s: string) => b.readers.some(r => r.status === s)
const SHOWS: Record<LibraryStatus, (b: Filterable) => boolean> = {
  unread: b => has(b) && !b.readers.length,
  reading: b => has(b) && reads(b, 'reading'),
  want: b => has(b) && wantOnly(b),
  finished: b => has(b) && reads(b, 'finished'),
  lent: b => has(b) && !!b.lentTo,
  borrowed: b => has(b) && !!b.borrowedFrom,
  returned: b => !!b.borrowedFrom && !!b.returnedOn,
  wishlist: b => !!b.wanted,
}
/** The books the filters pick, in the order given (Borrowed alone: soonest due first). With nothing
 * in Show: the books we have, minus the ones only on someone's want-to-read shelf. */
export function filterLibrary<B extends Filterable>(books: B[], f: LibraryFilters): B[] {
  const out = books.filter(b => (f.show.length ? f.show.some(s => SHOWS[s](b)) : has(b) && !wantOnly(b))
    && (!f.places.length || (!!b.location && f.places.includes(b.location)))
    && (!f.who.length || b.readers.some(r => !!r.memberId && f.who.includes(r.memberId))))
  return f.show.length === 1 && f.show[0] === 'borrowed' ? out.sort((a, z) => (a.dueOn ?? '9999').localeCompare(z.dueOn ?? '9999')) : out
}
/** Which lists beyond the books we have the filters reach (GET /api/library leaves both out otherwise). */
export const libraryNeeds = (f: LibraryFilters) => ({ returned: f.show.includes('returned'), wanted: f.show.includes('wishlist') })

/** "Pick a book for me": any book on the shelf (not the wishlist, not one that went back), or null. */
export function pickBook<B extends Pick<LibraryBook, 'wanted' | 'returnedOn'>>(books: B[], random = Math.random): B | null {
  const shelf = books.filter(b => !b.wanted && !b.returnedOn)
  return shelf.length ? shelf[Math.floor(random() * shelf.length)] : null
}

/** GET /api/library's query: every filter the server takes (each one left out means "not that"). */
export function libraryQuery(q?: { q?: string; unread?: boolean; lent?: boolean; borrowed?: boolean; returned?: boolean; wanted?: boolean; location?: string }): string {
  const p = new URLSearchParams()
  if (q?.q) p.set('q', q.q)
  for (const k of ['unread', 'lent', 'borrowed', 'returned', 'wanted'] as const) if (q?.[k]) p.set(k, '1')
  if (q?.location) p.set('location', q.location)
  return p.toString()
}
