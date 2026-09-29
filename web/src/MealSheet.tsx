import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { BookIcon, CalendarIcon, ChevronRight, TrashIcon } from './icons.tsx'
import { SourceLink } from './RecipeSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import { clockTime, todayKeyInTz } from './date.ts'
import MealCalendarSheet from './MealCalendarSheet.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { inkFor } from './color.ts'
import type { Member } from './types.ts'
import { MEAL_SLOTS, SLOT_LABEL, mealDayLabel, minutesLabel, recipeTime, servingsLabel, startBy, swapCandidates, swapWindow } from './meal-date.ts'
import { pickerRecipes } from './recipe-search.ts'
import type { Meal, MealInput, MealKind, MealSlot, MealStatus, Recipe } from './meal-types.ts'

export type MealDraft = { date: string; slot: MealSlot; recipe?: Recipe }

/** Small overlapping avatars of who's eating (planner card, Board, meal sheet). */
export function EaterAvatars({ ids, members }: { ids: string[]; members: Member[] }) {
  const eaters = members.filter(m => ids.includes(m.id))
  if (!eaters.length) return null
  return <span className="meal-eaters" role="img" aria-label={`Eating: ${eaters.map(m => m.name).join(', ')}`}>
    {eaters.map(m => <span key={m.id} className="member-avatar-sm" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span>)}
  </span>
}

