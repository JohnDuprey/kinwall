import { useEffect, useId, useState } from 'react'
import { api, MOCK } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { CheckIcon, ChevronRight, EditIcon, ExternalIcon, FileIcon, LinkIcon, MinusIcon, PlusIcon } from './icons.tsx'
import { ingredientAmount, isPdfUrl, recipeTime, servingsLabel, urlHost } from './meal-date.ts'
import { KIT_QUALIFIER, type IngredientInput, type Recipe, type RecipeInput, type RecipeKind, type RecipeRating, type RecipeSnapshot, type RecipeStep } from './meal-types.ts'
import { matchBasic } from './recipe-search.ts'
import { inkFor } from './color.ts'
import CookingMode from './CookingMode.tsx'
import { cookingSteps, savedStep } from './cooking.ts'
import RecipeCardSheet from './RecipeCardSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import RecipeShare from './RecipeShare.tsx'
import { holdAwake } from './wakeLock.ts'

const emptyIngredient = (): IngredientInput => ({ name: '', quantity: null, unit: null, preparation: null, qualifier: null, category: null, sort: 0 })

/** "2 ounces", or "As needed"; a meal kit's own ingredient gets a quiet "In the kit" tag instead of trailing words. */
export function IngredientAmount({ quantity, unit, qualifier }: { quantity: number | null; unit: string | null; qualifier: string | null }) {
  const kit = qualifier === KIT_QUALIFIER
  return <>{ingredientAmount(quantity, unit, kit ? null : qualifier) || 'As needed'}{kit && <span className="kit-tag">In the kit</span>}</>
}

/** A recipe's source link as a sheet row: a PDF recipe card opens in the app's viewer (`pdfPath`
 * is the server route that fetches it), anything else opens the site. */
export function SourceLink({ url, pdfPath, title, label = 'Recipe website' }: { url: string; pdfPath: string; title: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const pdf = isPdfUrl(url)
  const text = <span>{pdf ? 'Recipe card (PDF)' : label}<small>{urlHost(url)}</small></span>
  // The demo has no server to fetch a card through: it opens like any other link.
  if (pdf && !MOCK) return <>
    <button type="button" className="sheet-link" onClick={() => setOpen(true)}><FileIcon />{text}<ChevronRight /></button>
    {open && <RecipeCardSheet path={pdfPath} url={url} title={title} onClose={() => setOpen(false)} />}
  </>
  return <a className="sheet-link" href={url} target="_blank" rel="noopener noreferrer">{pdf ? <FileIcon /> : <LinkIcon />}{text}<ExternalIcon /></a>
}

/** A planned meal renders its snapshot here; changing servings never edits the recipe. A line made
 * from a basic opens it (`onBasic`): the name is the link, or with `makeIt` a "Make it" link follows. */
export function IngredientList({ recipe, servings, onBasic, makeIt }: { recipe: RecipeSnapshot; servings: number; onBasic?: (id: string) => void; makeIt?: boolean }) {
  return <ul className="meal-ingredients">
    {recipe.ingredients.map(ingredient => {
      const { scalable, basicId } = ingredient
      const amount = scalable ? ingredient.quantity! * servings / recipe.defaultServings : ingredient.quantity
      const linked = basicId && onBasic ? basicId : null
      return <li key={ingredient.id}>
        {linked && !makeIt ? <button type="button" className="ingredient-basic" aria-label={`${ingredient.name}: open the basic`} onClick={() => onBasic!(linked)}>{ingredient.name}</button> : <strong>{ingredient.name}</strong>} — <IngredientAmount quantity={amount} unit={ingredient.unit} qualifier={ingredient.qualifier} />
        {linked && makeIt && <> <button type="button" className="link-btn" aria-label={`Make ${ingredient.name}`} onClick={() => onBasic!(linked)}>Make it</button></>}
        {ingredient.preparation && <span> · {ingredient.preparation}</span>}
        {!scalable && servings !== recipe.defaultServings && <span className="field-hint"> · Check amount for {servingsLabel(servings)} (recipe: {recipe.defaultServings})</span>}
      </li>
    })}
  </ul>
}

/** Steps saved as "1. …" lines read as a numbered list; anything else as written. */
function Steps({ text }: { text: string }) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  return lines.every(l => /^\d+[.)]\s/.test(l))
    ? <ol className="recipe-steps">{lines.map((l, i) => <li key={i}>{l.replace(/^\d+[.)]\s+/, '')}</li>)}</ol>
    : <p className="meal-prose">{text}</p>
}

