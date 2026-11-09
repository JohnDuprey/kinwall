// node --test test/ (npm test). Pantry lists: use-by lines, matching food to recipes, and ranking
// (the same rules as server/src/pantry.ts, which server/test/pantry.test.ts covers in full).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { foodMatches, rankRecipes, expiryLabel, expiryShort, expiryStatus } from '../src/pantry.ts'
import type { PantryItem } from '../src/types.ts'
import type { Recipe } from '../src/meal-types.ts'

const today = '2026-11-08'

test('expiryStatus: days left in the calendar, and what that means', () => {
  assert.deepEqual(expiryStatus('2026-11-07', today), { daysLeft: -1, status: 'expired' })
  assert.deepEqual(expiryStatus(today, today), { daysLeft: 0, status: 'today' })
  assert.deepEqual(expiryStatus('2026-11-11', today), { daysLeft: 3, status: 'soon' })
  assert.deepEqual(expiryStatus('2026-11-12', today), { daysLeft: 4, status: 'later' })
  assert.equal(expiryStatus(null, today), null)
  assert.equal(expiryStatus('2026-13-45', today), null)
})

test('expiryLabel: a word and a mark for each state, never color alone; nothing once used up', () => {
  const label = (dueDate: string | null, done = false) => expiryLabel({ dueDate, done }, today)?.text
  assert.match(label('2026-11-06')!, /^⚠ Expired · Nov 6$/)
  assert.equal(label(today), '⏳ Use today')
  assert.equal(label('2026-11-09'), '⏳ Use by tomorrow')
  assert.match(label('2026-11-10')!, /^⏳ Use by Tue, Nov 10$/)
  assert.match(label('2026-11-20')!, /^Use by Nov 20$/)
  assert.equal(label('2026-11-06', true), undefined)
  assert.equal(label(null), undefined)
  assert.equal(expiryShort({ useBy: '2026-11-06', daysLeft: -2, status: 'expired' }), 'expired')
  assert.equal(expiryShort({ useBy: '2026-11-09', daysLeft: 1, status: 'soon' }), 'tomorrow')
})

test('foodMatches: the same food, a cut or a variety; not a different food', () => {
  assert.ok(foodMatches('Chicken', 'Chicken breast'))
  assert.ok(foodMatches('Tomatoes', 'Cherry tomatoes'))
  assert.ok(foodMatches('Greek yogurt', 'yogurt'))
  assert.ok(!foodMatches('Milk', 'Coconut milk'))
  assert.ok(!foodMatches('Garlic', 'Garlic powder'))
})

test('rankRecipes: sooner and more expiring items first, staples never missing, basics and archived left out', () => {
  const item = (id: string, title: string, daysLeft: number | null): PantryItem => ({ id, listId: 'p', listName: 'Kitchen', title, quantity: null, kept: null, useBy: null, daysLeft, status: daysLeft === null ? null : daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'today' : daysLeft <= 3 ? 'soon' : 'later' })
  const recipe = (id: string, names: string[], extra: Partial<Recipe> = {}) => ({ id, name: id, archived: false, kind: 'meal', ingredients: names.map(name => ({ name })), ...extra }) as unknown as Recipe
  const pantry = [item('a', 'Spinach', 0), item('b', 'Chicken', 2), item('c', 'Rice', null)]
  const expiring = pantry.slice(0, 2)
  const ranked = rankRecipes([
    recipe('Salad', ['Spinach', 'Walnuts', 'Salt']),
    recipe('Curry', ['Chicken thighs', 'Spinach', 'Rice']),
    recipe('Toast', ['Bread']),
    recipe('Stock', ['Chicken'], { kind: 'basic' }),
    recipe('Old', ['Spinach'], { archived: true }),
  ], pantry, expiring)
  assert.deepEqual(ranked.map(r => r.recipe.name), ['Curry', 'Salad'])
  assert.deepEqual(ranked[0].uses.map(u => u.title), ['Spinach', 'Chicken'])
  assert.deepEqual(ranked[0].alsoHave.map(u => u.title), ['Rice'])
  assert.deepEqual(ranked[1].missing, ['Walnuts'])
})

test('rankRecipes: staples never match ("pepper" isn\'t peppers), one item per ingredient, meal-kit ingredients never missing', () => {
  const item = (id: string, title: string, daysLeft: number): PantryItem => ({ id, listId: 'p', listName: 'Kitchen', title, quantity: null, kept: null, useBy: null, daysLeft, status: daysLeft <= 3 ? 'soon' : 'later' })
  const pantry = [item('p', 'Peppers', 1), item('b', 'Chicken breast', 2), item('t', 'Chicken thighs', 1)]
  const recipe = (id: string, ings: { name: string; qualifier?: string }[]) => ({ id, name: id, archived: false, kind: 'meal', ingredients: ings }) as unknown as Recipe
  const ranked = rankRecipes([
    recipe('Roast', [{ name: 'Chicken' }, { name: 'Salt and pepper' }, { name: 'Black pepper' }]),
    recipe('Fajitas', [{ name: 'Peppers' }, { name: 'Fajita spice', qualifier: 'in the kit' }, { name: 'Tortillas' }]),
  ], pantry, pantry)
  const by = Object.fromEntries(ranked.map(r => [r.recipe.name, r]))
  assert.deepEqual(by.Roast.uses.map(u => u.title), ['Chicken thighs'])
  assert.deepEqual(by.Roast.missing, [])
  assert.deepEqual(by.Fajitas.uses.map(u => u.title), ['Peppers'])
  assert.deepEqual(by.Fajitas.missing, ['Tortillas'])
  assert.ok(!foodMatches('Beans', 'green beans'))
})

test('soonestGroupFirst: the place with the food to use first leads; undated places last, then A-Z', async () => {
  const { soonestGroupFirst } = await import('../src/pantry.ts')
  const g = (name: string, ...dates: (string | null)[]) => ({ name, items: dates.map(dueDate => ({ dueDate })) })
  const groups = [g('Freezer', '2027-01-07'), g('Pantry', null), g('Fridge', '2026-11-07', '2026-11-20'), g('Cellar', null), g('Garage fridge', '2026-11-07')]
  assert.deepEqual(groups.sort(soonestGroupFirst).map(x => x.name), ['Fridge', 'Garage fridge', 'Freezer', 'Cellar', 'Pantry'])
})
