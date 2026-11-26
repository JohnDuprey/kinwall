import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { kitDate, kitIcon, plannedMealKit } from './meal-kits.ts'
import { t } from './i18n.ts'
import type { Meal, MealKitDetail, Recipe } from './meal-types.ts'

/** Prep and ready-food details stay visible above a planned meal's recipe or form. */
export default function MealPlanFacts({ meal, recipe }: { meal: Meal; recipe?: Recipe | null }) {
  const [linked, setLinked] = useState<MealKitDetail | null>(null)
  useEffect(() => {
    let canceled = false
    if (meal.readyId) api.getMealKits().then(items => { if (!canceled) setLinked(items.find(item => item.id === meal.readyId) ?? null) }).catch(() => {})
    else setLinked(null)
    return () => { canceled = true }
  }, [meal.readyId])
  const item = linked ?? plannedMealKit(meal, recipe?.kits)
  const name = linked?.recipeName ?? recipe?.name ?? meal.title
  if (!meal.prepOn && !item) return null
  return <div className="meal-plan-facts">
    {meal.prepOn && <span className="kit-tag">🔪 {t('Prep {date}', { date: kitDate(meal.prepOn) })}</span>}
    {item && <span className="kit-tag">{kitIcon(item)} {item.kind === 'prepped' ? t('From {name} (prepped)', { name }) : item.kind === 'frozen' ? t('From {name} (frozen)', { name }) : t('Meal kit')}</span>}
  </div>
}
