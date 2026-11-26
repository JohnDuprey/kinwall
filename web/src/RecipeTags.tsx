import { useId, useState, type FormEvent } from 'react'
import { api } from './api.ts'
import { useDialog } from './dialog.tsx'
import { ChevronRight, PlusIcon } from './icons.tsx'
import { t, tn } from './i18n.ts'
import type { Recipe, RecipeTag } from './meal-types.ts'
import { suggestTags, suggestNewTags, type SuggestionRecipe, type TagSuggestion } from '../../server/src/recipe-tag-suggestions.ts'
import PickField from './PickField.tsx'
import { availableRecipeTagIds } from './recipe-search.ts'
import Sheet from './Sheet.tsx'

const MAX_TAGS = 50
export type RecipeTagChange = (id: string, tag?: RecipeTag) => void

export function RecipeTagFilter({ tags, value, onChange }: { tags: RecipeTag[]; value: string[]; onChange: (ids: string[]) => void }) {
  const id = useId()
  return <div className="field recipe-tag-filter">
    <label htmlFor={id}>{t('Tags')}</label>
    <PickField id={id} label={t('Tags')} none={t('All tags')} multiple search maxSelections={MAX_TAGS}
      hint={t('Matches all selected tags.')} summary={value.length ? tn(value.length, '{n} tag', '{n} tags') : undefined}
      options={tags.map(tag => ({ value: tag.id, label: tag.name }))} value={value} onChange={onChange} />
  </div>
}

function reasonText(suggestion: TagSuggestion, name: string): string {
  if (suggestion.rule === 'words') return t('In the name, description or page details')
  if (suggestion.rule === 'habits') return t('Like your other “{name}” recipes', { name })
  switch (suggestion.fact) {
    case 'quick': return t('30 minutes or less')
    case 'vegetarian': return t('No meat or fish')
    case 'vegan': return t('No meat, fish, dairy or eggs')
    default: return t('Matches the recipe type')
  }
}

function SuggestedTags({ recipe, tags, library, onAdd, disabled = false }: {
  recipe: SuggestionRecipe; tags: RecipeTag[]; library: SuggestionRecipe[]; onAdd: (ids: string[]) => void; disabled?: boolean
}) {
  const suggestions = suggestTags(recipe, tags, library)
  if (!suggestions.length) return null
  return <div className="recipe-tag-suggestions"><p className="field-hint">{t('Suggested')}</p><div className="recipe-suggestion-chips">
    {suggestions.map(suggestion => {
      const tag = tags.find(tag => tag.id === suggestion.tagId)!
      const reason = reasonText(suggestion, tag.name)
      return <button key={tag.id} type="button" className="chip recipe-suggestion-chip" disabled={disabled}
        aria-label={t('Add {name}: {reason}', { name: tag.name, reason })} onClick={() => onAdd([tag.id])}>
        <span>{tag.name}</span><small>{reason}</small>
      </button>
    })}
  </div></div>
}

export function RecipeTagField({ catalog, initial = [], value, onChange, onCatalogChange, recipe, library = [] }: {
  catalog?: RecipeTag[]; initial?: RecipeTag[]; value: string[]; onChange: (ids: string[]) => void; onCatalogChange: RecipeTagChange
  recipe?: SuggestionRecipe; library?: Recipe[]
}) {
  const id = useId()
  const [newName, setNewName] = useState<string | null>(null)
  const tags = catalog ?? initial
  const available = catalog ? availableRecipeTagIds(value, catalog) : value
  const missing = value.length - available.length
  return <div className="field">
    <label htmlFor={id}>{t('Tags')}</label>
    {recipe && available.length < MAX_TAGS && <SuggestedTags recipe={{ ...recipe, tags: tags.filter(tag => value.includes(tag.id)) }} tags={tags} library={library}
      onAdd={ids => onChange([...available, ...ids].slice(0, MAX_TAGS))} />}
    <PickField id={id} label={t('Tags')} multiple search maxSelections={MAX_TAGS} options={tags.map(tag => ({ value: tag.id, label: tag.name }))}
      value={available} onChange={onChange} add={value.length < MAX_TAGS ? { label: t('New tag…'), onAdd: setNewName } : undefined} />
    {missing > 0 && <div className="field-hint" role="status">
      {tn(missing, '{n} selected tag is no longer available.', '{n} selected tags are no longer available.')}
      {' '}<button type="button" className="link-btn recipe-tag-action" onClick={() => onChange(available)}>{t('Remove unavailable tags')}</button>
    </div>}
    {newName !== null && <RecipeTagForm initialName={newName} onClose={() => setNewName(null)} onSaved={tag => {
      onCatalogChange(tag.id, tag); onChange([...available, tag.id]); setNewName(null)
    }} />}
  </div>
}

