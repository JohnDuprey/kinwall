// node --test test/ (npm test). Books and audiobooks: progress, finishing, the shelf line, hours and minutes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayAmount, isAudiobook, left, recentDays, logReachesEnd, readingPercent, shelfBooks, shelfLine, shelfTotals, splitMinutes, toMinutes } from '../src/reading.ts'
import type { ReadingData } from '../src/types.ts'

const book = (d: Partial<ReadingData>): ReadingData => ({ status: 'reading', ...d })

test('an entry without a format is a book', () => {
  assert.equal(isAudiobook(book({ pagesRead: 10 })), false)
  assert.equal(isAudiobook(book({ format: 'audiobook' })), true)
})

test('percent: books by pages, audiobooks by minutes', () => {
  assert.equal(readingPercent(book({ pagesRead: 45, totalPages: 90 })), 50)
  assert.equal(readingPercent(book({ format: 'audiobook', minutesListened: 130, totalMinutes: 520 })), 25)
  assert.equal(readingPercent(book({ format: 'audiobook', minutesListened: 999, totalMinutes: 60 })), 100, 'capped')
  assert.equal(readingPercent(book({ format: 'audiobook', pagesRead: 45, totalPages: 90 })), null, 'pages mean nothing for an audiobook')
  assert.equal(readingPercent(book({ pagesRead: 45 })), null)
})

test('logging up to the end finishes it', () => {
  assert.equal(logReachesEnd(book({ totalPages: 90 }), 90), true)
  assert.equal(logReachesEnd(book({ totalPages: 90 }), 89), false)
  assert.equal(logReachesEnd(book({ format: 'audiobook', totalMinutes: 270 }), 270), true)
  assert.equal(logReachesEnd(book({ format: 'audiobook', totalMinutes: 270, totalPages: 10 }), 20), false, 'audiobooks by minutes')
  assert.equal(logReachesEnd(book({ format: 'audiobook' }), 500), false, 'no length, no finish')
})

test('left: time left for audiobooks, else percent or page', () => {
  assert.equal(left(book({ format: 'audiobook', minutesListened: 60, totalMinutes: 190 })), '2h 10m left')
  assert.equal(left(book({ format: 'audiobook', minutesListened: 45 })), '45m')
  assert.equal(left(book({ pagesRead: 45, totalPages: 90 })), '50%')
  assert.equal(left(book({ pagesRead: 45 })), 'p. 45')
  assert.equal(left(book({})), '')
})

test('hours and minutes fields', () => {
  assert.equal(toMinutes('4', '30'), 270)
  assert.equal(toMinutes('', '90'), 90)
  assert.equal(toMinutes('2', ''), 120)
  assert.equal(toMinutes(' 1h', '5 m'), 65, 'stray letters ignored')
  assert.equal(toMinutes('', ''), null)
  assert.deepEqual(splitMinutes(270), ['4', '30'])
  assert.deepEqual(splitMinutes(45), ['0', '45'])
  assert.deepEqual(splitMinutes(undefined), ['', ''])
})

test('shelf totals and line: pages and time listened, zero parts left out', () => {
  const entries = [
    book({ status: 'finished', finishedOn: '2026-03-01', totalPages: 200 }),
    book({ status: 'finished', finishedOn: '2025-03-01', totalPages: 999 }),
    book({ format: 'audiobook', status: 'finished', finishedOn: '2026-05-01', totalMinutes: 600 }),
    book({ format: 'audiobook', status: 'reading', minutesListened: 90, totalMinutes: 300 }),
    book({ status: 'reading', pagesRead: 50 }),
  ]
  assert.deepEqual(shelfTotals(entries, '2026'), { finished: 2, pages: 250, minutes: 690 })
  assert.equal(shelfLine('2026', { finished: 2, pages: 1250, minutes: 690 }), '2 books finished in 2026 · 1,250 pages · 11h 30m listened')
  assert.equal(shelfLine('2026', { finished: 1, pages: 0, minutes: 60 }), '1 book finished in 2026 · 1h listened')
  assert.equal(shelfLine('2026', { finished: 0, pages: 12, minutes: 0 }), '0 books finished in 2026 · 12 pages')
})

test('recentDays: the last n days up to today, zero on days with no reading', () => {
  const log = [{ date: '2026-09-20', amount: 30 }, { date: '2026-09-29', amount: 12 }, { date: '2026-10-01', amount: 8 }]
  assert.deepEqual(recentDays(log, '2026-10-01', 4), [
    { date: '2026-09-28', amount: 0 }, { date: '2026-09-29', amount: 12 }, { date: '2026-09-30', amount: 0 }, { date: '2026-10-01', amount: 8 },
  ])
  assert.equal(recentDays(undefined, '2026-03-02', 3)[0].date, '2026-02-28', 'across a month end')
  assert.equal(dayAmount({ format: 'book', status: 'reading' }, 12), '12 pages')
  assert.equal(dayAmount({ format: 'book', status: 'reading' }, 1), '1 page')
  assert.equal(dayAmount({ format: 'audiobook', status: 'reading' }, 75), '1h 15m')
})

test('shelfBooks: reading and want first, then the 3 newest finished; the rest behind Show all', () => {
  const b = (id: string, status: string, finishedOn?: string) => ({ id, status, finishedOn })
  const books = [b('f1', 'finished', '2026-01-05'), b('r', 'reading'), b('f2', 'finished', '2026-09-01'), b('w', 'want'), b('f3', 'finished', '2026-05-20'), b('f4', 'finished', '2026-08-02'), b('f5', 'finished', '2025-12-30')]
  const few = shelfBooks(books, x => x, false)
  assert.deepEqual(few.shown.map(x => x.id), ['r', 'w', 'f2', 'f4', 'f3'])
  assert.equal(few.more, 2)
  const all = shelfBooks(books, x => x, true)
  assert.deepEqual(all.shown.map(x => x.id), ['r', 'w', 'f2', 'f4', 'f3', 'f1', 'f5'])
  assert.equal(all.more, 0)
  assert.equal(shelfBooks(books.slice(0, 4), x => x, false).more, 0, 'three or fewer: nothing held back')
})
