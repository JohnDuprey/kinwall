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
const stepLine = z.string().trim().max(2000);
export const StepTimerSchema = z.object({
  name: z.string().trim().max(100).nullable().describe('What the timer is for, e.g. "Veggies" (null: unnamed).'),
  minutes: z.number().positive().max(1440),
}).strict().openapi('RecipeStepTimer');
export const RecipeStepInputSchema = z.object({
  text: z.string().trim().max(10000).optional().describe('The step itself; a text with several lines and no bullets becomes bullets.'),
  bullets: z.array(stepLine).max(50).optional().describe('Short instructions within the step, one per line.'),
  imageUrl: url.optional().describe('Photo for this step (served through GET /api/recipes/{id}/steps/{n}/image).'),
  title: z.string().trim().max(200).nullable().optional().describe('A short heading for the step, e.g. "Roast the veggies".'),
  timers: z.array(StepTimerSchema).max(10).optional().describe('Timers for this step; cooking mode offers these instead of durations found in the text.'),
}).strict().openapi('RecipeStepInput');
export const RecipeStepSchema = z.object({
  text: z.string(), bullets: z.array(z.string()).default([]), imageUrl: url.default(null),
  title: z.string().nullable().default(null), timers: z.array(StepTimerSchema).default([]),
}).openapi('RecipeStep');
const steps = z.array(RecipeStepInputSchema).max(100).nullable()
  .describe('Structured steps; when set they replace instructions, which is kept as the same steps in numbered text. null clears them (instructions stays as sent).');
