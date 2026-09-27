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
}
export interface RecipeIngredient extends IngredientInput { id: string; normalizedName: string; scalable: boolean /* amount scales with servings */ }
export interface RecipeInput {
  name: string
  description: string | null
  instructions: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  defaultServings: number
  archived: boolean
  ingredients: IngredientInput[]
}
export interface Recipe extends Omit<RecipeInput, 'ingredients'> {
  id: string
  ingredients: RecipeIngredient[]
  createdAt: string
  updatedAt: string
}
export interface RecipeSnapshot { name: string; defaultServings: number; ingredients: RecipeIngredient[] }
export interface MealInput {
  date: string
  slot: MealSlot
  title: string
  mealKind: MealKind
  recipeId: string | null
  servings: number
  assigneeMemberId: string | null
  notes: string | null
  plannedTime: string | null
  status: MealStatus
  sourceUrl: string | null
}
export interface Meal extends MealInput {
  id: string
  recipeSnapshot: RecipeSnapshot | null
  calendarEventId: string | null
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
}
/** Qualifier the server gives imported meal-kit ingredients that ship in the box (server/src/meal-schemas.ts). */
export const KIT_QUALIFIER = 'in the kit'
export interface ShoppingProjection { from: string; to: string; listId: string | null; items: ProjectionItem[] }
