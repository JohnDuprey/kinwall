// node --test test/ (npm test). The grocery catalog's search, store filter and labels.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeCatalogFilters, boughtLabel, catalogDepartments, catalogFilterSummary, catalogStores, catalogTags, filterCatalog, groupCatalog, placeLabel, placesFor, placesInput, scanMatch, scanTarget, sortCatalog, tagsInput } from '../src/catalog.ts'
import { itemKey } from '../src/itemSuggest.ts'
import type { List, RememberedItem } from '../src/types.ts'

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

test('activeCatalogFilters and catalogFilterSummary: the badge count and the line above the items', () => {
  const none = { store: null, tag: null, department: null }
  const alpha = { sort: 'alpha', group: 'none' } as const
  assert.equal(activeCatalogFilters(none), 0)
  assert.equal(catalogFilterSummary(none, { sort: 'bought', group: 'department' }), '')
  const f = { store: 'Market', tag: 'Breakfast', department: null }
  assert.equal(activeCatalogFilters(f), 2)
  assert.equal(activeCatalogFilters({ ...f, department: 'Dairy' }), 3)
  assert.equal(catalogFilterSummary(f, alpha), 'Market · Breakfast')
  assert.equal(catalogFilterSummary(f, { sort: 'bought', group: 'none' }), 'Market · Breakfast · Most bought')
  assert.equal(catalogFilterSummary(f, { sort: 'aisle', group: 'category' }), 'Market · Breakfast · Aisle at Market · By category')
  assert.equal(catalogFilterSummary({ ...none, department: 'Dairy' }, { sort: 'recent', group: 'department' }), 'Dairy · Recently used · By department')
})

test('scanTarget: food goes to a Groceries list, household and beauty to a Shopping list; else the list scanned on', () => {
  const l = (id: string, catalog: 'groceries' | 'shopping', archived = false) => ({ id, kind: 'shopping', catalog, archived }) as unknown as List
  const lists = [l('g', 'groceries'), l('old', 'shopping', true), l('hw', 'shopping'), l('target', 'shopping')]
  assert.equal(scanTarget(lists, 'g', 'openproductsfacts'), 'hw', 'household scanned on Groceries: the first Shopping list')
  assert.equal(scanTarget(lists, 'g', 'openbeautyfacts'), 'hw')
  assert.equal(scanTarget(lists, 'target', 'openbeautyfacts'), 'target', 'already a Shopping list: stays')
  assert.equal(scanTarget(lists, 'hw', 'openfoodfacts'), 'g', 'food scanned on a Shopping list: Groceries')
  assert.equal(scanTarget(lists, 'hw', 'openpetfoodfacts'), 'g', 'pet food is groceries')
  assert.equal(scanTarget(lists, 'hw', null), 'hw', 'not found anywhere: stays')
  assert.equal(scanTarget([l('hw', 'shopping')], 'hw', 'openfoodfacts'), 'hw', 'no Groceries list: stays')
})

test("scanTarget: the type's default list wins over the first one", () => {
  const l = (id: string, catalog: 'groceries' | 'shopping', isDefault = false) => ({ id, kind: 'shopping', catalog, archived: false, isDefault }) as unknown as List
  const lists = [l('g', 'groceries'), l('costco', 'groceries', true), l('hw', 'shopping'), l('target', 'shopping', true)]
  assert.equal(scanTarget(lists, 'hw', 'openfoodfacts'), 'costco')
  assert.equal(scanTarget(lists, 'g', 'openproductsfacts'), 'target')
  assert.equal(scanTarget(lists, 'g', 'openfoodfacts'), 'g', 'already the right type: stays, default or not')
})

test('scanMatch: the open item a scanned product is, by name: exact first, else a whole-word name inside it, longest wins', () => {
  const items = [{ title: 'Milk', done: false }, { title: 'Cheerios', done: false }, { title: 'Oat milk', done: false }, { title: 'Bread', done: true }, { title: 'Eggs', done: false }]
  assert.equal(scanMatch(items, 'cheerios')?.title, 'Cheerios', 'the same name, any case')
  assert.equal(scanMatch(items, 'Honey Nut Cheerios')?.title, 'Cheerios', 'the list name inside the product name')
  assert.equal(scanMatch(items, 'Organic Oat Milk 64oz')?.title, 'Oat milk', 'the longest name that fits')
  assert.equal(scanMatch(items, 'Egg')?.title, 'Eggs', 'simple plurals')
  assert.equal(scanMatch(items, 'Sourdough Bread'), undefined, 'checked-off items are not matched again')
  assert.equal(scanMatch(items, 'Buttermilk'), undefined, 'only whole words')
  assert.equal(scanMatch(items, 'Paper Towels'), undefined)
})
