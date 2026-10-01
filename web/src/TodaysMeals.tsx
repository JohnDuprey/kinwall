import { useState } from 'react'
import { useApp } from './AppContext.tsx'
import { minutesSinceMidnight } from './date.ts'
import { formatTime } from './timeFormat.ts'
import { SLOT_LABEL, byMealTime, mealForMember, mealMinutes, minutesLabel } from './meal-date.ts'
import type { Meal } from './meal-types.ts'
import { EaterAvatars } from './MealSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import MealQuickSheet from './MealQuickSheet.tsx'

/** The Board's Today's meals card (its rows; Board.tsx wraps them in the card), from the Board's own data. A tapped meal opens its sheet over the Board; planning stays in the Meals section. */
export default function TodaysMeals({ now, meals: all }: { now: Date; meals: Meal[] }) {
  const { settings, members, selectedMemberId } = useApp()
  const [open, setOpen] = useState<Meal | null>(null)
  const meals = byMealTime(all.filter(meal => mealForMember(meal, selectedMemberId)), settings.mealTimes)
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const at = (meal: Meal) => mealMinutes(meal, settings.mealTimes)
  const planned = meals.filter(meal => meal.status === 'planned')
  const minute = minutesSinceMidnight(now.toISOString(), tz)
  const next = planned.find(meal => at(meal) >= minute) ?? planned[planned.length - 1]
  return <>
      {meals.length === 0 ? <button className="snap-empty board-empty-tap" onClick={() => { location.hash = '#/meals' }}>No meals planned today.</button> : <ul className="snap-list">
        {meals.map(meal => {
          const assignee = members.find(member => member.id === meal.assigneeMemberId)
          return <li key={meal.id}><button type="button" onClick={() => setOpen(meal)} className={`snap-row today-meal ${meal.id === next?.id ? 'today-meal-next' : ''}`}>
            <span className="snap-main"><span className="board-when">{SLOT_LABEL[meal.slot]}{meal.plannedTime ? ` · ${formatTime(meal.plannedTime)}` : ''}{meal.id === next?.id ? at(meal) >= minute ? ' · Next' : ' · Planned' : ''}</span>
              <span className="snap-title">{meal.mealKind === 'dining_out' ? '↗ ' : ''}{meal.title}</span>
              <EaterAvatars ids={meal.eaterIds ?? []} members={members} />
              <span className="snap-meta">{[meal.mealKind === 'dining_out' ? 'Dining out' : null, meal.recipeSnapshot?.totalMinutes ? minutesLabel(meal.recipeSnapshot.totalMinutes) : null, assignee ? `Cooking: ${assignee.avatar ?? ''} ${assignee.name}` : null, meal.status !== 'planned' ? meal.status === 'prepared' ? 'Prepared' : 'Handled' : null].filter(Boolean).join(' · ')}</span>
            </span>
            {meal.mealKind === 'recipe' && meal.recipeId && <RecipePhoto id={meal.recipeId} className="meal-thumb-board" />}
          </button></li>
        })}
      </ul>}
      {open && <MealQuickSheet meal={open} onClose={() => setOpen(null)} />}
  </>
}
