// node --test test/ (npm test). The family library's labels and the bulk scanner's book check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listenLabel, openLibraryUrl, ratingLabel, readingLevel, seriesLabel, wantOnly, addDayKeys, bookDetails, bookLean, clothColor, dueLabel, dueTag, existingRead, isbnFromScan, isOverdue, lentLabel, pickBook, sortLibrary, STATUS_LABEL } from '../src/library.ts'
import { STATUS_EMOJI, STATUS_WORDS } from '../src/reading.ts'

test('isbnFromScan: book barcodes (978/979, or ISBN-10) only', () => {
  assert.equal(isbnFromScan('9780440414803'), '9780440414803')
  assert.equal(isbnFromScan('9791034304243'), '9791034304243')
  assert.equal(isbnFromScan('0440414806'), '0440414806')
  assert.equal(isbnFromScan('016000275287'), null, 'a cereal box (UPC-A)')
  assert.equal(isbnFromScan('5012345678900'), null, 'a non-book EAN-13')
})

test('bookDetails: series and number, year, reading level, joined', () => {
  assert.equal(bookDetails({ series: 'Warriors', seriesNumber: '1', year: 2003, lexile: 970, pages: 272 }), 'Warriors #1 · 2003 · 970L · 272 pages')
  assert.equal(bookDetails({ series: 'Warriors', seriesNumber: null, year: null, lexile: null, pages: null }), 'Warriors')
  assert.equal(bookDetails({ series: null, seriesNumber: null, year: 1988, lexile: null, pages: null }), '1988')
  assert.equal(bookDetails({ series: null, seriesNumber: null, year: null, lexile: null, pages: null }), '')
})

test('lentLabel: who has it and since when', () => {
  assert.equal(lentLabel({ lentTo: 'Grandma', lentOn: '2026-09-23' }, '2026-10-02'), 'Lent to Grandma since Sep 23')
  assert.equal(lentLabel({ lentTo: 'Sam', lentOn: '2026-10-02' }, '2026-10-02'), 'Lent to Sam today')
  assert.equal(lentLabel({ lentTo: 'Sam', lentOn: '2025-12-30' }, '2026-10-02'), 'Lent to Sam since Dec 30, 2025')
  assert.equal(lentLabel({ lentTo: 'Sam', lentOn: null }, '2026-10-02'), 'Lent to Sam')
  assert.equal(lentLabel({ lentTo: null, lentOn: null }, '2026-10-02'), null)
})

test('dueLabel: borrowed books say when they go back', () => {
  const t = '2026-10-02'
  const b = (dueOn: string | null, returnedOn: string | null = null, borrowedFrom: string | null = 'Town library') => ({ borrowedFrom, dueOn, returnedOn })
  assert.equal(dueLabel(b('2026-10-02'), t), 'Due back today')
  assert.equal(dueLabel(b('2026-10-03'), t), 'Due back tomorrow')
  assert.equal(dueLabel(b('2026-10-23'), t), 'Due back Oct 23')
  assert.equal(dueLabel(b('2027-01-04'), t), 'Due back Jan 4, 2027')
  assert.equal(dueLabel(b('2026-09-30'), t), 'Overdue since Sep 30')
  assert.equal(dueLabel(b('2026-09-30', '2026-09-29'), t), 'Returned Sep 29')
  assert.equal(dueLabel(b(null), t), null)
  assert.equal(dueLabel(b('2026-10-04', null, null), t), null, 'our own book')
  assert.equal(isOverdue(b('2026-09-30'), t), true)
  assert.equal(isOverdue(b('2026-09-30', '2026-09-29'), t), false)
  assert.equal(addDayKeys('2026-12-25', 21), '2027-01-15')
})

