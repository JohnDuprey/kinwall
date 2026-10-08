import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { BookIcon, CalendarIcon, ChevronRight, TrashIcon } from './icons.tsx'
import { SourceLink } from './RecipeSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import { todayKeyInTz } from './date.ts'
import { formatTime } from './timeFormat.ts'
import MealCalendarSheet from './MealCalendarSheet.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import type { Member } from './types.ts'
import { MEAL_SLOTS, SLOT_LABEL, isOrderNight, mealDayLabel, minutesLabel, recipeTime, servingsLabel, startBy, statusLabel, swapCandidates, swapWindow } from './meal-date.ts'
import { pickerRecipes } from './recipe-search.ts'
import type { Meal, MealInput, MealKind, MealSlot, MealStatus, OrderType, Recipe, Restaurant } from './meal-types.ts'
import type { Me } from './types.ts'
import PickField from './PickField.tsx'
import { OrderSheet, OrderSummary, useMealRestaurant } from './Orders.tsx'
import { ORDER_TYPE_LABEL } from './orders.ts'
import { Face } from './Face'

/** Where a new meal starts. recipe, restaurant or title (a poll's winner: Polls.tsx) also prefill an existing meal. */
export type MealDraft = { date: string; slot: MealSlot; recipe?: Recipe; restaurant?: Restaurant; title?: string }

/** Small overlapping avatars of who's eating (planner card, Board, meal sheet). */
export function EaterAvatars({ ids, members, label = 'Eating' }: { ids: string[]; members: Member[]; label?: string }) {
  const eaters = members.filter(m => ids.includes(m.id))
  if (!eaters.length) return null
  return <span className="meal-eaters" role="img" aria-label={`${label}: ${eaters.map(m => m.name).join(', ')}`}>
    {eaters.map(m => <Face key={m.id} m={m} />)}
  </span>
}

