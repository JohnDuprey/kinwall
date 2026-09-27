import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { minutesSinceMidnight, zonedDayKey } from './date.ts'
import { MEAL_SLOTS, SLOT_LABEL } from './meal-date.ts'
import type { Meal } from './meal-types.ts'

/** A glanceable wall card. Recipe editing stays in the full Meals section. */
export default function TodaysMeals({ now }: { now: Date }) {
  const { settings, members, refreshTick } = useApp()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = zonedDayKey(now.toISOString(), tz)
  const [data, setData] = useState<{ date: string; meals: Meal[] } | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let canceled = false
    api.getMeals(today, today).then(meals => { if (!canceled) { setData({ date: today, meals }); setError(false) } }).catch(() => { if (!canceled) setError(true) })
    return () => { canceled = true }
  }, [today, refreshTick, tick])
  const defaultTime = { breakfast: 8 * 60, lunch: 12 * 60, dinner: 18 * 60, snack: 15 * 60 }
  const at = (meal: Meal) => meal.plannedTime ? Number(meal.plannedTime.slice(0, 2)) * 60 + Number(meal.plannedTime.slice(3)) : defaultTime[meal.slot]
  const meals = data?.date === today ? data.meals : null
  const planned = (meals ?? []).filter(meal => meal.status === 'planned').sort((a, b) => at(a) - at(b))
  const minute = minutesSinceMidnight(now.toISOString(), tz)
  const next = planned.find(meal => at(meal) >= minute) ?? planned[planned.length - 1]
  return <section className="board-card board-meals" aria-label="Today's meals">
    <h3 className="snap-heading"><a href="#/meals">Today’s meals</a></h3>
    <div className="board-body">
      {error && <p className="field-hint" role="status">Couldn’t refresh meals. <button className="link-btn" onClick={() => setTick(t => t + 1)}>Retry</button></p>}
      {!meals ? !error && <p className="snap-empty" role="status">Loading meals…</p> : meals.length === 0 ? <p className="snap-empty"><a href="#/meals">No meals planned today.</a></p> : <ul className="snap-list">
        {MEAL_SLOTS.flatMap(slot => meals.filter(meal => meal.slot === slot).map(meal => {
          const assignee = members.find(member => member.id === meal.assigneeMemberId)
          return <li key={meal.id}><a href={`#/meals?date=${today}&meal=${encodeURIComponent(meal.id)}`} className={`snap-row today-meal ${meal.id === next?.id ? 'today-meal-next' : ''}`}>
            <span className="snap-main"><span className="board-when">{SLOT_LABEL[meal.slot]}{meal.plannedTime ? ` · ${meal.plannedTime}` : ''}{meal.id === next?.id ? at(meal) >= minute ? ' · Up next' : ' · Still planned' : ''}</span>
              <span className="snap-title">{meal.mealKind === 'dining_out' ? '↗ ' : ''}{meal.title}</span>
              <span className="snap-meta">{[meal.mealKind === 'dining_out' ? 'Dining out' : null, assignee ? `${assignee.avatar ?? ''} ${assignee.name}` : null, meal.status !== 'planned' ? meal.status === 'prepared' ? 'Prepared' : 'Handled' : null].filter(Boolean).join(' · ')}</span>
            </span>
          </a></li>
        }))}
      </ul>}
    </div>
  </section>
}