test("existingRead: Read it links what they're already reading instead of adding another", () => {
  const book = { id: 'b1', title: 'Outcast' }
  const entry = (id: string, memberId: string, title: string, data: Record<string, unknown>) => ({ id, kind: 'reading', memberId, title, data } as any)
  const solo = entry('e1', 'june', ' outcast ', { status: 'reading' }) // tracked before the book was in the library
  assert.equal(existingRead([solo], 'june', book)?.id, 'e1', 'same title, unlinked')
  assert.equal(existingRead([solo], 'maya', book), null, "someone else's")
  assert.equal(existingRead([entry('e2', 'june', 'Outcast', { status: 'finished' })], 'june', book), null, 'finished: reading it again is new')
  assert.equal(existingRead([entry('e3', 'june', 'Outcast', { status: 'reading', bookId: 'b9' })], 'june', book), null, 'linked to another copy')
  assert.equal(existingRead([entry('e4', 'june', 'Renamed', { status: 'want', bookId: 'b1' })], 'june', book)?.id, 'e4', 'already linked')
})

test('clothColor: a no-cover book gets the same cloth color every time, picked from its title', () => {
  assert.equal(clothColor('Holes'), clothColor('Holes'))
  assert.match(clothColor('Holes'), /^hsl\(\d+ \d+% \d+%\)$/)
  const colors = new Set(['Holes', 'Wonder', 'Hatchet', 'Matilda', 'Fire and Ice', 'Into the Wild'].map(clothColor))
  assert.ok(colors.size >= 4, 'different titles mostly differ')
})

test('bookLean: a small, steady tilt and height per book', () => {
  for (const id of ['a', 'book-holes', 'book-wonder', 'x'.repeat(40)]) {
    const { tilt, height } = bookLean(id)
    assert.ok(Math.abs(tilt) <= 3, `tilt ${tilt}`)
    assert.ok(height >= 88 && height <= 100, `height ${height}`)
    assert.deepEqual(bookLean(id), { tilt, height })
  }
})

test('dueTag: a short tag for a borrowed book still out', () => {
  const t = '2026-10-06' // a Tuesday
  const b = (dueOn: string | null, returnedOn: string | null = null, borrowedFrom: string | null = 'Town library') => ({ borrowedFrom, dueOn, returnedOn })
  assert.equal(dueTag(b('2026-10-06'), t), 'Due today')
  assert.equal(dueTag(b('2026-10-07'), t), 'Due tomorrow')
  assert.equal(dueTag(b('2026-10-09'), t), 'Due Fri')
  assert.equal(dueTag(b('2026-10-12'), t), 'Due Mon')
  assert.equal(dueTag(b('2026-10-13'), t), 'Due Oct 13')
  assert.equal(dueTag(b('2026-10-01'), t), 'Overdue')
  assert.equal(dueTag(b('2026-10-01', '2026-09-30'), t), null, 'returned')
  assert.equal(dueTag(b(null), t), 'Borrowed', 'no due date')
  assert.equal(dueTag(b('2026-10-09', null, null), t), null, 'ours')
})

test('pickBook: a random book from the shelf, never a wishlist or returned one', () => {
  const bk = (id: string, d: { wanted?: boolean; returnedOn?: string | null } = {}) => ({ id, wanted: false, returnedOn: null, ...d })
  const shelf = [bk('wish', { wanted: true }), bk('a'), bk('gone', { returnedOn: '2026-09-01' }), bk('b')]
  assert.equal(pickBook(shelf, () => 0)?.id, 'a')
  assert.equal(pickBook(shelf, () => 0.99)?.id, 'b')
  assert.equal(pickBook([bk('wish', { wanted: true })], () => 0), null)
  assert.equal(pickBook([], () => 0), null)
})

test('wantOnly: on a shelf as want to read, nobody started', () => {
  const r = (...st: string[]) => ({ readers: st.map((status, i) => ({ entryId: String(i), memberId: null, status: status as never })) })
  assert.equal(wantOnly(r('want')), true)
  assert.equal(wantOnly(r('want', 'want')), true)
  assert.equal(wantOnly(r('want', 'reading')), false, 'someone started it')
  assert.equal(wantOnly(r()), false, 'on nobody\'s shelf: just a book we have')
})

test('libraryQuery sends every filter (the wishlist, borrowed and returned were dropped once)', async () => {
  const { libraryQuery } = await import('../src/library.ts')
  assert.equal(libraryQuery({ q: 'owl', unread: true, lent: true, borrowed: true, returned: true, wanted: true, location: 'Den' }), 'q=owl&unread=1&lent=1&borrowed=1&returned=1&wanted=1&location=Den')
  assert.equal(libraryQuery(), '')
})

