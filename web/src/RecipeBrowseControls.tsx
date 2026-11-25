import { Choose } from './PickField.tsx'
import { useId } from 'react'
import { t } from './i18n.ts'
import type { CookedFilter, RecipeSort } from './recipe-search.ts'

/** The same sorting and cooking-history choices in every recipe selector and the library. */
export default function RecipeBrowseControls({ sort, cooked, onSort, onCooked, suggested = false }: {
  suggested?: boolean; sort: RecipeSort; cooked: CookedFilter; onSort: (value: RecipeSort) => void; onCooked: (value: CookedFilter) => void
}) {
  const id = useId()
  return <>
    <div className="field"><label htmlFor={`${id}-cooked`}>{t('Cooking history')}</label><Choose hideLabel label={t('Cooking history')} id={`${id}-cooked`} value={String(cooked)} onChange={next => onCooked(next as CookedFilter)}
      options={[
        { value: 'all', label: t('All recipes') },
        { value: 'cooked', label: t('Cooked') },
        { value: 'never', label: t('Never cooked') },
      ]} /></div>
    <div className="field"><label htmlFor={`${id}-sort`}>{t('Sort')}</label><Choose hideLabel label={t('Sort')} id={`${id}-sort`} value={String(sort)} onChange={next => onSort(next as RecipeSort)}
      options={[
        ...(suggested ? [{ value: 'suggested', label: t('Use food soon first') }] : []),
        { value: 'name', label: t('Name') },
        { value: 'favorites', label: t('Favorites first') },
        { value: 'rating', label: t('Top rated') },
        { value: 'newest', label: t('Date added: newest first') },
        { value: 'oldest', label: t('Date added: oldest first') },
        { value: 'most-cooked', label: t('Most cooked') },
        { value: 'last-cooked', label: t('Last cooked') },
      ]} /></div>
  </>
}
