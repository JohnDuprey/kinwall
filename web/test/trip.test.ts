// node --test test/ (npm test). "Shopping at" ordering and per-store aisle lookup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aisleAt, anyStoreView, placeNeeds, departmentAisle, resumeShoppingHash, setShoppingModeList, setTripReverse, setTripStore, shoppingModeList, tripLeftovers, tripReverse, tripStoreFor, tripView, ANY_STORE } from '../src/trip.ts'

type P = { store: string | null; aisle: string | null }
const item = (title: string, store: string | null, aisle: string | null = null, places: P[] = []) => ({ title, store, aisle, places })

test('aisleAt: the item\'s own aisle at its store, else the one remembered for that store', () => {
  const milk = item('Milk', 'Club', 'Aisle 2', [{ store: 'Market', aisle: 'Dairy' }, { store: 'Club', aisle: 'Aisle 9' }])
  assert.equal(aisleAt(milk, 'Club'), 'Aisle 2')
  assert.equal(aisleAt(milk, 'Market'), 'Dairy')
  assert.equal(aisleAt(milk, 'Corner shop'), null)
  assert.equal(aisleAt(item('Soap', null, 'Aisle 7'), 'Market'), null) // an anywhere item's aisle isn't this store's
  assert.equal(aisleAt(item('Soap', null, null, [{ store: 'Market', aisle: 'Aisle 7' }]), 'Market'), 'Aisle 7')
})

test('tripView: aisles in walking order (custom, else natural), aisle unknown, then other stores', () => {
  const items = [
    item('Ice cream', 'Market', 'Frozen'),
    item('Soup', null, null, [{ store: 'Market', aisle: 'Aisle 10' }]),
    item('Rice', 'Market', 'Aisle 2'),
    item('Beans', 'Market', 'Aisle 2'),
    item('Batteries', null),
    item('Apples', 'Market', 'Produce'),
    item('Stamps', 'Post office'),
    item('Paper towels', 'Club', 'Aisle 14'),
  ]
  const natural = tripView(items, 'Market', new Map())
  assert.deepEqual(natural.aisles.map(g => [g.aisle, g.items.map(i => i.title)]), [['Aisle 2', ['Beans', 'Rice']], ['Aisle 10', ['Soup']], ['Frozen', ['Ice cream']], ['Produce', ['Apples']]])
  assert.deepEqual(natural.unknown.map(i => i.title), ['Batteries'])
  assert.deepEqual(natural.other.map(i => i.title), ['Paper towels', 'Stamps'])

  // The market's own order puts Produce first and Frozen between numbered aisles; unlisted ones follow.
  const custom = tripView(items, 'Market', new Map([['Market', ['Produce', 'Aisle 10', 'Frozen']]]))
  assert.deepEqual(custom.aisles.map(g => g.aisle), ['Produce', 'Aisle 10', 'Frozen', 'Aisle 2'])

  // At the club, market items are "other"; anywhere items with no club aisle are unknown.
  const club = tripView(items, 'Club', new Map())
  assert.deepEqual(club.aisles.map(g => [g.aisle, g.items.map(i => i.title)]), [['Aisle 14', ['Paper towels']]])
  assert.deepEqual(club.unknown.map(i => i.title), ['Batteries', 'Soup'])
  assert.deepEqual(club.other.map(i => i.title), ['Apples', 'Beans', 'Ice cream', 'Rice', 'Stamps'])
})

test('tripView reversed: aisle groups walk backwards (custom order, then natural); unknown and other stay last', () => {
  const items = [
    item('Ice cream', 'Market', 'Frozen'),
    item('Rice', 'Market', 'Aisle 2'),
    item('Beans', 'Market', 'Aisle 2'),
    item('Soup', 'Market', 'Aisle 10'),
    item('Apples', 'Market', 'Produce'),
    item('Batteries', null),
    item('Stamps', 'Post office'),
  ]
  const order = new Map([['Market', ['Produce', 'Frozen']]])
  const fwd = tripView(items, 'Market', order)
  assert.deepEqual(fwd.aisles.map(g => g.aisle), ['Produce', 'Frozen', 'Aisle 2', 'Aisle 10'])
  const rev = tripView(items, 'Market', order, [], true)
  assert.deepEqual(rev.aisles.map(g => [g.aisle, g.items.map(i => i.title)]), [['Aisle 10', ['Soup']], ['Aisle 2', ['Beans', 'Rice']], ['Frozen', ['Ice cream']], ['Produce', ['Apples']]], 'items keep A-Z within an aisle')
  assert.deepEqual(rev.unknown.map(i => i.title), ['Batteries'])
  assert.deepEqual(rev.other.map(i => i.title), ['Stamps'])
})

test('tripReverse: remembered per store on this device', () => {
  const store = new Map<string, string>()
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k) } as Storage
  try {
    assert.equal(tripReverse('Shaws'), false)
    setTripReverse('Shaws', true)
    assert.equal(tripReverse('Shaws'), true)
    assert.equal(tripReverse('Market'), false)
    setTripReverse('Shaws', false)
    assert.equal(tripReverse('Shaws'), false)
    assert.equal(store.size, 0)
  } finally { delete (globalThis as { localStorage?: Storage }).localStorage }
  assert.equal(tripReverse('Shaws'), false, 'no storage: not reversed')
})

test('departmentAisle: a department naming one of the store\'s aisles, any case', () => {
  const aisles = ['Produce', 'Aisle 4', 'Dairy']
  assert.equal(departmentAisle('produce', aisles), 'Produce') // the store's spelling
  assert.equal(departmentAisle(' DAIRY ', aisles), 'Dairy')
  assert.equal(departmentAisle('Bakery', aisles), null)
  assert.equal(departmentAisle(null, aisles), null)
  assert.equal(departmentAisle('', aisles), null)
})