test('filterLibrary: OR within a group, AND across groups, and the default shelf', async () => {
  const { filterLibrary, NO_FILTERS } = await import('../src/library.ts')
  const r = (memberId: string, status: string) => ({ entryId: memberId + status, memberId, status: status as never })
  const bk = (id: string, d: Record<string, unknown> = {}) => ({ id, readers: [], wanted: false, returnedOn: null, borrowedFrom: null, dueOn: null, lentTo: null, location: null, ...d }) as never
  const books = [
    bk('fresh', { location: 'Den' }), // ours, nobody started
    bk('reading', { readers: [r('maya', 'reading')], location: 'Maya\'s room' }),
    bk('want', { readers: [r('leo', 'want')] }), // want to read only
    bk('done', { readers: [r('maya', 'finished'), r('leo', 'want')], location: 'Den' }),
    bk('lent', { lentTo: 'Grandma', readers: [r('sam', 'finished')] }),
    bk('borrowed', { borrowedFrom: 'Town library', dueOn: '2026-10-09', readers: [r('leo', 'reading')] }),
    bk('back', { borrowedFrom: 'Town library', returnedOn: '2026-09-01', readers: [r('maya', 'finished')] }),
    bk('wish', { wanted: true, readers: [r('maya', 'want')] }),
  ]
  const ids = (f: Partial<typeof NO_FILTERS>) => filterLibrary(books, { ...NO_FILTERS, ...f }).map((b: { id: string }) => b.id)
  // Nothing on: the books we have, not returned, not wishlist, not want-to-read-only.
  assert.deepEqual(ids({}), ['fresh', 'reading', 'done', 'lent', 'borrowed'])
  assert.deepEqual(ids({ show: ['unread'] }), ['fresh'])
  assert.deepEqual(ids({ show: ['want'] }), ['want'], 'want to read is a filter now, only books nobody started')
  assert.deepEqual(ids({ show: ['reading'] }), ['reading', 'borrowed'])
  assert.deepEqual(ids({ show: ['finished'] }), ['done', 'lent'], 'a returned book only shows under Returned')
  assert.deepEqual(ids({ show: ['lent'] }), ['lent'])
  assert.deepEqual(ids({ show: ['borrowed'] }), ['borrowed'])
  assert.deepEqual(ids({ show: ['returned'] }), ['back'])
  assert.deepEqual(ids({ show: ['wishlist'] }), ['wish'])
  assert.deepEqual(ids({ show: ['unread', 'want', 'wishlist'] }), ['fresh', 'want', 'wish'], 'OR within Show')
  assert.deepEqual(ids({ places: ['Den'] }), ['fresh', 'done'])
  assert.deepEqual(ids({ places: ['Den', 'Maya\'s room'] }), ['fresh', 'reading', 'done'], 'OR within Where')
  assert.deepEqual(ids({ who: ['leo'] }), ['done', 'borrowed'], 'whose shelf, on the default view')
  assert.deepEqual(ids({ who: ['leo', 'sam'] }), ['done', 'lent', 'borrowed'], 'OR within Who')
  assert.deepEqual(ids({ show: ['want', 'wishlist'], who: ['leo'] }), ['want'], 'AND across groups')
  assert.deepEqual(ids({ show: ['finished'], places: ['Den'], who: ['maya'] }), ['done'])
})

test('libraryNeeds: the extra lists the chosen filters reach', async () => {
  const { libraryNeeds, NO_FILTERS } = await import('../src/library.ts')
  assert.deepEqual(libraryNeeds(NO_FILTERS), { returned: false, wanted: false })
  assert.deepEqual(libraryNeeds({ ...NO_FILTERS, show: ['returned', 'unread'] }), { returned: true, wanted: false })
  assert.deepEqual(libraryNeeds({ ...NO_FILTERS, show: ['wishlist'] }), { returned: false, wanted: true })
})

