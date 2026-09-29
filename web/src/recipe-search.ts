// Finding a recipe: the Recipe library's search box and the meal sheet's recipe picker.
type Searchable = { id: string; name: string; description?: string | null; archived: boolean; kind?: 'meal' | 'basic'; ingredients: { name: string }[] }

/** Name, description or an ingredient contains the text (any case); blank matches every recipe. */
export function recipeMatches(recipe: Searchable, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || `${recipe.name} ${recipe.description ?? ''} ${recipe.ingredients.map(i => i.name).join(' ')}`.toLocaleLowerCase().includes(needle)
}

/** What the meal sheet's picker lists: matching recipes by name; archived ones, and basics unless
 * `basics`, only when already chosen. */
export function pickerRecipes<R extends Searchable>(recipes: R[], query: string, currentId?: string | null, basics = false): R[] {
  return recipes.filter(r => ((!r.archived && (basics || r.kind !== 'basic')) || r.id === currentId) && recipeMatches(r, query))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
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
