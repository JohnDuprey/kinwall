import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error the source scanner is a plain JavaScript module
import { scanSource } from '../scripts/i18n-check.mjs'

// These everyday screens should not fall back to English merely because a key is missing.
const screens = ['App.tsx', 'Board.tsx', 'Calendar.tsx', 'CalendarFilterSheet.tsx', 'Lists.tsx', 'Meals.tsx', 'TodaysMeals.tsx', 'MealSheet.tsx', 'MealQuickSheet.tsx', 'RecipeSheet.tsx', 'RecipeImportSheet.tsx', 'types.ts', 'calendarFilter.ts', 'MealCalendarSheet.tsx', 'RecipeCardSheet.tsx', 'BoardEditor.tsx', 'PhoneMenu.tsx', 'ProviderConfig.tsx', 'featureConfig.ts', 'Chores.tsx', 'Notifications.tsx']
// Product metaphors awaiting the family's wording review retain their current behavior.
const pending = new Set([
  'Nooks', 'Free time', 'Basics', 'Basic', 'Meals and basics',
  '{name}: open the basic', 'Not from a basic',
  'Something you make to use in other recipes, like a seasoning blend, sauce or dough. Basics stay out of meal planning unless you ask for them.',
  'Link to basic: {name}', 'from a basic', 'Made from a basic',
  'Made from a basic, ingredient {n}', 'Basic name',
  'Temp check, goal checks, the energy battery, journals and Insights. Who gets them is set per person in Family.',
])
for (const language of ['fr', 'es']) {
  test(`${language}: everyday screens have translations for their extracted messages`, () => {
    const dict = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    const missing: string[] = []
    for (const file of screens) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
      for (const { key } of scanSource(file, source).keys) {
        if (!pending.has(key) && !dict[key]) missing.push(`${file}: ${key}`)
      }
    }
    assert.deepEqual([...new Set(missing)], [], 'missing translations in everyday screens')
  })
}
