import { useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { PlusIcon, TrashIcon } from './icons.tsx'
import { ingredientAmount } from './meal-date.ts'
import type { IngredientInput, Recipe, RecipeInput, RecipeSnapshot } from './meal-types.ts'

const emptyIngredient = (): IngredientInput => ({ name: '', quantity: null, unit: null, preparation: null, qualifier: null, category: null, sort: 0 })

/** A planned meal renders its snapshot here; changing servings never edits the recipe. */
export function IngredientList({ recipe, servings }: { recipe: RecipeSnapshot; servings: number }) {
  return <ul className="meal-ingredients">
    {recipe.ingredients.map(ingredient => {
      const scalable = ingredient.quantity !== null && !ingredient.qualifier && !/^(packages?|packs?|cans?|jars?|bunch(es)?|pinch(es)?|handfuls?)$/i.test(ingredient.unit?.trim() ?? '')
      const amount = scalable ? ingredient.quantity! * servings / recipe.defaultServings : ingredient.quantity
      return <li key={ingredient.id}>
        <strong>{ingredient.name}</strong> — {ingredientAmount(amount, ingredient.unit, ingredient.qualifier) || 'As needed'}
        {ingredient.preparation && <span> · {ingredient.preparation}</span>}
        {!scalable && servings !== recipe.defaultServings && <span className="field-hint"> · Check amount for {servings} servings (recipe: {recipe.defaultServings})</span>}
      </li>
    })}
  </ul>
}

export default function RecipeSheet({ recipe, admin, onClose, onSaved, onPlan }: {
  recipe: Recipe | null; admin: boolean; onClose: () => void; onSaved: () => void; onPlan?: (recipe: Recipe) => void
}) {
  const { toast } = useApp()
  const dialog = useDialog()
  const formId = useId()
  const [draft, setDraft] = useState<RecipeInput>(() => ({
    name: recipe?.name ?? '', description: recipe?.description ?? null, defaultServings: recipe?.defaultServings ?? 4,
    instructions: recipe?.instructions ?? null, preparationNotes: recipe?.preparationNotes ?? null,
    sourceUrl: recipe?.sourceUrl ?? null, archived: recipe?.archived ?? false,
    ingredients: recipe?.ingredients.map(({ name, quantity, unit, preparation, qualifier, category, sort }) => ({ name, quantity, unit, preparation, qualifier, category, sort })) ?? [],
  }))
  // Row ids survive removal/reordering so keyboard focus stays on the ingredient being edited.
  const [rowIds, setRowIds] = useState(() => draft.ingredients.map(() => crypto.randomUUID()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = <K extends keyof RecipeInput>(key: K, value: RecipeInput[K]) => setDraft(d => ({ ...d, [key]: value }))
  const ingredient = (index: number, patch: Partial<IngredientInput>) => update('ingredients', draft.ingredients.map((row, i) => i === index ? { ...row, ...patch } : row))
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('')
    try { await action(); toast(message); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save recipe.') }
    finally { setBusy(false) }
  }
  const save = () => {
    const body = { ...draft, name: draft.name.trim(), ingredients: draft.ingredients.map((row, sort) => ({ ...row, name: row.name.trim(), sort })) }
    if (!body.name || body.ingredients.some(row => !row.name)) { setError('Give the recipe and each ingredient a name.'); return }
    void run(() => recipe ? api.updateRecipe(recipe.id, body) : api.createRecipe(body), 'Recipe saved')
  }
  const remove = async () => {
    if (!recipe || !await dialog.confirm({ title: `Delete “${recipe.name}”?`, body: 'This removes the recipe from the library. Existing meals keep their saved ingredients.', confirmLabel: 'Delete recipe', danger: true })) return
    void run(() => api.deleteRecipe(recipe.id), 'Recipe deleted')
  }
  const close = () => { if (!busy) onClose() }
  if (!admin && recipe) return <Sheet title={recipe.name} onClose={onClose}>
    {recipe.description && <p>{recipe.description}</p>}
    <p>{recipe.defaultServings} servings{recipe.archived ? ' · Archived' : ''}</p>
    <IngredientList recipe={recipe} servings={recipe.defaultServings} />
    {recipe.instructions && <><h3>Instructions</h3><p className="meal-prose">{recipe.instructions}</p></>}
    {recipe.preparationNotes && <><h3>Preparation notes</h3><p className="meal-prose">{recipe.preparationNotes}</p></>}
    {recipe.sourceUrl && <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">Open recipe source</a>}
  </Sheet>
  return <Sheet title={recipe ? 'Edit recipe' : 'New recipe'} onClose={close} dismissable={!busy} actions={<>
    {recipe && <button className="btn btn-secondary" disabled={busy} onClick={() => void run(() => api.updateRecipe(recipe.id, { archived: !recipe.archived }), recipe.archived ? 'Recipe restored' : 'Recipe archived')}>{recipe.archived ? 'Restore' : 'Archive'}</button>}
    {recipe && <button className="icon-btn" aria-label="Delete recipe" disabled={busy} onClick={remove}><TrashIcon /></button>}
    <button className="btn btn-primary" type="submit" form={formId} disabled={busy}>{busy ? 'Saving…' : 'Save recipe'}</button>
  </>}>
    <form id={formId} onSubmit={e => { e.preventDefault(); save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-name`}>Name</label><input id={`${formId}-name`} required maxLength={200} value={draft.name} onChange={e => update('name', e.target.value)} /></div>
        <div className="field"><label htmlFor={`${formId}-description`}>Description</label><textarea id={`${formId}-description`} maxLength={10000} value={draft.description ?? ''} onChange={e => update('description', e.target.value || null)} /></div>
        <div className="field"><label htmlFor={`${formId}-servings`}>Default servings</label><input id={`${formId}-servings`} type="number" required min="0.01" max="10000" step="any" value={draft.defaultServings || ''} onChange={e => update('defaultServings', Number(e.target.value))} /></div>
        <h3>Ingredients</h3>
        <p className="field-hint">Use a numeric quantity when it can scale. Leave it blank for “to taste” or “as needed”; packages stay unscaled for review.</p>
        {draft.ingredients.map((row, index) => <fieldset key={rowIds[index]} className="recipe-ingredient">
          <legend>Ingredient {index + 1}</legend>
          <div className="field"><label htmlFor={rowIds[index]}>Name</label><input id={rowIds[index]} required maxLength={200} value={row.name} onChange={e => ingredient(index, { name: e.target.value })} /></div>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${rowIds[index]}-quantity`}>Quantity</label><input id={`${rowIds[index]}-quantity`} type="number" min="0" max="1000000" step="any" value={row.quantity ?? ''} onChange={e => ingredient(index, { quantity: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor={`${rowIds[index]}-unit`}>Unit</label><input id={`${rowIds[index]}-unit`} maxLength={50} placeholder="cup, lb, package…" value={row.unit ?? ''} onChange={e => ingredient(index, { unit: e.target.value || null })} /></div>
          </div>
          <div className="field"><label htmlFor={`${rowIds[index]}-preparation`}>Preparation</label><input id={`${rowIds[index]}-preparation`} maxLength={10000} placeholder="Diced, softened…" value={row.preparation ?? ''} onChange={e => ingredient(index, { preparation: e.target.value || null })} /></div>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${rowIds[index]}-qualifier`}>Quantity note</label><input id={`${rowIds[index]}-qualifier`} maxLength={100} placeholder="To taste, as needed…" value={row.qualifier ?? ''} onChange={e => ingredient(index, { qualifier: e.target.value || null })} /></div>
            <div className="field"><label htmlFor={`${rowIds[index]}-category`}>Category</label><input id={`${rowIds[index]}-category`} maxLength={100} placeholder="Produce…" value={row.category ?? ''} onChange={e => ingredient(index, { category: e.target.value || null })} /></div>
          </div>
          <button type="button" className="link-btn" aria-label={`Remove ingredient ${index + 1}${row.name ? `, ${row.name}` : ''}`} onClick={() => { update('ingredients', draft.ingredients.filter((_, i) => i !== index)); setRowIds(ids => ids.filter((_, i) => i !== index)) }}>Remove ingredient</button>
        </fieldset>)}
        <button type="button" className="btn btn-secondary" disabled={draft.ingredients.length >= 300} onClick={() => { update('ingredients', [...draft.ingredients, emptyIngredient()]); setRowIds(ids => [...ids, crypto.randomUUID()]) }}><PlusIcon /> Add ingredient</button>
        <div className="field meal-spaced"><label htmlFor={`${formId}-instructions`}>Instructions</label><textarea id={`${formId}-instructions`} rows={5} maxLength={10000} value={draft.instructions ?? ''} onChange={e => update('instructions', e.target.value || null)} /></div>
        <div className="field"><label htmlFor={`${formId}-notes`}>Preparation notes</label><textarea id={`${formId}-notes`} maxLength={10000} value={draft.preparationNotes ?? ''} onChange={e => update('preparationNotes', e.target.value || null)} /></div>
        <div className="field"><label htmlFor={`${formId}-url`}>Source URL</label><input id={`${formId}-url`} type="url" pattern="https?://.*" maxLength={2000} placeholder="https://…" value={draft.sourceUrl ?? ''} onChange={e => update('sourceUrl', e.target.value || null)} /><p className="field-hint">Saved as a link. Recipe websites are not imported.</p></div>
        {recipe?.sourceUrl && <p><a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">Open recipe source</a></p>}
        {recipe && !recipe.archived && onPlan && <button type="button" className="btn btn-secondary" onClick={() => onPlan(recipe)}>Plan a meal with this recipe</button>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}
