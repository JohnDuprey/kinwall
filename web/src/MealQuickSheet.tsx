import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { mealRecipe } from './meal-date.ts'
import MealSheet from './MealSheet.tsx'
import RecipeSheet, { ratingOwner } from './RecipeSheet.tsx'
import type { Meal, Recipe } from './meal-types.ts'
import type { Me } from './types.ts'

/** A tapped planned meal: its recipe read-only with "Edit meal" (admins) or "Meal details" (an
 * assignee's notes and status), or the meal's own sheet for dining out and simple meals. */
export function PlannedMealSheet({ meal, recipes, me, startOrders, onClose, onSaved, onRated }: {
  meal: Meal; recipes: Recipe[]; me: Me | null; startOrders?: boolean; onClose: () => void; onSaved: () => void; onRated?: () => void
}) {
  const admin = me?.scope === 'admin'
  const recipe = mealRecipe(meal, recipes)
  const [details, setDetails] = useState(false)
  // "Open recipe" from the meal's sheet, over it; closing it comes back to the meal.
  const [viewing, setViewing] = useState<Recipe | null>(null)
  return <>
    {details || !recipe
      ? <MealSheet meal={meal} initial={{ date: meal.date, slot: meal.slot }} recipes={recipes} admin={admin} owner={me?.owner} me={me} startOrders={startOrders} onClose={onClose} onSaved={onSaved} onRecipe={setViewing} onChanged={onRated} />
      : <RecipeSheet key={recipe.id} recipe={recipe} library={recipes} admin={false} owner={ratingOwner(me)} onRated={onRated} onClose={onClose} onSaved={onSaved}
        onEditMeal={{ label: admin ? 'Edit meal' : 'Meal details', open: () => setDetails(true) }} />}
    {viewing && <RecipeSheet key={viewing.id} recipe={viewing} library={recipes} admin={false} owner={ratingOwner(me)} onRated={onRated} onClose={() => setViewing(null)} onSaved={onSaved} />}
  </>
}

/** The same sheet over the Board or a person's day, loading what the Meals page already has: the
 * recipe library (the recipe, its basics, the meal's recipe picker) and this device's access. */
export default function MealQuickSheet({ meal, onClose }: { meal: Meal; onClose: () => void }) {
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
  return <PlannedMealSheet meal={meal} recipes={loaded.recipes} me={loaded.me} onClose={onClose} onSaved={() => { onClose(); reloadCore() }} onRated={reloadCore} />
}
