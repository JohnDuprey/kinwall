// Finding a recipe: the Recipe library's search box and the meal sheet's recipe picker.
export type Searchable = { id: string; name: string; description?: string | null; archived?: boolean; kind?: 'meal' | 'basic'; ingredients?: { name: string }[]; favoritedBy?: string[]; createdAt?: string; cookedCount?: number; lastCookedDate?: string | null; rating?: { average: number | null; count: number } }

/** Name, description or an ingredient contains the text (any case); blank matches every recipe. */
export function recipeMatches(recipe: Searchable, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || `${recipe.name} ${recipe.description ?? ''} ${(recipe.ingredients ?? []).map(i => i.name).join(' ')}`.toLocaleLowerCase().includes(needle)
}

export type RecipeSort = 'suggested' | 'name' | 'favorites' | 'rating' | 'newest' | 'oldest' | 'most-cooked' | 'last-cooked'
export type CookedFilter = 'all' | 'cooked' | 'never'
export type RecipeBrowse = { query?: string; sort?: RecipeSort; cooked?: CookedFilter; suggestedIds?: Set<string> }

/** Shared by the library, meal chooser and poll picker. History covers marked-cooked meals only. */
export function browseRecipes<R extends Searchable>(recipes: R[], { query = '', sort = 'name', cooked = 'all', suggestedIds }: RecipeBrowse = {}): R[] {
  return recipes.filter(r => recipeMatches(r, query) && (cooked === 'all' || (cooked === 'cooked' ? (r.cookedCount ?? 0) > 0 : !(r.cookedCount ?? 0))))
    .sort((a, b) => {
      let order = 0
      if (sort === 'suggested') order = Number(suggestedIds?.has(b.id) ?? false) - Number(suggestedIds?.has(a.id) ?? false)
      if (sort === 'favorites') order = Number(!!b.favoritedBy?.length) - Number(!!a.favoritedBy?.length)
      if (sort === 'rating') order = (b.rating?.average ?? 0) - (a.rating?.average ?? 0) || (b.rating?.count ?? 0) - (a.rating?.count ?? 0)
      if (sort === 'newest' || sort === 'oldest') order = (a.createdAt ?? '').localeCompare(b.createdAt ?? '') * (sort === 'newest' ? -1 : 1)
      if (sort === 'most-cooked') order = (b.cookedCount ?? 0) - (a.cookedCount ?? 0)
      if (sort === 'last-cooked') order = (b.lastCookedDate ?? '').localeCompare(a.lastCookedDate ?? '')
      return order || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id)
    })
}

/** Archived recipes and basics stay out unless already chosen or explicitly requested. */
export function pickerRecipes<R extends Searchable>(recipes: R[], query: string, currentId?: string | null, basics = false, options: RecipeBrowse = {}): R[] {
  return browseRecipes(recipes.filter(r => (!r.archived && (basics || r.kind !== 'basic')) || r.id === currentId), { sort: 'favorites', ...options, query })
}

// Words an ingredient line adds to a basic's name without meaning another thing ("Taco seasoning blend").
const FILLER = new Set(['blend', 'mix', 'homemade'])
/** A name as basics match it: any case, punctuation and spacing, without filler words (the server's
 * rule, server/src/meals.ts basicKey, which links imported recipes the same way). */
export function basicKey(name: string): string {
  const words = name.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const kept = words.filter(w => !FILLER.has(w))
  return (kept.length ? kept : words).join(' ')
}
/** The one basic an ingredient's name matches, or null when none or several do (never `selfId`). */
export function matchBasic<B extends { id: string; name: string }>(name: string, basics: B[], selfId?: string): B | null {
  const key = basicKey(name)
  const found = key ? basics.filter(b => b.id !== selfId && basicKey(b.name) === key) : []
  return found.length === 1 ? found[0] : null
}
