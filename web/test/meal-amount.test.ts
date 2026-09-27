// Ingredient amounts as the meal and recipe sheets show them; stored data is untouched.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ingredientAmount, isPdfUrl, urlHost } from '../src/meal-date.ts'

test('ingredientAmount: kitchen fractions, units that agree with the amount', () => {
  assert.equal(ingredientAmount(2, 'ounce'), '2 ounces')
  assert.equal(ingredientAmount(10, 'ounces'), '10 ounces')
  assert.equal(ingredientAmount(1, 'ounces'), '1 ounce')
  assert.equal(ingredientAmount(0.5, 'cup'), '½ cup')
  assert.equal(ingredientAmount(1.5, 'cup'), '1½ cups')
  assert.equal(ingredientAmount(0.333333, 'cup'), '⅓ cup')
  assert.equal(ingredientAmount(2, 'tsp'), '2 tsp')
  assert.equal(ingredientAmount(4, 'fl oz'), '4 fl oz')
  assert.equal(ingredientAmount(2, 'bunch'), '2 bunches')
  assert.equal(ingredientAmount(1, 'bunches'), '1 bunch')
  assert.equal(ingredientAmount(1.1, 'lb'), '1.1 lb')
  assert.equal(ingredientAmount(3, null), '3')
  assert.equal(ingredientAmount(null, null, 'to taste'), 'to taste')
})

test('isPdfUrl / urlHost', () => {
  assert.equal(isPdfUrl('https://img.example.com/cards/abc.PDF?v=2'), true)
  assert.equal(isPdfUrl('https://example.com/recipes/abc'), false)
  assert.equal(isPdfUrl('https://example.com/pdf?x=.pdf'), false)
  assert.equal(isPdfUrl('not a url'), false)
  assert.equal(urlHost('https://www.hellofresh.com/recipes/x'), 'hellofresh.com')
})

test('recipeTime / startBy', async () => {
  const { recipeTime, startBy } = await import('../src/meal-date.ts')
  assert.equal(recipeTime({ prepMinutes: 10, totalMinutes: 35 }), '35 min · 10 min prep')
  assert.equal(recipeTime({ totalMinutes: 90 }), '1 hr 30 min')
  assert.equal(recipeTime({ prepMinutes: null, totalMinutes: 120 }), '2 hr')
  assert.equal(recipeTime(null), '')
  assert.equal(startBy('18:00', 35), '17:25')
  assert.equal(startBy('00:10', 35), null)
  assert.equal(startBy(null, 35), null)
  assert.equal(startBy('18:00', null), null)
})

test('mealForMember: eaters, the cook, and meals with nobody picked', async () => {
  const { mealForMember } = await import('../src/meal-date.ts')
  const meal = (eaterIds: string[], cook: string | null = null) => ({ eaterIds, assigneeMemberId: cook })
  assert.equal(mealForMember(meal(['a', 'b']), null), true)
  assert.equal(mealForMember(meal(['a', 'b']), 'a'), true)
  assert.equal(mealForMember(meal(['a', 'b']), 'c'), false)
  assert.equal(mealForMember(meal(['a'], 'c'), 'c'), true)
  assert.equal(mealForMember(meal([]), 'c'), true)
})
