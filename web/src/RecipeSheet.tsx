import { useEffect, useId, useState, type ReactNode } from 'react'
import { useHashParam } from './hashQuery.ts'
import { api, MOCK } from './api.ts'
import { useApp } from './AppContext.tsx'
import { actingMember } from './actingAs.ts'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { BookIcon, CheckIcon, ChevronLeft, ChevronRight, EditIcon, ExternalIcon, FileIcon, LinkIcon, MinusIcon, PlusIcon } from './icons.tsx'
import { ingredientAmount, isPdfUrl, recipeTime, servingsLabel, urlHost } from './meal-date.ts'
import { KIT_QUALIFIER, type IngredientInput, type Recipe, type RecipeInput, type RecipeKind, type RecipeRating, type RecipeSnapshot, type RecipeStep } from './meal-types.ts'
import { matchBasic } from './recipe-search.ts'
import CookingMode from './CookingMode.tsx'
import { cookingSteps, savedStep } from './cooking.ts'
import RecipeCardSheet from './RecipeCardSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import PickField, { type PickOption } from './PickField.tsx'
import RecipeShare from './RecipeShare.tsx'
import { holdAwake } from './wakeLock.ts'
import { Face } from './Face'
import { t, tn } from './i18n.ts'

const emptyIngredient = (): IngredientInput => ({ name: '', quantity: null, unit: null, preparation: null, qualifier: null, category: null, sort: 0 })

/** "2 ounces", or "As needed"; a meal kit's own ingredient gets a quiet "In the kit" tag instead of trailing words. */
export function IngredientAmount({ quantity, unit, qualifier }: { quantity: number | null; unit: string | null; qualifier: string | null }) {
  const kit = qualifier === KIT_QUALIFIER
  return <>{ingredientAmount(quantity, unit, kit ? null : qualifier) || t('As needed')}{kit && <span className="kit-tag">{t('In the kit')}</span>}</>
}

/** A recipe's source link as a sheet row: a PDF recipe card opens in the app's viewer (`pdfPath`
 * is the server route that fetches it), anything else opens the site. */
export function SourceLink({ url, pdfPath, title, label }: { url: string; pdfPath: string; title: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const pdf = isPdfUrl(url)
  const text = <span>{pdf ? t('Recipe card (PDF)') : label ?? t('Recipe website')}<small>{urlHost(url)}</small></span>
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
        {linked && !makeIt ? <button type="button" className="ingredient-basic" aria-label={t('{name}: open the basic', { name: ingredient.name })} onClick={() => onBasic!(linked)}>{ingredient.name}</button> : <strong>{ingredient.name}</strong>} — <IngredientAmount quantity={amount} unit={ingredient.unit} qualifier={ingredient.qualifier} />
        {linked && makeIt && <> <button type="button" className="link-btn" aria-label={t('Make {name}', { name: ingredient.name })} onClick={() => onBasic!(linked)}>{t('Make it')}</button></>}
        {ingredient.preparation && <span> · {ingredient.preparation}</span>}
        {!scalable && servings !== recipe.defaultServings && <span className="field-hint"> · {t('Check amount for {servings} (recipe: {n})', { servings: servingsLabel(servings), n: recipe.defaultServings })}</span>}
      </li>
    })}
  </ul>
}

/** The steps (structured, or typed ones split the way cooking mode splits them) as numbered cards to cook along with: tapping one marks it done (only while this
 * view is open), Reset clears them. A step's photo sits beside it when there's room, above it when not. */
