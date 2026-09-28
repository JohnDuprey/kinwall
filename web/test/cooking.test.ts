// node --test test/ (npm test). Cooking mode: plain-text steps, timers and a step's ingredients.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cookingSteps, findDurations, stepIngredients, stepTimers } from '../src/cooking.ts'

const texts = (instructions: string) => cookingSteps({ instructions }).map(s => s.text)

test('cookingSteps: structured steps win; plain text splits by line, numbering dropped', () => {
  const steps = [{ text: 'Boil', bullets: ['Salt the water'] }]
  assert.equal(cookingSteps({ steps, instructions: 'ignored' }), steps)
  assert.deepEqual(texts('1. Heat oil\n2) Add 1.5 cups rice\n\nStep 3: Simmer'), ['Heat oil', 'Add 1.5 cups rice', 'Simmer'])
  assert.deepEqual(texts('1.5 cups flour, sifted\nMix well'), ['1.5 cups flour, sifted', 'Mix well'])
  assert.deepEqual(texts('Roast at 425°F. Serve with rice! Enjoy'), ['Roast at 425°F.', 'Serve with rice!', 'Enjoy'])
  assert.deepEqual(texts(''), [])
  assert.deepEqual(cookingSteps({ steps: [], instructions: null }), [])
})

test('findDurations: minutes, hours, seconds and ranges (low end)', () => {
  assert.deepEqual(findDurations('Simmer for 10 minutes, then rest 30 seconds.'), [{ label: '10 min', seconds: 600 }, { label: '30 sec', seconds: 30 }])
  assert.deepEqual(findDurations('Bake 5-7 min'), [{ label: '5–7 min', seconds: 300 }])
  assert.deepEqual(findDurations('cook 15–20 Minutes or 8 to 10 mins'), [{ label: '15–20 min', seconds: 900 }, { label: '8–10 min', seconds: 480 }])
  assert.deepEqual(findDurations('Chill 1 hour. A 1.5 hr rise. A 10-minute rest.'), [{ label: '1 hr', seconds: 3600 }, { label: '1.5 hr', seconds: 5400 }, { label: '10 min', seconds: 600 }])
  assert.deepEqual(findDurations('Stir 2 minutes; stir 2 minutes more'), [{ label: '2 min', seconds: 120 }])
  assert.deepEqual(findDurations('Heat to 425°F, 2 cups, 3 mint leaves, 0 min'), [])
})

test('stepIngredients: whole names or their last word, case- and plural-insensitive', () => {
  const ingredients = ['Yellow onion', 'Olive oil', 'Tomatoes', 'Chicken broth', 'Salt', 'Eggs'].map(name => ({ name }))
  const names = (text: string, bullets: string[] = []) => stepIngredients({ text, bullets }, ingredients).map(i => i.name)
  assert.deepEqual(names('Soften the ONIONS in olive oil.', ['Add a tomato']), ['Yellow onion', 'Olive oil', 'Tomatoes'])
  assert.deepEqual(names('Season with salt; beat the egg.'), ['Salt', 'Eggs'])
  assert.deepEqual(names('Add the broth'), ['Chicken broth'])
  assert.deepEqual(names('Salted butter and oilcloth'), [])
})

test('stepTimers: a step\'s own timers, named, win over durations found in its text', () => {
  const text = 'Roast 25 minutes, then rest 5 minutes.'
  assert.deepEqual(stepTimers({ text, bullets: [], timers: [{ name: 'Veggies', minutes: 20 }, { name: null, minutes: 1.5 }] }), [
    { label: 'Veggies · 20 min', seconds: 1200 },
    { label: '1.5 min', seconds: 90 },
  ])
  assert.deepEqual(stepTimers({ text, bullets: [], timers: [] }), [{ label: '25 min', seconds: 1500 }, { label: '5 min', seconds: 300 }])
  assert.deepEqual(stepTimers({ text: 'Plate.', bullets: ['Bake 10 min'] }), [{ label: '10 min', seconds: 600 }], 'steps saved before timers')
})
