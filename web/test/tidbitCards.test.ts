// node --test test/ (npm test). The Board's tidbit cards: the family's choice or this device's own.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TIDBIT_CARDS, tidbitCardTitle, tidbitCards, tidbitFor, tidbitQuery, tidbitSlot } from '../src/tidbits.ts'
import { boardAreas, tidbitCardsThatFit } from '../src/boardFit.ts'
import type { TidbitSettings } from '../src/types.ts'

const family: TidbitSettings = { sources: ['quotes', 'facts'], factCategories: [], tipCategories: [], onThisDay: ['holidays', 'births'], birthsAfter: 1900, triviaCategories: [27, 17], triviaDifficulties: ['easy'] }
const trivia: TidbitSettings = { ...family, sources: ['trivia'], triviaCategories: [17, 27], triviaDifficulties: ['easy', 'medium'] }
const tips: TidbitSettings = { ...family, sources: ['tips'], tipCategories: ['focus', 'routines'] }

test('tidbitCards: no choice of its own follows the family, one card', () => {
  assert.deepEqual(tidbitCards(family, undefined), [family])
  assert.deepEqual(tidbitCards(family, []), [family])
  assert.deepEqual(tidbitCards({ ...family, sources: [] }, undefined), []) // family turned the card off
})

test('tidbitCards: a device choice replaces the family, up to the cap, skipping cards with nothing on', () => {
  assert.deepEqual(tidbitCards(family, [trivia, tips]), [trivia, tips])
  assert.equal(tidbitCards(family, [trivia, tips, trivia, tips]).length, MAX_TIDBIT_CARDS)
  assert.deepEqual(tidbitCards(family, [{ ...tips, sources: [] }, trivia]), [trivia])
  // A card saved by an older build fills missing fields from the family's.
  const partial = { sources: ['facts'] } as unknown as TidbitSettings
  assert.deepEqual(tidbitCards(family, [partial]), [{ ...family, sources: ['facts'] }])
})

test('tidbitQuery: only the online fields, none when the card has no online source', () => {
  assert.equal(tidbitQuery(tips), null)
  const q = new URLSearchParams(tidbitQuery(trivia)!)
  assert.equal(q.get('sources'), 'trivia')
  assert.equal(q.get('triviaCategories'), '17,27')
  assert.equal(q.get('triviaDifficulties'), 'easy,medium')
  assert.equal(new URLSearchParams(tidbitQuery({ ...family, sources: ['onthisday'], birthsAfter: null })!).get('birthsAfter'), 'any')
})

test('tidbitCardTitle: names what the card shows', () => {
  assert.equal(tidbitCardTitle(trivia), 'Trivia')
  assert.equal(tidbitCardTitle(tips), 'Tips')
  assert.equal(tidbitCardTitle({ ...family, sources: ['onthisday'] }), 'On this day')
  assert.equal(tidbitCardTitle(family), 'Quotes & fun facts')
  assert.equal(tidbitCardTitle({ ...family, sources: ['quotes', 'facts', 'tips'] }), 'Quotes, fun facts & more')
})

test('tidbitFor: a card index shifts the pick, so two alike cards differ; low-stim changes hourly', () => {
  const d = new Date(2026, 8, 30)
  const a = tidbitFor(d, 10, family, null)
  assert.notDeepEqual(tidbitFor(d, 10, family, null, 1), a)
  assert.deepEqual(tidbitFor(d, 10, family, null, 0), a)
  assert.equal(tidbitSlot(9, 45, false), 19) // half hours
  assert.equal(tidbitSlot(9, 5, true), tidbitSlot(9, 55, true)) // calmer: one an hour
  assert.notEqual(tidbitSlot(9, 55, true), tidbitSlot(10, 5, true))
})

test('tidbitCardsThatFit: one on a phone and a short tablet, three on two columns and the wall', () => {
  assert.equal(tidbitCardsThatFit(390, 700), 1)
  assert.equal(tidbitCardsThatFit(768, 800), 3) // two columns: the Board scrolls
  assert.equal(tidbitCardsThatFit(930, 475), 1) // a tablet on its side: no room for a second row of cards
  assert.equal(tidbitCardsThatFit(1270, 731), 3) // a 1366 × 1024 wall
})

test('boardAreas: extra tidbit cards take grid slots on the wall and a row on two columns', () => {
  const shown = ['clock', 'today', 'meals', 'photo', 'coming', 'tidbit', 'tidbit2', 'tidbit3']
  const a = boardAreas(shown) as Record<string, string>
  assert.ok(a['--board-areas-2'].includes('"tidbit2 tidbit3"'))
  const rows = a['--board-areas-3'].split('" "').map(r => r.replace(/"/g, '').split(' '))
  assert.deepEqual(rows[3], ['tidbit', 'tidbit3', 'tidbit2']) // the bottom row: one card per column
  assert.deepEqual(rows.map(r => r[1]), ['today', 'today', 'meals', 'tidbit3'])
  // With Chores' full card on too, Today keeps a row and Chores and meals stay.
  const full = boardAreas([...shown, 'chores', 'due']) as Record<string, string>
  assert.equal(full['--board-areas-3'], '"clock today coming" "photo chores coming" "photo meals due" "tidbit tidbit3 tidbit2"')
  // One card: today's layout.
  const one = boardAreas(['clock', 'today', 'meals', 'photo', 'coming', 'tidbit']) as Record<string, string>
  assert.equal(one['--board-areas-3'], '"clock today coming" "photo today coming" "photo today coming" "tidbit meals coming"')
})
