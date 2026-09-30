// JSON shapes mirror the meal API. Dates are household calendar dates, never week ids.
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type MealKind = 'recipe' | 'freeform' | 'dining_out'
export type MealStatus = 'planned' | 'prepared' | 'handled'
export interface IngredientInput {
  name: string
  quantity: number | null
  unit: string | null
  preparation: string | null
  qualifier: string | null
  category: string | null
  sort: number
  basicId?: string | null // the basic this line is made from (a recipe with kind 'basic')
}
export interface RecipeIngredient extends IngredientInput { id: string; normalizedName: string; scalable: boolean /* amount scales with servings */; basicName?: string | null }
/** meal: the default; basic: a component used inside other recipes (seasoning blend, sauce, dough). */
export type RecipeKind = 'meal' | 'basic'
/** A structured recipe step; imageUrl is shown through api.recipeStepImageUrl, never loaded directly. */
export interface StepTimer { name: string | null; minutes: number }
/** A structured recipe step; imageUrl is shown through api.recipeStepImageUrl, never loaded directly.
 * title and timers are optional: steps saved before them (and plain-text steps) have neither. */
export interface RecipeStep { text: string; bullets: string[]; imageUrl?: string | null; title?: string | null; timers?: StepTimer[] }
export interface RecipeInput {
  name: string
  description: string | null
  instructions: string | null
  steps?: RecipeStep[] | null // when set, what the view shows; instructions then mirrors them as text
  preparationNotes: string | null
  sourceUrl: string | null
  imageUrl?: string | null // shown through api.recipeImageUrl, never loaded directly
  defaultServings: number
  prepMinutes?: number | null
  totalMinutes?: number | null
  archived: boolean
  ingredients: IngredientInput[]
  kind?: RecipeKind
  makes?: string | null // how much it makes, e.g. "about ½ cup" (basics)
}
export interface RecipeRating { average: number | null; count: number; byMember: Record<string, number> /* member id -> 1-5 stars */ }
/** A recipe's public link (/r/{token}); parents' devices only. */
export interface RecipeShare { url: string; createdAt: string }
export interface Recipe extends Omit<RecipeInput, 'ingredients'> {
  id: string
  ingredients: RecipeIngredient[]
  rating?: RecipeRating
  share?: RecipeShare | null
  createdAt: string
  updatedAt: string
}
/** What POST /api/recipes/import-url and /parse-text read, before anything is saved. */
export interface RecipePreview {
  name: string; description: string | null; imageUrl: string | null; sourceUrl: string | null
  servings: number | null; prepMinutes: number | null; totalMinutes: number | null
  // qualifier, preparation and category come only from a Kinwall share link; import those whole.
  ingredients: { text: string; name: string; quantity: number | null; unit: string | null; qualifier?: string | null; preparation?: string | null; category?: string | null; basic?: string | null }[]
  steps: RecipeStep[]
  kind?: RecipeKind; makes?: string | null // from a Kinwall share link
}
// updates: the recipe already imported from this address, which saving replaces.
export interface RecipePreviewResult { recipe: RecipePreview; warnings: string[]; updates?: { id: string; name: string } }
/** POST /api/recipes/import: upserts by source + externalId (a web recipe is keyed by its address). */
export interface RecipeImport {
  source: string; externalId: string; name: string; description?: string | null; sourceUrl?: string | null; imageUrl?: string
  servings?: number; prepMinutes?: number | null; totalMinutes?: number | null; kind?: RecipeKind; makes?: string | null; ingredients: (string | RecipePreview['ingredients'][number])[]; steps?: RecipeStep[]
}
export interface RecipeSnapshot { name: string; defaultServings: number; prepMinutes?: number | null; totalMinutes?: number | null; ingredients: RecipeIngredient[] }
export interface MealInput {
  date: string
  slot: MealSlot
  title: string
  mealKind: MealKind
  recipeId: string | null
  servings: number
  assigneeMemberId: string | null // who's cooking
  eaterIds: string[] // who's eating
  notes: string | null
  plannedTime: string | null
  status: MealStatus
  sourceUrl: string | null
}
export interface Meal extends MealInput {
  id: string
  recipeSnapshot: RecipeSnapshot | null
  calendarEventId: string | null
  calendarEventStart?: 'meal' | 'cooking' | null // set when Kinwall created the event (it follows the meal); null = an event you linked
  createdAt: string
  updatedAt: string
}
export interface ProjectionSource {
  sourceRef: string
  mealId: string
  date: string
  slot: MealSlot
  title: string
  recipeName: string
  quantity: number | null
  unit: string | null
  qualifier: string | null
  preparation: string | null
  scalable: boolean
  servings: number
  defaultServings: number
  applied: boolean
  changedSinceApplied: boolean
  basicName?: string | null // one of a basic's own ingredients: that basic
}
export interface ProjectionItem {
  key: string
  name: string
  normalizedName: string
  quantity: number | null
  unit: string | null
  qualifier: string | null
  category: string | null
  scalable: boolean
  sources: ProjectionSource[]
  matches: { id: string; title: string; quantity: string | null; done: boolean }[]
  applied: boolean
  partiallyApplied: boolean
  changedSinceApplied: boolean
  basicId?: string | null // made from this basic: ask whether it's made already
  basicName?: string | null
}
/** For lines made from a basic, by basic id: made already (skip it), or add its own ingredients. */
export type BasicChoices = Record<string, 'made' | 'ingredients'>
/** Qualifier the server gives imported meal-kit ingredients that ship in the box (server/src/meal-schemas.ts). */
export const KIT_QUALIFIER = 'in the kit'
export interface ShoppingProjection { from: string; to: string; listId: string | null; items: ProjectionItem[] }
