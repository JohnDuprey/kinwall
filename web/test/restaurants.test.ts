import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addonsFor, menuOptions, menuSections, optionName, parsePrice, priceLabel, telHref } from '../src/restaurants.ts'
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

test('restaurants: sizes and choices read off the description, the way a menu is read in', () => {
  assert.deepEqual(menuOptions('Single $9.35 · Double $12.45 — Yellow cheddar, lettuce — tomato'), { options: [{ label: 'Single', cents: 935 }, { label: 'Double', cents: 1245 }], rest: 'Yellow cheddar, lettuce — tomato' })
  assert.deepEqual(menuOptions('10" $11.40 · 14" $14.50'), { options: [{ label: '10"', cents: 1140 }, { label: '14"', cents: 1450 }], rest: null })
  assert.deepEqual(menuOptions('(4) $8.30 · (8) $14.50 — Flavors: Buffalo | BBQ').options.map(o => o.label), ['4', '8'])
  assert.deepEqual(menuOptions('Eggplant $12.45 · Chicken Caprese $14.50 — On a wrap').options.map(o => o.label), ['Eggplant', 'Chicken Caprese'])
  // One price, a price with no label, or no prices: no options, the description as is.
  assert.deepEqual(menuOptions('+$1.00 each — For Panini'), { options: [], rest: '+$1.00 each — For Panini' })
  assert.deepEqual(menuOptions('$9 · $12'), { options: [], rest: '$9 · $12' })
  assert.deepEqual(menuOptions('Spring mix, ham · olives'), { options: [], rest: 'Spring mix, ham · olives' })
  assert.deepEqual(menuOptions(null), { options: [], rest: null })
  assert.equal(optionName('Classic burger', 'Double'), 'Classic burger (Double)')
})

test('restaurants: add-ons go with the sections they say they are for', () => {
  const addon = (name: string, description: string | null) => ({ ...item(name, 'Add-ons'), description })
  const menu = [item('Burger', 'Burgers'), addon('Bacon', 'For Burgers and Subs and sandwiches'), addon('Extra cheese', '10" $2.00 · 14" $3.00 — For Pizza and Specialty pizza'), addon('Napkins', null), addon('Sub fries', 'For Smash Burgers, Panini & Specialty Sandwiches and Wraps')]
  const names = (section: string | null) => addonsFor(menu, { section }).map(a => a.name)
  assert.deepEqual(names('Burgers'), ['Bacon', 'Napkins'])
  assert.deepEqual(names('Subs and sandwiches'), ['Bacon', 'Napkins'], 'a section with "and" in its name')
  assert.deepEqual(names('Pizza'), ['Extra cheese', 'Napkins'])
  assert.deepEqual(names('Specialty pizza'), ['Extra cheese', 'Napkins'])
  assert.deepEqual(names('Panini & Specialty Sandwiches'), ['Napkins', 'Sub fries'])
  assert.deepEqual(names('Smash'), ['Napkins'], 'only whole sections')
  assert.deepEqual(names('Add-ons'), []); assert.deepEqual(names(null), []); assert.deepEqual(addonsFor(menu, undefined), [])
})
