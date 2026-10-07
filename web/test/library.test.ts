// node --test test/ (npm test). The family library's labels and the bulk scanner's book check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wantOnly, addDayKeys, bookDetails, bookLean, clothColor, dueLabel, dueTag, existingRead, isbnFromScan, isOverdue, lentLabel, pickBook } from '../src/library.ts'

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