export function RecipeTagManager({ tags, library, onRecipesChanged, onChange, onClose }: { tags: RecipeTag[]; library: Recipe[]; onRecipesChanged: () => void; onChange: RecipeTagChange; onClose: () => void }) {
  const [editing, setEditing] = useState<RecipeTag | null>()
  const [review, setReview] = useState(false)
  return <><Sheet title={t('Manage tags')} onClose={onClose} actions={<>
    <button type="button" className="btn btn-secondary" onClick={onClose}>{t('Done')}</button>
    <button type="button" className="btn btn-primary" onClick={() => setEditing(null)}><PlusIcon /> {t('New tag')}</button>
  </>}>
    <div className="sheet-links"><button type="button" className="sheet-link" onClick={() => setReview(true)}><span>{t('Suggest tags')}</span><ChevronRight /></button></div>
    <RecipeTagIdeas library={library} tags={tags} onChange={onChange} />
    {tags.length ? <div className="sheet-links">{tags.map(tag => <button type="button" className="sheet-link recipe-tag-row" key={tag.id} onClick={() => setEditing(tag)}>
      <span>{tag.name}</span><ChevronRight />
    </button>)}</div> : <p className="state-card">{t('No recipe tags yet.')}</p>}
  </Sheet>
  {review && <RecipeTagReview library={library} tags={tags} onChanged={onRecipesChanged} onClose={() => setReview(false)} />}
  {editing !== undefined && <RecipeTagForm tag={editing ?? undefined} onClose={() => setEditing(undefined)}
    onSaved={tag => { onChange(tag.id, tag); setEditing(undefined) }}
    onDeleted={id => { onChange(id); setEditing(undefined) }} />}</>
}