test('book sheet details: reading level band, series, audiobook, ratings, Open Library link', () => {
  assert.equal(readingLevel(660), '660L · about grade 3')
  assert.equal(readingLevel(840), '840L · about grades 4–5')
  assert.equal(readingLevel(100), '100L · early reader')
  assert.equal(readingLevel(-50), 'BR50L · early reader')
  assert.equal(readingLevel(1500), '1500L · high school and up')
  assert.equal(readingLevel(null), null)
  assert.equal(seriesLabel({ series: 'Warriors: Power of Three', seriesNumber: '2' }), 'Warriors: Power of Three #2')
  assert.equal(seriesLabel({ series: null, seriesNumber: '2' }), null)
  const reader = { entryId: 'e1', memberId: 'm3', status: 'reading' as const }
  assert.equal(listenLabel({ format: 'audiobook', readers: [reader, { ...reader, narrator: 'Nora Bell', totalMinutes: 629 }] }), '🎧 Audiobook · read by Nora Bell · 10h 29m')
  assert.equal(listenLabel({ format: 'audiobook', readers: [] }), '🎧 Audiobook')
  assert.equal(listenLabel({ format: 'book', readers: [{ ...reader, narrator: 'Nora Bell' }] }), null)
  assert.equal(ratingLabel({ ratingsAverage: 4.18, ratingsCount: 1210 }), '★ 4.2 · 1,210 ratings')
  assert.equal(ratingLabel({ ratingsAverage: 5, ratingsCount: 2 }), null, 'too few to mean much')
  assert.equal(openLibraryUrl({ workKey: '/works/OL5W', isbn: '9780440414803' }), 'https://openlibrary.org/works/OL5W')
  assert.equal(openLibraryUrl({ workKey: null, isbn: '9780440414803' }), 'https://openlibrary.org/isbn/9780440414803')
  assert.equal(openLibraryUrl({ workKey: null, isbn: null }), null)
})

test('audiobooks: the Format filter, Libro.fm link and listening progress', async () => {
  const { filterLibrary, NO_FILTERS, isAudio, libroUrl, listening } = await import('../src/library.ts')
  const bk = (id: string, d: Record<string, unknown> = {}) => ({ id, format: 'book', readers: [], wanted: false, returnedOn: null, borrowedFrom: null, dueOn: null, lentTo: null, location: null, isbn: null, ...d }) as never
  const books = [bk('paper'), bk('audio', { format: 'audiobook' }), bk('old', { format: undefined })]
  const ids = (formats: string[]) => filterLibrary(books, { ...NO_FILTERS, formats: formats as never }).map((b: { id: string }) => b.id)
  assert.deepEqual(ids([]), ['paper', 'audio', 'old'])
  assert.deepEqual(ids(['audiobook']), ['audio'])
  assert.deepEqual(ids(['book']), ['paper', 'old'], 'no format: a book')
  assert.deepEqual(ids(['book', 'audiobook']), ['paper', 'audio', 'old'], 'OR within Format')
  assert.equal(isAudio(books[1]), true)
  assert.equal(isAudio(books[2]), false)

  assert.equal(libroUrl({ isbn: '9781774248188' }), 'https://libro.fm/audiobooks/9781774248188')
  assert.equal(libroUrl({ isbn: null }), null)

  const r = (memberId: string, status: string, d: Record<string, unknown> = {}) => ({ entryId: memberId, memberId, status: status as never, ...d })
  // The first one listening, with how far along (null without a length).
  assert.deepEqual(listening({ readers: [r('sam', 'finished'), r('maya', 'reading', { minutesListened: 90, totalMinutes: 360, narrator: 'Nora Bell' })] }), { memberId: 'maya', progress: 0.25 })
  assert.deepEqual(listening({ readers: [r('leo', 'reading')] }), { memberId: 'leo', progress: null })
  assert.equal(listening({ readers: [r('sam', 'want')] }), null)
})

test("the library's status filters use the Reading shelves' words and marks", () => {
  for (const s of ['want', 'reading', 'finished'] as const) assert.equal(STATUS_LABEL[s], `${STATUS_EMOJI[s]} ${STATUS_WORDS[s]}`)
  assert.equal(STATUS_LABEL.reading, '📖 Reading now')
  assert.equal(STATUS_WORDS.want, 'Want to read')
})

