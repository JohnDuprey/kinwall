// node --test test/ (npm test). Finding a recipe: the library search and the meal sheet's picker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickerRecipes, recipeMatches } from '../src/recipe-search.ts'

const recipe = (id: string, name: string, ingredients: string[] = [], archived = false, description: string | null = null) =>
  ({ id, name, description, archived, ingredients: ingredients.map(name => ({ name })) })

test('recipeMatches: name, description or an ingredient, any case; blank matches all', () => {
  const tacos = recipe('1', 'Fish tacos', ['Cod', 'Lime'], false, 'Friday favorite')
  assert.ok(recipeMatches(tacos, 'TACO'))
  assert.ok(recipeMatches(tacos, 'lime'))
  assert.ok(recipeMatches(tacos, 'friday'))
  assert.ok(recipeMatches(tacos, '  '))
  assert.ok(!recipeMatches(tacos, 'pasta'))
})

test('pickerRecipes: matches by name, skips archived unless it is the current one, sorted by name', () => {
  const all = [recipe('1', 'soup', ['Leek']), recipe('2', 'Apple pie', ['Apple']), recipe('3', 'Old stew', [], true), recipe('4', 'Banana bread', ['Banana'])]
  assert.deepEqual(pickerRecipes(all, '').map(r => r.id), ['2', '4', '1'])
  assert.deepEqual(pickerRecipes(all, '', '3').map(r => r.id), ['2', '4', '3', '1'])
  assert.deepEqual(pickerRecipes(all, 'leek').map(r => r.id), ['1'])
  assert.deepEqual(pickerRecipes(all, 'zzz'), [])
})
