import { z } from '@hono/zod-openapi';

export const MealDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const date = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === s;
}, 'must be a real YYYY-MM-DD date');
const text = z.string().trim().max(10000).nullable();
const url = z.string().url().max(2000).refine((s) => /^https?:\/\//i.test(s), 'must be an HTTP or HTTPS URL').nullable();
const servings = z.number().positive().max(10000);
const minutes = z.number().int().min(0).max(10000).nullable();
export const RecipeKindSchema = z.enum(['meal', 'basic']).describe('meal (the default), or basic: a component used inside other recipes, like a seasoning blend, sauce or dough.');
const makes = z.string().trim().max(200).nullable().describe('How much it makes, e.g. "about ½ cup" (shown on basics).');
const eaterIds = z.array(z.string().min(1)).max(100).describe("Who's eating (member ids). Without servings, servings becomes how many.");
export const MealSlotSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const IngredientInputSchema = z.object({
  name: z.string().trim().min(1).max(200), quantity: z.number().min(0).max(1000000).nullable().optional(),
  unit: z.string().trim().max(50).nullable().optional(), preparation: text.optional(),
  qualifier: z.string().trim().max(100).nullable().optional(), category: z.string().trim().max(100).nullable().optional(),
  sort: z.number().int().min(0).optional(),
  basicId: z.string().nullable().optional().describe('The basic (a recipe with kind "basic") this line is made from; null unlinks. Left out when editing a line of the same name and unit, it keeps its link. An id that is not a basic is ignored.'),
}).strict();
export const IngredientSchema = IngredientInputSchema.extend({
  id: z.string(), normalizedName: z.string(), quantity: z.number().min(0).nullable(), unit: z.string().nullable(),
  preparation: z.string().nullable(), qualifier: z.string().nullable(), category: z.string().nullable(), sort: z.number().int(),
  scalable: z.boolean(), // the amount scales with servings (a count or measure, not a can, jar or bunch, and no qualifier)
  // Optional so older exports and meal snapshots still read.
  basicId: z.string().nullable().optional(), basicName: z.string().nullable().optional().describe("The linked basic's name (read only)."),
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
  kind: RecipeKindSchema.optional(), makes: makes.optional(),
}).strict().openapi('RecipeInput');
export const RecipeSchema = z.object({
  id: z.string(), name: z.string(), description: text, instructions: text, preparationNotes: text, sourceUrl: url,
  defaultServings: servings, archived: z.boolean(), ingredients: z.array(IngredientSchema),
  // Defaults so older exports still import.
  kind: RecipeKindSchema.default('meal'), makes: makes.default(null),
  // Set on imported recipes (POST /api/recipes/import); optional so older exports still import.
  prepMinutes: minutes.optional(), totalMinutes: minutes.optional(),
  source: z.string().nullable().optional(), externalId: z.string().nullable().optional(), imageUrl: url.optional(),
  steps: z.array(RecipeStepSchema).nullable().optional().describe('Structured steps (null: the recipe only has instructions text).'),
  // Optional so older exports still import.
  rating: z.object({
    average: z.number().nullable().describe('Family average, 1-5 (null: no ratings yet).'), count: z.number().int(),
    byMember: z.record(z.string(), z.number().int().min(1).max(5)).describe('Stars by member id.'),
  }).optional(),
  share: z.object({ url: z.string(), createdAt: z.string() }).nullable().optional().describe('Admin keys only: the public link (POST /api/recipes/{id}/share), or null when not shared.'),
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
  kind: RecipeKindSchema.optional(), makes: makes.optional(),
  servings: servings.optional().describe('Servings the ingredient amounts are for.'),
  prepMinutes: minutes.optional().describe('Hands-on prep time in minutes.'), totalMinutes: minutes.optional().describe('Total time in minutes, prep included.'),
  ingredients: z.array(z.union([
    z.string().trim().min(1).max(300),
    z.object({ text: z.string().trim().min(1).max(300), pantry: z.boolean().optional(), category: z.string().trim().max(100).nullable().optional(),
      name: z.string().trim().min(1).max(300).optional(), quantity: IngredientInputSchema.shape.quantity, unit: IngredientInputSchema.shape.unit,
      qualifier: IngredientInputSchema.shape.qualifier, preparation: IngredientInputSchema.shape.preparation,
      basic: z.string().trim().max(200).nullable().optional() }).strict(),
  ])).max(300).describe('Lines like "1.5 tablespoon Sour Cream". pantry: false marks one that ships in the kit (skipped on grocery lists by default); strings and pantry: true are regular groceries. name, quantity, unit, qualifier and preparation, when given, are used instead of what the line says (qualifier instead of pantry). basic names the basic the line is made from: it links to the family\'s basic of that name, if there is one.'),
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
  kind: RecipeKindSchema.optional(), makes: z.string().nullable().optional().describe('kind and makes: from a Kinwall share link.'),
  ingredients: z.array(z.object({ text: z.string().describe('The line as written; send these to POST /api/recipes/import to save.'), name: z.string(), quantity: z.number().nullable(), unit: z.string().nullable(),
    qualifier: z.string().nullable().optional(), preparation: z.string().nullable().optional(), category: z.string().nullable().optional(), basic: z.string().nullable().optional() })
    .describe('qualifier, preparation, category and basic are set when the page is a Kinwall share link; then send the whole ingredient to POST /api/recipes/import, not just its text.')),
  steps: z.array(z.object({ text: z.string(), bullets: z.array(z.string()), title: z.string().nullable().optional(), imageUrl: z.string().nullable().optional(), timers: z.array(StepTimerSchema).optional() })),
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
  updates: z.object({ id: z.string(), name: z.string() }).optional().describe('Preview only: the recipe already imported from this address, which saving replaces.'),
}).openapi('RecipePreviewResult');
export const RecipeSnapshotSchema = z.object({ name: z.string(), defaultServings: servings, prepMinutes: minutes.optional(), totalMinutes: minutes.optional(), ingredients: z.array(IngredientSchema) }).openapi('RecipeSnapshot');
// Order nights: a dining_out meal from a restaurant in the binder, and each person's order.
export const OrderTypeSchema = z.enum(['dine_in', 'pickup', 'delivery']).describe('How: eat there, pickup or delivery.');
export const OrderItemSchema = z.object({
  menuItemId: z.string().max(100).nullable().default(null).describe("The menu item (from the restaurant's menu); null for something not on it."),
  name: z.string().trim().min(1).max(200).describe('What it is, kept with the order so menu edits never change it.'),
  qty: z.number().int().min(1).max(99).default(1), note: z.string().trim().max(200).nullable().default(null).describe('"No onions".'),
}).strict().openapi('MealOrderItem');
export const MealOrderInputSchema = z.object({
  items: z.array(OrderItemSchema).max(50), note: z.string().trim().max(1000).nullable().optional().describe('"I\'ll share with Leo".'),
}).strict().openapi('MealOrderInput');
export const MealOrderSchema = z.object({ memberId: z.string(), items: z.array(OrderItemSchema), note: z.string().nullable(), updatedAt: z.string() }).openapi('MealOrder');
export const MealInputSchema = z.object({
  date: MealDateSchema, slot: MealSlotSchema, title: z.string().trim().min(1).max(200).optional(),
  mealKind: z.enum(['recipe', 'freeform', 'dining_out']).optional(), recipeId: z.string().nullable().optional(),
  servings: servings.optional(), assigneeMemberId: z.string().nullable().optional().describe("Who's cooking."), eaterIds: eaterIds.optional(), notes: text.optional(),
  plannedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  status: z.enum(['planned', 'prepared']).optional().describe('planned, or prepared (shown as Cooked; for dining out, Ordered, which locks the orders for everyone but parents).'), sourceUrl: url.optional(),
  restaurantId: z.string().nullable().optional().describe('Dining out: the restaurant (from the binder). Without a title, the meal takes its name.'),
  orderType: OrderTypeSchema.nullable().optional(),
}).strict().openapi('MealInput');
export const MealPatchSchema = MealInputSchema.partial().extend({ refreshRecipe: z.boolean().optional() }).strict().openapi('MealPatch');
export const MealSchema = z.object({
  id: z.string(), date: MealDateSchema, slot: MealSlotSchema, title: z.string(),
  mealKind: z.enum(['recipe', 'freeform', 'dining_out']), recipeId: z.string().nullable(), recipeSnapshot: RecipeSnapshotSchema.nullable(),
  servings, assigneeMemberId: z.string().nullable(), eaterIds: z.array(z.string()).default([]), notes: text, plannedTime: z.string().nullable(),
  calendarEventId: z.string().nullable(),
  calendarEventStart: MealEventStartSchema.nullable().default(null).describe('Set when Kinwall created the event (it then follows the meal): when it starts. null for an event you linked yourself, which is never changed.'),
  // An export from before 0104 can say handled, which was the same as prepared.
  status: z.preprocess((v) => (v === 'handled' ? 'prepared' : v), z.enum(['planned', 'prepared'])), sourceUrl: url,
  // Defaults so older exports still import.
  restaurantId: z.string().nullable().default(null), orderType: OrderTypeSchema.nullable().default(null),
  orders: z.array(MealOrderSchema).default([]).describe("Each person's order (dining out)."),
  createdAt: z.string(), updatedAt: z.string(),
}).openapi('Meal');
export const MealRangeSchema = z.object({ from: MealDateSchema, to: MealDateSchema }).refine((r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86400000 <= 366, 'range must be ordered and at most 367 days');
export const ProjectionQuerySchema = MealRangeSchema.safeExtend({ listId: z.string().optional() });
export const BasicChoicesSchema = z.record(z.string(), z.enum(['made', 'ingredients']))
  .describe('For lines made from a basic, by basic id: made (made already: skip it) or ingredients (add the basic\'s own ingredients as written, once, instead of the line). A basic left out is added as its line.');
export const ProjectionApplySchema = MealRangeSchema.safeExtend({ listId: z.string().min(1), omitKeys: z.array(z.string()).max(10000).optional(), includeNotes: z.boolean().optional(), includeKitItems: z.boolean().optional(), basics: BasicChoicesSchema.optional() }).strict();
export const ProjectionSourceSchema = z.object({
  sourceRef: z.string(), mealId: z.string(), date: MealDateSchema, slot: MealSlotSchema, title: z.string(), recipeName: z.string(),
  quantity: z.number().nullable(), unit: z.string().nullable(), qualifier: z.string().nullable(), preparation: z.string().nullable(),
  scalable: z.boolean(), servings: z.number(), defaultServings: z.number(), applied: z.boolean(), changedSinceApplied: z.boolean(),
  basicName: z.string().nullable().optional().describe("Set when this is one of a basic's own ingredients (the basic's name)."),
});
export const ProjectionItemSchema = z.object({
  key: z.string(), name: z.string(), normalizedName: z.string(), quantity: z.number().nullable(), unit: z.string().nullable(),
  qualifier: z.string().nullable(), category: z.string().nullable(), scalable: z.boolean(), sources: z.array(ProjectionSourceSchema),
  matches: z.array(z.object({ id: z.string(), title: z.string(), quantity: z.string().nullable(), done: z.boolean() })),
  applied: z.boolean(), partiallyApplied: z.boolean(), changedSinceApplied: z.boolean(),
  basicId: z.string().nullable().optional().describe('The line is made from this basic: ask whether it is made already (apply basics).'), basicName: z.string().nullable().optional(),
});
export const ProjectionSchema = z.object({ from: MealDateSchema, to: MealDateSchema, listId: z.string().nullable(), items: z.array(ProjectionItemSchema) }).openapi('MealShoppingProjection');
// The restaurant binder (Meals → Restaurants).
const short = z.string().trim().max(200).nullable();
export const MenuItemInputSchema = z.object({
  id: z.string().min(1).max(100).optional().describe('An item already on the menu keeps its id (its star and past orders follow it); left out, a new item.'),
  section: short.optional().describe('Its section, e.g. "Pizza" or "Sides"; sections show in the order they first appear.'),
  name: z.string().trim().min(1).max(200), description: z.string().trim().max(1000).nullable().optional(),
  priceCents: z.number().int().min(0).max(1000000).nullable().optional().describe('Price in cents (shown, never totaled).'),
  favorite: z.boolean().optional().describe("The family's star: pinned to the top."),
  sort: z.number().int().optional().describe('Ignored (the order sent is the order kept), so items read back can be sent as they are.'),
}).strict().openapi('RestaurantMenuItemInput');
export const MenuItemSchema = z.object({
  id: z.string(), section: z.string().nullable(), name: z.string(), description: z.string().nullable(),
  priceCents: z.number().int().nullable(), favorite: z.boolean(), sort: z.number().int(),
}).openapi('RestaurantMenuItem');
export const RestaurantInputSchema = z.object({
  name: z.string().trim().min(1).max(200), cuisine: short.optional().describe('Free text, e.g. "Pizza" or "Thai".'),
  phone: z.string().trim().max(50).nullable().optional(), address: z.string().trim().max(500).nullable().optional().describe('One line; the Map button searches for it.'),
  website: url.optional(), orderUrl: url.optional().describe('Their online ordering page.'), menuUrl: url.optional().describe('Their own menu page or PDF.'),
  notes: text.optional(), archived: z.boolean().optional(),
  menu: z.array(MenuItemInputSchema).max(500).optional().describe('The whole menu, in order: sending it replaces the menu.'),
}).strict().openapi('RestaurantInput');
export const RestaurantSchema = z.object({
  id: z.string(), name: z.string(), cuisine: z.string().nullable(), phone: z.string().nullable(), address: z.string().nullable(),
  website: url, orderUrl: url, menuUrl: url, notes: text, archived: z.boolean(), menu: z.array(MenuItemSchema),
  // Read only (optional so exports without them import).
  lastOrders: z.array(z.object({ memberId: z.string(), mealId: z.string(), date: z.string(), items: z.array(OrderItemSchema) })).optional()
    .describe("Each person's latest order here, from a night already ordered: their usual."),
  upcoming: z.array(z.object({ mealId: z.string(), date: z.string(), slot: MealSlotSchema, plannedTime: z.string().nullable(), orderType: OrderTypeSchema.nullable(), status: z.enum(['planned', 'prepared']), eaterIds: z.array(z.string()), orderCount: z.number().int() })).optional()
    .describe('Planned meals from here, today on.'),
  createdAt: z.string(), updatedAt: z.string(),
}).openapi('Restaurant');
export const MenuTextParseSchema = z.object({ text: z.string().min(1).max(100000).describe('Pasted menu text: one item per line with its prices at the end; lines under an item that read like a description are its description; a heading line (or "Section: …") starts a section.') }).strict().openapi('MenuTextParse');
export type Restaurant = z.infer<typeof RestaurantSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeStep = z.infer<typeof RecipeStepSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type Meal = z.infer<typeof MealSchema>;
export type Projection = z.infer<typeof ProjectionSchema>;
