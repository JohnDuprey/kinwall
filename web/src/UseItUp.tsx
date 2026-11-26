// Meals' "Use it up" strip: food on pantry lists that expires soon, and the family's recipes that use
// it (GET /api/pantry/suggestions), alongside meal kits on hand.
import { useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { kitIcon, kitLabel, kitPast, kitWhen } from './meal-kits.ts'
import Sheet from './Sheet.tsx'
import { chipsThatFit, stripFood } from './pantry-strip.ts'
import ReadyItemSheet from './ReadyItemSheet.tsx'
import { api } from './api.ts'
import { t, tn } from './i18n.ts'
import { expiryShort } from './pantry.ts'
import type { PantryItem, PantrySuggestions } from './types.ts'
import type { MealKitDetail, Recipe } from './meal-types.ts'

/** The family-wide refresh (any change anywhere) refetches at most this often: suggestions read every recipe. */
const POLL_EVERY = 5 * 60_000

/** "Spinach (expired)", "Chicken breast (tomorrow)". */
const itemWhen = (i: Pick<PantryItem, 'title' | 'useBy' | 'daysLeft' | 'status'>) => t('{item} ({when})', { item: i.title, when: expiryShort(i) })

function PantryStrip({ items, count, onIdeas }: { items: PantryItem[]; count: number; onIdeas: () => void }) {
  const space = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(0)
  const food = stripFood(items)
  useEffect(() => {
    const fit = () => {
      const widths = [...measure.current!.querySelectorAll<HTMLElement>('.use-it-up-item')].map(el => el.getBoundingClientRect().width)
      const more = measure.current!.querySelector<HTMLElement>('.use-it-up-more')!.getBoundingClientRect().width
      setVisible(chipsThatFit(widths, space.current!.clientWidth, more, 8))
    }
    const observer = new ResizeObserver(fit)
    observer.observe(space.current!)
    observer.observe(measure.current!)
    return () => observer.disconnect()
  }, [items])
  return <div className="use-it-up-strip-scroll">
    <div className="use-it-up-strip">
      <h2 id="use-it-up-title">🥫 <span>{t('Use it up')}</span></h2>
      <div className="use-it-up-strip-food" ref={space}>
        <ul className="use-it-up-strip-items" aria-label={t('Food to use soon')}>
          {food.slice(0, visible).map(i => <li key={i.id} className="chip chip-static use-it-up-item">{itemWhen(i)}</li>)}
        </ul>
        {visible < food.length && <button type="button" className="btn btn-secondary use-it-up-more" aria-label={tn(food.length - visible, '{n} more thing to use soon', '{n} more things to use soon')} onClick={onIdeas}>+{food.length - visible}</button>}
        <div className="use-it-up-measure" ref={measure} aria-hidden="true">
          {food.map(i => <span key={i.id} className="chip chip-static use-it-up-item">{itemWhen(i)}</span>)}
          <span className="btn btn-secondary use-it-up-more">+{food.length}</span>
        </div>
      </div>
      <button type="button" className="btn btn-secondary use-it-up-ideas" aria-haspopup="dialog" onClick={onIdeas}>{t('Ideas ({n})', { n: count })}</button>
    </div>
  </div>
}

export default function UseItUp({ recipes, admin, reload, poll, onOpen, onPlan }: {
  recipes: Recipe[]; admin: boolean
  reload: number // a change made here (a meal planned, a recipe saved): refetch now
  poll: number // the app's refresh after a change anywhere: refetch, at most every POLL_EVERY
  onOpen: (recipe: Recipe) => void; onPlan: (recipe: Recipe | undefined, item?: MealKitDetail) => void
}) {
  const { settings, toast, reloadCore } = useApp()
  const dialog = useDialog()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<PantrySuggestions | null>(null)
  const [ideas, setIdeas] = useState(false)
  const [ready, setReady] = useState<MealKitDetail[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<MealKitDetail | null>(null)
  const [readyTick, setReadyTick] = useState(0)
  useEffect(() => {
    let canceled = false
    api.getMealKits().then(items => { if (!canceled) setReady(items) }).catch(() => {})
    return () => { canceled = true }
  }, [reload, poll, readyTick])
  const fetched = useRef<{ reload: number; at: number } | null>(null)
  useEffect(() => {
    if (!settings.features.lists) { setData(null); return }
    const last = fetched.current
    if (last && last.reload === reload && Date.now() - last.at < POLL_EVERY) return
    let canceled = false
    // Noted once it lands (not when asked), so a canceled request never stops the next one.
    const done = () => { fetched.current = { reload, at: Date.now() } }
    // An older server has no pantry: no card, nothing to report.
    api.getPantrySuggestions(7).then(d => { if (!canceled) { setData(d); done() } }).catch(() => { if (!canceled) { setData(null); done() } })
    return () => { canceled = true }
  }, [reload, poll, settings.features.lists])
  const kits = ready.map(kit => ({ recipe: recipes.find(r => r.id === kit.recipeId), kit }))
  const markDone = async (id: string, name: string) => {
    if (!await dialog.confirm({ title: t('Done with “{name}”?', { name }), body: t('Mark the remaining food used or tossed.'), confirmLabel: t('Done') })) return
    setBusy(true); setError('')
    try { await api.markMealKitDone(id); toast(t('Saved: {name}', { name })); reloadCore(); setReadyTick(n => n + 1) }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save meal kit.')) }
    finally { setBusy(false) }
  }
  if (!admin && !kits.length && !data?.expiring.length) return null
  const expired = data?.expiring.filter(i => i.status === 'expired').length ?? 0
  const shown = data?.suggestions ?? []
  return (
    <section className="use-it-up" aria-labelledby="use-it-up-title">
      {(admin || kits.length > 0) && <>
        <div className="use-it-up-head"><h2 id={data?.expiring.length ? undefined : 'use-it-up-title'}>📦 {t('Ready to cook')}</h2>{admin && <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>{t('+ Add')}</button>}</div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <ul className="use-it-up-recipes">{kits.map(({ recipe, kit }) => <li key={kit.id} className="use-it-up-recipe meal-kit-recipe">
          <button type="button" className="use-it-up-open" disabled={!recipe && !admin} onClick={() => recipe ? onOpen(recipe) : setEditing(kit)}><strong>{kit.recipeName}</strong><span>{kitIcon(kit)} {kitLabel(kit)}</span><span>{kitWhen(kit)}</span><span>{tn(kit.left, '{n} meal left', '{n} meals left')}</span>{kitPast(kit, settings.timezone) && <span className="list-overdue">⚠ {t('Past its date')}</span>}</button>
          {admin && <div className="meal-kit-actions"><button type="button" className="btn btn-secondary" onClick={() => onPlan(recipe, kit)}>{t('Plan it')}</button><button type="button" className="btn btn-secondary" onClick={() => setEditing(kit)}>{t('Edit')}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void markDone(kit.id, kit.recipeName)}>{t('Done')}</button></div>}
        </li>)}</ul>
      </>}
      {(adding || editing) && <ReadyItemSheet recipes={recipes} item={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null) }} onSaved={() => { setAdding(false); setEditing(null); setReadyTick(n => n + 1) }} />}
      {!!data?.expiring.length && <>
      <PantryStrip items={data.expiring} count={data.suggestions.length} onIdeas={() => setIdeas(true)} />
      {ideas && <Sheet title={t('Use it up')} onClose={() => setIdeas(false)}>
        <div className="use-it-up-head">
          <p className="field-hint">
            {tn(data.expiring.length, '{n} thing in your pantry to use this week', '{n} things in your pantry to use this week')}
            {expired > 0 && <> · <span className="list-overdue">⚠ {tn(expired, '{n} past its date', '{n} past their date')}</span></>}
          </p>
        </div>
        <ul className="use-it-up-items" aria-label={t('Food to use soon')}>
          {data.expiring.map(i => (
            <li key={i.id} className={`chip chip-static use-it-up-item ${i.status ?? ''}`}>
              <span aria-hidden="true">{i.status === 'expired' ? '⚠ ' : i.status === 'later' ? '' : '⏳ '}</span>{itemWhen(i)}
            </li>
          ))}
        </ul>
        {shown.length > 0 ? (
          <ul className="use-it-up-recipes">
            {shown.map(s => {
              const recipe = recipes.find(r => r.id === s.recipe.id)
              return (
                <li key={s.recipe.id} className="use-it-up-recipe">
                  <button type="button" className="use-it-up-open" disabled={!recipe} onClick={() => { if (recipe) { setIdeas(false); onOpen(recipe) } }}>
                    <strong>{s.recipe.name}</strong>
                    <span>{t('Uses {items}', { items: s.uses.map(itemWhen).join(', ') })}</span>
                    <span className="use-it-up-missing">{s.missing.length ? t('Needs {items}', { items: s.missing.join(', ') }) : t('You have everything')}</span>
                  </button>
                  {admin && recipe && <button type="button" className="btn btn-secondary" onClick={() => { setIdeas(false); onPlan(recipe) }}>{t('Plan it')}</button>}
                </li>
              )
            })}
          </ul>
        ) : <p className="field-hint">{t('None of your recipes use these yet.')}</p>}
        {data.unmatched.length > 0 && (
          <p className="field-hint">{t('No recipe uses {items} yet.', { items: data.unmatched.map(i => i.title).join(', ') })}</p>
        )}
        <p className="field-hint">{t('Ask an AI assistant connected over MCP for more ideas for food to use up.')}</p>
      </Sheet>}
      </>}
    </section>
  )
}