export default function MealSheet({ meal, initial, recipes, admin, owner, me = null, startOrders = false, onClose, onSaved, onRecipe, onChanged }: {
  meal: Meal | null; initial: MealDraft; recipes: Recipe[]; admin: boolean; owner?: string | null
  me?: Me | null; startOrders?: boolean // a link from "Ask for orders" opens the order sheet over it
  onClose: () => void; onSaved: (saved?: Meal) => void; onRecipe: (recipe: Recipe) => void; onChanged?: () => void // onChanged: orders changed (the sheet stays open)
}) {
  const { members, settings, toast } = useApp()
  const dialog = useDialog()
  const formId = useId()
  const [draft, setDraft] = useState<MealInput>(() => ({
    date: meal?.date ?? initial.date, slot: meal?.slot ?? initial.slot, title: meal?.title ?? initial.recipe?.name ?? initial.restaurant?.name ?? '',
    mealKind: meal?.mealKind ?? (initial.recipe ? 'recipe' : initial.restaurant ? 'dining_out' : 'freeform'), recipeId: meal?.recipeId ?? initial.recipe?.id ?? null,
    restaurantId: meal?.restaurantId ?? initial.restaurant?.id ?? null, orderType: meal?.orderType ?? (initial.restaurant ? 'pickup' : null),
    servings: meal?.servings ?? initial.recipe?.defaultServings ?? 4, assigneeMemberId: meal?.assigneeMemberId ?? null, eaterIds: meal?.eaterIds ?? [],
    notes: meal?.notes ?? null, plannedTime: meal?.plannedTime ?? null, status: meal?.status ?? 'planned', sourceUrl: meal?.sourceUrl ?? null,
    ...(initial.recipe ? { title: initial.recipe.name, mealKind: 'recipe' as const, recipeId: initial.recipe.id, restaurantId: null }
      : initial.restaurant ? { title: initial.restaurant.name, mealKind: 'dining_out' as const, recipeId: null, restaurantId: initial.restaurant.id, orderType: meal?.orderType ?? 'pickup' as const }
      : initial.title ? { title: initial.title, mealKind: meal?.mealKind === 'dining_out' ? 'dining_out' as const : 'freeform' as const, recipeId: null, restaurantId: null } : {}),
  }))
  // A new meal starts by choosing what it is: a recipe from the library first, or something else.
  const [choosing, setChoosing] = useState(!meal && admin && !initial.recipe && !initial.restaurant && !initial.title)
  const [refreshRecipe, setRefreshRecipe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [linkedMeal, setLinkedMeal] = useState(meal)
  const [ordering, setOrdering] = useState(false)
  // After the meal's own sheet is up, so the order sheet opens over it (portals stack in mount order).
  useEffect(() => { if (startOrders && meal?.mealKind === 'dining_out') setOrdering(true) }, [startOrders, meal?.mealKind])
  // The binder, for a dining-out night's Restaurant row (parents), and this night's restaurant.
  const [binder, setBinder] = useState<Restaurant[]>(initial.restaurant ? [initial.restaurant] : [])
  useEffect(() => {
    let canceled = false
    if (admin) api.getRestaurants(true).then(all => { if (!canceled) setBinder(all) }).catch(() => {})
    return () => { canceled = true }
  }, [admin])
  const restaurant = useMealRestaurant(linkedMeal)
  const ordersChanged = (saved: Meal) => { setLinkedMeal(saved); setDraft(d => ({ ...d, status: saved.status })); onChanged?.() }
  const assigned = !!meal?.assigneeMemberId && owner === meal.assigneeMemberId
  const canUpdate = admin || assigned
  const selectedRecipe = recipes.find(r => r.id === draft.recipeId)
  const snapshot = draft.mealKind === 'recipe'
    ? meal?.mealKind === 'recipe' && draft.recipeId === meal.recipeId && !refreshRecipe ? meal.recipeSnapshot : selectedRecipe
    : null
  // Snapshots saved before recipes had times fall back to the recipe itself.
  const timed = snapshot && 'totalMinutes' in snapshot ? snapshot : selectedRecipe
  const time = draft.mealKind === 'recipe' ? recipeTime(timed) : ''
  const start = startBy(draft.plannedTime, timed?.totalMinutes)
  // A meal whose recipe was deleted keeps its saved copy; the picker offers it back.
  const savedRecipe = meal?.mealKind === 'recipe' && meal.recipeSnapshot && !recipes.some(r => r.id === meal.recipeId) ? { id: meal.recipeId, name: meal.recipeSnapshot.name } : null
  const recipeLabel = selectedRecipe?.name ?? (snapshot ? `${snapshot.name} (saved recipe)` : 'Choose a recipe')
  const pick = (recipe: Recipe | null) => {
    setDraft(d => recipe ? { ...d, recipeId: recipe.id, title: recipe.name, servings: recipe.defaultServings } : { ...d, recipeId: meal!.recipeId, title: meal!.recipeSnapshot!.name, servings: meal!.servings })
    setRefreshRecipe(false); setPicking(false)
  }
  const update = <K extends keyof MealInput>(key: K, value: MealInput[K]) => setDraft(d => ({ ...d, [key]: value }))
  const save = async () => {
    if (!canUpdate) return
    if (admin && (!draft.title.trim() || (draft.mealKind === 'recipe' && !snapshot))) { setError(draft.mealKind === 'recipe' && !snapshot ? 'Pick a recipe first.' : 'Give the meal a name first.'); return }
    setBusy(true); setError('')
    try {
      const body = { ...draft, title: draft.title.trim(), recipeId: draft.mealKind === 'recipe' ? draft.recipeId : null }
      const saved = meal ? await api.updateMeal(meal.id, admin ? { ...body, ...(refreshRecipe ? { refreshRecipe: true } : {}) } : { notes: draft.notes, status: draft.status })
        : await api.createMeal(body)
      toast('Meal saved'); onSaved(saved)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save meal.') }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!meal || !await dialog.confirm({ title: `Delete “${meal.title}”?`, body: 'Remove this meal from the plan? Items already added to shopping lists stay there.', confirmLabel: 'Delete meal', danger: true })) return
    setBusy(true); setError('')
    try { await api.deleteMeal(meal.id); toast('Meal deleted'); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete meal.') }
    finally { setBusy(false) }
  }
  // Swap with a meal from today through the end of this meal's week (the planner's week).
  const swapRange = meal && admin ? swapWindow(meal.date, todayKeyInTz(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone), settings.weekStart) : null
  const swap = async (other: Meal) => {
    const done = `Swapped with ${mealDayLabel(other.date, { weekday: 'long' })}’s ${SLOT_LABEL[other.slot].toLowerCase()}`
    setSwapping(false); setBusy(true); setError('')
    try { await api.swapMeal(meal!.id, other.id); toast(done); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not swap meals.') }
    finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  return <Sheet title={meal ? admin ? 'Edit meal' : meal.title : 'Plan a meal'} onClose={close} dismissable={!busy} actions={choosing ? <button className="btn btn-secondary" onClick={close}>Cancel</button> : canUpdate ? <>
    {meal && admin && <button className="icon-btn" aria-label="Delete meal" disabled={busy} onClick={remove}><TrashIcon /></button>}
    <button className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
    <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save meal'}</button>
  </> : undefined}>
    {choosing ? <MealChooser recipes={recipes} slot={draft.slot}
      onRecipe={recipe => { setDraft(d => ({ ...d, mealKind: 'recipe', recipeId: recipe.id, title: recipe.name, servings: recipe.defaultServings })); setChoosing(false) }}
      onOther={(kind, title) => { setDraft(d => ({ ...d, mealKind: kind, recipeId: null, title })); setChoosing(false) }} /> :
    <form id={formId} onSubmit={e => { e.preventDefault(); void save() }}>
      {admin ? <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-kind`}>What are we eating?</label><select id={`${formId}-kind`} value={draft.mealKind} onChange={e => update('mealKind', e.target.value as MealKind)}><option value="recipe">A recipe</option><option value="freeform">Something else</option><option value="dining_out">Eating out</option></select></div>
        {draft.mealKind === 'recipe' && <div className="field"><label htmlFor={`${formId}-recipe`}>Recipe</label>
          <button id={`${formId}-recipe`} type="button" className="sheet-link" aria-haspopup="dialog" aria-label={`Recipe: ${recipeLabel}`} onClick={() => setPicking(true)}>
            {selectedRecipe?.imageUrl && <RecipePhoto id={selectedRecipe.id} className="recipe-pick-thumb" />}
            <span>{recipeLabel}</span><ChevronRight />
          </button>
          {!recipes.some(r => !r.archived) && !snapshot && <p className="field-hint">Create a recipe in the Recipe library first.</p>}
        </div>}
        {draft.mealKind === 'dining_out' && <>
          <div className="field"><label htmlFor={`${formId}-restaurant`}>Restaurant</label>
            <PickField id={`${formId}-restaurant`} label="Restaurant" title="Choose a restaurant" placeholder="Restaurant name"
              options={[{ value: '', label: 'Somewhere else', detail: 'Not in the binder' }, ...binder.filter(r => !r.archived || r.id === draft.restaurantId).map(r => ({ value: r.id, label: r.name, detail: r.cuisine ?? undefined }))]}
              value={[draft.restaurantId ?? '']} onChange={v => { const r = binder.find(x => x.id === v[0]); setDraft(d => ({ ...d, restaurantId: r?.id ?? null, title: r ? r.name : d.title, orderType: r ? d.orderType ?? 'pickup' : d.orderType })) }} /></div>
          <div className="field"><label htmlFor={`${formId}-how`}>How</label><select id={`${formId}-how`} value={draft.orderType ?? ''} onChange={e => update('orderType', (e.target.value || null) as OrderType | null)}><option value="">Not set</option>{Object.entries(ORDER_TYPE_LABEL).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div>
        </>}
        <div className="field"><label htmlFor={`${formId}-title`}>{draft.mealKind === 'dining_out' ? 'Place or meal name' : 'Meal name'}</label><input id={`${formId}-title`} type="text" required maxLength={200} placeholder={draft.mealKind === 'dining_out' ? 'Eating out, school cafeteria…' : 'What are we eating?'} value={draft.title} onChange={e => update('title', e.target.value)} /></div>
        {/* Swapping is the usual edit, so it sits right under what the meal is. */}
        {swapRange && <div className="sheet-links"><button className="sheet-link" type="button" aria-haspopup="dialog" onClick={() => setSwapping(true)}><CalendarIcon /><span>Swap with…<small>Trade days with another meal this week</small></span><ChevronRight /></button></div>}
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${formId}-date`}>Date</label><input id={`${formId}-date`} type="date" required value={draft.date} onChange={e => update('date', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${formId}-slot`}>Meal</label><select id={`${formId}-slot`} value={draft.slot} onChange={e => update('slot', e.target.value as MealSlot)}>{MEAL_SLOTS.map(slot => <option key={slot} value={slot}>{SLOT_LABEL[slot]}</option>)}</select></div>
        </div>
        <div className="meal-form-row">
          {/* Eating out: who's eating sets how many, and nobody cooks. */}
          {draft.mealKind !== 'dining_out' && <div className="field"><label htmlFor={`${formId}-servings`}>Servings</label><input id={`${formId}-servings`} type="number" required min="0.01" max="10000" step="any" value={draft.servings || ''} onChange={e => update('servings', Number(e.target.value))} /></div>}
          <div className="field"><label htmlFor={`${formId}-time`}>Time</label><input id={`${formId}-time`} type="time" placeholder={settings.mealTimes[draft.slot]} aria-describedby={`${formId}-time-hint`} value={draft.plannedTime ?? ''} onChange={e => update('plannedTime', e.target.value || null)} />
            {/* A time field can't show a placeholder, so the usual time sits under it. */}
            <p className="field-hint" id={`${formId}-time-hint`}>{draft.plannedTime ? 'Clear it to use the usual time.' : `Usual ${SLOT_LABEL[draft.slot].toLowerCase()} time: ${formatTime(settings.mealTimes[draft.slot])}`}</p></div>
        </div>
        {draft.mealKind !== 'dining_out' && <div className="field"><label htmlFor={`${formId}-assignee`}>Cooking</label><select id={`${formId}-assignee`} value={draft.assigneeMemberId ?? ''} onChange={e => update('assigneeMemberId', e.target.value || null)}><option value="">Nobody yet</option>{members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}</select></div>}
        <MemberPicker members={members} selected={draft.eaterIds} label="Who’s eating" noneLabel="Not set" onChange={ids => setDraft(d => ({ ...d, eaterIds: ids, servings: ids.length || d.servings }))} />
        {draft.mealKind === 'dining_out' ? <p className="field-hint meal-eaters-hint">Who’s eating is who gets asked for their order.</p>
          : members.length > 0 && draft.servings > 0 && <p className="field-hint meal-eaters-hint">{!draft.eaterIds.length ? `${servingsLabel(draft.servings)}: pick ${draft.servings === 1 ? 'who’s eating' : `${draft.servings} people`}` : draft.eaterIds.length === draft.servings ? `${draft.eaterIds.length} of ${servingsLabel(draft.servings)}` : `${draft.eaterIds.length} selected for ${servingsLabel(draft.servings)}`}</p>}
        {draft.mealKind === 'dining_out' && !draft.restaurantId && <div className="field"><label htmlFor={`${formId}-url`}>Website (optional)</label><input id={`${formId}-url`} type="url" pattern="https?://.*" maxLength={2000} value={draft.sourceUrl ?? ''} onChange={e => update('sourceUrl', e.target.value || null)} /></div>}
      </fieldset> : <>
        <p>{mealDayLabel(draft.date)} · {SLOT_LABEL[draft.slot]}{draft.plannedTime ? ` · ${formatTime(draft.plannedTime)}` : ''}</p>
        <p>{draft.mealKind === 'dining_out' ? ['Eating out', draft.orderType && ORDER_TYPE_LABEL[draft.orderType]].filter(Boolean).join(' · ') : `${servingsLabel(draft.servings)} · Cooking: ${members.find(m => m.id === draft.assigneeMemberId)?.name ?? 'nobody yet'}`}</p>
        {draft.eaterIds.length > 0 && <p className="meal-eaters-row">Eating <EaterAvatars ids={draft.eaterIds} members={members} /></p>}
      </>}
      {snapshot && (time || meal?.recipeSnapshot) && <section aria-label="Recipe">
        {time && <p className="recipe-time">⏱ {time}{start ? ` · Start by ${formatTime(start)}` : ''}</p>}
        {meal?.recipeSnapshot && <p className="field-hint">The recipe is saved with this meal, so later recipe edits don’t change it.</p>}
        {admin && meal?.recipeSnapshot && selectedRecipe && !selectedRecipe.archived && draft.recipeId === meal.recipeId && <label className="meal-check"><input type="checkbox" checked={refreshRecipe} disabled={busy} onChange={e => setRefreshRecipe(e.target.checked)} /> Refresh from the current recipe when saving</label>}
      </section>}
      {/* An order night's orders have their own view (Orders.tsx OrderNightSheet); eating out somewhere else keeps them here. */}
      {linkedMeal?.mealKind === 'dining_out' && !isOrderNight(linkedMeal) && <OrderSummary meal={linkedMeal} restaurant={restaurant} me={me} onChanged={ordersChanged} onOrder={() => setOrdering(true)} />}
      {draft.mealKind !== 'recipe' && <p className="field-hint">{draft.mealKind === 'dining_out' ? 'Eating out doesn’t add anything to the grocery list.' : 'Only recipes add to the grocery list.'}</p>}
      {canUpdate ? <fieldset className="meal-fieldset meal-spaced" disabled={busy}>
        {/* On an order night the status locks everyone's orders: a grown-up's call (the server says so too). */}
        {(admin || draft.mealKind !== 'dining_out') && <div className="field"><label htmlFor={`${formId}-status`}>Status</label><select id={`${formId}-status`} value={draft.status} onChange={e => update('status', e.target.value as MealStatus)}>{(['planned', 'prepared'] as const).map(status => <option key={status} value={status}>{statusLabel({ status, mealKind: draft.mealKind })}</option>)}</select></div>}
        <div className="field"><label htmlFor={`${formId}-notes`}>Notes</label><textarea id={`${formId}-notes`} maxLength={10000} value={draft.notes ?? ''} onChange={e => update('notes', e.target.value || null)} /></div>
      </fieldset> : <><p>Status: {statusLabel(draft)}</p>{draft.notes && <p className="meal-prose">{draft.notes}</p>}</>}
      {((snapshot && selectedRecipe) || meal?.sourceUrl || linkedMeal?.calendarEventId) && <div className="sheet-links">
        {snapshot && selectedRecipe && <button className="sheet-link" type="button" onClick={() => onRecipe(selectedRecipe)}><BookIcon /><span>Open recipe</span><ChevronRight /></button>}
        {meal?.sourceUrl && <SourceLink url={meal.sourceUrl} pdfPath={`api/meals/${encodeURIComponent(meal.id)}/source.pdf`} title={meal.title} label={meal.mealKind === 'dining_out' ? 'Website' : 'Recipe website'} />}
        {linkedMeal?.calendarEventId && <a className="sheet-link" href={`#/calendar?at=${linkedMeal.date}&event=${encodeURIComponent(linkedMeal.calendarEventId)}`}><CalendarIcon /><span>Linked calendar event</span><ChevronRight /></a>}
      </div>}
      {admin && linkedMeal && <div className="meal-actions">
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setCalendarOpen(true)}>{linkedMeal.calendarEventId ? 'Manage calendar event' : 'Add to calendar'}</button>
      </div>}
      {admin && !meal && <p className="field-hint">Save this meal to put it on a calendar.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>}
    {swapping && meal && swapRange && <SwapPicker meal={meal} range={swapRange} recipes={recipes} onPick={other => void swap(other)} onClose={() => setSwapping(false)} />}
    {picking && <RecipePicker recipes={recipes} currentId={draft.recipeId} saved={savedRecipe} onPick={pick} onClose={() => setPicking(false)} />}
    {ordering && linkedMeal && <OrderSheet meal={linkedMeal} restaurant={restaurant} me={me} onClose={() => setOrdering(false)} onSaved={ordersChanged} />}
    {calendarOpen && linkedMeal && <MealCalendarSheet meal={linkedMeal} onClose={() => setCalendarOpen(false)} onLinked={setLinkedMeal} />}
  </Sheet>
}

/** The first step of planning a meal: find a recipe (Enter picks the first match), or plan something
 * else by name, or eating out. */
function MealChooser({ recipes, slot, onRecipe, onOther }: {
  recipes: Recipe[]; slot: MealSlot; onRecipe: (recipe: Recipe) => void; onOther: (kind: 'freeform' | 'dining_out', title: string) => void
}) {
  const [query, setQuery] = useState('')
  const shown = pickerRecipes(recipes, query, null, false)
  const name = query.trim()
  return <div className="recipe-picker">
    <div className="field"><label htmlFor="meal-choose">What’s for {SLOT_LABEL[slot].toLowerCase()}?</label>
      <input id="meal-choose" type="search" data-autofocus placeholder="Find a recipe" value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) onRecipe(shown[0]); else if (name) onOther('freeform', name) } }} /></div>
    <div className="meal-actions meal-choose-other">
      <button type="button" className="btn btn-secondary" onClick={() => onOther('freeform', name)}>{name && !shown.length ? `Something else: “${name}”` : 'Something else'}</button>
      <button type="button" className="btn btn-secondary" onClick={() => onOther('dining_out', '')}>Eating out</button>
    </div>
    {shown.length ? <div className="sheet-links">{shown.map(r => <button key={r.id} type="button" className="sheet-link" onClick={() => onRecipe(r)}>
      {r.imageUrl ? <RecipePhoto id={r.id} className="recipe-pick-thumb" /> : <BookIcon />}
      <span>{r.name}{(!!r.totalMinutes || r.rating?.average != null) && <small>{[r.totalMinutes ? minutesLabel(r.totalMinutes) : '', r.rating?.average != null ? `★ ${r.rating.average}` : ''].filter(Boolean).join(' · ')}</small>}</span>
    </button>)}</div>
      : <p className="state-card">{recipes.some(r => !r.archived) ? 'No recipes match. Tap Something else to plan it by name.' : 'No recipes yet. Tap Something else to plan a meal by name.'}</p>}
  </div>
}

/** Choosing a meal's recipe: search by name or ingredient, arrows move through the list, Enter picks. */
export function RecipePicker({ recipes, currentId, saved, onPick, onClose }: {
  recipes: Recipe[]; currentId: string | null; saved: { id: string | null; name: string } | null
  onPick: (recipe: Recipe | null) => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  // Basics (seasoning blends, doughs…) stay out of meal planning unless asked for.
  const [basics, setBasics] = useState(false)
  const shown = pickerRecipes(recipes, query, currentId, basics)
  const hasBasics = recipes.some(r => r.kind === 'basic' && !r.archived)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('input, .sheet-link')]
    const next = items[items.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) { e.preventDefault(); next.focus() }
  }
  return <Sheet title="Choose a recipe" onClose={onClose}>
    <div className="recipe-picker" onKeyDown={onKey}>
      <div className="field"><label htmlFor="recipe-picker-search">Find a recipe</label>
        <input id="recipe-picker-search" type="search" data-autofocus placeholder="Recipe name or ingredient" value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onPick(shown[0]) } }} /></div>
      {hasBasics && <div className="field"><label htmlFor="recipe-picker-show">Show</label><select id="recipe-picker-show" value={basics ? 'all' : 'meals'} onChange={e => setBasics(e.target.value === 'all')}><option value="meals">Meals</option><option value="all">Meals and basics</option></select></div>}
      <div className="sheet-links">
        {saved && !query.trim() && <button type="button" className="sheet-link" aria-current={currentId === saved.id || undefined} onClick={() => onPick(null)}><BookIcon /><span>{saved.name} (saved recipe)<small>Kept with this meal</small></span></button>}
        {shown.map(r => <button key={r.id} type="button" className="sheet-link" aria-current={r.id === currentId || undefined} onClick={() => onPick(r)}>
          {r.imageUrl ? <RecipePhoto id={r.id} className="recipe-pick-thumb" /> : <BookIcon />}
          <span>{r.name}{r.archived ? ' (archived)' : ''}{r.kind === 'basic' && <span className="kit-tag">Basic</span>}{(!!r.totalMinutes || r.rating?.average != null) && <small>{[r.totalMinutes ? minutesLabel(r.totalMinutes) : '', r.rating?.average != null ? `★ ${r.rating.average}` : ''].filter(Boolean).join(' · ')}</small>}</span>
        </button>)}
      </div>
      {!shown.length && <p className="state-card">No recipes match</p>}
    </div>
  </Sheet>
}