test('sortLibrary: each sort, ties by title, missing values last', () => {
  const b = (id: string, d: Partial<Parameters<typeof sortLibrary>[0][number]> = {}) => ({
    id, title: id, author: null, series: null, seriesNumber: null, year: null, ratingsAverage: null, ratingsCount: null,
    createdAt: '2026-01-01T00:00:00Z', readers: [], ...d,
  })
  const ids = (list: { id: string }[]) => list.map(x => x.id).join(' ')
  const books = [
    b('Holes', { author: 'Louis Sachar', year: 1998, ratingsAverage: 4.1, createdAt: '2026-03-01T00:00:00Z', readers: [{ status: 'finished', readAt: '2026-09-01' }] }),
    b('Fire and Ice', { author: 'Erin Hunter', series: 'Warriors', seriesNumber: '2', year: 2003, createdAt: '2026-02-01T00:00:00Z' }),
    b('Into the Wild', { author: 'Erin Hunter', series: 'Warriors', seriesNumber: '1', year: 2003, ratingsAverage: 4.1, ratingsCount: 900, readers: [{ status: 'reading', readAt: '2026-10-01' }] }),
    b("charlotte's Web", { author: 'E. B. White', year: 1952, ratingsAverage: 4.5, createdAt: '2026-04-01T00:00:00Z', readers: [{ status: 'want', readAt: null }] }),
    b('Zebra'),
  ]
  // Title: A-Z ignoring case, a series together in order under its name.
  assert.equal(ids(sortLibrary(books, 'title')), "charlotte's Web Holes Into the Wild Fire and Ice Zebra")
  // Author: by last name (Hunter, Sachar, White), then the title order; no author last.
  assert.equal(ids(sortLibrary(books, 'author')), "Into the Wild Fire and Ice Holes charlotte's Web Zebra")
  // Recently added: newest first; same day → title order.
  assert.equal(ids(sortLibrary(books, 'added')), "charlotte's Web Holes Fire and Ice Into the Wild Zebra")
  // Recently read: latest activity of any reader; never read (or only want to) last, in title order.
  assert.equal(ids(sortLibrary(books, 'read')), "Into the Wild Holes charlotte's Web Fire and Ice Zebra")
  // Series: series first, by name and number; the rest by title.
  assert.equal(ids(sortLibrary(books, 'series')), "Into the Wild Fire and Ice charlotte's Web Holes Zebra")
  // Year published: oldest first, unknown last.
  assert.equal(ids(sortLibrary(books, 'year')), "charlotte's Web Holes Into the Wild Fire and Ice Zebra")
  // Rating: highest first; a tie goes to more ratings, then title; unrated last.
  assert.equal(ids(sortLibrary(books, 'rating')), "charlotte's Web Into the Wild Holes Fire and Ice Zebra")
  // Doesn't change the list it's given.
  assert.equal(books[0].id, 'Holes')
})

test('genres: the Genre filter and its choices, most common first', async () => {
  const { filterLibrary, genreOptions, NO_FILTERS } = await import('../src/library.ts')
  const bk = (id: string, genres?: string[]) => ({ id, readers: [], wanted: false, returnedOn: null, borrowedFrom: null, dueOn: null, lentTo: null, location: null, genres }) as never
  const books = [bk('a', ['Fantasy', 'Animals']), bk('b', ['Humor']), bk('c', ['Fantasy']), bk('d', []), bk('e')]
  const ids = (genres: string[]) => filterLibrary(books, { ...NO_FILTERS, genres }).map((b: { id: string }) => b.id)
  assert.deepEqual(ids([]), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(ids(['Fantasy']), ['a', 'c'])
  assert.deepEqual(ids(['Animals', 'Humor']), ['a', 'b'], 'OR within Genre')
  assert.deepEqual(genreOptions(books), [{ genre: 'Fantasy', count: 2 }, { genre: 'Animals', count: 1 }, { genre: 'Humor', count: 1 }], 'by count, then A-Z')
  assert.deepEqual(genreOptions(books, ['Poetry']).at(-1), { genre: 'Poetry', count: 0 }, 'a picked genre stays, so it can be turned off')
})
