// node --test test/ (npm test). The grocery catalog's search, store filter and labels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boughtLabel, catalogDepartments, catalogStores, catalogTags, filterCatalog, groupCatalog, placeLabel, placesFor, placesInput, sortCatalog, tagsInput } from '../src/catalog.ts'
import { itemKey } from '../src/itemSuggest.ts'
import type { RememberedItem } from '../src/types.ts'

const item = (title: string, places: [string, string | null][], uses = 1, more: Partial<RememberedItem> = {}): RememberedItem => ({
  key: itemKey(title), title, uses, lastUsed: null, category: null, lastStore: places[0]?.[0] ?? null,
  places: places.map(([store, aisle]) => ({ store, aisle, updatedAt: '2026-09-01T00:00:00Z' })), tags: [], ...more,
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

// Categories (tags), departments, sort and group.
const shelf = [
  item('Bananas', [['Market', 'Produce']], 5, { category: 'Produce', tags: ['Snacks', 'Breakfast'], lastUsed: '2026-09-20T00:00:00Z' }),
  item('Milk', [['Warehouse club', 'Aisle 4'], ['Market', 'Dairy']], 9, { category: 'Dairy', tags: ['Breakfast'], lastUsed: '2026-09-10T00:00:00Z' }),
  item('Crackers', [['Market', 'Aisle 10']], 2, { category: 'Pantry', tags: ['snacks', 'Lunchbox'], lastUsed: '2026-09-25T00:00:00Z' }),
  item('Dish soap', [['Market', 'Aisle 2']], 1, { tags: [] }),
  item('Apples', [], 0, { category: 'Produce' }),
]
const names = (list: RememberedItem[]) => list.map(i => i.title)

test('catalogTags and catalogDepartments: each once (case ignored, first spelling), A-Z, with counts', () => {
  assert.deepEqual(catalogTags(shelf), [{ name: 'Breakfast', count: 2 }, { name: 'Lunchbox', count: 1 }, { name: 'Snacks', count: 2 }])
  assert.deepEqual(catalogDepartments(shelf), [{ name: 'Dairy', count: 1 }, { name: 'Pantry', count: 1 }, { name: 'Produce', count: 2 }])
})

test('filterCatalog: category and department combine with search and store', () => {
  assert.deepEqual(names(filterCatalog(shelf, '', null, { tag: 'snacks' })), ['Bananas', 'Crackers'])
  assert.deepEqual(names(filterCatalog(shelf, '', null, { tag: 'Snacks', department: 'Produce' })), ['Bananas'])
  assert.deepEqual(names(filterCatalog(shelf, 'milk', 'Market', { tag: 'Breakfast' })), ['Milk'])
  assert.deepEqual(names(filterCatalog(shelf, '', 'Warehouse club', { tag: 'Snacks' })), [])
  assert.deepEqual(names(filterCatalog(shelf, '', null, { department: 'Produce' })), ['Bananas', 'Apples'])
})

test('sortCatalog: A-Z, most bought, department, aisle at a store, recently used', () => {
  const order = new Map([['Market', ['Produce', 'Aisle 2', 'Aisle 10', 'Dairy']]])
  assert.deepEqual(names(sortCatalog(shelf, 'alpha', null, order)), ['Apples', 'Bananas', 'Crackers', 'Dish soap', 'Milk'])
  assert.deepEqual(names(sortCatalog(shelf, 'bought', null, order)), ['Milk', 'Bananas', 'Crackers', 'Dish soap', 'Apples'])
  assert.deepEqual(names(sortCatalog(shelf, 'department', null, order)), ['Milk', 'Crackers', 'Apples', 'Bananas', 'Dish soap'])
  // The store's walking order; items not found there last. Without a store it's A-Z.
  assert.deepEqual(names(sortCatalog(shelf, 'aisle', 'Market', order)), ['Bananas', 'Dish soap', 'Crackers', 'Milk', 'Apples'])
  assert.deepEqual(names(sortCatalog(shelf, 'aisle', 'Market', new Map())), ['Dish soap', 'Crackers', 'Milk', 'Bananas', 'Apples'])
  assert.deepEqual(names(sortCatalog(shelf, 'aisle', null, order)), ['Apples', 'Bananas', 'Crackers', 'Dish soap', 'Milk'])
  assert.deepEqual(names(sortCatalog(shelf, 'recent', null, order)), ['Crackers', 'Bananas', 'Milk', 'Apples', 'Dish soap'])
})

test('groupCatalog: by department or category (an item under each of its categories), none last, order kept', () => {
  const sorted = sortCatalog(shelf, 'alpha', null, new Map())
  assert.deepEqual(groupCatalog(sorted, 'none').map(g => [g.name, names(g.items)]), [[null, ['Apples', 'Bananas', 'Crackers', 'Dish soap', 'Milk']]])
  assert.deepEqual(groupCatalog(sorted, 'department').map(g => [g.name, names(g.items)]),
    [['Dairy', ['Milk']], ['Pantry', ['Crackers']], ['Produce', ['Apples', 'Bananas']], ['No department', ['Dish soap']]])
  assert.deepEqual(groupCatalog(sorted, 'category').map(g => [g.name, names(g.items)]),
    [['Breakfast', ['Bananas', 'Milk']], ['Lunchbox', ['Crackers']], ['Snacks', ['Bananas', 'Crackers']], ['No category', ['Apples', 'Dish soap']]])
})

test('tagsInput: trimmed, blanks dropped, each once ignoring case, the family spelling kept', () => {
  assert.deepEqual(tagsInput([' Snacks ', 'snacks', '', 'lunchbox', 'New  one'], ['Lunchbox']), ['Snacks', 'Lunchbox', 'New one'])
})
