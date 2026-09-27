// node --test test/ (npm test). Autocomplete matching for the list add bar and Shopping mode.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemKey, matchItems } from '../src/itemSuggest.ts'

const names = ['Bread', 'Bananas', 'Banana milk', 'Bagels', 'Oat milk', 'Blueberries', 'Eggs', 'Baby spinach', 'Tomatoes'].map(title => ({ title, key: itemKey(title) }))
const titles = (q: string, skip: string[] = [], limit?: number) => matchItems(q, names, new Set(skip.map(itemKey)), limit).map(s => s.title)

test('itemKey matches the server: case, spacing and simple plurals', () => {
  for (const [a, b] of [['Eggs', 'egg'], ['  Whole   Milk ', 'whole milk'], ['Tomatoes', 'tomato'], ['Berries', 'berry'], ['Cookies', 'cookie'], ['Peaches', 'peach'], ['Glasses', 'glass']]) assert.equal(itemKey(a), itemKey(b), `${a} = ${b}`)
  for (const [a, b] of [['Hummus', 'Hummu'], ['Milk', 'Mint']]) assert.notEqual(itemKey(a), itemKey(b))
})

test('matchItems: word starts first (in the given order), then contains; case-insensitive', () => {
  assert.deepEqual(titles('ba'), ['Bananas', 'Banana milk', 'Bagels', 'Baby spinach'])
  assert.deepEqual(titles('MILK'), ['Banana milk', 'Oat milk'])
  assert.deepEqual(titles('e'), ['Eggs', 'Bread', 'Bagels', 'Blueberries', 'Tomatoes']) // Eggs starts with it; the rest contain it
  assert.deepEqual(titles('b', [], 2), ['Bread', 'Bananas'])
  assert.deepEqual(titles(''), [])
  assert.deepEqual(titles('  '), [])
})

test('matchItems: plural-insensitive, and names already on the list are left out', () => {
  assert.deepEqual(titles('eggs'), ['Eggs'])
  assert.deepEqual(titles('egg'), ['Eggs'])
  assert.deepEqual(titles('blueberry'), ['Blueberries'])
  assert.deepEqual(titles('tomatoe'), ['Tomatoes'])
  assert.deepEqual(titles('banana'), ['Bananas', 'Banana milk'])
  assert.deepEqual(titles('banana', ['banana']), ['Banana milk'])
  assert.deepEqual(titles('ba', ['Bagels', 'bananas']), ['Banana milk', 'Baby spinach'])
})