/** Structured steps as numbered cards to cook along with: tapping one marks it done (only while this
 * view is open), Reset clears them. A step's photo sits beside it when there's room, above it when not. */
function StepCards({ recipe, steps }: { recipe: Recipe; steps: RecipeStep[] }) {
  const [done, setDone] = useState<ReadonlySet<number>>(new Set())
  const toggle = (i: number) => setDone(d => { const next = new Set(d); if (!next.delete(i)) next.add(i); return next })
  return <>
    <div className="recipe-steps-head"><h3>Steps</h3>{done.size > 0 && <button type="button" className="link-btn" onClick={() => setDone(new Set())}>Reset</button>}</div>
    <ol className="recipe-step-cards">
      {steps.map((step, i) => <li key={i}>
        {/* A div, not a <button>: a step holds a list. Enter and Space toggle it like a button. */}
        <div role="button" tabIndex={0} aria-pressed={done.has(i)} className="recipe-step"
          onClick={() => toggle(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i) } }}>
          <span className="recipe-step-num"><span className="sr-only">Step {i + 1}</span><span aria-hidden="true">{done.has(i) ? <CheckIcon width={18} height={18} /> : i + 1}</span></span>
          {step.imageUrl && <RecipePhoto id={recipe.id} step={{ n: i + 1, v: recipe.updatedAt }} className="recipe-step-photo" />}
          <div className="recipe-step-body">
            {step.title && <h4 className="recipe-step-title">{step.title}</h4>}
            {step.text && <p>{step.text}</p>}
            {step.bullets.length > 0 && <ul>{step.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
          </div>
        </div>
      </li>)}
    </ol>
  </>
}

/** A recipe's family average as small stars, e.g. on a library card. */
export function Stars({ average, count }: { average: number; count: number }) {
  return <span className="recipe-stars" role="img" aria-label={`Rated ${average} out of 5 by ${count}`}>
    <span aria-hidden="true">{[1, 2, 3, 4, 5].map(n => <span key={n} className={n <= Math.round(average) ? 'on' : ''}>★</span>)}</span> {average} ({count})
  </span>
}

/** Collapsed to the family average; open it for each member's stars, tappable (tap the same star again to clear). A member's own device rates only for them. */
function Ratings({ recipe, owner, onRated }: { recipe: Recipe; owner?: string | null; onRated?: () => void }) {
  const { members, toast } = useApp()
  const [rating, setRating] = useState<RecipeRating>(recipe.rating ?? { average: null, count: 0, byMember: {} })
  const [busy, setBusy] = useState('')
  if (!members.length) return null
  const rate = async (memberId: string, stars: number | null) => {
    setBusy(memberId)
    try { const saved = await api.rateRecipe(recipe.id, memberId, stars); if (saved.rating) setRating(saved.rating); onRated?.() }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not save the rating.', true) }
    finally { setBusy('') }
  }
  return <details className="settings-disclosure recipe-ratings-box">
    <summary>{rating.average !== null ? `★ ${rating.average} · ${rating.count} rating${rating.count === 1 ? '' : 's'}` : 'Rate this recipe'}</summary>
    <ul className="recipe-ratings">{members.map(m => {
      const mine = rating.byMember[m.id] ?? 0
      const locked = !!owner && owner !== 'shared' && owner !== m.id
      return <li key={m.id}>
        <span className="recipe-rating-who"><span className="member-avatar-sm" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>{m.name}</span>
        <span className="recipe-rating-stars" role="group" aria-label={`${m.name}'s rating`}>{[1, 2, 3, 4, 5].map(n =>
          <button key={n} type="button" className={n <= mine ? 'on' : ''} aria-pressed={n === mine} aria-label={`${n} star${n === 1 ? '' : 's'}`} disabled={locked || busy === m.id} onClick={() => void rate(m.id, n === mine ? null : n)}>★</button>)}
        </span>
      </li>
    })}</ul>
  </details>
}

/** Tapping a recipe opens this view; admins get Edit, which swaps in the editor (back to the view on close).
 * `library` is every recipe: where linked basics are found. */
