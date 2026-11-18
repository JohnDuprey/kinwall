// Meals' "Use it up" card: food on pantry lists that expires soon, and the family's recipes that use
// it (GET /api/pantry/suggestions). Hidden until something on a pantry list has a use-by date this week.
import { useEffect, useRef, useState } from 'react'
import { api } from './api.ts'
import { t, tn } from './i18n.ts'
import { expiryShort } from './pantry.ts'
import type { PantryItem, PantrySuggestions } from './types.ts'
import type { Recipe } from './meal-types.ts'

/** How many recipes the card shows; the rest are a tap away. */
const SHOWN = 3
/** The family-wide refresh (any change anywhere) refetches at most this often: suggestions read every recipe. */
const POLL_EVERY = 5 * 60_000

/** "Spinach (expired)", "Chicken breast (tomorrow)". */
const itemWhen = (i: Pick<PantryItem, 'title' | 'useBy' | 'daysLeft' | 'status'>) => t('{item} ({when})', { item: i.title, when: expiryShort(i) })

export default function UseItUp({ recipes, admin, reload, poll, onOpen, onPlan }: {
  recipes: Recipe[]; admin: boolean
  reload: number // a change made here (a meal planned, a recipe saved): refetch now
  poll: number // the app's refresh after a change anywhere: refetch, at most every POLL_EVERY
  onOpen: (recipe: Recipe) => void; onPlan: (recipe: Recipe) => void
}) {
  const [data, setData] = useState<PantrySuggestions | null>(null)
  const [all, setAll] = useState(false)
  const fetched = useRef<{ reload: number; at: number } | null>(null)
  useEffect(() => {
    const last = fetched.current
    if (last && last.reload === reload && Date.now() - last.at < POLL_EVERY) return
    let canceled = false
    // Noted once it lands (not when asked), so a canceled request never stops the next one.
    const done = () => { fetched.current = { reload, at: Date.now() } }
    // An older server has no pantry: no card, nothing to report.
    api.getPantrySuggestions(7).then(d => { if (!canceled) { setData(d); done() } }).catch(() => { if (!canceled) { setData(null); done() } })
    return () => { canceled = true }
  }, [reload, poll])
  if (!data?.expiring.length) return null
  const expired = data.expiring.filter(i => i.status === 'expired').length
  const shown = all ? data.suggestions : data.suggestions.slice(0, SHOWN)
  return (
    <section className="use-it-up" aria-labelledby="use-it-up-title">
      <div className="use-it-up-head">
        <h2 id="use-it-up-title"><span aria-hidden="true">🥫 </span>{t('Use it up')}</h2>
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
                <button type="button" className="use-it-up-open" disabled={!recipe} onClick={() => recipe && onOpen(recipe)}>
                  <strong>{s.recipe.name}</strong>
                  <span>{t('Uses {items}', { items: s.uses.map(itemWhen).join(', ') })}</span>
                  <span className="use-it-up-missing">{s.missing.length ? t('Needs {items}', { items: s.missing.join(', ') }) : t('You have everything')}</span>
                </button>
                {admin && recipe && <button type="button" className="btn btn-secondary" onClick={() => onPlan(recipe)}>{t('Plan it')}</button>}
              </li>
            )
          })}
        </ul>
      ) : <p className="field-hint">{t('None of your recipes use these yet.')}</p>}
      {data.suggestions.length > SHOWN && (
        <button type="button" className="link-btn" aria-expanded={all} onClick={() => setAll(v => !v)}>
          {all ? t('Show fewer') : tn(data.suggestions.length - SHOWN, 'Show {n} more recipe', 'Show {n} more recipes')}
        </button>
      )}
      {shown.length > 0 && data.unmatched.length > 0 && (
        <p className="field-hint">{t('No recipe uses {items} yet.', { items: data.unmatched.map(i => i.title).join(', ') })}</p>
      )}
    </section>
  )
}
