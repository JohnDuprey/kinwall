import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { mealDayLabel, servingsLabel, SLOT_LABEL } from './meal-date.ts'
import { IngredientAmount } from './RecipeSheet.tsx'
import type { List } from './types.ts'
import { KIT_QUALIFIER, type ShoppingProjection } from './meal-types.ts'

// The grocery list last used on this device, so a family with several doesn't pick it every time.
const LAST_LIST_KEY = 'kinwall.mealGroceryList'
const lastList = () => { try { return localStorage.getItem(LAST_LIST_KEY) } catch { return null } }
const rememberList = (id: string) => { try { localStorage.setItem(LAST_LIST_KEY, id) } catch { /* private mode: just not remembered */ } }

/** The server owns normalization, conversions and source claims. Previewing never writes a list.
 * Only grocery (shopping) lists can take ingredients; with just one it is chosen for you. */
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
  // What ships in a meal kit is already in the box: unchecked until someone ticks it.
  const [kitIncluded, setKitIncluded] = useState<string[]>([])
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
      if (canceled) return
      const grocery = data.filter(list => list.kind === 'shopping' && !list.archived)
      setLists(grocery); setListError('')
      // One grocery list: that one. Several: the one this device used last, if it's still there.
      setListId(id => id || (grocery.length === 1 ? grocery[0].id : grocery.find(list => list.id === lastList())?.id ?? ''))
    }).catch(e => { if (!canceled) setListError(e instanceof Error ? e.message : 'Could not load grocery lists.') })
    return () => { canceled = true }
  }, [tick, refreshTick])
  useEffect(() => {
    let canceled = false
    if (validRange) api.getMealProjection(from, to, listId || undefined).then(data => {
      if (!canceled) setResult({ key: requestKey, projection: data })
    }).catch(e => { if (!canceled) setResult({ key: requestKey, error: e instanceof Error ? e.message : 'Could not load the grocery preview.' }) })
    return () => { canceled = true }
  }, [from, to, listId, validRange, requestKey])
  const loading = validRange && result?.key !== requestKey
  const current = validRange && result?.key === requestKey ? result.projection : null
  const error = result?.key === requestKey ? result.error : undefined
  const isOmitted = (item: ShoppingProjection['items'][number]) => omitted.includes(item.key) || (item.qualifier === KIT_QUALIFIER && !kitIncluded.includes(item.key))
  const selected = current?.items.filter(item => !item.applied && !isOmitted(item)) ?? []
  const apply = async () => {
    if (!admin || !current || !listId || !selected.length || busy || loading || !lists?.some(list => list.id === listId)) return
    setBusy(true); setApplyError('')
    try {
      const result = await api.applyMealProjection({ from, to, listId, omitKeys: current.items.filter(isOmitted).map(item => item.key), includeNotes, includeKitItems: true })
      rememberList(listId)
      // Clear immediately so a failed refresh cannot leave an already-applied preview actionable.
      setResult(null); setTick(t => t + 1); reloadCore(); toast(`Added ${result.added} grocery item${result.added === 1 ? '' : 's'}. Previously applied ingredients are skipped.`)
    } catch (e) { setApplyError(e instanceof Error ? `${e.message}. Refresh the preview, then retry safely.` : 'Could not add these groceries. You can retry safely.'); setResult(null); setTick(t => t + 1) }
    finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  return <Sheet title="Groceries for these meals" onClose={close} dismissable={!busy} actions={admin ? <button className="btn btn-primary" disabled={busy || loading || !listId || !selected.length || !lists?.some(list => list.id === listId)} onClick={apply}>{busy ? 'Applying…' : `Add ${selected.length} item${selected.length === 1 ? '' : 's'} to list`}</button> : undefined}>
    <p>Review ingredients before adding them. Existing list items stay as they are; previously applied meal ingredients are skipped.</p>
    <fieldset className="meal-fieldset" disabled={busy}>
      <div className="meal-form-row">
        <div className="field"><label htmlFor={`${id}-from`}>From</label><input id={`${id}-from`} type="date" required value={from} onChange={e => { setFrom(e.target.value); setOmitted([]) }} /></div>
        <div className="field"><label htmlFor={`${id}-to`}>Through</label><input id={`${id}-to`} type="date" required min={from} value={to} onChange={e => { setTo(e.target.value); setOmitted([]) }} /></div>
      </div>
      {!validRange && <p className="field-error" role="alert">Choose an ordered date range of up to 367 days.</p>}
      {lists && lists.length > 1 && <div className="field"><label htmlFor={`${id}-list`}>Grocery list</label><select id={`${id}-list`} value={listId} onChange={e => { setListId(e.target.value); setOmitted([]) }}><option value="">Choose a grocery list</option>{lists.map(list => <option key={list.id} value={list.id}>{list.emoji} {list.name}</option>)}</select></div>}
      {lists?.length === 1 && <p className="field-hint">Adding to {lists[0].emoji} {lists[0].name}.</p>}
      {lists?.length === 0 && <p>No grocery lists yet. <a href="#/lists" onClick={close}>Create a shopping list in Lists</a> to add these ingredients.</p>}
      {admin && <label className="meal-check"><input type="checkbox" checked={includeNotes} onChange={e => setIncludeNotes(e.target.checked)} /> Include source meals and preparation details as notes</label>}
      {!admin && <p className="field-hint">An admin can add these ingredients to a grocery list.</p>}
      {loading && <p role="status">Calculating ingredients…</p>}
      {current && !loading && <>
        {current.items.length === 0 ? <p className="state-card">No recipe ingredients in this date range. Free-form and dining-out meals do not create ingredient requirements.</p> : <>
          {admin && <div className="meal-actions"><button type="button" className="link-btn" onClick={() => setOmitted([])}>Select all unapplied</button><button type="button" className="link-btn" onClick={() => setOmitted(current.items.map(item => item.key))}>Omit all</button></div>}
          <ul className="meal-projection-list">{current.items.map((item, index) => <li key={item.key} className="meal-projection-item">
            <div className="meal-check">
              {admin && <input id={`${id}-item-${index}`} type="checkbox" checked={!isOmitted(item) && !item.applied} disabled={item.applied} onChange={e => { const toggle = (keys: string[], on: boolean) => on ? [...keys, item.key] : keys.filter(key => key !== item.key); setOmitted(keys => toggle(keys, !e.target.checked)); if (item.qualifier === KIT_QUALIFIER) setKitIncluded(keys => toggle(keys, e.target.checked)) }} />}
              <label htmlFor={admin ? `${id}-item-${index}` : undefined}><strong>{item.name}</strong> — <IngredientAmount quantity={item.quantity} unit={item.unit} qualifier={item.qualifier} /></label>
            </div>
            <p className="field-hint">{item.applied ? 'Already applied to this list' : item.partiallyApplied ? 'Partly applied — only remaining contributions will be added' : 'Not yet applied'}{item.category ? ` · ${item.category}` : ''}</p>
            {item.changedSinceApplied && <p className="field-error">This meal changed after it was applied. Check the existing grocery item; adding again will not update it.</p>}
            {!item.scalable && <p className="field-hint">Amount needs review; this quantity was not scaled.</p>}
            {item.matches.length > 0 && <p className="field-hint">Existing matches: {item.matches.map(match => `${match.title}${match.quantity ? ` (${match.quantity})` : ''}${match.done ? ' — checked off' : ''}`).join(', ')}. Omit this ingredient if you already have enough.</p>}
            <details><summary>{item.sources.length} source meal{item.sources.length === 1 ? '' : 's'}</summary><ul>{item.sources.map(source => <li key={source.sourceRef}>
              {mealDayLabel(source.date)} · {SLOT_LABEL[source.slot]} · {source.title} ({source.recipeName}) — <IngredientAmount quantity={source.quantity} unit={source.unit} qualifier={source.qualifier} />
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
