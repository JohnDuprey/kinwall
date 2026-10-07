import { test } from 'node:test'
import assert from 'node:assert/strict'
import { menuSections, parsePrice, priceLabel, telHref } from '../src/restaurants.ts'
import type { MenuItem } from '../src/meal-types.ts'

const item = (name: string, section: string | null, favorite = false, sort = 0): MenuItem => ({ id: name, name, section, favorite, sort, description: null, priceCents: null })

test('restaurants: favorites come first, then sections in the order they appear', () => {
  const menu = [item('Cheese', 'Pizza', true), item('Fries', 'Sides'), item('Pepperoni', 'Pizza'), item('Soda', null, true)]
  assert.deepEqual(menuSections(menu).map(s => [s.title, s.items.map(i => i.name)]), [
    ['Favorites', ['Cheese', 'Soda']], ['Pizza', ['Cheese', 'Pepperoni']], ['Sides', ['Fries']], [null, ['Soda']],
  ])
  assert.deepEqual(menuSections([]), [])
})

test('restaurants: prices and phone numbers', () => {
  assert.equal(priceLabel(1299), '$12.99'); assert.equal(priceLabel(1200), '$12'); assert.equal(priceLabel(null), null)
  assert.equal(parsePrice('$12.5'), 1250); assert.equal(parsePrice(''), null); assert.equal(parsePrice('cheap'), undefined); assert.equal(parsePrice('3,25'), 325)
  assert.equal(telHref('(555) 010-0100'), 'tel:5550100100'); assert.equal(telHref('call us'), null); assert.equal(telHref(null), null)
})