test('tripView: a department fills in an unknown aisle; a real or remembered aisle wins', () => {
  const dept = (title: string, store: string | null, category: string, aisle: string | null = null, places: P[] = []) => ({ ...item(title, store, aisle, places), category })
  const items = [
    dept('Apples', null, 'produce'), // no aisle known at Shaws: its department's
    dept('Carrots', 'Shaws', 'Produce', 'Aisle 1'), // its own aisle wins
    dept('Kale', null, 'Produce', null, [{ store: 'Shaws', aisle: 'Aisle 2' }]), // remembered wins
    dept('Bread', null, 'Bakery'), // no Bakery aisle at Shaws
  ]
  const view = tripView(items, 'Shaws', new Map([['Shaws', ['Produce', 'Aisle 1', 'Aisle 2']]]), ['Produce', 'Aisle 1', 'Aisle 2'])
  assert.deepEqual(view.aisles.map(g => [g.aisle, g.items.map(i => i.title)]), [['Produce', ['Apples']], ['Aisle 1', ['Carrots']], ['Aisle 2', ['Kale']]])
  assert.deepEqual(view.unknown.map(i => i.title), ['Bread'])
  assert.equal(aisleAt(items[0], 'Shaws'), null) // without the store's aisles: nothing inferred
})

test('anyStoreView: store by store (anywhere last), each in its own aisle order', () => {
  const items = [
    item('Soap', null),
    item('Milk', 'Market', 'Dairy'),
    item('Apples', 'Market', 'Produce'),
    item('Bread', 'Market', null),
    item('Paper towels', 'Club', 'Aisle 14'),
  ]
  const v = anyStoreView(items, new Map([['Market', ['Produce', 'Dairy']]]))
  assert.deepEqual(v.aisles.map(g => [g.aisle, g.items.map(i => i.title)]), [['Club', ['Paper towels']], ['Market', ['Apples', 'Milk', 'Bread']], ['Anywhere', ['Soap']]])
  assert.deepEqual([v.unknown, v.other], [[], []])
})

test('shopping mode resumes only while its trip is on, and only over the default landing', () => {
  const store = new Map<string, string>()
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: k => void store.delete(k) } as Storage
  try {
    assert.equal(resumeShoppingHash(''), null)
    setShoppingModeList('l1')
    assert.equal(shoppingModeList(), null) // no trip: nothing to resume
    setTripStore('l1', 'Market')
    assert.equal(shoppingModeList(), 'l1')
    assert.equal(resumeShoppingHash(''), '#/lists/l1/shop')
    assert.equal(resumeShoppingHash('#/calendar'), '#/lists/l1/shop')
    assert.equal(resumeShoppingHash('#/chores'), null) // a link somewhere else wins
    setTripStore('l1', null) // Checkout / End
    assert.equal(resumeShoppingHash(''), null)
  } finally { delete (globalThis as { localStorage?: Storage }).localStorage }
})

test('tripLeftovers: unchecked items for this store or anywhere; any store counts every unchecked item', () => {
  const items = [
    { title: 'Milk', store: 'Market', done: true },
    { title: 'Eggs', store: 'Market', done: false },
    { title: 'Soap', store: null, done: false },
    { title: 'Tires', store: 'Garage', done: false },
    { title: 'Bread', store: null, done: true },
  ]
  assert.deepEqual(tripLeftovers(items, 'Market').map(i => i.title), ['Eggs', 'Soap'])
  assert.deepEqual(tripLeftovers(items, ANY_STORE).map(i => i.title), ['Eggs', 'Soap', 'Tires'])
  assert.deepEqual(tripLeftovers(items.map(i => ({ ...i, done: true })), 'Market'), [])
})

test('tripStoreFor: a linked store matches the list\'s stores in any case; "any" is Any store', () => {
  const stores = ['Market', "Trader Joe's"]
  assert.equal(tripStoreFor('market', stores), 'Market')
  assert.equal(tripStoreFor(" TRADER JOE'S ", stores), "Trader Joe's")
  assert.equal(tripStoreFor('Any', stores), ANY_STORE)
  assert.equal(tripStoreFor('any', []), ANY_STORE)
  assert.equal(tripStoreFor('Corner shop', stores), null) // not one of theirs: ask as usual
  assert.equal(tripStoreFor('', stores), null)
  assert.equal(tripStoreFor(null, stores), null)
})

test('placeNeeds: after a scan while shopping, ask only for what is missing at this store', () => {
  const item = (d: Partial<{ store: string | null; aisle: string | null; category: string | null; places: P[] }>) => ({ title: 'Cereal', store: null, aisle: null, category: null, places: [], ...d })
  assert.deepEqual(placeNeeds(item({}), 'Market', []), { aisle: true, department: true }, 'new item: both')
  assert.deepEqual(placeNeeds(item({ category: 'Pantry', places: [{ store: 'Market', aisle: 'Aisle 4' }] }), 'Market', []), { aisle: false, department: false }, 'known here: nothing')
  assert.deepEqual(placeNeeds(item({ category: 'Pantry', places: [{ store: 'Club', aisle: 'Aisle 9' }] }), 'Market', []), { aisle: true, department: false }, 'known at another store only')
  assert.deepEqual(placeNeeds(item({ category: 'Produce' }), 'Market', ['Produce', 'Aisle 1']), { aisle: false, department: false }, 'its department is an aisle here')
  assert.deepEqual(placeNeeds(item({}), ANY_STORE, []), { aisle: false, department: true }, 'any store: no aisle to ask for')
  assert.deepEqual(placeNeeds(item({}), null, []), { aisle: false, department: true })
})