/** Another planned meal from today through the end of this meal's week; picking one trades their day and slot. */
function SwapPicker({ meal, range, recipes, onPick, onClose }: {
  meal: Meal; range: { from: string; to: string }; recipes: Recipe[]; onPick: (other: Meal) => void; onClose: () => void
}) {
  const [meals, setMeals] = useState<Meal[] | null>(null)
  const [error, setError] = useState('')
  // Like the recipe picker: a basic planned as a meal (a prep session) shows only when asked for.
  const [basics, setBasics] = useState(false)
  const isBasic = (m: Meal) => recipes.find(r => r.id === m.recipeId)?.kind === 'basic'
  const shown = meals?.filter(m => basics || !isBasic(m)) ?? null
  useEffect(() => {
    let canceled = false
    api.getMeals(range.from, range.to).then(all => { if (!canceled) setMeals(swapCandidates(all, meal.id)) }).catch(e => { if (!canceled) setError(e instanceof Error ? e.message : 'Could not load meals.') })
    return () => { canceled = true }
  }, [meal.id, range.from, range.to])
  return <Sheet title={`Swap “${meal.title}” with…`} onClose={onClose}>
    {meals?.some(isBasic) && <div className="field"><label htmlFor="swap-show">Show</label><select id="swap-show" value={basics ? 'all' : 'meals'} onChange={e => setBasics(e.target.value === 'all')}><option value="meals">Meals</option><option value="all">Meals and basics</option></select></div>}
    {error ? <p className="field-error" role="alert">{error}</p> : !shown ? <p role="status">Loading meals…</p> : !shown.length ? <p className="state-card">No other meals planned for the rest of this week.</p> :
      <div className="sheet-links">{shown.map(m => {
        const recipe = recipes.find(r => r.id === m.recipeId)
        return <button key={m.id} type="button" className="sheet-link" onClick={() => onPick(m)}>
          {recipe?.imageUrl ? <RecipePhoto id={recipe.id} className="recipe-pick-thumb" /> : <CalendarIcon />}
          <span>{m.title}<small>{mealDayLabel(m.date, { weekday: 'long' })} · {SLOT_LABEL[m.slot]}</small></span>
        </button>
      })}</div>}
  </Sheet>
}
