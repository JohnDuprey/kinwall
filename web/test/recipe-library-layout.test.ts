import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const meals = readFileSync(new URL('../src/Meals.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/meals.css', import.meta.url), 'utf8')
const recipeSheet = readFileSync(new URL('../src/RecipeSheet.tsx', import.meta.url), 'utf8')

test('phone recipe actions sit below stable tabs and importing is offered only for a new recipe', () => {
  assert.match(meals, /className="icon-btn meals-phone-groceries"/)
  assert.match(meals, /className="btn btn-primary meals-add-recipe"/)
  assert.match(meals, /aria-label=\{t\('Add a recipe'\)\}/)
  assert.match(recipeSheet, /!recipe && onImport/)
  assert.match(recipeSheet, /onClick=\{onImport\}/)
})

test('phone navigation sticks within the existing safe-area-aware scroll container', () => {
  assert.match(css, /@media \(max-width: 600px\), \(max-height: 500px\) and \(orientation: landscape\)/)
  assert.match(css, /\.meals-navigation\s*\{[^}]*position: sticky;[^}]*top: 0;[^}]*background: var\(--bg\)/)
})

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
