import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { isOrderNight, mealDayLabel, mealRecipe, SLOT_WORD, statusLabel } from './meal-date.ts'
import { formatTime } from './timeFormat.ts'
import { OrderNightFacts, OrderSheet, OrderSummary, OrderNightSheet, useMealRestaurant } from './Orders.tsx'
import { CheckIcon, EditIcon } from './icons.tsx'
import MealSheet, { EaterAvatars } from './MealSheet.tsx'
import RecipeSheet, { ratingOwner } from './RecipeSheet.tsx'
import type { Meal, Recipe } from './meal-types.ts'
import type { Me } from './types.ts'
import { t, tm } from './i18n.ts'

/** A tapped planned meal: an order night's order view, its recipe read-only with "Edit meal" (admins)
 * or "Meal details" (an assignee's notes and status), or the meal's own sheet for simple meals.
 * startDetails opens the meal's sheet straight away (Edit meal on a calendar event's page). */
export function PlannedMealSheet({ meal: initial, recipes, me, startOrders, startDetails = false, onClose, onSaved, onRated }: {
  meal: Meal; recipes: Recipe[]; me: Me | null; startOrders?: boolean; startDetails?: boolean; onClose: () => void; onSaved: () => void; onRated?: () => void
}) {
  const admin = me?.scope === 'admin'
  // Orders change here without closing, so the order view and the meal's sheet share the latest copy.
  const [meal, setMeal] = useState(initial)
  const recipe = mealRecipe(meal, recipes)
  const orderNight = isOrderNight(meal)
  const [details, setDetails] = useState(startDetails)
  // "Open recipe" from the meal's sheet, over it; closing it comes back to the meal.
  const [viewing, setViewing] = useState<Recipe | null>(null)
  const ordersChanged = (saved: Meal) => { setMeal(saved); onRated?.() }
  return <>
    {orderNight && !details
      ? <OrderNightSheet meal={meal} me={me} startOrders={startOrders} onClose={onClose} onChanged={ordersChanged} onEdit={admin ? () => setDetails(true) : undefined} />
      : details || !recipe
      ? <MealSheet meal={meal} initial={{ date: meal.date, slot: meal.slot }} recipes={recipes} admin={admin} owner={me?.owner} me={me} startOrders={orderNight ? false : startOrders} onClose={orderNight && !startDetails ? () => setDetails(false) : onClose} onSaved={onSaved} onRecipe={setViewing} onChanged={onRated} />
      : <RecipeSheet key={recipe.id} recipe={recipe} library={recipes} admin={false} owner={ratingOwner(me)} onRated={onRated} onClose={onClose} onSaved={onSaved}
        meal={<MealStrip meal={meal} me={me} onChanged={ordersChanged} />}
        onEditMeal={{ label: admin ? t('Edit meal') : t('Meal details'), open: () => setDetails(true) }} />}
    {viewing && <RecipeSheet key={viewing.id} recipe={viewing} library={recipes} admin={false} owner={ratingOwner(me)} onRated={onRated} onClose={() => setViewing(null)} onSaved={onSaved} />}
  </>
}

/** A planned meal's recipe, on top: when, who's eating and its status, and Mark cooked for whoever may
 * (parents, and the cook's own device), with Undo. */
function MealStrip({ meal, me, onChanged }: { meal: Meal; me: Me | null; onChanged: (meal: Meal) => void }) {
  const { settings, members, toast } = useApp()
  const [busy, setBusy] = useState(false)
  const time = meal.plannedTime ?? settings.mealTimes[meal.slot]
  const canMark = me?.scope === 'admin' || (!!me?.owner && me.owner === meal.assigneeMemberId)
  const mark = async (status: Meal['status']) => {
    setBusy(true)
    try {
      onChanged(await api.updateMeal(meal.id, { status }))
      if (status === 'prepared') toast(t('Marked cooked'), false, { label: t('Undo'), run: () => void mark('planned') })
    } catch (e) { toast(e instanceof Error ? e.message : t('Could not save.'), true) } finally { setBusy(false) }
  }
  const when = { day: mealDayLabel(meal.date, { weekday: 'short', month: 'short', day: 'numeric' }), meal: tm(SLOT_WORD[meal.slot]) }
  return <div className="meal-strip">
    <span className="meal-strip-when">{time ? t('{day}, {meal} at {time}', { ...when, time: formatTime(time) }) : t('{day}, {meal}', when)}</span>
    <EaterAvatars ids={meal.eaterIds} members={members} />
    {meal.status !== 'planned' ? <span className="chip chip-static">✓ {statusLabel(meal)}</span>
      : canMark ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void mark('prepared')}><CheckIcon width={20} height={20} /> {t('Mark cooked')}</button>
      : <span className="chip chip-static">{statusLabel(meal)}</span>}
  </div>
}

/** The same sheet over the Board or a person's day, loading what the Meals page already has: the
 * recipe library (the recipe, its basics, the meal's recipe picker) and this device's access. */
export default function MealQuickSheet({ meal, startDetails, onClose, onSaved }: { meal: Meal; startDetails?: boolean; onClose: () => void; onSaved?: () => void }) {
  const { reloadCore } = useApp()
  const [loaded, setLoaded] = useState<{ recipes: Recipe[]; me: Me | null } | null>(null)
  useEffect(() => {
    let canceled = false
    // Either failing leaves the meal readable: no library shows the meal's sheet, no access is read-only.
    void Promise.all([api.getRecipes(true).catch(() => []), api.meStrict().catch(() => null)])
      .then(([recipes, me]) => { if (!canceled) setLoaded({ recipes, me }) })
    return () => { canceled = true }
  }, [])
  if (!loaded) return null
  return <PlannedMealSheet meal={meal} recipes={loaded.recipes} me={loaded.me} startDetails={startDetails} onClose={onClose} onSaved={() => { onClose(); onSaved?.(); reloadCore() }} onRated={reloadCore} />
}

/** On a calendar event's page: the order night it belongs to, with when and how, the same summary
 * and order sheet, and Edit meal for parents. */
export function EventOrders({ eventId }: { eventId: string }) {
  const [meal, setMeal] = useState<Meal | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [ordering, setOrdering] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let canceled = false
    api.getEventMeal(eventId).then(({ meal }) => { if (!canceled) setMeal(meal?.mealKind === 'dining_out' ? meal : null) }).catch(() => {})
    api.meStrict().then(value => { if (!canceled) setMe(value) }).catch(() => {})
    return () => { canceled = true }
  }, [eventId, tick])
  const restaurant = useMealRestaurant(meal)
  if (!meal) return null
  return <section className="event-order-night" aria-label={t('Order night')}>
    <OrderNightFacts meal={meal} restaurant={restaurant} notes={false} />
    <OrderSummary meal={meal} restaurant={restaurant} me={me} onChanged={setMeal} onOrder={() => setOrdering(true)} />
    {me?.scope === 'admin' && <div className="meal-actions"><button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}><EditIcon width={20} height={20} /> {t('Edit meal')}</button></div>}
    {ordering && <OrderSheet meal={meal} restaurant={restaurant} me={me} onClose={() => setOrdering(false)} onSaved={setMeal} />}
    {editing && <MealQuickSheet meal={meal} startDetails onClose={() => setEditing(false)} onSaved={() => setTick(n => n + 1)} />}
  </section>
}
