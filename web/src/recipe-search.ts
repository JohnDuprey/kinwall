// Finding a recipe: the Recipe library's search box and the meal sheet's recipe picker.
type Searchable = { id: string; name: string; description?: string | null; archived: boolean; ingredients: { name: string }[] }

/** Name, description or an ingredient contains the text (any case); blank matches every recipe. */
export function recipeMatches(recipe: Searchable, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || `${recipe.name} ${recipe.description ?? ''} ${recipe.ingredients.map(i => i.name).join(' ')}`.toLocaleLowerCase().includes(needle)
}

/** What the meal sheet's picker lists: matching recipes by name, archived ones only when already chosen. */
export function pickerRecipes<R extends Searchable>(recipes: R[], query: string, currentId?: string | null): R[] {
  return recipes.filter(r => (!r.archived || r.id === currentId) && recipeMatches(r, query))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}
