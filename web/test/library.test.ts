// node --test test/ (npm test). The family library's labels and the bulk scanner's book check.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookDetails, isbnFromScan, lentLabel } from '../src/library.ts'

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
