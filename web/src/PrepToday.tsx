import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { t } from './i18n.ts'
import { mealDayLabel } from './meal-date.ts'
import type { Meal } from './meal-types.ts'

/** Shared by the planner and Board; parent access is checked before showing write actions. */
export default function PrepToday({ date, compact = false }: { date: string; compact?: boolean }) {
  const { refreshTick, reloadCore, parentDevice } = useApp()
  const [meals, setMeals] = useState<Meal[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let canceled = false
    api.getMealPrep(date).then(items => { if (!canceled) setMeals(items) }).catch(() => {})
    return () => { canceled = true }
  }, [date, refreshTick, tick])
  const done = async (ids: string[]) => {
    setBusy(true); setError('')
    try { await api.finishMealPrep(date, ids); setTick(n => n + 1); reloadCore() }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save food.')) }
    finally { setBusy(false) }
  }
  if (!meals.length) return null
  return <section className={`prep-today${compact ? ' prep-today-compact' : ''}`} aria-label={t('Prep today')}>
    {!compact && <div className="prep-today-head"><h3>🔪 {t('Prep today')}</h3>{parentDevice && meals.length > 1 && <button className="btn btn-secondary" disabled={busy} onClick={() => void done(meals.map(m => m.id))}>{t('Done prepping all')}</button>}</div>}
    {error && <p role="alert" className="field-error">{error}</p>}
    <ul className="prep-today-list">{meals.map(meal => <li key={meal.id} className="prep-today-row"><span><strong>{compact ? t('🔪 Prep today: {name}', { name: meal.title }) : meal.title}</strong>{!compact && <span className="field-hint">{t('For {date}', { date: mealDayLabel(meal.date) })}</span>}</span>{parentDevice && <button className="btn btn-secondary" disabled={busy} onClick={() => void done([meal.id])}>{t('Done prepping')}</button>}</li>)}</ul>
  </section>
}
