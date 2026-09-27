import { z } from '@hono/zod-openapi';

export const MealDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}, 'must be a real YYYY-MM-DD date');
const text = z.string().trim().max(10000).nullable();
const url = z.string().url().max(2000).refine((s) => /^https?:\/\//i.test(s), 'must be an HTTP or HTTPS URL').nullable();
const servings = z.number().positive().max(10000);
const minutes = z.number().int().min(0).max(10000).nullable();
const eaterIds = z.array(z.string().min(1)).max(100).describe("Who's eating (member ids). Without servings, servings becomes how many.");
export const MealSlotSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const IngredientInputSchema = z.object({
  name: z.string().trim().min(1).max(200), quantity: z.number().min(0).max(1000000).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(), preparation: text.optional(),
  qualifier: z.string().trim().max(100).nullable().optional(), category: z.string().trim().max(100).nullable().optional(),
  sort: z.number().int().min(0).optional(),
}).strict();
export const IngredientSchema = IngredientInputSchema.extend({
  id: z.string(), normalizedName: z.string(), quantity: z.number().min(0).nullable(), unit: z.string().nullable(),
  preparation: z.string().nullable(), qualifier: z.string().nullable(), category: z.string().nullable(), sort: z.number().int(),
  scalable: z.boolean(), // the amount scales with servings (a count or measure, not a can, jar or bunch, and no qualifier)
}).openapi('RecipeIngredient');
export const RecipeInputSchema = z.object({
  name: z.string().trim().min(1).max(200), description: text.optional(), instructions: text.optional(),
  preparationNotes: text.optional(), sourceUrl: url.optional(), defaultServings: servings.optional(),
  prepMinutes: minutes.optional(), totalMinutes: minutes.optional(),
  archived: z.boolean().optional(), ingredients: z.array(IngredientInputSchema).max(300).optional(),
}).strict().openapi('RecipeInput');
export const RecipeSchema = z.object({
  id: z.string(), name: z.string(), description: text, instructions: text, preparationNotes: text, sourceUrl: url,
  defaultServings: servings, archived: z.boolean(), ingredients: z.array(IngredientSchema),
  // Set on imported recipes (POST /api/recipes/import); optional so older exports still import.
  prepMinutes: minutes.optional(), totalMinutes: minutes.optional(),
  source: z.string().nullable().optional(), externalId: z.string().nullable().optional(), imageUrl: url.optional(),
  createdAt: z.string(), updatedAt: z.string(),
}).openapi('Recipe');
/** An ingredient on a meal-kit recipe that ships in the box: grocery lists skip it unless asked. */
export const KIT_QUALIFIER = 'in the kit';
export const RecipeImportSchema = z.object({
  source: z.string().trim().min(1).max(50).describe('Where the recipe comes from, e.g. hellofresh.'),
  externalId: z.string().trim().min(1).max(200).describe("The source's own recipe id; importing it again updates the same recipe."),
  name: z.string().trim().min(1).max(200), description: text.optional(), sourceUrl: url.optional().describe('Recipe card link.'), imageUrl: url.optional(),
  servings: servings.optional().describe('Servings the ingredient amounts are for.'),
  prepMinutes: minutes.optional().describe('Hands-on prep time in minutes.'), totalMinutes: minutes.optional().describe('Total time in minutes, prep included.'),
  ingredients: z.array(z.union([
    z.string().trim().min(1).max(300),
    z.object({ text: z.string().trim().min(1).max(300), pantry: z.boolean().optional(), category: z.string().trim().max(100).nullable().optional() }).strict(),
  ])).max(300).describe('Lines like "1.5 tablespoon Sour Cream". pantry: false marks one that ships in the kit (skipped on grocery lists by default); strings and pantry: true are regular groceries.'),
  steps: z.array(z.string().trim().min(1).max(10000)).max(100).optional().describe('Saved as numbered instructions.'),
  plan: z.object({ date: MealDateSchema, slot: MealSlotSchema, servings: servings.optional(), eaterIds: eaterIds.optional() }).strict().optional()
    .describe('Also plan it on this date and slot, unless that slot already has a meal (planned: false).'),
}).strict().openapi('RecipeImport');
export const RecipeImportResultSchema = z.object({
  recipeId: z.string(), created: z.boolean(), planned: z.boolean(), mealId: z.string().optional(), reason: z.string().optional(),
}).openapi('RecipeImportResult');
export const RecipeSnapshotSchema = z.object({ name: z.string(), defaultServings: servings, prepMinutes: minutes.optional(), totalMinutes: minutes.optional(), ingredients: z.array(IngredientSchema) }).openapi('RecipeSnapshot');
export const MealInputSchema = z.object({
  date: MealDateSchema, slot: MealSlotSchema, title: z.string().trim().min(1).max(200).optional(),
  mealKind: z.enum(['recipe', 'freeform', 'dining_out']).optional(), recipeId: z.string().nullable().optional(),
  servings: servings.optional(), assigneeMemberId: z.string().nullable().optional().describe("Who's cooking."), eaterIds: eaterIds.optional(), notes: text.optional(),
  plannedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  status: z.enum(['planned', 'prepared', 'handled']).optional(), sourceUrl: url.optional(),
}).strict().openapi('MealInput');
export const MealPatchSchema = MealInputSchema.partial().extend({ refreshRecipe: z.boolean().optional() }).strict().openapi('MealPatch');
export const MealSchema = z.object({
  id: z.string(), date: MealDateSchema, slot: MealSlotSchema, title: z.string(),
  mealKind: z.enum(['recipe', 'freeform', 'dining_out']), recipeId: z.string().nullable(), recipeSnapshot: RecipeSnapshotSchema.nullable(),
  servings, assigneeMemberId: z.string().nullable(), eaterIds: z.array(z.string()).default([]), notes: text, plannedTime: z.string().nullable(),
  calendarEventId: z.string().nullable(), status: z.enum(['planned', 'prepared', 'handled']), sourceUrl: url,
  createdAt: z.string(), updatedAt: z.string(),
}).openapi('Meal');
export const MealRangeSchema = z.object({ from: MealDateSchema, to: MealDateSchema }).refine((r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86400000 <= 366, 'range must be ordered and at most 367 days');
export const ProjectionQuerySchema = MealRangeSchema.safeExtend({ listId: z.string().optional() });
export const ProjectionApplySchema = MealRangeSchema.safeExtend({ listId: z.string().min(1), omitKeys: z.array(z.string()).max(10000).optional(), includeNotes: z.boolean().optional(), includeKitItems: z.boolean().optional() }).strict();
export const ProjectionSourceSchema = z.object({
  sourceRef: z.string(), mealId: z.string(), date: MealDateSchema, slot: MealSlotSchema, title: z.string(), recipeName: z.string(),
  quantity: z.number().nullable(), unit: z.string().nullable(), qualifier: z.string().nullable(), preparation: z.string().nullable(),
  scalable: z.boolean(), servings: z.number(), defaultServings: z.number(), applied: z.boolean(), changedSinceApplied: z.boolean(),
});
export const ProjectionItemSchema = z.object({
  key: z.string(), name: z.string(), normalizedName: z.string(), quantity: z.number().nullable(), unit: z.string().nullable(),
  qualifier: z.string().nullable(), category: z.string().nullable(), scalable: z.boolean(), sources: z.array(ProjectionSourceSchema),
  matches: z.array(z.object({ id: z.string(), title: z.string(), quantity: z.string().nullable(), done: z.boolean() })),
  applied: z.boolean(), partiallyApplied: z.boolean(), changedSinceApplied: z.boolean(),
});
export const ProjectionSchema = z.object({ from: MealDateSchema, to: MealDateSchema, listId: z.string().nullable(), items: z.array(ProjectionItemSchema) }).openapi('MealShoppingProjection');
export type Recipe = z.infer<typeof RecipeSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type Meal = z.infer<typeof MealSchema>;
export type Projection = z.infer<typeof ProjectionSchema>;
