// node --test test/ (npm test). Finding a recipe: the library search and the meal sheet's picker.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { basicKey, matchBasic, pickerRecipes, recipeMatches } from '../src/recipe-search.ts'

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

test('pickerRecipes: basics stay out unless asked for, or already chosen', () => {
  const all = [recipe('1', 'Tacos'), { ...recipe('2', 'Taco seasoning'), kind: 'basic' as const }, { ...recipe('3', 'Pizza dough'), kind: 'basic' as const }]
  assert.deepEqual(pickerRecipes(all, '').map(r => r.id), ['1'])
  assert.deepEqual(pickerRecipes(all, 'taco').map(r => r.id), ['1'])
  assert.deepEqual(pickerRecipes(all, 'taco', null, true).map(r => r.id), ['2', '1'])
  assert.deepEqual(pickerRecipes(all, '', '3').map(r => r.id), ['3', '1'])
})

test('basicKey: any case, punctuation and spacing; filler words like blend and mix drop out', () => {
  assert.equal(basicKey('Taco Seasoning'), 'taco seasoning')
  assert.equal(basicKey('  taco   seasoning blend '), 'taco seasoning')
  assert.equal(basicKey('Taco-Seasoning Mix'), 'taco seasoning')
  assert.equal(basicKey('Homemade pizza dough'), 'pizza dough')
  assert.equal(basicKey('Mix'), 'mix', 'a name that is only filler keeps it')
  assert.equal(basicKey('Crème fraîche'), 'crème fraîche')
})

test('matchBasic: one basic with the same key; none when several match or it is the recipe itself', () => {
  const basics = [{ id: 'b1', name: 'Taco seasoning' }, { id: 'b2', name: 'Pizza dough' }, { id: 'b3', name: 'Ranch' }, { id: 'b4', name: 'Ranch mix' }]
  assert.equal(matchBasic('Taco Seasoning Blend', basics)?.id, 'b1')
  assert.equal(matchBasic('pizza-dough', basics)?.id, 'b2')
  assert.equal(matchBasic('Taco', basics), null, 'a shorter name is another thing')
  assert.equal(matchBasic('Taco seasoning packet', basics), null)
  assert.equal(matchBasic('Ranch', basics), null, 'ambiguous')
  assert.equal(matchBasic('Taco seasoning', basics, 'b1'), null, 'not itself')
  assert.equal(matchBasic('', basics), null)
})
