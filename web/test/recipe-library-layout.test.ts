import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const meals = readFileSync(new URL('../src/Meals.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/meals.css', import.meta.url), 'utf8')

test('recipe filters use the sheet at every screen size', () => {
  assert.doesNotMatch(meals, /compactRecipeFilters/)
  assert.match(meals, /showFilters && <Sheet/)
  const filters = meals.slice(meals.indexOf('const filters ='), meals.indexOf('// Phone Week:'))
  assert.match(filters, /RecipeTagFilter/)
  assert.match(filters, /Manage tags/)
  assert.match(filters, /RecipeBrowseControls/)
  assert.doesNotMatch(filters, /recipe-search/)
})

test('recipe card descriptions clamp to two lines without changing recipe text', () => {
  const description = css.match(/\.recipe-card p\s*\{([^}]+)\}/)?.[1] ?? ''
  assert.match(description, /-webkit-line-clamp:\s*2/)
  assert.match(description, /(?:^|;)\s*line-clamp:\s*2/)
  assert.match(description, /overflow:\s*hidden/)
  assert.match(meals, /<p>\{recipe.description\}<\/p>/)
})
