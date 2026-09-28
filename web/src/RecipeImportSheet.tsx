import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { ingredientAmount, recipeTime, urlHost } from './meal-date.ts'
import type { Recipe, RecipePreviewResult } from './meal-types.ts'

/** Import a recipe from a web page (or pasted text): read it, check it, then save. `url` comes
 * from a shared link (#/recipes/import?url=…) and is read right away. Only a parent's device can
 * add recipes; anyone else gets a note. */
export default function RecipeImportSheet({ url: initialUrl = '', admin, onClose, onSaved }: {
  url?: string; admin: boolean; onClose: () => void; onSaved: (recipe: Recipe) => void
}) {
  const { toast } = useApp()
  const id = useId()
  const [mode, setMode] = useState<'url' | 'text'>('url')
  const [url, setUrl] = useState(initialUrl)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<RecipePreviewResult | null>(null)
  const [name, setName] = useState('')
  const [servings, setServings] = useState(4)
  const link = /^https?:\/\//i.test(url.trim()) ? url.trim() : undefined
  // A shared link is read straight away (see the effect below), so the sheet opens busy.
  const [busy, setBusy] = useState(admin && !!link)
  const [error, setError] = useState('')
  const failed = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.')
  const show = (result: RecipePreviewResult) => { setPreview(result); setName(result.recipe.name); setServings(result.recipe.servings ?? 4) }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (e) { failed(e) } finally { setBusy(false) }
  }
  const read = (how: () => Promise<RecipePreviewResult>) => run(async () => show(await how()))
  const getRecipe = () => { if (link) void read(() => api.previewRecipeUrl(link)); else setError('Paste a link that starts with https://') }
  useEffect(() => {
    if (admin && link) api.previewRecipeUrl(link).then(show, failed).finally(() => setBusy(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- only the link the sheet opened with

  const save = () => run(async () => {
    const r = preview!.recipe
    if (!name.trim()) throw new Error('Give the recipe a name.')
    const common = { name: name.trim(), description: r.description, prepMinutes: r.prepMinutes, totalMinutes: r.totalMinutes, steps: r.steps }
    // From a page: keyed by its address, so importing it again updates this recipe.
    const saved = r.sourceUrl
      ? await api.getRecipe((await api.importRecipe({ ...common, source: 'web', externalId: r.sourceUrl, sourceUrl: r.sourceUrl, ...(r.imageUrl && { imageUrl: r.imageUrl }), servings, ingredients: r.ingredients.map(i => i.qualifier !== undefined ? i : i.text) })).recipeId)
      : await api.createRecipe({ ...common, instructions: null, preparationNotes: null, sourceUrl: null, defaultServings: servings, archived: false,
        ingredients: r.ingredients.map(({ name, quantity, unit }, sort) => ({ name, quantity, unit, preparation: null, qualifier: null, category: null, sort })) })
    toast('Recipe saved'); onSaved(saved)
  })

  if (!admin) return <Sheet title="Import a recipe" variant="dialog" onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>OK</button>}>
    <p>Ask a grown-up to import this recipe. Recipes are added from a parent’s phone or computer.</p>
    {initialUrl && <p className="field-hint recipe-import-host">{urlHost(initialUrl)}</p>}
  </Sheet>

  const fallback = mode === 'url'
    ? <button type="button" className="link-btn" onClick={() => { setMode('text'); setError('') }}>Paste the recipe text instead</button>
    : <button type="button" className="link-btn" onClick={() => { setMode('url'); setError('') }}>Use a link instead</button>
  const errorLine = error && <p className="field-error" role="alert">{error}</p>

  const r = preview?.recipe
  const time = r && recipeTime(r)
  // One sheet throughout (link or text, then the preview), so it doesn't slide in again at each stage.
  // Keyed buttons: React must not reuse the Back button as the submit button mid-click (the click
  // would then submit the form and read the recipe again).
  return <Sheet title={r ? 'Check the recipe' : 'Import a recipe'} onClose={onClose} dismissable={!busy} actions={r ? <>
    <button key="back" type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setPreview(null); setError('') }}>Back</button>
    <button key="save" type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save recipe'}</button>
  </> : <button key="read" className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? 'Reading…' : mode === 'url' ? 'Get recipe' : 'Read recipe'}</button>}>
    {r ? <>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} type="text" required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-servings`}>Servings</label><input id={`${id}-servings`} type="number" min="1" max="10000" step="any" value={servings || ''} onChange={e => setServings(Number(e.target.value))} /></div>
      </fieldset>
      {(time || r.sourceUrl) && <p className="recipe-time">{[time && `⏱ ${time}`, r.sourceUrl && urlHost(r.sourceUrl)].filter(Boolean).join(' · ')}</p>}
      {r.description && <p>{r.description}</p>}
      {r.imageUrl && <p className="field-hint">The photo appears after saving.</p>}
      {preview.warnings.length > 0 && <ul className="recipe-import-warnings" role="status">{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <details className="meal-projection-item"><summary>{r.ingredients.length} ingredient{r.ingredients.length === 1 ? '' : 's'}</summary>
        <ul className="meal-ingredients">{r.ingredients.map((i, n) => <li key={n}><strong>{i.name}</strong>{i.quantity !== null && <> — {ingredientAmount(i.quantity, i.unit, null)}</>}</li>)}</ul>
      </details>
      <details className="meal-projection-item"><summary>{r.steps.length} step{r.steps.length === 1 ? '' : 's'}</summary>
        <ol className="recipe-steps">{r.steps.map((s, n) => <li key={n}>{s.title && <strong>{s.title}: </strong>}{s.text || s.bullets.join(' ')}</li>)}</ol>
      </details>
      {errorLine}
    </> : <form id={id} onSubmit={e => { e.preventDefault(); if (mode === 'url') getRecipe(); else if (text.trim()) void read(() => api.previewRecipeText(text, link)); else setError('Paste the recipe first.') }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        {mode === 'url' ? <div className="field">
          <label htmlFor={`${id}-url`}>Recipe link</label>
          <input id={`${id}-url`} type="url" inputMode="url" autoComplete="off" placeholder="https://…" maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} />
          <p className="field-hint">Copy the address of a recipe page. Most recipe websites work.</p>
        </div> : <div className="field">
          <label htmlFor={`${id}-text`}>Recipe text</label>
          <textarea id={`${id}-text`} rows={12} maxLength={100000} value={text} onChange={e => setText(e.target.value)} placeholder={'Grandma’s pancakes\nServes 4\n\nIngredients\n2 cups flour\n1 1/2 cups milk\n\nDirections\n1. Mix.\n2. Cook on a hot griddle.'} />
          <p className="field-hint">Put the name first, then a line that says “Ingredients” with one ingredient per line, then “Directions” with the steps.</p>
        </div>}
      </fieldset>
      {busy && mode === 'url' && <p role="status" className="field-hint">Reading the page…</p>}
      {errorLine}
      <p>{fallback}</p>
    </form>}
  </Sheet>
}