function StepCards({ recipe, steps }: { recipe: Recipe; steps: RecipeStep[] }) {
  const [done, setDone] = useState<ReadonlySet<number>>(new Set())
  const toggle = (i: number) => setDone(d => { const next = new Set(d); if (!next.delete(i)) next.add(i); return next })
  return <>
    <div className="recipe-steps-head"><h3>{t('Steps')}</h3>{done.size > 0 && <button type="button" className="link-btn" onClick={() => setDone(new Set())}>{t('Reset')}</button>}</div>
    <ol className="recipe-step-cards">
      {steps.map((step, i) => <li key={i}>
        {/* A div, not a <button>: a step holds a list. Enter and Space toggle it like a button. */}
        <div role="button" tabIndex={0} aria-pressed={done.has(i)} className="recipe-step"
          onClick={() => toggle(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(i) } }}>
          <span className="recipe-step-num"><span className="sr-only">{t('Step {n}', { n: i + 1 })}</span><span aria-hidden="true">{done.has(i) ? <CheckIcon width={18} height={18} /> : i + 1}</span></span>
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
  return <span className="recipe-stars" role="img" aria-label={t('Rated {average} out of 5 by {count}', { average, count })}>
    <span aria-hidden="true">{[1, 2, 3, 4, 5].map(n => <span key={n} className={n <= Math.round(average) ? 'on' : ''}>★</span>)}</span> {average} ({count})
  </span>
}

/** Whose stars this device may set, for RecipeSheet's owner: a kid's own device or a wall screen set to one
 * person rates only for them (the server's ownerBlock); a grown-up's own phone rates for anyone. */
export const ratingOwner = (me: { scope: string; owner?: string | null } | null | undefined) => me?.scope === 'display' ? me.owner ?? null : null

/** Collapsed to the family average (open on a kid's own device, their row first); open it for each member's stars, tappable (tap the same star again to clear), and a heart to mark it their favorite. A member's own device rates only for them. */
function Ratings({ recipe, owner, onRated }: { recipe: Recipe; owner?: string | null; onRated?: () => void }) {
  const { members, toast, actingMemberId, meMemberId } = useApp()
  const [rating, setRating] = useState<RecipeRating>(recipe.rating ?? { average: null, count: 0, byMember: {} })
  const [loved, setLoved] = useState(recipe.favoritedBy ?? [])
  const [busy, setBusy] = useState('')
  if (!members.length) return null
  const rate = async (memberId: string, stars: number | null) => {
    setBusy(memberId)
    try { const saved = await api.rateRecipe(recipe.id, memberId, stars); if (saved.rating) setRating(saved.rating); onRated?.() }
    catch (e) { toast(e instanceof Error ? e.message : t('Could not save the rating.'), true) }
    finally { setBusy('') }
  }
  const love = async (memberId: string, favorite: boolean) => {
    setBusy(memberId)
    try { const saved = await api.favoriteRecipe(recipe.id, memberId, favorite); setLoved(saved.favoritedBy ?? []); onRated?.() }
    catch (e) { toast(e instanceof Error ? e.message : t('Could not save the favorite.'), true) }
    finally { setBusy('') }
  }
  // A kid's own device: rating dinner is the main thing they do here, so the stars start open with their row first.
  const kid = !!owner && owner !== 'shared'
  // A wall with someone picked in its header opens the same way, their row first.
  const first = kid ? owner : actingMember(actingMemberId, members)?.id
  const people = first ? [...members].sort((a, b) => Number(b.id === first) - Number(a.id === first)) : members
  // Whoever this device is (a kid's own, a grown-up's own phone, or who's picked on the wall) hearts it in one tap, without opening the list.
  const quick = members.find(m => m.id === (first ?? meMemberId)), quickOn = !!quick && loved.includes(quick.id)
  return <div className="recipe-ratings-wrap">
  {quick && <button type="button" className={`recipe-heart recipe-quick-heart${quickOn ? ' on' : ''}`} aria-pressed={quickOn} aria-label={t("{name}'s favorite", { name: quick.name })} disabled={busy === quick.id} onClick={() => void love(quick.id, !quickOn)}>{quickOn ? '♥' : '♡'}</button>}
  <details className="settings-disclosure recipe-ratings-box" open={!!first || undefined}>
    <summary>{kid ? t('How did you like it?') : rating.average !== null ? `★ ${rating.average} · ${tn(rating.count, '{n} rating', '{n} ratings')}` : t('Rate this recipe')}{!kid && loved.length > 0 && ` · ♥ ${tn(loved.length, '{n} favorite', '{n} favorites')}`}</summary>
    <ul className="recipe-ratings">{people.map(m => {
      const mine = rating.byMember[m.id] ?? 0, hearted = loved.includes(m.id)
      const locked = !!owner && owner !== 'shared' && owner !== m.id
      return <li key={m.id}>
        <span className="recipe-rating-who"><Face m={m} className="member-avatar-sm" aria-hidden="true" />{m.name}</span>
        <span className="recipe-rating-stars" role="group" aria-label={t("{name}'s rating", { name: m.name })}>{[1, 2, 3, 4, 5].map(n =>
          <button key={n} type="button" className={n <= mine ? 'on' : ''} aria-pressed={n === mine} aria-label={tn(n, '{n} star', '{n} stars')} disabled={locked || busy === m.id} onClick={() => void rate(m.id, n === mine ? null : n)}>★</button>)}
          <button type="button" className={`recipe-heart${hearted ? ' on' : ''}`} aria-pressed={hearted} aria-label={t("{name}'s favorite", { name: m.name })} disabled={locked || busy === m.id} onClick={() => void love(m.id, !hearted)}>{hearted ? '♥' : '♡'}</button>
        </span>
      </li>
    })}</ul>
  </details>
  </div>
}

/** Tapping a recipe opens this view; admins get Edit, which swaps in the editor (back to the view on close).
 * `library` is every recipe: where linked basics are found. */
export default function RecipeSheet({ recipe, library = [], admin, owner, onClose, onSaved, onPlan, onRated, onEditMeal, meal }: {
  recipe: Recipe | null; library?: Recipe[]; admin: boolean; owner?: string | null; onClose: () => void; onSaved: () => void; onPlan?: (recipe: Recipe) => void; onRated?: () => void
  /** Opened from a planned meal: that meal's when, who and status first (MealQuickSheet's MealStrip). */
  meal?: ReactNode
  /** Opened from a planned meal: a button back to that meal's details. */
  onEditMeal?: { label: string; open: () => void; back?: boolean }
}) {
  const [editing, setEditing] = useState(!recipe)
  // Reading a recipe while cooking: keep the screen on until it's closed (not while editing).
  const reading = !editing && !!recipe
  useEffect(() => { holdAwake('cooking', reading); return () => holdAwake('cooking', false) }, [reading])
  const [servings, setServings] = useState(recipe?.defaultServings ?? 4)
  // Cooking mode, in the link (#/meals?cook=<id>) so a reload reopens it; its step is saved on its own (savedStep).
  const [cook, setCook] = useHashParam('cook')
  const cooking = !!recipe && cook === recipe.id
  // A linked basic, opened over this recipe; closing it comes back here.
  const [basic, setBasic] = useState<Recipe | null>(null)
  if (editing || !recipe) return <RecipeEditor recipe={recipe} library={library} onClose={recipe ? () => setEditing(false) : onClose} onSaved={onSaved} />
  if (basic) return <RecipeSheet key={basic.id} recipe={basic} library={library} admin={admin} owner={owner} onClose={() => setBasic(null)} onSaved={onSaved} onRated={onRated}
    onEditMeal={{ label: t('Back to {name}', { name: recipe.name }), open: () => setBasic(null), back: true }} />
  const openBasic = (id: string) => { const found = library.find(r => r.id === id); if (found) setBasic(found) }
  const isBasic = recipe.kind === 'basic'
  const time = recipeTime(recipe)
  const step = (by: number) => setServings(n => Math.max(1, Math.round(n) + by))
  const cookSteps = cookingSteps(recipe), resumeAt = savedStep(recipe.id)
  return <><Sheet title={recipe.name} onClose={onClose} actions={admin || onEditMeal || (onPlan && !recipe.archived) ? <>
    {onEditMeal && <button className="btn btn-secondary" onClick={onEditMeal.open}>{onEditMeal.back ? <ChevronLeft width={20} height={20} /> : <EditIcon width={20} height={20} />} {onEditMeal.label}</button>}
    {admin && <button className="btn btn-secondary" onClick={() => setEditing(true)}><EditIcon width={20} height={20} /> {t('Edit')}</button>}
    {onPlan && !recipe.archived && <button className="btn btn-primary" onClick={() => onPlan(recipe)}>{t('Plan this meal')}</button>}
  </> : undefined}>
    {meal}
    {recipe.imageUrl && <RecipePhoto id={recipe.id} className="recipe-hero" alt={recipe.name} />}
    {recipe.description && <p>{recipe.description}</p>}
    {(time || recipe.archived || isBasic || recipe.makes) && <p className="recipe-time">{isBasic && <span className="kit-tag recipe-kind-tag">{t('Basic')}</span>}{[recipe.makes && t('Makes {amount}', { amount: recipe.makes }), time && `⏱ ${time}`, recipe.archived && t('Archived')].filter(Boolean).join(' · ')}</p>}
    {cookSteps.length > 0 && <button type="button" className="btn btn-primary cook-start" onClick={() => setCook(recipe.id)}>
      🍳 {resumeAt > 0 && resumeAt < cookSteps.length ? t('Resume cooking · step {n}', { n: resumeAt + 1 }) : t('Start cooking')}
    </button>}
    <Ratings key={`rating:${recipe.id}`} recipe={recipe} owner={owner} onRated={onRated} />
    <div className="recipe-servings">
      <h3>{t('Ingredients')}</h3>
      {/* A basic is made as written: how much it makes, not servings. */}
      {!isBasic && <div className="recipe-stepper" role="group" aria-label={t('Servings')}>
        <button type="button" className="icon-btn" aria-label={t('Fewer servings')} disabled={servings <= 1} onClick={() => step(-1)}><MinusIcon width={20} height={20} /></button>
        <span aria-live="polite">{servingsLabel(servings)}</span>
        <button type="button" className="icon-btn" aria-label={t('More servings')} disabled={servings >= 100} onClick={() => step(1)}><PlusIcon width={20} height={20} /></button>
      </div>}
    </div>
    <IngredientList recipe={recipe} servings={servings} onBasic={openBasic} />
    {cookSteps.length > 0 && <StepCards key={`steps:${recipe.id}`} recipe={recipe} steps={cookSteps} />}
    {recipe.preparationNotes && <><h3>{t('Preparation notes')}</h3><p className="meal-prose">{recipe.preparationNotes}</p></>}
    {recipe.sourceUrl && <div className="sheet-links"><SourceLink url={recipe.sourceUrl} pdfPath={`api/recipes/${encodeURIComponent(recipe.id)}/source.pdf`} title={recipe.name} /></div>}
    {admin && <RecipeShare key={`share:${recipe.id}`} recipe={recipe} />}
  </Sheet>
  {cooking && <CookingMode recipe={recipe} steps={cookSteps} servings={servings} library={library} onClose={() => setCook(null)} />}
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
  // The "Made from a basic" picker's rows, like the meal sheet's recipe picker (photo or book, then name).
  const basicOptions: PickOption[] = [{ value: '', label: t('Not from a basic') }, ...basics.map(b => ({ value: b.id, label: b.name + (b.archived ? ` ${t('(archived)')}` : ''),
    detail: b.makes ? t('Makes {amount}', { amount: b.makes }) : undefined, lead: b.imageUrl ? <RecipePhoto id={b.id} className="recipe-pick-thumb" /> : <BookIcon /> }))]
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
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save recipe.')) }
    finally { setBusy(false) }
  }
  const save = () => {
    // Structured steps are the source: the server writes instructions from them.
    const body = { ...draft, ...(draft.steps && { instructions: null }), name: draft.name.trim(), ingredients: draft.ingredients.map((row, sort) => ({ ...row, name: row.name.trim(), sort })) }
    if (!body.name || body.ingredients.some(row => !row.name)) { setError(t('Give the recipe and each ingredient a name.')); return }
    void run(() => recipe ? api.updateRecipe(recipe.id, body) : api.createRecipe(body), t('Recipe saved'))
  }
  const remove = async () => {
    if (!recipe || !await dialog.confirm({ title: t('Delete “{title}”?', { title: recipe.name }), body: t('This removes the recipe from the library. Existing meals keep their saved ingredients.'), confirmLabel: t('Delete recipe'), danger: true })) return
    void run(() => api.deleteRecipe(recipe.id), t('Recipe deleted'))
  }
  // Once, for a basic added after the recipes that use it: their lines that name it (and aren't linked) link to it.
  const linkUses = async () => {
    if (!recipe) return
    setBusy(true); setError('')
    try { const { linked } = await api.linkBasicUses(recipe.id); toast(linked ? tn(linked, 'Linked {n} ingredient to {name}', 'Linked {n} ingredients to {name}', { name: recipe.name }) : t('No other recipes name {name}', { name: recipe.name })); if (linked) onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not link recipes.')) }
    finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  return <Sheet title={recipe ? t('Edit recipe') : t('New recipe')} onClose={close} dismissable={!busy} dirty="auto" actions={<>
    {recipe && <select className="settings-select actions-select" aria-label={t('Recipe actions')} value="" disabled={busy} onChange={e => {
      if (e.target.value === 'archive') void run(() => api.updateRecipe(recipe.id, { archived: !recipe.archived }), recipe.archived ? t('Recipe restored') : t('Recipe archived'))
      if (e.target.value === 'delete') void remove()
      if (e.target.value === 'link-uses') void linkUses()
    }}>
      <option value="" disabled hidden>{t('More…')}</option>
      {recipe.kind === 'basic' && <option value="link-uses">{t('Link to recipes that use it')}</option>}
      <option value="archive">{recipe.archived ? t('Restore recipe') : t('Archive recipe')}</option>
      <option value="delete">{t('Delete recipe…')}</option>
    </select>}
    <button className="btn btn-primary" type="submit" form={formId} disabled={busy}>{busy ? t('Saving…') : recipe ? t('Save') : t('Add recipe')}</button>
  </>}>
    <form id={formId} onSubmit={e => { e.preventDefault(); save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-name`}>{t('Name')}</label><input type="text" id={`${formId}-name`} required maxLength={200} value={draft.name} onChange={e => update('name', e.target.value)} /></div>
        <div className="field"><label htmlFor={`${formId}-kind`}>{t('Type')}</label><select id={`${formId}-kind`} value={draft.kind} onChange={e => update('kind', e.target.value as RecipeKind)}><option value="meal">{t('Meal')}</option><option value="basic">{t('Basic')}</option></select>
          {draft.kind === 'basic' && <p className="field-hint">{t('Something you make to use in other recipes, like a seasoning blend, sauce or dough. Basics stay out of meal planning unless you ask for them.')}</p>}</div>
        <div className="field"><label htmlFor={`${formId}-description`}>{t('Description')}</label><textarea id={`${formId}-description`} maxLength={10000} value={draft.description ?? ''} onChange={e => update('description', e.target.value || null)} /></div>
        {recipe?.imageUrl && draft.imageUrl && <div className="field"><span className="recipe-photo-label">{t('Photo')}</span><RecipePhoto id={recipe.id} className="recipe-hero" /><button type="button" className="link-btn" onClick={() => update('imageUrl', null)}>{t('Remove photo')}</button></div>}
        {draft.kind === 'basic'
          ? <div className="field"><label htmlFor={`${formId}-makes`}>{t('Makes')}</label><input id={`${formId}-makes`} type="text" maxLength={200} placeholder={t('About ½ cup, 2 crusts…')} value={draft.makes ?? ''} onChange={e => update('makes', e.target.value || null)} /></div>
          : <div className="field"><label htmlFor={`${formId}-servings`}>{t('Default servings')}</label><input id={`${formId}-servings`} type="number" required min="0.01" max="10000" step="any" value={draft.defaultServings || ''} onChange={e => update('defaultServings', Number(e.target.value))} /></div>}
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${formId}-total`}>{t('Total time (min)')}</label><input id={`${formId}-total`} type="number" inputMode="numeric" min="0" max="10000" step="1" value={draft.totalMinutes ?? ''} onChange={e => update('totalMinutes', e.target.value === '' ? null : Number(e.target.value))} /></div>
          <div className="field"><label htmlFor={`${formId}-prep`}>{t('Prep time (min)')}</label><input id={`${formId}-prep`} type="number" inputMode="numeric" min="0" max="10000" step="1" value={draft.prepMinutes ?? ''} onChange={e => update('prepMinutes', e.target.value === '' ? null : Number(e.target.value))} /></div>
        </div>
        <h3>{t('Ingredients')}</h3>
        <p className="field-hint">{t('Use a numeric quantity when it can scale. Leave it blank for “to taste” or “as needed”; packages stay unscaled for review.')}</p>
        {draft.ingredients.map((row, index) => {
          const match = !row.basicId && row.name.trim() ? matchBasic(row.name, basics.filter(b => !b.archived)) : null
          return <fieldset key={rowIds[index]} className="recipe-ingredient">
          <legend>{t('Ingredient {n}', { n: index + 1 })}</legend>
          <div className="field"><label htmlFor={rowIds[index]}>{t('Name')}</label><input type="text" id={rowIds[index]} required maxLength={200} value={row.name} onChange={e => ingredient(index, { name: e.target.value })} />
            {match && <button type="button" className="link-btn" onClick={() => ingredient(index, { basicId: match.id })}>{t('Link to basic: {name}', { name: match.name })}</button>}</div>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${rowIds[index]}-quantity`}>{t('Quantity')}</label><input id={`${rowIds[index]}-quantity`} type="number" min="0" max="1000000" step="any" value={row.quantity ?? ''} onChange={e => ingredient(index, { quantity: e.target.value === '' ? null : Number(e.target.value) })} /></div>
            <div className="field"><label htmlFor={`${rowIds[index]}-unit`}>{t('Unit')}</label><input type="text" id={`${rowIds[index]}-unit`} maxLength={50} placeholder={t('cup, lb…')} value={row.unit ?? ''} onChange={e => ingredient(index, { unit: e.target.value || null })} /></div>
          </div>
          {/* The rest folds away (what's set shows on its line), so a long recipe isn't pages of fields. */}
          <details className="recipe-ingredient-more">
            <summary>{t('More')}{[row.preparation, row.qualifier, row.category, row.basicId].some(Boolean) && <span className="field-hint">{[row.preparation, row.qualifier, row.category, row.basicId && t('from a basic')].filter(Boolean).join(' · ')}</span>}</summary>
          {basics.length > 0 && <div className="field"><label htmlFor={`${rowIds[index]}-basic`}>{t('Made from a basic')}</label><PickField id={`${rowIds[index]}-basic`} label={t('Made from a basic, ingredient {n}', { n: index + 1 })} title={t('Made from a basic')} placeholder={t('Basic name')}
            options={basicOptions} value={[row.basicId ?? '']} onChange={v => ingredient(index, { basicId: v[0] || null })} /></div>}
          <div className="field"><label htmlFor={`${rowIds[index]}-preparation`}>{t('Preparation')}</label><input type="text" id={`${rowIds[index]}-preparation`} maxLength={10000} placeholder={t('Diced, softened…')} value={row.preparation ?? ''} onChange={e => ingredient(index, { preparation: e.target.value || null })} /></div>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${rowIds[index]}-qualifier`}>{t('Quantity note')}</label><input type="text" id={`${rowIds[index]}-qualifier`} maxLength={100} placeholder={t('To taste…')} value={row.qualifier ?? ''} onChange={e => ingredient(index, { qualifier: e.target.value || null })} /></div>
            <div className="field"><label htmlFor={`${rowIds[index]}-category`}>{t('Category')}</label><input type="text" id={`${rowIds[index]}-category`} maxLength={100} placeholder={t('Produce…')} value={row.category ?? ''} onChange={e => ingredient(index, { category: e.target.value || null })} /></div>
          </div>
          </details>
          <button type="button" className="link-btn" aria-label={row.name ? t('Remove ingredient {n}, {name}', { n: index + 1, name: row.name }) : t('Remove ingredient {n}', { n: index + 1 })} onClick={() => { update('ingredients', draft.ingredients.filter((_, i) => i !== index)); setRowIds(ids => ids.filter((_, i) => i !== index)) }}>{t('Remove ingredient')}</button>
        </fieldset>})}
        <button type="button" className="btn btn-secondary" disabled={draft.ingredients.length >= 300} onClick={() => { update('ingredients', [...draft.ingredients, emptyIngredient()]); setRowIds(ids => [...ids, crypto.randomUUID()]) }}><PlusIcon /> {t('Add ingredient')}</button>
        {steps ? <>
          <h3 className="meal-spaced">{t('Steps')}</h3>
          {steps.map((row, index) => <fieldset key={stepIds[index]} className="recipe-ingredient">
            <legend>{t('Step {n}', { n: index + 1 })}</legend>
            <div className="field"><label htmlFor={stepIds[index]}>{t('Step')}</label><textarea id={stepIds[index]} rows={2} maxLength={10000} value={row.text} onChange={e => stepRow(index, { text: e.target.value })} /></div>
            <div className="field"><label htmlFor={`${stepIds[index]}-bullets`}>{t('Bullets')}</label><textarea id={`${stepIds[index]}-bullets`} rows={Math.max(3, row.bullets.length + 1)} value={row.bullets.join('\n')} onChange={e => stepRow(index, { bullets: e.target.value.split('\n') })} /><p className="field-hint">{t('One per line.')}</p></div>
            {row.imageUrl && <p className="field-hint">{t('Has a photo.')} <button type="button" className="link-btn" aria-label={t('Remove step {n} photo', { n: index + 1 })} onClick={() => stepRow(index, { imageUrl: null })}>{t('Remove photo')}</button></p>}
            <div className="recipe-step-actions">
              <button type="button" className="link-btn" aria-label={t('Move step {n} up', { n: index + 1 })} disabled={index === 0} onClick={() => moveStep(index, -1)}>{t('Move up')}</button>
              <button type="button" className="link-btn" aria-label={t('Move step {n} down', { n: index + 1 })} disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>{t('Move down')}</button>
              <button type="button" className="link-btn" aria-label={t('Remove step {n}', { n: index + 1 })} onClick={() => { update('steps', steps.filter((_, i) => i !== index)); setStepIds(ids => ids.filter((_, i) => i !== index)) }}>{t('Remove step')}</button>
            </div>
          </fieldset>)}
          <button type="button" className="btn btn-secondary" disabled={steps.length >= 100} onClick={() => { update('steps', [...steps, { text: '', bullets: [], imageUrl: null }]); setStepIds(ids => [...ids, crypto.randomUUID()]) }}><PlusIcon /> {t('Add step')}</button>
        </> : <div className="field meal-spaced"><label htmlFor={`${formId}-instructions`}>{t('Instructions')}</label><textarea id={`${formId}-instructions`} rows={5} maxLength={10000} value={draft.instructions ?? ''} onChange={e => update('instructions', e.target.value || null)} />
          {/* How Start cooking (and the recipe view) will split it. */}
          {!!draft.instructions?.trim() && <details className="recipe-steps-preview"><summary>{t('Preview steps ({n})', { n: cookingSteps({ instructions: draft.instructions }).length })}</summary>
            <ol className="recipe-steps">{cookingSteps({ instructions: draft.instructions }).map((step, i) => <li key={i}>{step.text}</li>)}</ol></details>}</div>}
        <div className="field"><label htmlFor={`${formId}-notes`}>{t('Preparation notes')}</label><textarea id={`${formId}-notes`} maxLength={10000} value={draft.preparationNotes ?? ''} onChange={e => update('preparationNotes', e.target.value || null)} /></div>
        <div className="field"><label htmlFor={`${formId}-url`}>{t('Source URL')}</label><input id={`${formId}-url`} type="url" pattern="https?://.*" maxLength={2000} placeholder="https://…" value={draft.sourceUrl ?? ''} onChange={e => update('sourceUrl', e.target.value || null)} /><p className="field-hint">{t('Saved as a link. To read a recipe off its website, use Import from a link in the recipe library.')}</p></div>
        {recipe?.sourceUrl && <div className="sheet-links"><SourceLink url={recipe.sourceUrl} pdfPath={`api/recipes/${encodeURIComponent(recipe.id)}/source.pdf`} title={recipe.name} /></div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}
