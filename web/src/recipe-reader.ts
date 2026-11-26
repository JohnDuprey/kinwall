import type { Recipe } from './meal-types.ts'

/** The public recipe page's content, without family notes, ratings, tags or sharing credentials. */
export function recipeReaderContent(recipe: Recipe) {
  let sourceUrl: string | null = null
  try { if (recipe.sourceUrl && /^https?:$/.test(new URL(recipe.sourceUrl).protocol)) sourceUrl = recipe.sourceUrl } catch { /* an older recipe may have an invalid source */ }
  return {
    id: recipe.id, name: recipe.name, description: recipe.description, imageUrl: recipe.imageUrl,
    defaultServings: recipe.defaultServings, kind: recipe.kind, makes: recipe.makes,
    prepMinutes: recipe.prepMinutes, totalMinutes: recipe.totalMinutes, updatedAt: recipe.updatedAt,
    ingredients: recipe.ingredients, sourceUrl,
    steps: recipe.steps?.length ? recipe.steps.map(step => ({ title: step.title ?? null, text: step.text, bullets: step.bullets, imageUrl: step.imageUrl ?? null }))
      : (recipe.instructions ?? '').split('\n').map(line => line.replace(/^\s*\d+[.)]\s+/, '').trim()).filter(Boolean)
        .map(text => ({ title: null, text, bullets: [], imageUrl: null })),
  }
}