export const RecipeInputSchema = z.object({
  name: z.string().trim().min(1).max(200), description: text.optional(), instructions: text.optional(),
  preparationNotes: text.optional(), sourceUrl: url.optional(), imageUrl: url.optional().describe('Photo link (served through GET /api/recipes/{id}/image).'), defaultServings: servings.optional(),
  steps: steps.optional(),
  prepMinutes: minutes.optional(), totalMinutes: minutes.optional(),
  archived: z.boolean().optional(), ingredients: z.array(IngredientInputSchema).max(300).optional(),
}).strict().openapi('RecipeInput');
export const RecipeSchema = z.object({
  id: z.string(), name: z.string(), description: text, instructions: text, preparationNotes: text, sourceUrl: url,
  defaultServings: servings, archived: z.boolean(), ingredients: z.array(IngredientSchema),
  // Set on imported recipes (POST /api/recipes/import); optional so older exports still import.
  prepMinutes: minutes.optional(), totalMinutes: minutes.optional(),
  source: z.string().nullable().optional(), externalId: z.string().nullable().optional(), imageUrl: url.optional(),
  steps: z.array(RecipeStepSchema).nullable().optional().describe('Structured steps (null: the recipe only has instructions text).'),
  // Optional so older exports still import.
  rating: z.object({
    average: z.number().nullable().describe('Family average, 1-5 (null: no ratings yet).'), count: z.number().int(),
    byMember: z.record(z.string(), z.number().int().min(1).max(5)).describe('Stars by member id.'),
  }).optional(),
  createdAt: z.string(), updatedAt: z.string(),
}).openapi('Recipe');
export const RecipeRatingInputSchema = z.object({
  memberId: z.string(), stars: z.number().int().min(0).max(5).nullable().describe('1-5 stars; 0 or null clears the rating.'),
}).strict().openapi('RecipeRatingInput');
/** An ingredient on a meal-kit recipe that ships in the box: grocery lists skip it unless asked. */
export const KIT_QUALIFIER = 'in the kit';
/** A meal's calendar event starts at the meal time, or when cooking starts (ending at the meal time). */
export const MealEventStartSchema = z.enum(['meal', 'cooking']);
export const RecipeImportSchema = z.object({
  source: z.string().trim().min(1).max(50).describe('Where the recipe comes from, e.g. hellofresh.'),
  externalId: z.string().trim().min(1).max(2000).describe("The source's own recipe id (for a web page, its address); importing it again updates the same recipe."),
  name: z.string().trim().min(1).max(200), description: text.optional(), sourceUrl: url.optional().describe('Recipe card link.'), imageUrl: url.optional(),
  servings: servings.optional().describe('Servings the ingredient amounts are for.'),
  prepMinutes: minutes.optional().describe('Hands-on prep time in minutes.'), totalMinutes: minutes.optional().describe('Total time in minutes, prep included.'),
  ingredients: z.array(z.union([
    z.string().trim().min(1).max(300),
    z.object({ text: z.string().trim().min(1).max(300), pantry: z.boolean().optional(), category: z.string().trim().max(100).nullable().optional() }).strict(),
  ])).max(300).describe('Lines like "1.5 tablespoon Sour Cream". pantry: false marks one that ships in the kit (skipped on grocery lists by default); strings and pantry: true are regular groceries.'),
  steps: z.array(z.union([z.string().trim().min(1).max(10000), RecipeStepInputSchema])).max(100).optional()
    .describe('The steps, as text (a step with several lines becomes a step of bullets) or { text, bullets, imageUrl, title, timers }.'),
  plan: z.object({ date: MealDateSchema, slot: MealSlotSchema, servings: servings.optional(), eaterIds: eaterIds.optional(),
    calendarId: z.string().min(1).optional().describe('Also put the planned meal on this Kinwall calendar (any writable one, synced calendars included), unless it already has an event.'),
    eventStart: MealEventStartSchema.optional().describe('With calendarId: start the event at the meal time (default) or when cooking starts.'),
  }).strict().optional()
    .describe('Also plan it on this date and slot, unless that slot already has a meal (planned: false).'),
}).strict().openapi('RecipeImport');
export const RecipeImportResultSchema = z.object({
  recipeId: z.string(), created: z.boolean(), planned: z.boolean(), mealId: z.string().optional(), reason: z.string().optional(),
  calendarEventId: z.string().optional(), calendarError: z.string().optional().describe('Why plan.calendarId got no event (the meal is still planned).'),
}).openapi('RecipeImportResult');
export const RecipePreviewSchema = z.object({
  name: z.string().describe('Empty when the page or text had no name.'), description: z.string().nullable(), imageUrl: z.string().nullable(), sourceUrl: z.string().nullable(),
  servings: z.number().nullable(), prepMinutes: z.number().nullable(), totalMinutes: z.number().nullable(),
  ingredients: z.array(z.object({ text: z.string().describe('The line as written; send these to POST /api/recipes/import to save.'), name: z.string(), quantity: z.number().nullable(), unit: z.string().nullable() })),
  steps: z.array(z.object({ text: z.string(), bullets: z.array(z.string()) })),
}).openapi('RecipePreview');
export const RecipeUrlImportSchema = z.object({
  url: z.string().trim().url().max(2000).describe('A recipe page (https). Read from its schema.org Recipe data.'),
  save: z.boolean().optional().describe('Also save it (source "web", keyed by the page address: importing it again updates the same recipe). Default: preview only.'),
}).strict().openapi('RecipeUrlImport');
export const RecipeTextParseSchema = z.object({
  text: z.string().min(1).max(100000).describe('The recipe as text: a name, an "Ingredients" heading over one ingredient per line, then a "Directions" (or Instructions, Method, Steps) heading over the steps.'),
  url: url.optional().describe('Where it came from, kept as the source link.'),
}).strict().openapi('RecipeTextParse');
export const RecipePreviewResultSchema = z.object({
  recipe: RecipePreviewSchema, warnings: z.array(z.string()),
  recipeId: z.string().optional().describe('With save: the saved recipe.'), created: z.boolean().optional(),
}).openapi('RecipePreviewResult');
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
  calendarEventId: z.string().nullable(),
  calendarEventStart: MealEventStartSchema.nullable().default(null).describe('Set when Kinwall created the event (it then follows the meal): when it starts. null for an event you linked yourself, which is never changed.'),
  status: z.enum(['planned', 'prepared', 'handled']), sourceUrl: url,
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
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type Meal = z.infer<typeof MealSchema>;
export type Projection = z.infer<typeof ProjectionSchema>;
