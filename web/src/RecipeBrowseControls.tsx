import { useId } from 'react'
import { t } from './i18n.ts'
import type { CookedFilter, RecipeSort } from './recipe-search.ts'

/** The same sorting and cooking-history choices in every recipe selector and the library. */
export default function RecipeBrowseControls({ sort, cooked, onSort, onCooked, suggested = false }: {
  suggested?: boolean; sort: RecipeSort; cooked: CookedFilter; onSort: (value: RecipeSort) => void; onCooked: (value: CookedFilter) => void
}) {
  const id = useId()
  return <>
    <div className="field"><label htmlFor={`${id}-cooked`}>{t('Cooking history')}</label><select id={`${id}-cooked`} value={cooked} onChange={e => onCooked(e.target.value as CookedFilter)}>
      <option value="all">{t('All recipes')}</option><option value="cooked">{t('Cooked')}</option><option value="never">{t('Never cooked')}</option>
    </select></div>
    <div className="field"><label htmlFor={`${id}-sort`}>{t('Sort')}</label><select id={`${id}-sort`} value={sort} onChange={e => onSort(e.target.value as RecipeSort)}>
      {suggested && <option value="suggested">{t('Use food soon first')}</option>}
      <option value="name">{t('Name')}</option><option value="favorites">{t('Favorites first')}</option><option value="rating">{t('Top rated')}</option>
      <option value="newest">{t('Date added: newest first')}</option><option value="oldest">{t('Date added: oldest first')}</option>
      <option value="most-cooked">{t('Most cooked')}</option><option value="last-cooked">{t('Last cooked')}</option>
    </select></div>
  </>
}
