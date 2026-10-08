// node --test test/ (npm test). Which sheet a tapped planned meal opens: its recipe, or the meal's details.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATUS_LABEL, isOrderNight, mealEventStatus, mealRecipe, statusLabel } from '../src/meal-date.ts'

test('mealRecipe: a recipe meal opens its recipe from the library; anything else opens the meal sheet', () => {
  const tacos = { id: 'r1', name: 'Tacos' }
  const library = [tacos, { id: 'r2', name: 'Soup' }]
  assert.equal(mealRecipe({ mealKind: 'recipe', recipeId: 'r1' }, library), tacos)
  assert.equal(mealRecipe({ mealKind: 'dining_out', recipeId: null }, library), undefined)
  assert.equal(mealRecipe({ mealKind: 'simple', recipeId: 'r1' }, library), undefined) // a leftover id on a simple meal
  assert.equal(mealRecipe({ mealKind: 'recipe', recipeId: 'gone' }, library), undefined) // deleted recipe: the meal keeps its snapshot
  assert.equal(mealRecipe({ mealKind: 'recipe', recipeId: 'r1' }, []), undefined)
})

test('isOrderNight: eating out from a binder restaurant opens the order view', () => {
  assert.equal(isOrderNight({ mealKind: 'dining_out', restaurantId: 'r1' }), true)
  assert.equal(isOrderNight({ mealKind: 'dining_out', restaurantId: null }), false) // "somewhere else": the meal sheet
  assert.equal(isOrderNight({ mealKind: 'recipe', restaurantId: 'r1' }), false)
})

test('statusLabel: plain words for what the family did; the API values stay', () => {
  assert.equal(statusLabel({ status: 'planned', mealKind: 'recipe' }), 'Planned')
  assert.equal(statusLabel({ status: 'prepared', mealKind: 'recipe' }), 'Cooked')
  assert.equal(statusLabel({ status: 'prepared', mealKind: 'freeform' }), 'Cooked')
  assert.equal(statusLabel({ status: 'prepared', mealKind: 'dining_out' }), 'Ordered')
  assert.deepEqual(Object.keys(STATUS_LABEL), ['planned', 'prepared'])
})

test('mealEventStatus: what a meal event says on the calendar', () => {
  const meal = { status: 'planned' as const, mealKind: 'recipe' as const, restaurantId: null, eaterCount: 4, orderCount: 0 }
  assert.deepEqual(mealEventStatus(meal), { done: false, text: 'Planned', compact: '🍽️' })
  assert.deepEqual(mealEventStatus({ ...meal, status: 'prepared' }), { done: true, text: '✓ Cooked', compact: '🍽️✓' })
  const pizza = { ...meal, mealKind: 'dining_out' as const, restaurantId: 'r1', orderCount: 3 }
  assert.deepEqual(mealEventStatus(pizza), { done: false, text: '3 of 4 orders in', compact: '🍽️' })
  assert.equal(mealEventStatus({ ...pizza, eaterCount: 0, orderCount: 1 }).text, '1 order in')
  assert.deepEqual(mealEventStatus({ ...pizza, status: 'prepared' }), { done: true, text: '✓ Ordered', compact: '🍽️✓' })
  assert.equal(mealEventStatus({ ...pizza, restaurantId: null }).text, 'Planned') // eating out somewhere else: no orders to count
})
