import { useId, useState, type FormEvent } from 'react'
import { api } from './api.ts'
import { useDialog } from './dialog.tsx'
import { ChevronRight, PlusIcon } from './icons.tsx'
import { t, tn } from './i18n.ts'
import type { RecipeTag } from './meal-types.ts'
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

export function RecipeTagField({ catalog, initial = [], value, onChange, onCatalogChange }: {
  catalog?: RecipeTag[]; initial?: RecipeTag[]; value: string[]; onChange: (ids: string[]) => void; onCatalogChange: RecipeTagChange
}) {
  const id = useId()
  const [newName, setNewName] = useState<string | null>(null)
  const tags = catalog ?? initial
  const available = catalog ? availableRecipeTagIds(value, catalog) : value
  const missing = value.length - available.length
  return <div className="field">
    <label htmlFor={id}>{t('Tags')}</label>
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

export function RecipeTagManager({ tags, onChange, onClose }: { tags: RecipeTag[]; onChange: RecipeTagChange; onClose: () => void }) {
  const [editing, setEditing] = useState<RecipeTag | null>()
  return <><Sheet title={t('Manage tags')} onClose={onClose} actions={<>
    <button type="button" className="btn btn-secondary" onClick={onClose}>{t('Done')}</button>
    <button type="button" className="btn btn-primary" onClick={() => setEditing(null)}><PlusIcon /> {t('New tag')}</button>
  </>}>
    {tags.length ? <div className="sheet-links">{tags.map(tag => <button type="button" className="sheet-link recipe-tag-row" key={tag.id} onClick={() => setEditing(tag)}>
      <span>{tag.name}</span><ChevronRight />
    </button>)}</div> : <p className="state-card">{t('No recipe tags yet.')}</p>}
  </Sheet>
  {editing !== undefined && <RecipeTagForm tag={editing ?? undefined} onClose={() => setEditing(undefined)}
    onSaved={tag => { onChange(tag.id, tag); setEditing(undefined) }}
    onDeleted={id => { onChange(id); setEditing(undefined) }} />}</>
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