export default function RecipeSheet({ recipe, library = [], admin, owner, onClose, onSaved, onPlan, onRated, onEditMeal }: {
  recipe: Recipe | null; library?: Recipe[]; admin: boolean; owner?: string | null; onClose: () => void; onSaved: () => void; onPlan?: (recipe: Recipe) => void; onRated?: () => void
  /** Opened from a planned meal: a button back to that meal's details. */
  onEditMeal?: { label: string; open: () => void }
}) {
  const [editing, setEditing] = useState(!recipe)
  // Reading a recipe while cooking: keep the screen on until it's closed (not while editing).
  const reading = !editing && !!recipe
  useEffect(() => { holdAwake('cooking', reading); return () => holdAwake('cooking', false) }, [reading])
  const [servings, setServings] = useState(recipe?.defaultServings ?? 4)
  const [cooking, setCooking] = useState(false)
  // A linked basic, opened over this recipe; closing it comes back here.
  const [basic, setBasic] = useState<Recipe | null>(null)
  if (editing || !recipe) return <RecipeEditor recipe={recipe} library={library} onClose={recipe ? () => setEditing(false) : onClose} onSaved={onSaved} />
  if (basic) return <RecipeSheet key={basic.id} recipe={basic} library={library} admin={admin} owner={owner} onClose={() => setBasic(null)} onSaved={onSaved} onRated={onRated}
    onEditMeal={{ label: `Back to ${recipe.name}`, open: () => setBasic(null) }} />
  const openBasic = (id: string) => { const found = library.find(r => r.id === id); if (found) setBasic(found) }
  const isBasic = recipe.kind === 'basic'
  const time = recipeTime(recipe)
  const step = (by: number) => setServings(n => Math.max(1, Math.round(n) + by))
  const cookSteps = cookingSteps(recipe), resumeAt = savedStep(recipe.id)
  return <><Sheet title={recipe.name} onClose={onClose} actions={admin || onEditMeal || (onPlan && !recipe.archived) ? <>
    {onEditMeal && <button className="btn btn-secondary" onClick={onEditMeal.open}><EditIcon width={20} height={20} /> {onEditMeal.label}</button>}
    {admin && <button className="btn btn-secondary" onClick={() => setEditing(true)}><EditIcon width={20} height={20} /> Edit</button>}
    {onPlan && !recipe.archived && <button className="btn btn-primary" onClick={() => onPlan(recipe)}>Plan this meal</button>}
  </> : undefined}>
    {recipe.imageUrl && <RecipePhoto id={recipe.id} className="recipe-hero" alt={recipe.name} />}
    {recipe.description && <p>{recipe.description}</p>}
    {(time || recipe.archived || isBasic || recipe.makes) && <p className="recipe-time">{isBasic && <span className="kit-tag recipe-kind-tag">Basic</span>}{[recipe.makes && `Makes ${recipe.makes}`, time && `⏱ ${time}`, recipe.archived && 'Archived'].filter(Boolean).join(' · ')}</p>}
    {cookSteps.length > 0 && <button type="button" className="btn btn-primary cook-start" onClick={() => setCooking(true)}>
      🍳 {resumeAt > 0 && resumeAt < cookSteps.length ? `Resume cooking · step ${resumeAt + 1}` : 'Start cooking'}
    </button>}
    <Ratings key={recipe.id} recipe={recipe} owner={owner} onRated={onRated} />
    <div className="recipe-servings">
      <h3>Ingredients</h3>
      {/* A basic is made as written: how much it makes, not servings. */}
      {!isBasic && <div className="recipe-stepper" role="group" aria-label="Servings">
        <button type="button" className="icon-btn" aria-label="Fewer servings" disabled={servings <= 1} onClick={() => step(-1)}><MinusIcon width={20} height={20} /></button>
        <span aria-live="polite">{servingsLabel(servings)}</span>
        <button type="button" className="icon-btn" aria-label="More servings" disabled={servings >= 100} onClick={() => step(1)}><PlusIcon width={20} height={20} /></button>
      </div>}
    </div>
    <IngredientList recipe={recipe} servings={servings} onBasic={openBasic} />
    {recipe.steps?.length ? <StepCards key={recipe.id} recipe={recipe} steps={recipe.steps} />
      : recipe.instructions && <><h3>Steps</h3><Steps text={recipe.instructions} /></>}
    {recipe.preparationNotes && <><h3>Preparation notes</h3><p className="meal-prose">{recipe.preparationNotes}</p></>}
    {recipe.sourceUrl && <div className="sheet-links"><SourceLink url={recipe.sourceUrl} pdfPath={`api/recipes/${encodeURIComponent(recipe.id)}/source.pdf`} title={recipe.name} /></div>}
    {admin && <RecipeShare key={recipe.id} recipe={recipe} />}
  </Sheet>
  {cooking && <CookingMode recipe={recipe} steps={cookSteps} servings={servings} library={library} onClose={() => setCooking(false)} />}
  </>
}

