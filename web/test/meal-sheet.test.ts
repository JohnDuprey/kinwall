// node --test test/ (npm test). Which sheet a tapped planned meal opens: its recipe, or the meal's details.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mealRecipe } from '../src/meal-date.ts'

test('mealRecipe: a recipe meal opens its recipe from the library; anything else opens the meal sheet', () => {
  const tacos = { id: 'r1', name: 'Tacos' }
  const library = [tacos, { id: 'r2', name: 'Soup' }]
  assert.equal(mealRecipe({ mealKind: 'recipe', recipeId: 'r1' }, library), tacos)
  assert.equal(mealRecipe({ mealKind: 'dining_out', recipeId: null }, library), undefined)
  assert.equal(mealRecipe({ mealKind: 'simple', recipeId: 'r1' }, library), undefined) // a leftover id on a simple meal
  assert.equal(mealRecipe({ mealKind: 'recipe', recipeId: 'gone' }, library), undefined) // deleted recipe: the meal keeps its snapshot
  assert.equal(mealRecipe({ mealKind: 'recipe', recipeId: 'r1' }, []), undefined)
})
