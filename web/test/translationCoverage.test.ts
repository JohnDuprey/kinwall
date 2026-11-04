import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error the source scanner is a plain JavaScript module
import { scanSource } from '../scripts/i18n-check.mjs'

// These everyday screens should not fall back to English merely because a key is missing.
const screens = ['App.tsx', 'Board.tsx', 'Calendar.tsx', 'CalendarFilterSheet.tsx', 'Lists.tsx', 'Meals.tsx', 'TodaysMeals.tsx', 'MealSheet.tsx', 'MealQuickSheet.tsx', 'RecipeSheet.tsx', 'RecipeImportSheet.tsx', 'types.ts', 'calendarFilter.ts', 'MealCalendarSheet.tsx', 'RecipeCardSheet.tsx', 'BoardEditor.tsx', 'PhoneMenu.tsx', 'ProviderConfig.tsx', 'featureConfig.ts', 'Chores.tsx', 'Notifications.tsx', 'Setup.tsx', 'Contacts.tsx', 'Outings.tsx', 'Timers.tsx', 'FamilyAnnouncements.tsx', 'Polls.tsx', 'TaskApps.tsx', 'SchemePicker.tsx', 'skins.ts']
for (const language of ['fr', 'es']) {
  test(`${language}: everyday screens have translations for their extracted messages`, () => {
    const dict = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    const missing: string[] = []
    for (const file of screens) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
      for (const { key } of scanSource(file, source).keys) {
        if (!dict[key]) missing.push(`${file}: ${key}`)
      }
    }
    assert.deepEqual([...new Set(missing)], [], 'missing translations in everyday screens')
  })
}

for (const area of ['web', 'server']) {
  for (const language of ['fr', 'es']) {
    test(`${area}/${language}: at least half of the source messages have translations`, () => {
      const root = new URL(`../../${area}/src/locales/`, import.meta.url)
      const english = JSON.parse(readFileSync(new URL('en.json', root), 'utf8'))
      const translated = JSON.parse(readFileSync(new URL(`${language}.json`, root), 'utf8'))
      const covered = Object.keys(english).filter(key => typeof translated[key] === 'string' && translated[key].trim()).length
      assert.ok(covered >= Math.ceil(Object.keys(english).length / 2), `${covered}/${Object.keys(english).length}`)
    })
  }
}