function RecipeEditor({ recipe, library, onClose, onSaved }: { recipe: Recipe | null; library: Recipe[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const formId = useId()
  const [draft, setDraft] = useState<RecipeInput>(() => ({
    name: recipe?.name ?? '', description: recipe?.description ?? null, defaultServings: recipe?.defaultServings ?? 4,
    instructions: recipe?.instructions ?? null, steps: recipe?.steps ?? null, preparationNotes: recipe?.preparationNotes ?? null,
    sourceUrl: recipe?.sourceUrl ?? null, imageUrl: recipe?.imageUrl ?? null, prepMinutes: recipe?.prepMinutes ?? null, totalMinutes: recipe?.totalMinutes ?? null, archived: recipe?.archived ?? false,
    kind: recipe?.kind ?? 'meal', makes: recipe?.makes ?? null,
    ingredients: recipe?.ingredients.map(({ name, quantity, unit, preparation, qualifier, category, sort, basicId }) => ({ name, quantity, unit, preparation, qualifier, category, sort, basicId: basicId ?? null })) ?? [],
  }))
  // Basics an ingredient can be made from: every other active basic (a linked one stays listed).
  const basics = library.filter(r => r.kind === 'basic' && r.id !== recipe?.id && (!r.archived || draft.ingredients.some(i => i.basicId === r.id))).sort((a, b) => a.name.localeCompare(b.name))
  // Row ids survive removal/reordering so keyboard focus stays on the ingredient being edited.
  const [rowIds, setRowIds] = useState(() => draft.ingredients.map(() => crypto.randomUUID()))
  const [stepIds, setStepIds] = useState(() => (draft.steps ?? []).map(() => crypto.randomUUID()))
  const steps = draft.steps
  const stepRow = (index: number, patch: Partial<RecipeStep>) => update('steps', steps!.map((row, i) => i === index ? { ...row, ...patch } : row))
  const moveStep = (index: number, by: number) => {
    const swap = <T,>(list: T[]) => { const next = [...list]; [next[index], next[index + by]] = [next[index + by], next[index]]; return next }
    update('steps', swap(steps!)); setStepIds(swap)
  }
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
    // Structured steps are the source: the server writes instructions from them.
    const body = { ...draft, ...(draft.steps && { instructions: null }), name: draft.name.trim(), ingredients: draft.ingredients.map((row, sort) => ({ ...row, name: row.name.trim(), sort })) }
    if (!body.name || body.ingredients.some(row => !row.name)) { setError('Give the recipe and each ingredient a name.'); return }
    void run(() => recipe ? api.updateRecipe(recipe.id, body) : api.createRecipe(body), 'Recipe saved')
  }
  const remove = async () => {
    if (!recipe || !await dialog.confirm({ title: `Delete “${recipe.name}”?`, body: 'This removes the recipe from the library. Existing meals keep their saved ingredients.', confirmLabel: 'Delete recipe', danger: true })) return
    void run(() => api.deleteRecipe(recipe.id), 'Recipe deleted')
  }
  const close = () => { if (!busy) onClose() }
  return <Sheet title={recipe ? 'Edit recipe' : 'New recipe'} onClose={close} dismissable={!busy} actions={<>
    {recipe && <select className="settings-select actions-select" aria-label="Recipe actions" value="" disabled={busy} onChange={e => {
      if (e.target.value === 'archive') void run(() => api.updateRecipe(recipe.id, { archived: !recipe.archived }), recipe.archived ? 'Recipe restored' : 'Recipe archived')
      if (e.target.value === 'delete') void remove()
    }}>
      <option value="" disabled hidden>More…</option>
      <option value="archive">{recipe.archived ? 'Restore recipe' : 'Archive recipe'}</option>
      <option value="delete">Delete recipe…</option>
    </select>}
    <button className="btn btn-primary" type="submit" form={formId} disabled={busy}>{busy ? 'Saving…' : 'Save recipe'}</button>
  </>}>
    <form id={formId} onSubmit={e => { e.preventDefault(); save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-name`}>Name</label><input type="text" id={`${formId}-name`} required maxLength={200} value={draft.name} onChange={e => update('name', e.target.value)} /></div>
        <div className="field"><label htmlFor={`${formId}-kind`}>Type</label><select id={`${formId}-kind`} value={draft.kind} onChange={e => update('kind', e.target.value as RecipeKind)}><option value="meal">Meal</option><option value="basic">Basic</option></select>
          {draft.kind === 'basic' && <p className="field-hint">Something you make to use in other recipes, like a seasoning blend, sauce or dough. Basics stay out of meal planning unless you ask for them.</p>}</div>
        <div className="field"><label htmlFor={`${formId}-description`}>Description</label><textarea id={`${formId}-description`} maxLength={10000} value={draft.description ?? ''} onChange={e => update('description', e.target.value || null)} /></div>
        {recipe?.imageUrl && draft.imageUrl && <div className="field"><span className="recipe-photo-label">Photo</span><RecipePhoto id={recipe.id} className="recipe-hero" /><button type="button" className="link-btn" onClick={() => update('imageUrl', null)}>Remove photo</button></div>}
        {draft.kind === 'basic'
          ? <div className="field"><label htmlFor={`${formId}-makes`}>Makes</label><input id={`${formId}-makes`} type="text" maxLength={200} placeholder="About ½ cup, 2 crusts…" value={draft.makes ?? ''} onChange={e => update('makes', e.target.value || null)} /></div>
          : <div className="field"><label htmlFor={`${formId}-servings`}>Default servings</label><input id={`${formId}-servings`} type="number" required min="0.01" max="10000" step="any" value={draft.defaultServings || ''} onChange={e => update('defaultServings', Number(e.target.value))} /></div>}
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${formId}-total`}>Total time (min)</label><input id={`${formId}-total`} type="number" inputMode="numeric" min="0" max="10000" step="1" value={draft.totalMinutes ?? ''} onChange={e => update('totalMinutes', e.target.value === '' ? null : Number(e.target.value))} /></div>
          <div className="field"><label htmlFor={`${formId}-prep`}>Prep time (min)</label><input id={`${formId}-prep`} type="number" inputMode="numeric" min="0" max="10000" step="1" value={draft.prepMinutes ?? ''} onChange={e => update('prepMinutes', e.target.value === '' ? null : Number(e.target.value))} /></div>
        </div>
        <h3>Ingredients</h3>
        <p className="field-hint">Use a numeric quantity when it can scale. Leave it blank for “to taste” or “as needed”; packages stay unscaled for review.</p>
        {draft.ingredients.map((row, index) => {
          const match = !row.basicId && row.name.trim() ? matchBasic(row.name, basics.filter(b => !b.archived)) : null
          return <fieldset key={rowIds[index]} className="recipe-ingredient">
          <legend>Ingredient {index + 1}</legend>
          <div className="field"><label htmlFor={rowIds[index]}>Name</label><input type="text" id={rowIds[index]} required maxLength={200} value={row.name} onChange={e => ingredient(index, { name: e.target.value })} />
            {match && <button type="button" className="link-btn" onClick={() => ingredient(index, { basicId: match.id })}>Link to basic: {match.name}</button>}</div>
          {basics.length > 0 && <div className="field"><label htmlFor={`${rowIds[index]}-basic`}>Made from a basic</label><select id={`${rowIds[index]}-basic`} value={row.basicId ?? ''} onChange={e => ingredient(index, { basicId: e.target.value || null })}>
            <option value="">Not linked</option>{basics.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></div>}
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${rowIds[index]}-quantity`}>Quantity</label><input id={`${rowIds[index]}-quantity`} type="number" min="0" max="1000000" step="any" value={row.quantity ?? ''} onChange={e => ingredient(index, { quantity: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor={`${rowIds[index]}-unit`}>Unit</label><input type="text" id={`${rowIds[index]}-unit`} maxLength={50} placeholder="cup, lb, package…" value={row.unit ?? ''} onChange={e => ingredient(index, { unit: e.target.value || null })} /></div>
          </div>
          <div className="field"><label htmlFor={`${rowIds[index]}-preparation`}>Preparation</label><input type="text" id={`${rowIds[index]}-preparation`} maxLength={10000} placeholder="Diced, softened…" value={row.preparation ?? ''} onChange={e => ingredient(index, { preparation: e.target.value || null })} /></div>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${rowIds[index]}-qualifier`}>Quantity note</label><input type="text" id={`${rowIds[index]}-qualifier`} maxLength={100} placeholder="To taste, as needed…" value={row.qualifier ?? ''} onChange={e => ingredient(index, { qualifier: e.target.value || null })} /></div>
            <div className="field"><label htmlFor={`${rowIds[index]}-category`}>Category</label><input type="text" id={`${rowIds[index]}-category`} maxLength={100} placeholder="Produce…" value={row.category ?? ''} onChange={e => ingredient(index, { category: e.target.value || null })} /></div>
          </div>
          <button type="button" className="link-btn" aria-label={`Remove ingredient ${index + 1}${row.name ? `, ${row.name}` : ''}`} onClick={() => { update('ingredients', draft.ingredients.filter((_, i) => i !== index)); setRowIds(ids => ids.filter((_, i) => i !== index)) }}>Remove ingredient</button>
        </fieldset>})}
        <button type="button" className="btn btn-secondary" disabled={draft.ingredients.length >= 300} onClick={() => { update('ingredients', [...draft.ingredients, emptyIngredient()]); setRowIds(ids => [...ids, crypto.randomUUID()]) }}><PlusIcon /> Add ingredient</button>
        {steps ? <>
          <h3 className="meal-spaced">Steps</h3>
          {steps.map((row, index) => <fieldset key={stepIds[index]} className="recipe-ingredient">
            <legend>Step {index + 1}</legend>
            <div className="field"><label htmlFor={stepIds[index]}>Step</label><textarea id={stepIds[index]} rows={2} maxLength={10000} value={row.text} onChange={e => stepRow(index, { text: e.target.value })} /></div>
            <div className="field"><label htmlFor={`${stepIds[index]}-bullets`}>Bullets</label><textarea id={`${stepIds[index]}-bullets`} rows={Math.max(3, row.bullets.length + 1)} value={row.bullets.join('\n')} onChange={e => stepRow(index, { bullets: e.target.value.split('\n') })} /><p className="field-hint">One per line.</p></div>
            {row.imageUrl && <p className="field-hint">Has a photo. <button type="button" className="link-btn" aria-label={`Remove step ${index + 1} photo`} onClick={() => stepRow(index, { imageUrl: null })}>Remove photo</button></p>}
            <div className="recipe-step-actions">
              <button type="button" className="link-btn" aria-label={`Move step ${index + 1} up`} disabled={index === 0} onClick={() => moveStep(index, -1)}>Move up</button>
              <button type="button" className="link-btn" aria-label={`Move step ${index + 1} down`} disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>Move down</button>
              <button type="button" className="link-btn" aria-label={`Remove step ${index + 1}`} onClick={() => { update('steps', steps.filter((_, i) => i !== index)); setStepIds(ids => ids.filter((_, i) => i !== index)) }}>Remove step</button>
            </div>
          </fieldset>)}
          <button type="button" className="btn btn-secondary" disabled={steps.length >= 100} onClick={() => { update('steps', [...steps, { text: '', bullets: [], imageUrl: null }]); setStepIds(ids => [...ids, crypto.randomUUID()]) }}><PlusIcon /> Add step</button>
        </> : <div className="field meal-spaced"><label htmlFor={`${formId}-instructions`}>Instructions</label><textarea id={`${formId}-instructions`} rows={5} maxLength={10000} value={draft.instructions ?? ''} onChange={e => update('instructions', e.target.value || null)} /></div>}
        <div className="field"><label htmlFor={`${formId}-notes`}>Preparation notes</label><textarea id={`${formId}-notes`} maxLength={10000} value={draft.preparationNotes ?? ''} onChange={e => update('preparationNotes', e.target.value || null)} /></div>
        <div className="field"><label htmlFor={`${formId}-url`}>Source URL</label><input id={`${formId}-url`} type="url" pattern="https?://.*" maxLength={2000} placeholder="https://…" value={draft.sourceUrl ?? ''} onChange={e => update('sourceUrl', e.target.value || null)} /><p className="field-hint">Saved as a link. To read a recipe off its website, use Import from a link in the recipe library.</p></div>
        {recipe?.sourceUrl && <div className="sheet-links"><SourceLink url={recipe.sourceUrl} pdfPath={`api/recipes/${encodeURIComponent(recipe.id)}/source.pdf`} title={recipe.name} /></div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}