function RecipeTagIdeas({ library, tags, onChange }: { library: Recipe[]; tags: RecipeTag[]; onChange: RecipeTagChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ideas = suggestNewTags(library, tags)
  const add = async (name: string) => {
    setBusy(true); setError('')
    try { const tag = await api.createRecipeTag(name); onChange(tag.id, tag) }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save the tag.')) }
    finally { setBusy(false) }
  }
  return <section className="recipe-tag-ideas"><h3>{t('Tags you might add')}</h3>
    <p className="field-hint">{t('Common words in your recipes. Adding a tag makes it available to suggest; it does not tag any recipes.')}</p>
    {ideas.length ? ideas.map(idea => <div className="recipe-tag-idea" key={idea.name}>
      <div><strong>{idea.name}</strong><small>{tn(idea.count, '{n} recipe', '{n} recipes')} · {idea.examples.join(', ')}</small></div>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void add(idea.name)} aria-label={t('Add tag: {name}', { name: idea.name })}>{t('Add tag')}</button>
    </div>) : <p className="field-hint">{t('No new tag ideas yet.')}</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </section>
}

function RecipeTagReview({ library, tags, onChanged, onClose }: { library: Recipe[]; tags: RecipeTag[]; onChanged: () => void; onClose: () => void }) {
  const dialog = useDialog()
  // Local accepted tags remain visible until the review closes, including while the library reloads.
  const [accepted, setAccepted] = useState<Record<string, string[]>>({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [failed, setFailed] = useState<{ recipe: Recipe; ids: string[] }[]>([])
  const [error, setError] = useState('')
  const untagged = library.filter(r => !r.tags?.length || accepted[r.id])
  const rows = untagged.map(recipe => ({ recipe, ids: suggestTags(recipe, tags, library).map(s => s.tagId).filter(id => !accepted[recipe.id]?.includes(id)) }))
  const suggested = rows.filter(row => row.ids.length)
  const none = rows.filter(row => !row.ids.length && !accepted[row.recipe.id])
  const apply = async (jobs: { recipe: Recipe; ids: string[] }[]) => {
    if (busy) return
    setBusy(true); setError(''); setFailed([])
    const failures: typeof jobs = []
    for (const [index, job] of jobs.entries()) {
      setStatus(t('Saving recipe {n} of {total}…', { n: index + 1, total: jobs.length }))
      const ids = [...new Set([...(job.recipe.tags ?? []).map(tag => tag.id), ...(accepted[job.recipe.id] ?? []), ...job.ids])]
      try {
        await api.updateRecipe(job.recipe.id, { tagIds: ids })
        setAccepted(previous => ({ ...previous, [job.recipe.id]: ids }))
      } catch (e) { failures.push(job); setError(e instanceof Error ? e.message : t('Could not save the tags.')) }
    }
    setFailed(failures); setStatus(failures.length ? t('Some recipes could not be saved. Try again.') : t('Tags saved.')); setBusy(false); onChanged()
  }
  const addAll = async () => {
    const count = suggested.reduce((n, row) => n + row.ids.length, 0)
    if (await dialog.confirm({ title: t('Add all suggested tags?'), body: tn(count, 'Add {n} tag to the recipes shown?', 'Add {n} tags to the recipes shown?'), confirmLabel: t('Add all') })) void apply(suggested)
  }
  return <Sheet title={t('Suggest tags')} onClose={onClose} dismissable={!busy} actions={<>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Done')}</button>
    <button type="button" className="btn btn-primary" disabled={busy || !suggested.length} onClick={() => void addAll()}>{t('Add all')}</button>
  </>}>
    <p className="field-hint">{t('Review recipes without tags. Nothing is added until you choose it.')}</p>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {failed.length > 0 && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void apply(failed)}>{t('Retry failed recipes')}</button>}
    {suggested.map(({ recipe, ids }) => <section className="recipe-tag-review" key={recipe.id}>
      <h3>{recipe.name}</h3>
      <SuggestedTags recipe={{ ...recipe, tags: tags.filter(tag => accepted[recipe.id]?.includes(tag.id)) }} tags={tags} library={library} disabled={busy} onAdd={ids => void apply([{ recipe, ids }])} />
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void apply([{ recipe, ids }])}>{t('Add all suggested')}</button>
    </section>)}
    {none.length > 0 && <details className="settings-disclosure"><summary>{tn(none.length, 'No suggestions for {n} recipe', 'No suggestions for {n} recipes')}</summary><ul>{none.map(({ recipe }) => <li key={recipe.id}>{recipe.name}</li>)}</ul></details>}
    {!untagged.length && <p className="state-card">{t('All recipes have tags.')}</p>}
  </Sheet>
}

function RecipeTagForm({ tag, initialName = '', onClose, onSaved, onDeleted }: {
  tag?: RecipeTag; initialName?: string; onClose: () => void; onSaved: (tag: RecipeTag) => void; onDeleted?: (id: string) => void
}) {
  const formId = useId()
  const dialog = useDialog()
  const [name, setName] = useState(initialName || tag?.name || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!busy) onClose() }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save the tag.')) }
    finally { setBusy(false) }
  }
  const save = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation() // The tag sheet can be opened from inside the recipe form.
    if (busy || !name.trim()) return
    void run(async () => onSaved(await (tag ? api.renameRecipeTag(tag.id, name) : api.createRecipeTag(name))))
  }
  const remove = async () => {
    if (!tag || !onDeleted || !await dialog.confirm({
      title: t('Delete “{name}”?', { name: tag.name }),
      body: t('This tag will be removed from every recipe that uses it. Your recipes will stay in the library.'),
      confirmLabel: t('Delete tag'), danger: true,
    })) return
    void run(async () => { await api.deleteRecipeTag(tag.id); onDeleted(tag.id) })
  }
  return <Sheet title={tag ? t('Rename tag') : t('New tag')} onClose={close} dismissable={!busy} dirty="auto" actions={<>
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={close}>{t('Cancel')}</button>
    <button type="submit" form={formId} className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={formId} onSubmit={save}>
      <div className="field"><label htmlFor={`${formId}-name`}>{t('Tag name')}</label>
        <input id={`${formId}-name`} data-autofocus value={name} onChange={e => setName(e.target.value)} maxLength={60} disabled={busy} required />
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}
    </form>
    {tag && onDeleted && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger recipe-tag-action" disabled={busy}
      onClick={() => void remove()}>{t('Delete tag')}</button></div>}
  </Sheet>
}
