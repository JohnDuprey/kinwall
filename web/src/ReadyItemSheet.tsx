import { useId, useState } from 'react'
import { MinusIcon, PlusIcon } from './icons.tsx'
import Sheet from './Sheet.tsx'
import PickField from './PickField.tsx'
import { Segmented } from './a11y.tsx'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { todayKeyInTz } from './date.ts'
import { kitLabel } from './meal-kits.ts'
import { t, tn } from './i18n.ts'
import type { MealKitDetail, ReadyKind, Recipe } from './meal-types.ts'

const plusDays = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10)

function MealCount({ name, value, onChange }: { name: string; value: number; onChange: (n: number) => void }) {
  return <div className="recipe-servings"><span>{name}</span><div className="recipe-stepper" role="group" aria-label={name}>
    <button type="button" className="icon-btn" aria-label={t('Fewer meals for {name}', { name })} disabled={value <= 1} onClick={() => onChange(value - 1)}><MinusIcon width={20} height={20} /></button>
    <span aria-live="polite">{tn(value, '{n} meal', '{n} meals')}</span>
    <button type="button" className="icon-btn" aria-label={t('More meals for {name}', { name })} disabled={value >= 20} onClick={() => onChange(value + 1)}><PlusIcon width={20} height={20} /></button>
  </div></div>
}

export default function ReadyItemSheet({ recipes, recipe, item, onClose, onSaved }: { recipes: Recipe[]; recipe?: Recipe; item?: MealKitDetail; onClose: () => void; onSaved: () => void }) {
  const { settings, toast, reloadCore } = useApp()
  const dialog = useDialog(), formId = useId()
  const [kind, setKind] = useState<ReadyKind>(item?.kind ?? 'prepped')
  const [date, setDate] = useState(item?.receivedOn ?? todayKeyInTz(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone))
  const window = (k: ReadyKind) => k === 'prepped' ? 4 : k === 'frozen' ? 90 : settings.mealKitDays ?? 7
  const [cookBy, setCookBy] = useState(item?.cookBy ?? plusDays(date, window(kind)))
  const [customDate, setCustomDate] = useState(false)
  const [several, setSeveral] = useState(false)
  const [ids, setIds] = useState<string[]>(recipe ? [recipe.id] : [])
  const [title, setTitle] = useState(item?.title ?? '')
  const [counts, setCounts] = useState<Record<string, number>>({ '': item?.quantity ?? 1 })
  const [savedIds, setSavedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const changedDate = (next: string, nextKind = kind) => { setDate(next); setKind(nextKind); setCustomDate(false); if (next) setCookBy(plusDays(next, window(nextKind))) }
  const save = async () => {
    setBusy(true); setError('')
    try {
      if (item) await api.updateReadyItem(item.id, { kind, quantity: counts[''], ...(customDate ? { cookBy } : kind !== item.kind ? { cookBy: null } : {}), ...(title.trim() ? { title: title.trim() } : {}) })
      else {
        // Keep successful rows when a later row fails, so retrying cannot duplicate the batch.
        for (const id of ids.length ? ids : ['']) if (!savedIds.includes(id)) {
          await api.addReadyItem({ kind, receivedOn: date, ...(customDate ? { cookBy } : {}), quantity: counts[id] ?? 1, ...(id ? { recipeId: id } : { title: title.trim() }) })
          setSavedIds(old => [...old, id])
        }
      }
      toast(t('Ready to cook saved')); reloadCore(); onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not save food.')) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!item || !await dialog.confirm({ title: t('Delete “{name}”?', { name: item.recipeName }), body: t('Planned meals stay in the plan. You can prep them again.'), confirmLabel: t('Delete'), danger: true })) return
    setBusy(true)
    try { await api.deleteMealKit(item.id); reloadCore(); onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save food.')); setBusy(false) }
  }
  return <Sheet title={item ? item.recipeName : recipe ? t('Prepped this') : t('Add to Ready to cook')} onClose={onClose} dirty="auto" dismissable={!busy} actions={<button className="btn btn-primary" form={formId} type="submit" disabled={busy || (!item && !ids.length && !title.trim())}>{busy ? t('Saving…') : t('Save')}</button>}>
    <form id={formId} onSubmit={e => { e.preventDefault(); void save() }}>
      {error && <p className="field-error" role="alert">{error}</p>}
      <fieldset className="ready-item-fields" disabled={busy || savedIds.length > 0}>
        {!item && !recipe && <>
          <div className="field"><Segmented label={t('How many items?')} value={several ? 'several' : 'one'} options={[{ key: 'one', label: t('One item') }, { key: 'several', label: t('Several') }]} onChange={value => { setSeveral(value === 'several'); setIds([]) }} /></div>
          <div className="field"><label htmlFor={`${formId}-recipe`}>{t('What is it?')}</label><PickField id={`${formId}-recipe`} label={t('Recipe')} options={[...(!several ? [{ value: '', label: t('Name the food') }] : []), ...recipes.filter(r => !r.archived).map(r => ({ value: r.id, label: r.name }))]} value={ids} onChange={next => setIds(next.filter(Boolean))} multiple={several} search none={t('Pick a recipe')} /></div>
          {!several && <div className="field"><label htmlFor={`${formId}-name`}>{t('Or name the food')}</label><input id={`${formId}-name`} type="text" value={title} maxLength={200} disabled={!!ids.length} onChange={e => setTitle(e.target.value)} /></div>}
        </>}
        <div className="field"><label id={`${formId}-kind`}>{t('Type')}</label><Segmented aria-labelledby={`${formId}-kind`} label={t('Type')} value={kind} onChange={value => changedDate(date, value as ReadyKind)} options={(['prepped', 'frozen', 'kit'] as const).map(value => ({ key: value, label: kitLabel({ kind: value }) }))} /></div>
        <div className="field"><label htmlFor={`${formId}-date`}>{kind === 'kit' ? t('Arrived on') : kind === 'frozen' ? t('Frozen on') : t('Prepped on')}</label><input id={`${formId}-date`} type="date" required value={date} disabled={!!item} onChange={e => changedDate(e.target.value)} /></div>
        {(item ? [''] : ids.length ? ids : ['']).map(id => <MealCount key={id} name={several ? recipes.find(r => r.id === id)?.name ?? t('How many meals does it cover?') : t('How many meals does it cover?')} value={counts[id] ?? 1} onChange={value => setCounts(old => ({ ...old, [id]: value }))} />)}
        <div className="field"><label htmlFor={`${formId}-until`}>{kind === 'kit' ? t('Cook by') : kind === 'frozen' ? t('Use by') : t('Eat by')}</label><input id={`${formId}-until`} type="date" required value={cookBy} onChange={e => { setCookBy(e.target.value); setCustomDate(true) }} /></div>
        {item && !item.recipeId && <div className="field"><label htmlFor={`${formId}-name`}>{t('What is it?')}</label><input id={`${formId}-name`} type="text" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></div>}
      </fieldset>
    </form>
    {item && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" disabled={busy} onClick={() => void remove()}>{t('Delete')}</button></div>}
  </Sheet>
}
