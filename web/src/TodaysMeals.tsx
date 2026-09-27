import { useApp } from './AppContext.tsx'
import { clockTime, minutesSinceMidnight } from './date.ts'
import { MEAL_SLOTS, SLOT_LABEL } from './meal-date.ts'
import type { Meal } from './meal-types.ts'

/** A glanceable wall card from the Board's own data. Recipe editing stays in the full Meals section. */
export default function TodaysMeals({ now, today, meals }: { now: Date; today: string; meals: Meal[] }) {
  const { settings, members } = useApp()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const defaultTime = { breakfast: 8 * 60, lunch: 12 * 60, dinner: 18 * 60, snack: 15 * 60 }
  const at = (meal: Meal) => meal.plannedTime ? Number(meal.plannedTime.slice(0, 2)) * 60 + Number(meal.plannedTime.slice(3)) : defaultTime[meal.slot]
  const planned = meals.filter(meal => meal.status === 'planned').sort((a, b) => at(a) - at(b))
  const minute = minutesSinceMidnight(now.toISOString(), tz)
  const next = planned.find(meal => at(meal) >= minute) ?? planned[planned.length - 1]
  return <section className="board-card board-meals" aria-label="Today's meals">
    <h3 className="snap-heading"><a href="#/meals">Today’s meals</a></h3>
    <div className="board-body">
      {meals.length === 0 ? <p className="snap-empty"><a href="#/meals">No meals planned today.</a></p> : <ul className="snap-list">
        {MEAL_SLOTS.flatMap(slot => meals.filter(meal => meal.slot === slot).map(meal => {
          const assignee = members.find(member => member.id === meal.assigneeMemberId)
          return <li key={meal.id}><a href={`#/meals?date=${today}&meal=${encodeURIComponent(meal.id)}`} className={`snap-row today-meal ${meal.id === next?.id ? 'today-meal-next' : ''}`}>
            <span className="snap-main"><span className="board-when">{SLOT_LABEL[meal.slot]}{meal.plannedTime ? ` · ${clockTime(meal.plannedTime)}` : ''}{meal.id === next?.id ? at(meal) >= minute ? ' · Next' : ' · Planned' : ''}</span>
              <span className="snap-title">{meal.mealKind === 'dining_out' ? '↗ ' : ''}{meal.title}</span>
              <span className="snap-meta">{[meal.mealKind === 'dining_out' ? 'Dining out' : null, assignee ? `${assignee.avatar ?? ''} ${assignee.name}` : null, meal.status !== 'planned' ? meal.status === 'prepared' ? 'Prepared' : 'Handled' : null].filter(Boolean).join(' · ')}</span>
            </span>
          </a></li>
        }))}
      </ul>}
    </div>
  </section>
}
