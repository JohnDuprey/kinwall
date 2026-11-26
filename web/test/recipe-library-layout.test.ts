import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const meals = readFileSync(new URL('../src/Meals.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/meals.css', import.meta.url), 'utf8')
const recipeSheet = readFileSync(new URL('../src/RecipeSheet.tsx', import.meta.url), 'utf8')
const restaurants = readFileSync(new URL('../src/Restaurants.tsx', import.meta.url), 'utf8')

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

test('phone planner and restaurants share the pinned action row below the tabs', () => {
  assert.doesNotMatch(meals, /meals-phone-action/)
  assert.match(meals, /className="meals-planner-controls"/)
  assert.match(meals, /aria-label=\{t\('Plan a meal'\)\}/)
  assert.match(meals, /aria-label=\{t\('Add a restaurant'\)\}/)
  assert.match(meals, /showRestaurantFilters && <Sheet/)
  assert.match(meals, /Show \{n\} restaurants/)
  assert.match(meals, /restaurantFilter !== 'active' && <span className="filter-badge"/)
  assert.match(meals, /className=\{isPhone \? 'sr-only' : undefined\} htmlFor="restaurant-search"/)
  assert.match(restaurants, /className="field-hint restaurant-count" role="status" aria-live="polite"/)
  assert.match(css, /\.meals-navigation \.meals-planner-controls\s*\{[^}]*grid-column: 1 \/ -1;[^}]*grid-row: 2/)
})

test('recipe filters use the sheet at every screen size', () => {
  assert.doesNotMatch(meals, /compactRecipeFilters/)
  assert.match(meals, /showFilters && <Sheet/)
  const filters = meals.slice(meals.indexOf('const filters ='), meals.indexOf('const freeSlot'))
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

test('week planner: day columns on wide screens, a day-by-day list on phones, no Day/Week switch', () => {
  assert.doesNotMatch(meals, /<table className=\{`meal-grid/)
  assert.doesNotMatch(meals, /key: 'day', label: t\('Day'\)/)
  assert.match(meals, /className=\{agenda \? 'meal-week meal-agenda' : 'meal-week'\}/)
  assert.match(css, /\.meal-week\s*\{[^}]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.meal-agenda\s*\{[^}]*flex-direction: column/)
  // A slot holds any number of meals: a full day still offers Add (a dessert or side beside dinner).
  assert.doesNotMatch(meals, /admin && open\.length > 0/)
  assert.match(meals, /open\.length \? open : \['dinner' as MealSlot\]/)
})
