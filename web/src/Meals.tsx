import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { Segmented } from './a11y.tsx'
import { todayKeyInTz } from './date.ts'
import { ChevronLeft, ChevronRight, PlusIcon } from './icons.tsx'
import { MEAL_SLOTS, SLOT_LABEL, mealDayLabel, mealWeek, moveMealDate } from './meal-date.ts'
import MealSheet, { type MealDraft } from './MealSheet.tsx'
import RecipeSheet from './RecipeSheet.tsx'
import MealProjection from './MealProjection.tsx'
import type { Meal, Recipe } from './meal-types.ts'
import type { Me } from './types.ts'
import './meals.css'

export default function Meals() {
  const { settings, members, refreshTick, reloadCore } = useApp()
  const timezone = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = todayKeyInTz(timezone)
  const [anchor, setAnchor] = useState(today)
  const days = mealWeek(anchor, settings.weekStart)
  const from = days[0], to = days[6]
  const [view, setView] = useState<'week' | 'recipes'>('week')
  const [me, setMe] = useState<Me | null>(null)
  const [authError, setAuthError] = useState('')
  const [data, setData] = useState<{ from: string; to: string; meals: Meal[]; error?: string } | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [recipesLoaded, setRecipesLoaded] = useState(false)
  const [recipeError, setRecipeError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [category, setCategory] = useState('')
  const [editing, setEditing] = useState<{ meal: Meal | null; initial: MealDraft } | null>(null)
  const [recipeSheet, setRecipeSheet] = useState<{ recipe: Recipe | null; readOnly?: boolean } | null>(null)
  const [projection, setProjection] = useState(false)
  const [tick, setTick] = useState(0)
  const [pendingMeal, setPendingMeal] = useState<string | null>(null)
  const admin = me?.scope === 'admin'
  useEffect(() => {
    const read = () => {
      if (!location.hash.startsWith('#/meals')) return
      const query = new URLSearchParams(location.hash.split('?')[1] ?? '')
      const date = query.get('date')
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date))) setAnchor(date)
      if (query.get('meal')) { setPendingMeal(query.get('meal')); setView('week') }
      if (query.toString()) history.replaceState(null, '', '#/meals')
    }
    read(); window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  useEffect(() => {
    let canceled = false
    api.meStrict().then(value => { if (!canceled) { setMe(value); setAuthError('') } }).catch(() => { if (!canceled) { setMe(null); setAuthError('Could not verify editing access. Retry to enable editing.') } })
    return () => { canceled = true }
  }, [tick, refreshTick])
  useEffect(() => {
    let canceled = false
    api.getMeals(from, to).then(meals => { if (!canceled) setData({ from, to, meals }) }).catch(e => { if (!canceled) setData({ from, to, meals: [], error: e instanceof Error ? e.message : 'Could not load meals.' }) })
    return () => { canceled = true }
  }, [from, to, tick, refreshTick])
  useEffect(() => {
    let canceled = false
    api.getRecipes(true).then(values => { if (!canceled) { setRecipes(values); setRecipesLoaded(true); setRecipeError('') } }).catch(e => { if (!canceled) setRecipeError(e instanceof Error ? e.message : 'Could not load recipes.') })
    return () => { canceled = true }
  }, [tick, refreshTick])
  const saved = () => { setEditing(null); setPendingMeal(null); setRecipeSheet(null); setTick(t => t + 1); reloadCore() }
  const meals = data?.from === from && data.to === to ? data.meals : null
  const mealError = data?.from === from && data.to === to ? data.error : undefined
  const linkedMeal = me && pendingMeal ? meals?.find(meal => meal.id === pendingMeal) : null
  const activeEditing = editing ?? (linkedMeal ? { meal: linkedMeal, initial: { date: linkedMeal.date, slot: linkedMeal.slot } } : null)
  const bySlot = new Map<string, Meal[]>()
  for (const meal of meals ?? []) { const key = `${meal.date}:${meal.slot}`; bySlot.set(key, [...(bySlot.get(key) ?? []), meal]) }
  const categories = [...new Set(recipes.flatMap(recipe => recipe.ingredients.map(i => i.category).filter((c): c is string => !!c)))].sort()
  const needle = search.trim().toLocaleLowerCase()
  const shownRecipes = recipes.filter(recipe => (filter === 'all' || recipe.archived === (filter === 'archived')) && (!category || recipe.ingredients.some(i => i.category === category)) && `${recipe.name} ${recipe.description ?? ''} ${recipe.ingredients.map(i => i.name).join(' ')}`.toLocaleLowerCase().includes(needle))
  return <div className="meals-view scroll-y">
    <div className="meals-heading"><div><h1>Meals</h1><p className="field-hint">What are we eating, and what do we need to buy?</p></div>
      <div className="meal-actions"><button className="btn btn-secondary" onClick={() => setProjection(true)}>Shopping projection</button>{admin && <button className="btn btn-primary" onClick={() => view === 'week' ? setEditing({ meal: null, initial: { date: today, slot: 'dinner' } }) : setRecipeSheet({ recipe: null })}><PlusIcon /> {view === 'week' ? 'Plan meal' : 'New recipe'}</button>}</div>
    </div>
    <Segmented tabs idBase="meals-tab" label="Meals sections" value={view} onChange={setView} options={[{ key: 'week', label: 'Week planner' }, { key: 'recipes', label: 'Recipe library' }]} />
    {authError && <p role="alert" className="field-error">{authError} <button className="link-btn" onClick={() => setTick(t => t + 1)}>Retry</button></p>}
    {me && !admin && <p className="field-hint">Admins manage recipes and plans. Your assigned meals allow notes and status updates.</p>}
    {view === 'week' ? <section role="tabpanel" aria-labelledby="meals-tab-week">
      <div className="meals-toolbar">
        <div className="meal-actions"><button className="icon-btn" aria-label="Previous meal week" onClick={() => setAnchor(moveMealDate(anchor, -7))}><ChevronLeft /></button><button className="btn btn-secondary" onClick={() => setAnchor(today)}>This week</button><button className="icon-btn" aria-label="Next meal week" onClick={() => setAnchor(moveMealDate(anchor, 7))}><ChevronRight /></button></div>
        <h2 aria-live="polite">{mealDayLabel(from, { month: 'short', day: 'numeric' })} – {mealDayLabel(to, { month: 'short', day: 'numeric', year: 'numeric' })}</h2>
      </div>
      {recipeError && <p className="field-error" role="alert">The recipe library could not refresh. <button className="link-btn" onClick={() => setTick(t => t + 1)}>Retry</button></p>}
      {mealError ? <div className="state-card" role="alert">Could not load the meal plan: {mealError} <button className="btn btn-secondary" onClick={() => setTick(t => t + 1)}>Retry</button></div> : !meals ? <p role="status">Loading meals…</p> : <div className="meal-grid-scroll" tabIndex={0} role="region" aria-label="Weekly meal plan; scroll horizontally for all meal slots">
        <table className="meal-grid"><caption className="sr-only">Meals from {from} through {to}</caption><thead><tr><th scope="col">Date</th>{MEAL_SLOTS.map(slot => <th key={slot} scope="col">{SLOT_LABEL[slot]}</th>)}</tr></thead><tbody>{days.map(date => <tr key={date} className={date === today ? 'meal-today' : ''}>
          <th scope="row"><time dateTime={date}>{mealDayLabel(date, { weekday: 'long' })}<span>{mealDayLabel(date, { month: 'short', day: 'numeric' })}</span></time>{date === today && <span className="meal-today-label">Today</span>}</th>
          {MEAL_SLOTS.map(slot => <td key={slot}>{(bySlot.get(`${date}:${slot}`) ?? []).map(meal => {
            const assignee = members.find(member => member.id === meal.assigneeMemberId)
            return <button key={meal.id} className={`meal-card ${meal.status !== 'planned' ? 'meal-complete' : ''}`} onClick={() => setEditing({ meal, initial: { date, slot } })} aria-label={`${SLOT_LABEL[slot]}, ${mealDayLabel(date)}, ${meal.title}, ${meal.status}${assignee ? `, assigned to ${assignee.name}` : ''}`}>
              <strong>{meal.mealKind === 'dining_out' && <span aria-label="Dining out">↗ </span>}{meal.title}</strong>
              <span>{meal.plannedTime ? `${meal.plannedTime} · ` : ''}{meal.servings} servings</span>
              {assignee && <span>{assignee.avatar} {assignee.name}</span>}
              {meal.status !== 'planned' && <span>✓ {meal.status === 'prepared' ? 'Prepared' : 'Handled'}</span>}
              {meal.notes && <span className="meal-note-preview">{meal.notes}</span>}
            </button>
          })}{admin ? <button className="meal-add" aria-label={`Plan ${SLOT_LABEL[slot].toLowerCase()} for ${mealDayLabel(date)}`} onClick={() => setEditing({ meal: null, initial: { date, slot } })}><PlusIcon width={16} height={16} /><span className="sr-only">Plan meal</span></button> : !bySlot.has(`${date}:${slot}`) && <span className="meal-empty" aria-label="No meal planned">—</span>}</td>)}
        </tr>)}</tbody></table>
      </div>}
    </section> : <section role="tabpanel" aria-labelledby="meals-tab-recipes">
      <div className="meals-toolbar">
        <div className="field meals-search"><label htmlFor="recipe-search">Find a recipe</label><input id="recipe-search" type="search" placeholder="Recipe name or ingredient" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="field"><label htmlFor="recipe-filter">Show</label><select id="recipe-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active recipes</option><option value="archived">Archived recipes</option><option value="all">All recipes</option></select></div>
        <div className="field"><label htmlFor="recipe-category">Ingredient category</label><select id="recipe-category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div>
      </div>
      {recipeError && <div role="alert" className="state-card">Could not load recipes: {recipeError} <button className="btn btn-secondary" onClick={() => setTick(t => t + 1)}>Retry</button></div>}
      {!recipesLoaded && !recipeError ? <p role="status">Loading recipes…</p> : <>
        <p className="field-hint" role="status">{shownRecipes.length} recipe{shownRecipes.length === 1 ? '' : 's'}</p>
        {shownRecipes.length === 0 && !recipeError && <p className="state-card">{search || category || filter !== 'active' ? 'No recipes match these filters.' : 'Your recipe library is ready. Add a recipe with ingredients to start planning.'}</p>}
        <div className="recipe-library">{shownRecipes.map(recipe => <button key={recipe.id} className="recipe-card" onClick={() => setRecipeSheet({ recipe })}>
          <strong>{recipe.name}</strong><span>{recipe.defaultServings} servings · {recipe.ingredients.length} ingredients{recipe.archived ? ' · Archived' : ''}</span>{recipe.description && <p>{recipe.description}</p>}
        </button>)}</div>
      </>}
    </section>}
    {activeEditing && <MealSheet meal={activeEditing.meal} initial={activeEditing.initial} recipes={recipes} admin={admin} owner={me?.owner} onClose={() => { setEditing(null); setPendingMeal(null) }} onSaved={saved} onRecipe={recipe => setRecipeSheet({ recipe, readOnly: true })} />}
    {recipeSheet && <RecipeSheet recipe={recipeSheet.recipe} admin={admin && !recipeSheet.readOnly} onClose={() => setRecipeSheet(null)} onSaved={saved} onPlan={recipe => { setRecipeSheet(null); setEditing({ meal: null, initial: { date: today, slot: 'dinner', recipe } }) }} />}
    {projection && <MealProjection from={from} to={to} admin={admin} onClose={() => setProjection(false)} />}
  </div>
}
