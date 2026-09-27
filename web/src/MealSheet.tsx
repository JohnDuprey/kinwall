import { useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { TrashIcon } from './icons.tsx'
import { IngredientList } from './RecipeSheet.tsx'
import MealCalendarSheet from './MealCalendarSheet.tsx'
import { MEAL_SLOTS, SLOT_LABEL, mealDayLabel } from './meal-date.ts'
import type { Meal, MealInput, MealKind, MealSlot, MealStatus, Recipe } from './meal-types.ts'

export type MealDraft = { date: string; slot: MealSlot; recipe?: Recipe }

export default function MealSheet({ meal, initial, recipes, admin, owner, onClose, onSaved, onRecipe }: {
  meal: Meal | null; initial: MealDraft; recipes: Recipe[]; admin: boolean; owner?: string | null
  onClose: () => void; onSaved: () => void; onRecipe: (recipe: Recipe) => void
}) {
  const { members, toast } = useApp()
  const dialog = useDialog()
  const formId = useId()
  const [draft, setDraft] = useState<MealInput>(() => ({
    date: meal?.date ?? initial.date, slot: meal?.slot ?? initial.slot, title: meal?.title ?? initial.recipe?.name ?? '',
    mealKind: meal?.mealKind ?? (initial.recipe ? 'recipe' : 'freeform'), recipeId: meal?.recipeId ?? initial.recipe?.id ?? null,
    servings: meal?.servings ?? initial.recipe?.defaultServings ?? 4, assigneeMemberId: meal?.assigneeMemberId ?? null,
    notes: meal?.notes ?? null, plannedTime: meal?.plannedTime ?? null, status: meal?.status ?? 'planned', sourceUrl: meal?.sourceUrl ?? null,
  }))
  const [refreshRecipe, setRefreshRecipe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [linkedMeal, setLinkedMeal] = useState(meal)
  const assigned = !!meal?.assigneeMemberId && owner === meal.assigneeMemberId
  const canUpdate = admin || assigned
  const selectedRecipe = recipes.find(r => r.id === draft.recipeId)
  const snapshot = draft.mealKind === 'recipe'
    ? meal?.mealKind === 'recipe' && draft.recipeId === meal.recipeId && !refreshRecipe ? meal.recipeSnapshot : selectedRecipe
    : null
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
        {draft.mealKind === 'recipe' && <div className="field"><label htmlFor={`${formId}-recipe`}>Recipe</label><select id={`${formId}-recipe`} required={!snapshot} value={draft.recipeId ?? ''} onChange={e => {
          const recipe = recipes.find(r => r.id === e.target.value)
          setDraft(d => ({ ...d, recipeId: recipe?.id ?? null, title: recipe?.name ?? d.title, servings: recipe?.defaultServings ?? d.servings })); setRefreshRecipe(false)
        }}><option value="">Choose a recipe</option>{!selectedRecipe && meal?.recipeSnapshot && draft.recipeId && <option value={draft.recipeId}>{meal.recipeSnapshot.name} (saved recipe)</option>}{recipes.filter(r => !r.archived || r.id === draft.recipeId).map(r => <option key={r.id} value={r.id}>{r.name}{r.archived ? ' (archived)' : ''}</option>)}</select>
          {!recipes.some(r => !r.archived) && !snapshot && <p className="field-hint">Create a recipe in the Recipe library first.</p>}
        </div>}
        <div className="field"><label htmlFor={`${formId}-title`}>{draft.mealKind === 'dining_out' ? 'Place or meal name' : 'Meal name'}</label><input id={`${formId}-title`} type="text" required maxLength={200} placeholder={draft.mealKind === 'dining_out' ? 'Eating out, school cafeteria…' : 'What are we eating?'} value={draft.title} onChange={e => update('title', e.target.value)} /></div>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${formId}-servings`}>Servings</label><input id={`${formId}-servings`} type="number" required min="0.01" max="10000" step="any" value={draft.servings || ''} onChange={e => update('servings', Number(e.target.value))} /></div>
          <div className="field"><label htmlFor={`${formId}-time`}>Time (optional)</label><input id={`${formId}-time`} type="time" value={draft.plannedTime ?? ''} onChange={e => update('plannedTime', e.target.value || null)} /></div>
        </div>
        <div className="field"><label htmlFor={`${formId}-assignee`}>Assignee</label><select id={`${formId}-assignee`} value={draft.assigneeMemberId ?? ''} onChange={e => update('assigneeMemberId', e.target.value || null)}><option value="">Unassigned</option>{members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}</select></div>
        {draft.mealKind === 'dining_out' && <div className="field"><label htmlFor={`${formId}-url`}>Website (optional)</label><input id={`${formId}-url`} type="url" pattern="https?://.*" maxLength={2000} value={draft.sourceUrl ?? ''} onChange={e => update('sourceUrl', e.target.value || null)} /></div>}
      </fieldset> : <>
        <p>{mealDayLabel(draft.date)} · {SLOT_LABEL[draft.slot]}{draft.plannedTime ? ` · ${draft.plannedTime}` : ''}</p>
        <p>{draft.mealKind === 'dining_out' ? 'Dining out · ' : ''}{draft.servings} servings · {members.find(m => m.id === draft.assigneeMemberId)?.name ?? 'Unassigned'}</p>
      </>}
      {snapshot && <section aria-label="Scaled ingredients">
        <h3>Ingredients for {draft.servings} servings</h3>
        <IngredientList recipe={snapshot} servings={draft.servings} />
        {meal?.recipeSnapshot && <p className="field-hint">Saved with this meal. Recipe edits do not change these ingredients.</p>}
        {admin && meal?.recipeSnapshot && selectedRecipe && !selectedRecipe.archived && draft.recipeId === meal.recipeId && <label className="meal-check"><input type="checkbox" checked={refreshRecipe} disabled={busy} onChange={e => setRefreshRecipe(e.target.checked)} /> Refresh from the current recipe when saving</label>}
        {selectedRecipe && <button className="link-btn" type="button" onClick={() => onRecipe(selectedRecipe)}>Open recipe</button>}
      </section>}
      {draft.mealKind !== 'recipe' && <p className="field-hint">{draft.mealKind === 'dining_out' ? 'Dining out' : 'Free-form meals'} do not add ingredients to the shopping projection.</p>}
      {canUpdate ? <fieldset className="meal-fieldset meal-spaced" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-status`}>Status</label><select id={`${formId}-status`} value={draft.status} onChange={e => update('status', e.target.value as MealStatus)}><option value="planned">Planned</option><option value="prepared">Prepared</option><option value="handled">Handled</option></select></div>
        <div className="field"><label htmlFor={`${formId}-notes`}>Notes</label><textarea id={`${formId}-notes`} maxLength={10000} value={draft.notes ?? ''} onChange={e => update('notes', e.target.value || null)} /></div>
      </fieldset> : <><p>Status: {draft.status}</p>{draft.notes && <p className="meal-prose">{draft.notes}</p>}</>}
      {meal?.sourceUrl && <p><a href={meal.sourceUrl} target="_blank" rel="noopener noreferrer">Open meal website</a></p>}
      {linkedMeal?.calendarEventId && <p><a href={`#/calendar?at=${linkedMeal.date}&event=${encodeURIComponent(linkedMeal.calendarEventId)}`}>Open linked calendar event</a></p>}
      {admin && linkedMeal && <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => setCalendarOpen(true)}>{linkedMeal.calendarEventId ? 'Manage calendar link' : 'Link or create calendar event'}</button>}
      {admin && !meal && <p className="field-hint">Save this meal to link an event or add it to a local calendar.</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
    {calendarOpen && linkedMeal && <MealCalendarSheet meal={linkedMeal} onClose={() => setCalendarOpen(false)} onLinked={setLinkedMeal} />}
  </Sheet>
}
