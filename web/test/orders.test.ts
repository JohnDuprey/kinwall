import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsLabel, orderLines, orderPeople, ordersLabel, orderText, ownOrderer, toggleAddon, hasAddon, usualFor, waitingOn } from '../src/orders.ts'
import type { MealOrder } from '../src/meal-types.ts'

const members = [{ id: 'm1', name: 'Alex' }, { id: 'm2', name: 'Sam' }, { id: 'm3', name: 'Maya' }, { id: 'm4', name: 'Leo' }]
const item = (name: string, qty = 1, note: string | null = null) => ({ menuItemId: null, name, qty, note })
const order = (memberId: string, items: ReturnType<typeof item>[], note: string | null = null): MealOrder => ({ memberId, items, note, updatedAt: '' })

test('orders: who gets a row', () => {
  const meal = { eaterIds: ['m2', 'm4'], orders: [order('m1', [item('Soda')])] }
  assert.deepEqual(orderPeople(meal, members).map(m => m.name), ['Alex', 'Sam', 'Leo'])
  assert.deepEqual(orderPeople({ eaterIds: [], orders: [] }, members).length, 4)
  assert.deepEqual(orderPeople(meal, members, 'm4').map(m => m.name), ['Leo'])
  assert.equal(ordersLabel(meal), '1 of 2 orders in')
  assert.equal(ordersLabel({ eaterIds: [], orders: [order('m1', [])] }), '0 orders in')
})

test('orders: the same item adds up with who it is for, item notes kept apart', () => {
  const orders = [order('m4', [item('Cheese slice', 2)]), order('m2', [item('cheese slice'), item('Salad', 1, 'no croutons')], 'Extra napkins'), order('m3', [item('Salad')])]
  assert.deepEqual(orderLines(orders, members).map(l => [l.qty, l.name, l.note, l.who]), [
    [3, 'cheese slice', null, ['Sam', 'Leo']], [1, 'Salad', 'no croutons', ['Sam']], [1, 'Salad', null, ['Maya']],
  ])
  assert.equal(orderText({ title: 'Corner Slice', orderType: 'pickup', orders }, members),
    'Corner Slice · Pickup\n3 × cheese slice (Sam, Leo)\n1 × Salad, no croutons (Sam)\n1 × Salad (Maya)\n\nNotes:\nSam: Extra napkins')
})

test("orders: someone's usual is their last order elsewhere, unless they have it already", () => {
  const place = { lastOrders: [{ memberId: 'm4', mealId: 'old', date: '2026-10-02', items: [item('Tenders')] }, { memberId: 'm2', mealId: 'tonight', date: '2026-10-09', items: [item('Salad')] }] }
  const tonight = { id: 'tonight', orders: [] as MealOrder[] }
  assert.equal(itemsLabel(usualFor(place, 'm4', tonight)!), 'Tenders')
  assert.equal(usualFor(place, 'm2', tonight), null) // that's tonight's own order
  assert.equal(usualFor(place, 'm4', { id: 'tonight', orders: [order('m4', [item('Tenders')])] }), null)
  assert.equal(itemsLabel([item('Slice', 2), item('Fries')]), '2 × Slice, Fries')
})

test("orders: only a kid's own device is limited to its owner", () => {
  assert.equal(ownOrderer({ scope: 'display', owner: 'm4' }), 'm4')
  assert.equal(ownOrderer({ scope: 'display', owner: 'shared' }), null)
  assert.equal(ownOrderer({ scope: 'admin', owner: 'm1' }), null)
  assert.equal(ownOrderer(null), null)
})

test('orders: who is eating and still has to order', () => {
  const orders = [order('m1', [item('Pizza')]), order('m2', [], 'Not hungry?')]
  assert.deepEqual(waitingOn({ eaterIds: ['m4', 'm1', 'm2'], orders }, members).map(m => m.name), ['Sam', 'Leo'], 'a note alone is not an order')
  assert.deepEqual(waitingOn({ eaterIds: [], orders }, members), [], 'nobody picked as eating')
})

test('orders: an add-on goes in the item note and comes back out', () => {
  assert.equal(toggleAddon(null, 'Bacon'), '+ Bacon')
  assert.equal(toggleAddon('No onions', 'Bacon'), 'No onions, + Bacon')
  assert.equal(toggleAddon('No onions, + Bacon, + Avocado', 'Bacon'), 'No onions, + Avocado')
  assert.equal(toggleAddon('+ Bacon', 'Bacon'), null)
  assert.ok(hasAddon('No onions, + Bacon', 'Bacon')); assert.ok(!hasAddon('Bacon please', 'Bacon')); assert.ok(!hasAddon(null, 'Bacon'))
})
