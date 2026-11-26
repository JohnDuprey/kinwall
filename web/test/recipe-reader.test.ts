import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recipeReaderContent } from '../src/recipe-reader.ts'
import type { Recipe } from '../src/meal-types.ts'

const recipe: Recipe = {
  id: 'r1', name: 'Family tacos', description: 'Build your own tacos.', defaultServings: 4,
  instructions: '1. Warm tortillas.\n\n2) Add the filling.', preparationNotes: 'Private family notes',
  sourceUrl: 'https://example.com/tacos', imageUrl: 'https://example.com/tacos.jpg',
  prepMinutes: 10, totalMinutes: 30, archived: false, ingredients: [], createdAt: '', updatedAt: '',
  rating: { average: 5, count: 1, byMember: { m1: 5 } }, favoritedBy: ['m1'],
  tags: [{ id: 't1', name: 'Family favorites' }], share: { url: 'https://example.com/r/private-token', createdAt: '' },
}

test('reader includes only public recipe content, without creating a share link', () => {
  const shown = recipeReaderContent(recipe)
  assert.equal(shown.name, recipe.name)
  assert.equal(shown.description, recipe.description)
  assert.equal(shown.imageUrl, recipe.imageUrl)
  assert.equal(shown.defaultServings, 4)
  assert.equal(shown.sourceUrl, recipe.sourceUrl)
  for (const key of ['preparationNotes', 'rating', 'favoritedBy', 'tags', 'share', 'cookedCount', 'lastCookedDate', 'archived']) {
    assert.ok(!(key in shown), `${key} stays out of the reader`)
  }
})

test('reader preserves structured step titles, photos and bullets; plain instructions match the public page', () => {
  assert.deepEqual(recipeReaderContent(recipe).steps.map(s => s.text), ['Warm tortillas.', 'Add the filling.'])
  const steps = [{ title: 'Prepare', text: 'Chop vegetables.', bullets: ['Keep toppings separate.'], imageUrl: 'https://example.com/step.jpg', timers: [{ name: 'Rest', minutes: 5 }] }]
  assert.deepEqual(recipeReaderContent({ ...recipe, steps }).steps, [{ title: 'Prepare', text: 'Chop vegetables.', bullets: ['Keep toppings separate.'], imageUrl: 'https://example.com/step.jpg' }])
  assert.deepEqual(recipeReaderContent({ ...recipe, instructions: null }).steps, [])
})

test('reader accepts only web source links and preserves basic yield and ingredient scaling data', () => {
  assert.equal(recipeReaderContent({ ...recipe, sourceUrl: 'javascript:alert(1)' }).sourceUrl, null)
  assert.equal(recipeReaderContent({ ...recipe, sourceUrl: '/relative' }).sourceUrl, null)
  const basic = recipeReaderContent({ ...recipe, kind: 'basic', makes: '1 cup' })
  assert.equal(basic.kind, 'basic')
  assert.equal(basic.makes, '1 cup')
  assert.equal(basic.ingredients, recipe.ingredients)
})
