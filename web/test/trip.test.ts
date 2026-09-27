// node --test test/ (npm test). "Shopping at" ordering and per-store aisle lookup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aisleAt, departmentAisle, tripView } from '../src/trip.ts'

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
