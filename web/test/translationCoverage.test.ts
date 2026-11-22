import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// @ts-expect-error the source scanner is a plain JavaScript module
import { scanSource } from '../scripts/i18n-check.mjs'

// These everyday screens should not fall back to English merely because a key is missing.
const screens = ['App.tsx', 'Board.tsx', 'Calendar.tsx', 'CalendarFilterSheet.tsx', 'Lists.tsx', 'Meals.tsx', 'TodaysMeals.tsx', 'MealSheet.tsx', 'MealQuickSheet.tsx', 'RecipeSheet.tsx', 'RecipeImportSheet.tsx', 'types.ts', 'calendarFilter.ts', 'MealCalendarSheet.tsx', 'RecipeCardSheet.tsx', 'BoardEditor.tsx', 'PhoneMenu.tsx', 'ProviderConfig.tsx', 'featureConfig.ts', 'Chores.tsx', 'Notifications.tsx', 'Setup.tsx', 'Contacts.tsx', 'Outings.tsx', 'Timers.tsx', 'FamilyAnnouncements.tsx', 'Polls.tsx', 'TaskApps.tsx', 'SchemePicker.tsx', 'skins.ts', 'Trackers.tsx', 'Upkeep.tsx', 'Rewards.tsx', 'Library.tsx', 'Paint.tsx', 'Newscast.tsx', 'Restaurants.tsx', 'Profile.tsx', 'MedicationSettings.tsx', 'Orders.tsx', 'Medications.tsx', 'Journal.tsx', 'Photos.tsx', 'Stickers.tsx', 'Activities.tsx', 'AnyEmojiField.tsx', 'Authorize.tsx', 'Battery.tsx', 'BookLookup.tsx', 'ChoreLibrary.tsx', 'ChoreScheduleFields.tsx', 'ChoreSuggest.tsx', 'ChoreTimer.tsx', 'ColorClash.tsx', 'ColoringBook.tsx', 'CookingMode.tsx', 'GetStarted.tsx', 'GetStuffDone.tsx', 'GivePoints.tsx', 'GoalFollowUp.tsx', 'Help.tsx', 'Insights.tsx', 'Install.tsx', 'LibraryShelf.tsx', 'MealProjection.tsx', 'MemberPicture.tsx', 'Milestones.tsx', 'NotesThread.tsx', 'NowNext.tsx', 'Plugins.tsx', 'PriorityBadge.tsx', 'RecipeShare.tsx', 'Refills.tsx', 'RoutineAppPreview.tsx', 'RoutineHomeIndicator.tsx', 'SecurityActivitySheet.tsx', 'Snapshot.tsx', 'TakeNow.tsx', 'TidbitsSheet.tsx', 'battery.ts', 'calendarViews.ts', 'catalog.ts', 'checkIn.ts', 'choreGoal.ts', 'choreSchedule.ts', 'choreSuggest.ts', 'contact-types.ts', 'cooking.ts', 'failureMessage.ts', 'insights.ts', 'journal.ts', 'leadTime.ts', 'library.ts', 'meal-date.ts', 'medications.ts', 'outings.ts', 'paintTools.ts', 'profile.ts', 'reading.ts', 'settingsSummary.ts', 'setupSteps.ts', 'tidbits.ts', 'timers.ts', 'upkeep.ts', 'ColorSwatch.tsx', 'PickField.tsx', 'RoutineAppsSettings.tsx', 'RoutineMode.tsx', 'RoutineModeSettings.tsx', 'Settings.tsx', 'Sheet.tsx', 'TimezoneField.tsx', 'a11y.tsx', 'api.ts', 'boardLayout.ts', 'bonus.ts', 'calendarReconnect.ts', 'choreCounts.ts', 'choreDay.ts', 'colorVision.ts', 'itemDue.ts', 'liveActivity.ts', 'main.tsx', 'native.ts', 'newscast.ts', 'orders.ts', 'photos.ts', 'pick.ts', 'polls.ts', 'refillChoices.ts', 'routineDeviceError.ts', 'routineForm.ts', 'routineSave.ts', 'securityActivity.ts', 'wallScreen.ts', 'webauthn.ts']
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
    test(`${area}/${language}: at least 99.9% of the source messages have translations`, () => {
      const root = new URL(`../../${area}/src/locales/`, import.meta.url)
      const english = JSON.parse(readFileSync(new URL('en.json', root), 'utf8'))
      const translated = JSON.parse(readFileSync(new URL(`${language}.json`, root), 'utf8'))
      const covered = Object.keys(english).filter(key => typeof translated[key] === 'string' && translated[key].trim()).length
      assert.ok(covered >= Math.ceil(Object.keys(english).length * 0.999), `${covered}/${Object.keys(english).length}`)
    })
  }
}
