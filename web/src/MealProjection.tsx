import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { ingredientAmount, mealDayLabel, servingsLabel, SLOT_LABEL } from './meal-date.ts'
import type { List } from './types.ts'
import type { ShoppingProjection } from './meal-types.ts'

/** The server owns normalization, conversions and source claims. Previewing never writes a list. */
export default function MealProjection({ from: initialFrom, to: initialTo, admin, onClose }: {
  from: string; to: string; admin: boolean; onClose: () => void
}) {
  const { refreshTick, reloadCore, toast } = useApp()
  const id = useId()
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(initialTo)
  const [lists, setLists] = useState<List[] | null>(null)
  const [listId, setListId] = useState('')
  const [result, setResult] = useState<{ key: string; projection?: ShoppingProjection; error?: string } | null>(null)
  const [omitted, setOmitted] = useState<string[]>([])
  const [includeNotes, setIncludeNotes] = useState(true)
  const [busy, setBusy] = useState(false)
  const [applyError, setApplyError] = useState('')
  const [listError, setListError] = useState('')
  const [tick, setTick] = useState(0)
  const validRange = !!from && !!to && from <= to && (Date.parse(to) - Date.parse(from)) / 86400000 <= 366
  const requestKey = JSON.stringify([from, to, listId, tick, refreshTick])
  useEffect(() => {
    let canceled = false
    api.getLists().then(data => {
      if (!canceled) { setLists(data.filter(list => list.kind === 'shopping' && !list.archived)); setListError('') }
    }).catch(e => { if (!canceled) setListError(e instanceof Error ? e.message : 'Could not load shopping lists.') })
    return () => { canceled = true }
  }, [tick, refreshTick])
  useEffect(() => {
    let canceled = false
    if (validRange) api.getMealProjection(from, to, listId || undefined).then(data => {
      if (!canceled) setResult({ key: requestKey, projection: data })
    }).catch(e => { if (!canceled) setResult({ key: requestKey, error: e instanceof Error ? e.message : 'Could not load shopping projection.' }) })
    return () => { canceled = true }
  }, [from, to, listId, validRange, requestKey])
  const loading = validRange && result?.key !== requestKey
  const current = validRange && result?.key === requestKey ? result.projection : null
  const error = result?.key === requestKey ? result.error : undefined
  const selected = current?.items.filter(item => !item.applied && !omitted.includes(item.key)) ?? []
  const apply = async () => {
    if (!admin || !current || !listId || !selected.length || busy || loading || !lists?.some(list => list.id === listId)) return
    setBusy(true); setApplyError('')
    try {
      const result = await api.applyMealProjection({ from, to, listId, omitKeys: omitted, includeNotes })
      // Clear immediately so a failed refresh cannot leave an already-applied preview actionable.
      setResult(null); setTick(t => t + 1); reloadCore(); toast(`Added ${result.added} shopping item${result.added === 1 ? '' : 's'}. Previously applied ingredients are skipped.`)
    } catch (e) { setApplyError(e instanceof Error ? `${e.message}. Refresh the preview, then retry safely.` : 'Could not apply shopping projection. You can retry safely.'); setResult(null); setTick(t => t + 1) }
    finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  return <Sheet title="Shopping projection" onClose={close} dismissable={!busy} actions={admin ? <button className="btn btn-primary" disabled={busy || loading || !listId || !selected.length || !lists?.some(list => list.id === listId)} onClick={apply}>{busy ? 'Applying…' : `Add ${selected.length} item${selected.length === 1 ? '' : 's'} to list`}</button> : undefined}>
    <p>Review ingredients before adding them. Existing list items stay as they are; previously applied meal ingredients are skipped.</p>
    <fieldset className="meal-fieldset" disabled={busy}>
      <div className="meal-form-row">
        <div className="field"><label htmlFor={`${id}-from`}>From</label><input id={`${id}-from`} type="date" required value={from} onChange={e => { setFrom(e.target.value); setOmitted([]) }} /></div>
        <div className="field"><label htmlFor={`${id}-to`}>Through</label><input id={`${id}-to`} type="date" required min={from} value={to} onChange={e => { setTo(e.target.value); setOmitted([]) }} /></div>
      </div>
      {!validRange && <p className="field-error" role="alert">Choose an ordered date range of up to 367 days.</p>}
      <div className="field"><label htmlFor={`${id}-list`}>Shopping list</label><select id={`${id}-list`} value={listId} onChange={e => { setListId(e.target.value); setOmitted([]) }}><option value="">Choose a shopping list</option>{lists?.map(list => <option key={list.id} value={list.id}>{list.emoji} {list.name}</option>)}</select></div>
      {lists?.length === 0 && <p>No shopping lists yet. <a href="#/lists" onClick={close}>Create a shopping list in Lists</a> to apply these ingredients.</p>}
      {admin && <label className="meal-check"><input type="checkbox" checked={includeNotes} onChange={e => setIncludeNotes(e.target.checked)} /> Include source meals and preparation details as notes</label>}
      {!admin && <p className="field-hint">An admin can apply this projection to a shopping list.</p>}
      {loading && <p role="status">Calculating ingredients…</p>}
      {current && !loading && <>
        {current.items.length === 0 ? <p className="state-card">No recipe ingredients in this date range. Free-form and dining-out meals do not create ingredient requirements.</p> : <>
          {admin && <div className="meal-actions"><button type="button" className="link-btn" onClick={() => setOmitted([])}>Select all unapplied</button><button type="button" className="link-btn" onClick={() => setOmitted(current.items.map(item => item.key))}>Omit all</button></div>}
          <ul className="meal-projection-list">{current.items.map((item, index) => <li key={item.key} className="meal-projection-item">
            <div className="meal-check">
              {admin && <input id={`${id}-item-${index}`} type="checkbox" checked={!omitted.includes(item.key) && !item.applied} disabled={item.applied} onChange={e => setOmitted(keys => e.target.checked ? keys.filter(key => key !== item.key) : [...keys, item.key])} />}
              <label htmlFor={admin ? `${id}-item-${index}` : undefined}><strong>{item.name}</strong> — {ingredientAmount(item.quantity, item.unit, item.qualifier) || 'As needed'}</label>
            </div>
            <p className="field-hint">{item.applied ? 'Already applied to this list' : item.partiallyApplied ? 'Partly applied — only remaining contributions will be added' : 'Not yet applied'}{item.category ? ` · ${item.category}` : ''}</p>
            {item.changedSinceApplied && <p className="field-error">This meal changed after it was applied. Check the existing shopping item; applying again will not update it.</p>}
            {!item.scalable && <p className="field-hint">Amount needs review; this quantity was not scaled.</p>}
            {item.matches.length > 0 && <p className="field-hint">Existing matches: {item.matches.map(match => `${match.title}${match.quantity ? ` (${match.quantity})` : ''}${match.done ? ' — checked off' : ''}`).join(', ')}. Omit this ingredient if you already have enough.</p>}
            <details><summary>{item.sources.length} source meal{item.sources.length === 1 ? '' : 's'}</summary><ul>{item.sources.map(source => <li key={source.sourceRef}>
              {mealDayLabel(source.date)} · {SLOT_LABEL[source.slot]} · {source.title} ({source.recipeName}) — {ingredientAmount(source.quantity, source.unit, source.qualifier) || 'As needed'}
              {source.preparation ? ` · ${source.preparation}` : ''}{source.applied ? ' · Already applied' : ''}
              {!source.scalable && ` · Check for ${servingsLabel(source.servings)} (recipe: ${source.defaultServings})`}
            </li>)}</ul></details>
          </li>)}</ul>
        </>}
      </>}
    </fieldset>
    {(applyError || error || listError) && <div role="alert"><p className="field-error">{applyError || error || listError}</p><button className="btn btn-secondary" disabled={busy} onClick={() => { setApplyError(''); setTick(t => t + 1) }}>Refresh preview</button></div>}
  </Sheet>
}