export default function MealSheet({ meal, initial, recipes, admin, owner, onClose, onSaved, onRecipe }: {
  meal: Meal | null; initial: MealDraft; recipes: Recipe[]; admin: boolean; owner?: string | null
  onClose: () => void; onSaved: () => void; onRecipe: (recipe: Recipe) => void
}) {
  const { members, settings, toast } = useApp()
  const dialog = useDialog()
  const formId = useId()
  const [draft, setDraft] = useState<MealInput>(() => ({
    date: meal?.date ?? initial.date, slot: meal?.slot ?? initial.slot, title: meal?.title ?? initial.recipe?.name ?? '',
    mealKind: meal?.mealKind ?? (initial.recipe ? 'recipe' : 'freeform'), recipeId: meal?.recipeId ?? initial.recipe?.id ?? null,
    servings: meal?.servings ?? initial.recipe?.defaultServings ?? 4, assigneeMemberId: meal?.assigneeMemberId ?? null, eaterIds: meal?.eaterIds ?? [],
    notes: meal?.notes ?? null, plannedTime: meal?.plannedTime ?? null, status: meal?.status ?? 'planned', sourceUrl: meal?.sourceUrl ?? null,
  }))
  const [refreshRecipe, setRefreshRecipe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [swapping, setSwapping] = useState(false)
  const [linkedMeal, setLinkedMeal] = useState(meal)
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
    if (admin && (!draft.title.trim() || (draft.mealKind === 'recipe' && !snapshot))) { setError('Add a meal name and select a recipe for recipe meals.'); return }
    setBusy(true); setError('')
    try {
      const body = { ...draft, title: draft.title.trim(), recipeId: draft.mealKind === 'recipe' ? draft.recipeId : null }
      if (meal) await api.updateMeal(meal.id, admin ? { ...body, ...(refreshRecipe ? { refreshRecipe: true } : {}) } : { notes: draft.notes, status: draft.status })
      else await api.createMeal(body)
      toast('Meal saved'); onSaved()
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
  return <Sheet title={meal ? admin ? 'Edit meal' : meal.title : 'Plan a meal'} onClose={close} dismissable={!busy} actions={canUpdate ? <>
    {meal && admin && <button className="icon-btn" aria-label="Delete meal" disabled={busy} onClick={remove}><TrashIcon /></button>}
    <button className="btn btn-secondary" disabled={busy} onClick={close}>Cancel</button>
    <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save meal'}</button>
  </> : undefined}>
    <form id={formId} onSubmit={e => { e.preventDefault(); void save() }}>
      {admin ? <fieldset className="meal-fieldset" disabled={busy}>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${formId}-date`}>Date</label><input id={`${formId}-date`} type="date" required value={draft.date} onChange={e => update('date', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${formId}-slot`}>Meal slot</label><select id={`${formId}-slot`} value={draft.slot} onChange={e => update('slot', e.target.value as MealSlot)}>{MEAL_SLOTS.map(slot => <option key={slot} value={slot}>{SLOT_LABEL[slot]}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor={`${formId}-kind`}>Meal type</label><select id={`${formId}-kind`} value={draft.mealKind} onChange={e => update('mealKind', e.target.value as MealKind)}><option value="recipe">Recipe</option><option value="freeform">Free-form meal</option><option value="dining_out">Dining out</option></select></div>
        {draft.mealKind === 'recipe' && <div className="field"><label htmlFor={`${formId}-recipe`}>Recipe</label>
          <button id={`${formId}-recipe`} type="button" className="sheet-link" aria-haspopup="dialog" aria-label={`Recipe: ${recipeLabel}`} onClick={() => setPicking(true)}>
            {selectedRecipe?.imageUrl && <RecipePhoto id={selectedRecipe.id} className="recipe-pick-thumb" />}
            <span>{recipeLabel}</span><ChevronRight />
          </button>
          {!recipes.some(r => !r.archived) && !snapshot && <p className="field-hint">Create a recipe in the Recipe library first.</p>}
        </div>}
        <div className="field"><label htmlFor={`${formId}-title`}>{draft.mealKind === 'dining_out' ? 'Place or meal name' : 'Meal name'}</label><input id={`${formId}-title`} type="text" required maxLength={200} placeholder={draft.mealKind === 'dining_out' ? 'Eating out, school cafeteria…' : 'What are we eating?'} value={draft.title} onChange={e => update('title', e.target.value)} /></div>
        <MemberPicker members={members} selected={draft.eaterIds} label="Who’s eating" noneLabel="Not set" onChange={ids => setDraft(d => ({ ...d, eaterIds: ids, servings: ids.length || d.servings }))} />
        {members.length > 0 && draft.servings > 0 && <p className="field-hint meal-eaters-hint">{!draft.eaterIds.length ? `${servingsLabel(draft.servings)}: pick ${draft.servings === 1 ? 'who’s eating' : `${draft.servings} people`}` : draft.eaterIds.length === draft.servings ? `${draft.eaterIds.length} of ${servingsLabel(draft.servings)}` : `${draft.eaterIds.length} selected for ${servingsLabel(draft.servings)}`}</p>}
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${formId}-servings`}>Servings</label><input id={`${formId}-servings`} type="number" required min="0.01" max="10000" step="any" value={draft.servings || ''} onChange={e => update('servings', Number(e.target.value))} /></div>
          <div className="field"><label htmlFor={`${formId}-time`}>Time</label><input id={`${formId}-time`} type="time" placeholder={settings.mealTimes[draft.slot]} aria-describedby={`${formId}-time-hint`} value={draft.plannedTime ?? ''} onChange={e => update('plannedTime', e.target.value || null)} />
            {/* A time field can't show a placeholder, so the usual time sits under it. */}
            <p className="field-hint" id={`${formId}-time-hint`}>{draft.plannedTime ? 'Clear it to use the usual time.' : `Usual ${SLOT_LABEL[draft.slot].toLowerCase()} time: ${clockTime(settings.mealTimes[draft.slot])}`}</p></div>
        </div>
        <div className="field"><label htmlFor={`${formId}-assignee`}>Cooking</label><select id={`${formId}-assignee`} value={draft.assigneeMemberId ?? ''} onChange={e => update('assigneeMemberId', e.target.value || null)}><option value="">Nobody yet</option>{members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}</select></div>
        {draft.mealKind === 'dining_out' && <div className="field"><label htmlFor={`${formId}-url`}>Website (optional)</label><input id={`${formId}-url`} type="url" pattern="https?://.*" maxLength={2000} value={draft.sourceUrl ?? ''} onChange={e => update('sourceUrl', e.target.value || null)} /></div>}
      </fieldset> : <>
        <p>{mealDayLabel(draft.date)} · {SLOT_LABEL[draft.slot]}{draft.plannedTime ? ` · ${draft.plannedTime}` : ''}</p>
        <p>{draft.mealKind === 'dining_out' ? 'Dining out · ' : ''}{servingsLabel(draft.servings)} · Cooking: {members.find(m => m.id === draft.assigneeMemberId)?.name ?? 'nobody yet'}</p>
        {draft.eaterIds.length > 0 && <p className="meal-eaters-row">Eating <EaterAvatars ids={draft.eaterIds} members={members} /></p>}
      </>}
      {snapshot && (time || meal?.recipeSnapshot) && <section aria-label="Recipe">
        {time && <p className="recipe-time">⏱ {time}{start ? ` · Start by ${clockTime(start)}` : ''}</p>}
        {meal?.recipeSnapshot && <p className="field-hint">The recipe is saved with this meal, so later recipe edits don’t change it.</p>}
        {admin && meal?.recipeSnapshot && selectedRecipe && !selectedRecipe.archived && draft.recipeId === meal.recipeId && <label className="meal-check"><input type="checkbox" checked={refreshRecipe} disabled={busy} onChange={e => setRefreshRecipe(e.target.checked)} /> Refresh from the current recipe when saving</label>}
      </section>}
      {draft.mealKind !== 'recipe' && <p className="field-hint">{draft.mealKind === 'dining_out' ? 'Dining out' : 'Free-form meals'} do not add ingredients to the shopping projection.</p>}
      {canUpdate ? <fieldset className="meal-fieldset meal-spaced" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-status`}>Status</label><select id={`${formId}-status`} value={draft.status} onChange={e => update('status', e.target.value as MealStatus)}><option value="planned">Planned</option><option value="prepared">Prepared</option><option value="handled">Handled</option></select></div>
        <div className="field"><label htmlFor={`${formId}-notes`}>Notes</label><textarea id={`${formId}-notes`} maxLength={10000} value={draft.notes ?? ''} onChange={e => update('notes', e.target.value || null)} /></div>
      </fieldset> : <><p>Status: {draft.status}</p>{draft.notes && <p className="meal-prose">{draft.notes}</p>}</>}
      {((snapshot && selectedRecipe) || meal?.sourceUrl || linkedMeal?.calendarEventId) && <div className="sheet-links">
        {snapshot && selectedRecipe && <button className="sheet-link" type="button" onClick={() => onRecipe(selectedRecipe)}><BookIcon /><span>Open recipe</span><ChevronRight /></button>}
        {meal?.sourceUrl && <SourceLink url={meal.sourceUrl} pdfPath={`api/meals/${encodeURIComponent(meal.id)}/source.pdf`} title={meal.title} label={meal.mealKind === 'dining_out' ? 'Website' : 'Recipe website'} />}
        {linkedMeal?.calendarEventId && <a className="sheet-link" href={`#/calendar?at=${linkedMeal.date}&event=${encodeURIComponent(linkedMeal.calendarEventId)}`}><CalendarIcon /><span>Linked calendar event</span><ChevronRight /></a>}
      </div>}
      {admin && linkedMeal && <div className="meal-actions">
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setCalendarOpen(true)}>{linkedMeal.calendarEventId ? 'Manage calendar event' : 'Add to calendar'}</button>
        {swapRange && <button className="btn btn-secondary" type="button" aria-haspopup="dialog" disabled={busy} onClick={() => setSwapping(true)}>Swap with…</button>}
      </div>}
      {admin && !meal && <p className="field-hint">Save this meal to put it on a calendar.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
    {swapping && meal && swapRange && <SwapPicker meal={meal} range={swapRange} recipes={recipes} onPick={other => void swap(other)} onClose={() => setSwapping(false)} />}
    {picking && <RecipePicker recipes={recipes} currentId={draft.recipeId} saved={savedRecipe} onPick={pick} onClose={() => setPicking(false)} />}
    {calendarOpen && linkedMeal && <MealCalendarSheet meal={linkedMeal} onClose={() => setCalendarOpen(false)} onLinked={setLinkedMeal} />}
  </Sheet>
}

/** Choosing a meal's recipe: search by name or ingredient, arrows move through the list, Enter picks. */
function RecipePicker({ recipes, currentId, saved, onPick, onClose }: {
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
