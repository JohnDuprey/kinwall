import { useId, useState, type ReactNode } from 'react'
import { t } from './i18n.ts'
import { pickerRecipes, type Searchable, type RecipeSort, type CookedFilter } from './recipe-search.ts'
import RecipeBrowseControls from './RecipeBrowseControls.tsx'

/** Shared recipe browsing UI; callers supply rows and their surrounding meal actions. */
export default function RecipeSelector<R extends Searchable>({ recipes, currentId, basics = false, searchLabel, autoFocus = true, suggestedIds, renderRecipe, onPick, onEmptyEnter, beforeResults, extraControls, savedRow, emptyMessage }: {
  recipes: R[]; currentId?: string | null; basics?: boolean; searchLabel?: string; autoFocus?: boolean; suggestedIds?: Set<string>
  renderRecipe: (recipe: R) => ReactNode; onPick: (recipe: R) => void; onEmptyEnter?: (query: string) => void
  beforeResults?: (query: string, shown: R[]) => ReactNode; extraControls?: ReactNode; savedRow?: ReactNode; emptyMessage?: ReactNode
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<RecipeSort>(suggestedIds ? 'suggested' : 'favorites')
  const [cooked, setCooked] = useState<CookedFilter>('all')
  const shown = pickerRecipes(recipes, query, currentId, basics, { sort, cooked, suggestedIds })
  return <div className="recipe-picker" onKeyDown={e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    if ((e.target as HTMLElement).tagName === 'SELECT') return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('input[type="search"], .recipe-selector-results button')]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    const next = items[index + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) { e.preventDefault(); next.focus() }
  }}>
    <div className="field"><label htmlFor={id}>{searchLabel ?? t('Find a recipe')}</label>
      <input id={id} type="search" data-autofocus={autoFocus || undefined} placeholder={t('Recipe name or ingredient')} value={query} onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (shown[0]) onPick(shown[0]); else onEmptyEnter?.(query.trim()) } }} /></div>
    <div className="recipe-browse-controls"><RecipeBrowseControls sort={sort} cooked={cooked} onSort={setSort} onCooked={setCooked} suggested={!!suggestedIds} /></div>
    {extraControls}
    {beforeResults?.(query, shown)}
    <div className="sheet-links recipe-selector-results">
      {!query.trim() && cooked === 'all' && savedRow}
      {shown.map(renderRecipe)}
    </div>
    {!shown.length && <p className="state-card">{emptyMessage ?? t('No recipes match')}</p>}
  </div>
}
