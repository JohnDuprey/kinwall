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
