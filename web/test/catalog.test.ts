// node --test test/ (npm test). The grocery catalog's search, store filter and labels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boughtLabel, catalogStores, filterCatalog, placeLabel, placesFor, placesInput } from '../src/catalog.ts'
import { itemKey } from '../src/itemSuggest.ts'
import type { RememberedItem } from '../src/types.ts'

const item = (title: string, places: [string, string | null][], uses = 1): RememberedItem => ({
  key: itemKey(title), title, uses, lastUsed: null, category: null, lastStore: places[0]?.[0] ?? null,
  places: places.map(([store, aisle]) => ({ store, aisle, updatedAt: '2026-09-01T00:00:00Z' })),
})
const items = [item('Bananas', [['Market', 'Produce']]), item('Milk', [['Warehouse club', 'Aisle 4'], ['Market', null]]), item('Tomatoes', []), item('Oat milk', [['Market', 'Dairy']], 0)]
const titles = (q: string, store: string | null = null) => filterCatalog(items, q, store).map(i => i.title)

test('catalogStores: each store once, A-Z', () => {
  assert.deepEqual(catalogStores(items), ['Market', 'Warehouse club'])
})

test('filterCatalog: search by name or matching key, and by store', () => {
  assert.deepEqual(titles(''), ['Bananas', 'Milk', 'Tomatoes', 'Oat milk'])
  assert.deepEqual(titles(' MILK '), ['Milk', 'Oat milk'])
  assert.deepEqual(titles('tomato'), ['Tomatoes'])
  assert.deepEqual(titles('bananas'), ['Bananas'])
  assert.deepEqual(titles('', 'Warehouse club'), ['Milk'])
  assert.deepEqual(titles('milk', 'Market'), ['Milk', 'Oat milk'])
  assert.deepEqual(titles('bread'), [])
})

test('placeLabel and placesFor: aisle when known, the filtered store first', () => {
  assert.equal(placeLabel({ store: 'Market', aisle: 'Produce' }), 'Market · Produce')
  assert.equal(placeLabel({ store: 'Market', aisle: null }), 'Market')
  assert.deepEqual(placesFor(items[1], 'Market').map(p => p.store), ['Market', 'Warehouse club'])
  assert.deepEqual(placesFor(items[1], null).map(p => p.store), ['Warehouse club', 'Market'])
})

test('boughtLabel', () => {
  assert.deepEqual([0, 1, 5].map(boughtLabel), ['Not bought yet', 'Bought once', 'Bought 5 times'])
})

test('placesInput: trims, drops blank stores, one row per store', () => {
  assert.deepEqual(placesInput([{ store: ' Market ', aisle: ' Aisle 2 ' }, { store: '', aisle: 'x' }, { store: 'Shop', aisle: '' }, { store: 'Market', aisle: 'Dairy' }]),
    [{ store: 'Market', aisle: 'Dairy' }, { store: 'Shop', aisle: null }])
})
