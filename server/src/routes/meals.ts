import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import { ownerBlock, resolveKey } from '../auth.ts';
import { emit } from '../bus.ts';
import { hostTimezone } from '../env.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { ErrorSchema } from '../schemas.ts';
import { IngredientInputSchema, MealEventStartSchema, MealInputSchema, MealPatchSchema, MealRangeSchema, MealSchema, ProjectionApplySchema, ProjectionQuerySchema, ProjectionSchema, RecipeImportResultSchema, RecipeImportSchema, RecipeInputSchema, RecipeKindSchema, RecipePreviewResultSchema, RecipeRatingInputSchema, RecipeSchema, RecipeTextParseSchema, RecipeUrlImportSchema, type Meal, type Recipe } from '../meal-schemas.ts';
import { applyProjection, importIngredient, matchBasic, mealWrite, normalizeIngredient, normalizeSteps, readMeal, readMeals, readRecipes, shoppingProjection, stepsText } from '../meals.ts';
import type { KinwallDb } from '../db.ts';
import type { Env } from '../env.ts';
import { createEvent, deleteEvent, updateEvent } from './events.ts';
import { readSettings } from './settings.ts';
import { fetchRecipeImage, fetchRecipePage, fetchRecipePdf } from '../outbound.ts';
import { parseRecipeHtml, parseRecipeText, previewWarnings } from '../recipe-web.ts';
import { withShares } from './recipe-share.ts';

export const mealsRoutes = createRouter();
const params = z.object({ id: z.string() });
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: 'admin or assigned device required', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
};
const providerError = { 502: { description: 'the calendar provider refused the event change', content: { 'application/json': { schema: ErrorSchema } } } };
const ok = { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } };
const recipeResponse = { description: 'recipe', content: { 'application/json': { schema: RecipeSchema } } };
const mealResponse = { description: 'meal', content: { 'application/json': { schema: MealSchema } } };
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/recipes', tags: ['Meals'], summary: 'Search recipes (archived=true includes archived recipes)', security: [{ Bearer: [] }], request: { query: z.object({ search: z.string().optional(), category: z.string().optional(), archived: z.enum(['true', 'false']).optional(), kind: RecipeKindSchema.optional() }) }, responses: { 200: { description: 'recipes', content: { 'application/json': { schema: z.array(RecipeSchema) } } } } }), async (c) => {
  const query = c.req.valid('query');
  return c.json(await withShares(c, await readRecipes(c.env.DB, { ...query, archived: query.archived === 'true' })), 200);
});
mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/recipes/{id}', tags: ['Meals'], summary: 'Get a recipe', security: [{ Bearer: [] }], request: { params }, responses: { 200: recipeResponse, ...errors } }), async (c) => {
  const recipe = (await withShares(c, await readRecipes(c.env.DB, { id: c.req.valid('param').id, archived: true })))[0];
  return recipe ? c.json(recipe, 200) : c.json({ error: 'recipe not found' }, 404);
});

async function saveRecipe(db: KinwallDb, input: z.infer<typeof RecipeInputSchema>, old: Recipe | undefined, createdBy: string | null): Promise<Recipe> {
  const id = old?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  // Structured steps win: instructions follows them. Instructions sent alone replace the steps.
  const steps = input.steps !== undefined ? (input.steps?.length ? normalizeSteps(input.steps) : null) : input.instructions !== undefined ? null : old?.steps ?? null;
  const recipe = { description: null, instructions: null, preparationNotes: null, sourceUrl: null, imageUrl: null, defaultServings: 4, prepMinutes: null, totalMinutes: null, archived: false, kind: 'meal' as const, makes: null, ...old, ...input, steps: steps?.length ? steps : null, id, createdAt: old?.createdAt ?? now, updatedAt: now };
  if (recipe.steps) recipe.instructions = stepsText(recipe.steps);
  const writes = [db.prepare(`INSERT INTO recipes (id,name,description,instructions,steps,preparation_notes,source_url,image_url,default_servings,prep_minutes,total_minutes,archived,kind,makes,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,instructions=excluded.instructions,steps=excluded.steps,preparation_notes=excluded.preparation_notes,source_url=excluded.source_url,image_url=excluded.image_url,default_servings=excluded.default_servings,prep_minutes=excluded.prep_minutes,total_minutes=excluded.total_minutes,archived=excluded.archived,kind=excluded.kind,makes=excluded.makes,updated_at=excluded.updated_at`)
    .bind(id, recipe.name, recipe.description, recipe.instructions, recipe.steps ? JSON.stringify(recipe.steps) : null, recipe.preparationNotes, recipe.sourceUrl, recipe.imageUrl ?? null, recipe.defaultServings, recipe.prepMinutes ?? null, recipe.totalMinutes ?? null, recipe.archived ? 1 : 0, recipe.kind, recipe.makes || null, createdBy, recipe.createdAt, now)];
  // No longer a basic: lines made from it keep their text, unlinked.
  if (recipe.kind !== 'basic') writes.push(db.prepare('UPDATE recipe_ingredients SET basic_id = NULL WHERE basic_id = ?').bind(id));
  if (input.ingredients !== undefined || !old) {
    const previous = [...(old?.ingredients ?? [])];
    const ingredients = (input.ingredients ?? []).map((i: z.infer<typeof IngredientInputSchema>, index) => {
      // Keep identity through ordinary edits and explicit snapshot refreshes.
      const match = previous.findIndex((p) => normalizeIngredient(p.name) === normalizeIngredient(i.name) && normalizeIngredient(p.unit ?? '') === normalizeIngredient(i.unit ?? ''));
      const same = match >= 0 ? previous.splice(match, 1)[0] : undefined;
      // A line sent without basicId keeps the link it had.
      return { id: same?.id ?? crypto.randomUUID(), name: i.name, normalized_name: normalizeIngredient(i.name), quantity: i.quantity ?? null, unit: i.unit || null, preparation: i.preparation || null, qualifier: i.qualifier || null, category: i.category || null, sort: i.sort ?? index, basic_id: i.basicId !== undefined ? i.basicId : same?.basicId ?? null };
    });
    writes.push(db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').bind(id));
    // Only a basic can be linked, never the recipe itself; anything else is dropped.
    writes.push(db.prepare(`INSERT INTO recipe_ingredients (id,recipe_id,name,normalized_name,quantity,unit,preparation,qualifier,category,sort,basic_id)
      SELECT value->>'id',?,value->>'name',value->>'normalized_name',value->>'quantity',value->>'unit',value->>'preparation',value->>'qualifier',value->>'category',value->>'sort',
        (SELECT b.id FROM recipes b WHERE b.id = value->>'basic_id' AND b.kind = 'basic' AND b.id != ?) FROM json_each(?)`).bind(id, id, JSON.stringify(ingredients)));
  }
  await db.batch(writes);
  return (await readRecipes(db, { id, archived: true }))[0];
}
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/recipes', tags: ['Meals'], summary: 'Create a recipe (admin)', security: [{ Bearer: [] }], request: { body: body(RecipeInputSchema) }, responses: { 201: recipeResponse, ...errors } }), async (c) => {
  const recipe = await saveRecipe(c.env.DB, c.req.valid('json'), undefined, (await resolveKey(c))?.id ?? null);
  emit(c, 'recipe.changed', { id: recipe.id }); return c.json(recipe, 201);
});
/** Save an imported recipe, updating the one with the same source + externalId. */
async function upsertImport(c: Ctx, input: Omit<z.infer<typeof RecipeImportSchema>, 'plan'>): Promise<{ recipe: Recipe; created: boolean }> {
  const db = c.env.DB;
  const found = await db.prepare('SELECT id FROM recipes WHERE source = ? AND external_id = ?').bind(input.source, input.externalId).first<{ id: string }>();
  const old = found ? (await readRecipes(db, { id: found.id, archived: true }))[0] : undefined;
  // A line links to the family's basic of the same name: the basic a share link names, else its own
  // name ("Taco Seasoning Blend" is "Taco seasoning"). Otherwise it keeps the link it had.
  const basics = await readRecipes(db, { kind: 'basic' });
  const ingredients = input.ingredients.map((line, sort) => {
    const { basic, ...ingredient } = importIngredient(line);
    const linked = (basic && matchBasic(basic, basics, old?.id)) || matchBasic(ingredient.name, basics, old?.id);
    return { ...ingredient, sort, ...(linked && { basicId: linked.id }) };
  });
  const recipe = await saveRecipe(db, {
    name: input.name, ingredients,
    ...(input.kind !== undefined && { kind: input.kind }),
    ...(input.makes !== undefined && { makes: input.makes }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
    ...(input.servings !== undefined && { defaultServings: input.servings }),
    ...(input.prepMinutes !== undefined && { prepMinutes: input.prepMinutes }),
    ...(input.totalMinutes !== undefined && { totalMinutes: input.totalMinutes }),
    ...(input.steps !== undefined && { steps: input.steps.length ? normalizeSteps(input.steps) : null, instructions: null }),
  }, old, old ? null : (await resolveKey(c))?.id ?? null);
  // ponytail: two simultaneous first imports of one recipe race here; the unique index turns the loser into an error.
  await db.prepare('UPDATE recipes SET source = ?, external_id = ?, image_url = coalesce(?, image_url) WHERE id = ?').bind(input.source, input.externalId, input.imageUrl ?? null, recipe.id).run();
  emit(c, 'recipe.changed', { id: recipe.id });
  return { recipe, created: !old };
}
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/recipes/import', tags: ['Meals'], summary: 'Import a recipe from another app (e.g. a meal kit), updating it when imported again, and optionally plan it and put it on a calendar (admin)', security: [{ Bearer: [] }], request: { body: body(RecipeImportSchema) }, responses: { 200: { description: 'imported', content: { 'application/json': { schema: RecipeImportResultSchema } } }, ...errors } }), async (c) => {
  const input = c.req.valid('json');
  const db = c.env.DB;
  const { recipe, created } = await upsertImport(c, input);
  const result: z.infer<typeof RecipeImportResultSchema> = { recipeId: recipe.id, created, planned: false };
  if (!input.plan) return c.json(result, 200);
  const { date, slot } = input.plan;
  // Importing again (a re-run automation) finds the meal it planned before, even if moved within the week.
  const weekEnd = new Date(Date.parse(date) + 6 * 86400000).toISOString().slice(0, 10);
  // plan.calendarId also puts the meal on that calendar, unless it already has an event.
  const onCalendar = async (mealId: string): Promise<Pick<typeof result, 'calendarEventId' | 'calendarError'>> => {
    const meal = input.plan?.calendarId ? await readMeal(db, mealId) : null;
    if (!meal) return {};
    if (meal.calendarEventId) return { calendarEventId: meal.calendarEventId };
    const made = await createMealEvent(c, meal, input.plan!.calendarId, input.plan!.eventStart ?? 'meal');
    return typeof made === 'string' ? { calendarEventId: made } : { calendarError: made.error };
  };
  const mine = await db.prepare('SELECT id, date FROM meals WHERE recipe_id = ? AND slot = ? AND date >= ? AND date <= ? ORDER BY date LIMIT 1').bind(recipe.id, slot, date, weekEnd).first<{ id: string; date: string }>();
  if (mine) return c.json({ ...result, planned: true, mealId: mine.id, reason: `already planned on ${mine.date}`, ...await onCalendar(mine.id) }, 200);
  const taken = await db.prepare('SELECT title FROM meals WHERE date = ? AND slot = ? LIMIT 1').bind(date, slot).first<{ title: string }>();
  if (taken) return c.json({ ...result, reason: `${slot} on ${date} already has ${taken.title}` }, 200);
  const meal = await buildMeal(db, { date, slot, recipeId: recipe.id, ...(input.plan.servings !== undefined && { servings: input.plan.servings }), ...(input.plan.eaterIds && { eaterIds: input.plan.eaterIds }), sourceUrl: recipe.sourceUrl });
  if (typeof meal === 'string') return c.json({ ...result, reason: meal }, 200);
  await mealWrite(db, meal).run(); emit(c, 'meal.changed', { id: meal.id });
  return c.json({ ...result, planned: true, mealId: meal.id, ...await onCalendar(meal.id) }, 200);
});
const unprocessable = { 422: { description: 'no recipe found', content: { 'application/json': { schema: ErrorSchema } } } };
const previewResponse = { description: 'what was read (and, with save, the saved recipe)', content: { 'application/json': { schema: RecipePreviewResultSchema } } };
const upper = (s: string) => s[0].toUpperCase() + s.slice(1);
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/recipes/import-url', tags: ['Meals'], summary: 'Read a recipe from a web page (its schema.org Recipe data) to preview, or with save: true also save it; importing the same page again updates it (admin)', security: [{ Bearer: [] }], request: { body: body(RecipeUrlImportSchema) }, responses: { 200: previewResponse, ...errors, ...unprocessable, 502: { description: 'the page could not be fetched', content: { 'application/json': { schema: ErrorSchema } } } } }), async (c) => {
  const { url, save } = c.req.valid('json');
  // https only (an http:// link is tried as https), unless a self-hoster allows private addresses.
  const page = await fetchRecipePage(c.env, c.env.ALLOW_PRIVATE_FEED_URLS === '1' ? url : url.replace(/^http:/i, 'https:'));
  if ('error' in page) return c.json({ error: `${upper(page.error)}.` }, page.status);
  const recipe = parseRecipeHtml(page.html, page.url);
  if (!recipe) return c.json({ error: 'This page has no recipe data Kinwall can read. Paste the recipe text instead.' }, 422);
  const warnings = previewWarnings(recipe);
  if (!save) return c.json({ recipe, warnings }, 200);
  if (!recipe.name) return c.json({ error: 'This recipe has no name. Preview it, name it, then save.' }, 422);
  const saved = await upsertImport(c, {
    source: 'web', externalId: recipe.sourceUrl!, name: recipe.name, description: recipe.description, sourceUrl: recipe.sourceUrl, imageUrl: recipe.imageUrl ?? undefined,
    ...(recipe.servings !== null && { servings: recipe.servings }), prepMinutes: recipe.prepMinutes, totalMinutes: recipe.totalMinutes, kind: recipe.kind, makes: recipe.makes,
    ingredients: recipe.ingredients.map((i) => (i.qualifier !== undefined ? i : i.text)), steps: recipe.steps,
  });
  return c.json({ recipe, warnings, recipeId: saved.recipe.id, created: saved.created }, 200);
});
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/recipes/parse-text', tags: ['Meals'], summary: 'Read a pasted recipe (Ingredients and Directions headings) into the same preview as import-url, without saving (admin)', security: [{ Bearer: [] }], request: { body: body(RecipeTextParseSchema) }, responses: { 200: previewResponse, ...errors, ...unprocessable } }), async (c) => {
  const { text, url } = c.req.valid('json');
  const recipe = parseRecipeText(text, url ?? null);
  if (!recipe) return c.json({ error: 'Add a line that says "Ingredients" above the ingredients and one that says "Directions" above the steps.' }, 422);
  return c.json({ recipe, warnings: previewWarnings(recipe) }, 200);
});
mealsRoutes.openapi(createRoute({ method: 'patch', path: '/api/recipes/{id}', tags: ['Meals'], summary: 'Edit or archive a recipe without changing planned meal snapshots (admin)', security: [{ Bearer: [] }], request: { params, body: body(RecipeInputSchema.partial()) }, responses: { 200: recipeResponse, ...errors } }), async (c) => {
  const old = (await readRecipes(c.env.DB, { id: c.req.valid('param').id, archived: true }))[0];
  if (!old) return c.json({ error: 'recipe not found' }, 404);
  const recipe = await saveRecipe(c.env.DB, { name: old.name, ...c.req.valid('json') }, old, null);
  emit(c, 'recipe.changed', { id: recipe.id }); return c.json(recipe, 200);
});
mealsRoutes.openapi(createRoute({ method: 'delete', path: '/api/recipes/{id}', tags: ['Meals'], summary: 'Delete a recipe; existing meals retain their snapshots (admin)', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  // Lines made from it (a basic) keep their text, unlinked.
  await c.env.DB.prepare('UPDATE recipe_ingredients SET basic_id = NULL WHERE basic_id = ?').bind(id).run();
  const result = await c.env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'recipe not found' }, 404);
  emit(c, 'recipe.changed', { id }); return c.json({ ok: true }, 200);
});
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/recipes/{id}/link-uses', tags: ['Meals'], summary: "Link this basic to the other recipes' ingredient lines that name it and aren't linked yet (same matching as imports; a name two basics share is skipped) (admin)", security: [{ Bearer: [] }], request: { params },
  responses: { 200: { description: 'how many lines were linked', content: { 'application/json': { schema: z.object({ linked: z.number().int() }) } } }, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  const all = await readRecipes(c.env.DB, { archived: true });
  const basic = all.find((r) => r.id === id);
  if (!basic) return c.json({ error: 'recipe not found' }, 404);
  if (basic.kind !== 'basic') return c.json({ error: 'only a basic can be linked to recipes' }, 400);
  const basics = all.filter((r) => r.kind === 'basic' && (!r.archived || r.id === id));
  const uses = all.filter((r) => r.id !== id).flatMap((r) => r.ingredients.filter((i) => !i.basicId && matchBasic(i.name, basics)?.id === id).map((i) => ({ recipeId: r.id, id: i.id })));
  if (uses.length) await c.env.DB.prepare('UPDATE recipe_ingredients SET basic_id = ? WHERE basic_id IS NULL AND id IN (SELECT value FROM json_each(?))').bind(id, JSON.stringify(uses.map((u) => u.id))).run();
  for (const recipeId of new Set(uses.map((u) => u.recipeId))) emit(c, 'recipe.changed', { id: recipeId });
  return c.json({ linked: uses.length }, 200);
});
// Rating is a family action like ticking off a chore: wall screens and kids' devices may rate (a member's own device only for them).
mealsRoutes.openapi(createRoute({ method: 'put', path: '/api/recipes/{id}/rating', tags: ['Meals'], summary: "Set or clear a family member's 1-5 star rating of a recipe", security: [{ Bearer: [] }], request: { params, body: body(RecipeRatingInputSchema) }, responses: { 200: recipeResponse, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  const { memberId, stars } = c.req.valid('json');
  const blocked = await ownerBlock(c, memberId);
  if (blocked) return c.json({ error: blocked }, 403);
  const [recipe, member] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id FROM recipes WHERE id = ?').bind(id),
    c.env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(memberId),
  ]);
  if (!recipe.results.length) return c.json({ error: 'recipe not found' }, 404);
  if (!member.results.length) return c.json({ error: 'member not found' }, 404);
  await (stars
    ? c.env.DB.prepare('INSERT INTO recipe_ratings (recipe_id, member_id, stars) VALUES (?, ?, ?) ON CONFLICT(recipe_id, member_id) DO UPDATE SET stars = excluded.stars').bind(id, memberId, stars)
    : c.env.DB.prepare('DELETE FROM recipe_ratings WHERE recipe_id = ? AND member_id = ?').bind(id, memberId)).run();
  emit(c, 'recipe.changed', { id });
  return c.json((await readRecipes(c.env.DB, { id, archived: true }))[0], 200);
});

mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/meals', tags: ['Meals'], summary: 'Meals in an inclusive date range', security: [{ Bearer: [] }], request: { query: MealRangeSchema }, responses: { 200: { description: 'meals', content: { 'application/json': { schema: z.array(MealSchema) } } }, ...errors } }), async (c) => {
  const { from, to } = c.req.valid('query'); return c.json(await readMeals(c.env.DB, from, to), 200);
});
// Static routes must precede /api/meals/{id}.
mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/meals/projection', tags: ['Meals'], summary: 'Review scaled ingredients, sources, and existing shopping-list matches', security: [{ Bearer: [] }], request: { query: ProjectionQuerySchema }, responses: { 200: { description: 'projection', content: { 'application/json': { schema: ProjectionSchema } } }, ...errors } }), async (c) => {
  const { from, to, listId } = c.req.valid('query');
  if (listId && !await shoppingList(c.env.DB, listId)) return c.json({ error: 'active shopping list not found' }, 400);
  return c.json(await shoppingProjection(c.env.DB, from, to, listId), 200);
});
async function shoppingList(db: KinwallDb, id: string) {
  return db.prepare("SELECT id FROM lists WHERE id = ? AND kind = 'shopping' AND archived = 0").bind(id).first();
}
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals/projection/apply', tags: ['Meals'], summary: 'Explicitly add unclaimed ingredient requirements to a shopping list (admin, idempotent); meal-kit ingredients that ship in the box are skipped unless includeKitItems, and basics answers whether lines made from a basic are made already or need its ingredients', security: [{ Bearer: [] }], request: { body: body(ProjectionApplySchema) }, responses: { 200: { description: 'applied', content: { 'application/json': { schema: z.object({ added: z.number(), itemIds: z.array(z.string()), projection: ProjectionSchema }) } } }, ...errors } }), async (c) => {
  const { from, to, listId, omitKeys = [], includeNotes = false, includeKitItems = false, basics = {} } = c.req.valid('json');
  if (!await shoppingList(c.env.DB, listId)) return c.json({ error: 'active shopping list not found' }, 400);
  const projection = await shoppingProjection(c.env.DB, from, to, listId, basics);
  const itemIds = await applyProjection(c.env.DB, projection, listId, omitKeys, includeNotes, includeKitItems);
  if (itemIds.length) emit(c, 'list.item.changed', { listId });
  return c.json({ added: itemIds.length, itemIds, projection: await shoppingProjection(c.env.DB, from, to, listId) }, 200);
});

async function buildMeal(db: KinwallDb, input: z.infer<typeof MealPatchSchema>, old?: Meal): Promise<Meal | string> {
  const now = new Date().toISOString();
  const meal: Meal = { id: crypto.randomUUID(), date: input.date!, slot: input.slot!, title: '', mealKind: input.recipeId ? 'recipe' : 'freeform', recipeId: null, recipeSnapshot: null, servings: 1, assigneeMemberId: null, eaterIds: [], notes: null, plannedTime: null, calendarEventId: null, calendarEventStart: null, status: 'planned', sourceUrl: null, createdAt: now, ...old, ...input, updatedAt: now };
  if (input.recipeId && input.mealKind === undefined) meal.mealKind = 'recipe';
  if (meal.assigneeMemberId && !await db.prepare('SELECT id FROM members WHERE id = ?').bind(meal.assigneeMemberId).first()) return 'assignee not found';
  if (input.eaterIds) {
    meal.eaterIds = [...new Set(input.eaterIds)];
    const known = await db.prepare('SELECT count(*) AS n FROM members WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(meal.eaterIds)).first<{ n: number }>();
    if (known?.n !== meal.eaterIds.length) return 'eater not found';
  }
  if (meal.mealKind === 'recipe') {
    if (!meal.recipeId && !meal.recipeSnapshot) return 'recipe meals require a recipe';
    if (!old || input.recipeId !== undefined && input.recipeId !== old.recipeId || input.refreshRecipe || !meal.recipeSnapshot) {
      if (!meal.recipeId) return 'recipe no longer exists';
      const recipe = (await readRecipes(db, { id: meal.recipeId }))[0];
      if (!recipe) return 'recipe not found or archived';
      meal.recipeSnapshot = { name: recipe.name, defaultServings: recipe.defaultServings, prepMinutes: recipe.prepMinutes ?? null, totalMinutes: recipe.totalMinutes ?? null, ingredients: recipe.ingredients };
      if (input.title === undefined) meal.title = recipe.name;
      if (input.servings === undefined && (!old || old.recipeId !== meal.recipeId)) meal.servings = recipe.defaultServings;
    }
    if (!meal.title) meal.title = meal.recipeSnapshot!.name;
  } else {
    meal.recipeId = null; meal.recipeSnapshot = null;
    if (!meal.title && meal.mealKind === 'dining_out') meal.title = 'Eating out';
  }
  // Picking who's eating sets servings to how many, unless servings were given too.
  if (input.eaterIds?.length && input.servings === undefined) meal.servings = meal.eaterIds.length;
  if (!meal.title) return 'a meal title is required';
  return meal;
}
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals', tags: ['Meals'], summary: 'Plan a meal and snapshot its recipe (admin)', security: [{ Bearer: [] }], request: { body: body(MealInputSchema) }, responses: { 201: mealResponse, ...errors } }), async (c) => {
  const meal = await buildMeal(c.env.DB, c.req.valid('json'));
  if (typeof meal === 'string') return c.json({ error: meal }, 400);
  await mealWrite(c.env.DB, meal).run(); emit(c, 'meal.changed', { id: meal.id });
  return c.json(await readMeal(c.env.DB, meal.id) as Meal, 201);
});
mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/meals/{id}', tags: ['Meals'], summary: 'Get a planned meal', security: [{ Bearer: [] }], request: { params }, responses: { 200: mealResponse, ...errors } }), async (c) => {
  const meal = await readMeal(c.env.DB, c.req.valid('param').id);
  return meal ? c.json(meal, 200) : c.json({ error: 'meal not found' }, 404);
});
mealsRoutes.openapi(createRoute({ method: 'patch', path: '/api/meals/{id}', tags: ['Meals'], summary: 'Edit a meal; assigned members may change only notes/status. A calendar event Kinwall created for it follows the change', security: [{ Bearer: [] }], request: { params, body: body(MealPatchSchema) }, responses: { 200: mealResponse, ...errors, ...providerError } }), async (c) => {
  const old = await readMeal(c.env.DB, c.req.valid('param').id);
  if (!old) return c.json({ error: 'meal not found' }, 404);
  const patch = c.req.valid('json');
  const key = await resolveKey(c);
  if (key?.scope !== 'admin' && (!old.assigneeMemberId || key?.owner !== old.assigneeMemberId || Object.keys(patch).some((k) => k !== 'notes' && k !== 'status'))) return c.json({ error: 'Only admins can change the plan; assigned members may update notes and status' }, 403);
  const meal = await buildMeal(c.env.DB, patch, old);
  if (typeof meal === 'string') return c.json({ error: meal }, 400);
  // The event first: when a synced calendar refuses the change, the meal stays as it was so the two agree.
  const failed = await syncMealEvent(c, old, meal);
  if (failed) return c.json({ error: `Couldn't update the meal's calendar event: ${failed.error}` }, failed.status);
  await mealWrite(c.env.DB, meal).run();
  emit(c, 'meal.changed', { id: meal.id });
  return c.json(await readMeal(c.env.DB, meal.id) as Meal, 200);
});
mealsRoutes.openapi(createRoute({ method: 'delete', path: '/api/meals/{id}', tags: ['Meals'], summary: 'Remove a meal and the calendar event Kinwall created for it, on any calendar (keeps a linked event of your own and shopping items)', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors, ...providerError } }), async (c) => {
  const { id } = c.req.valid('param');
  const meal = await readMeal(c.env.DB, id);
  if (!meal) return c.json({ error: 'meal not found' }, 404);
  if (meal.calendarEventId && meal.calendarEventStart) {
    const gone = await deleteEvent(c, meal.calendarEventId);
    if ('error' in gone && gone.status !== 404) return c.json({ error: `Couldn't delete the meal's calendar event (${gone.error}). Unlink it to delete the meal and keep the event.` }, gone.status);
  }
  await c.env.DB.prepare('DELETE FROM meals WHERE id = ?').bind(id).run();
  emit(c, 'meal.changed', { id });
  return c.json({ ok: true }, 200);
});
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals/{id}/calendar-link', tags: ['Meals'], summary: 'Link an existing event without creating a duplicate; Kinwall never changes or deletes it (admin)', security: [{ Bearer: [] }], request: { params, body: body(z.object({ eventId: z.string().min(1) }).strict()) }, responses: { 200: mealResponse, ...errors } }), async (c) => {
  const meal = await readMeal(c.env.DB, c.req.valid('param').id);
  if (!meal) return c.json({ error: 'meal not found' }, 404);
  const { eventId } = c.req.valid('json');
  if (!await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first()) return c.json({ error: 'event not found' }, 400);
  await c.env.DB.prepare('UPDATE meals SET calendar_event_id = ?, calendar_event_start = NULL, updated_at = ? WHERE id = ?').bind(eventId, new Date().toISOString(), meal.id).run();
  emit(c, 'meal.changed', { id: meal.id }); return c.json(await readMeal(c.env.DB, meal.id) as Meal, 200);
});
mealsRoutes.openapi(createRoute({ method: 'delete', path: '/api/meals/{id}/calendar-link', tags: ['Meals'], summary: 'Unlink a calendar event without deleting it; an event Kinwall created stays and stops following the meal (admin)', security: [{ Bearer: [] }], request: { params }, responses: { 200: mealResponse, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  const result = await c.env.DB.prepare('UPDATE meals SET calendar_event_id = NULL, calendar_event_start = NULL, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
  if (!result.meta.changes) return c.json({ error: 'meal not found' }, 404);
  emit(c, 'meal.changed', { id }); return c.json(await readMeal(c.env.DB, id) as Meal, 200);
});
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals/{id}/calendar-event', tags: ['Meals'], summary: 'Create and link an event on the calendar you choose (any writable one; synced calendars get it too). Without calendarId it goes on a local calendar, never a synced one. It follows the meal from then on (admin)', security: [{ Bearer: [] }],
  request: { params, body: body(z.object({ calendarId: z.string().min(1).optional(), eventStart: MealEventStartSchema.optional().describe('At the meal time (default), or when cooking starts so it ends at the meal time.') }).strict()) }, responses: { 200: mealResponse, ...errors, ...providerError } }), async (c) => {
  const db = c.env.DB;
  const meal = await readMeal(db, c.req.valid('param').id);
  if (!meal) return c.json({ error: 'meal not found' }, 404);
  if (meal.calendarEventId) {
    if (await db.prepare('SELECT id FROM events WHERE id = ?').bind(meal.calendarEventId).first()) return c.json(meal, 200);
    meal.calendarEventId = null;
  }
  const { calendarId, eventStart = 'meal' } = c.req.valid('json');
  const made = await createMealEvent(c, meal, calendarId, eventStart);
  if (typeof made !== 'string') return c.json({ error: made.error }, made.status);
  return c.json(await readMeal(db, meal.id) as Meal, 200);
});
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals/{id}/swap', tags: ['Meals'], summary: "Swap two planned meals' date and slot in one step; calendar events Kinwall created for them follow (admin)", security: [{ Bearer: [] }],
  request: { params, body: body(z.object({ otherId: z.string().min(1) }).strict()) }, responses: { 200: { description: 'both meals, this one first', content: { 'application/json': { schema: z.array(MealSchema) } } }, ...errors, ...providerError } }), async (c) => {
  const db = c.env.DB;
  const { id } = c.req.valid('param'); const { otherId } = c.req.valid('json');
  if (id === otherId) return c.json({ error: 'pick another meal to swap with' }, 400);
  const [a, b] = await Promise.all([readMeal(db, id), readMeal(db, otherId)]);
  if (!a || !b) return c.json({ error: 'meal not found' }, 404);
  const now = new Date().toISOString();
  const a2: Meal = { ...a, date: b.date, slot: b.slot, updatedAt: now };
  const b2: Meal = { ...b, date: a.date, slot: a.slot, updatedAt: now };
  // Events first, like an edit; if the second calendar refuses, the first event goes back so all four agree.
  const failed = await syncMealEvent(c, a, a2) ?? await syncMealEvent(c, b, b2).then(async (err) => { if (err) await syncMealEvent(c, a2, a); return err; });
  if (failed) return c.json({ error: `Couldn't update a meal's calendar event: ${failed.error}` }, failed.status);
  await db.batch([mealWrite(db, a2), mealWrite(db, b2)]);
  emit(c, 'meal.changed', { id: a.id }); emit(c, 'meal.changed', { id: b.id });
  return c.json([await readMeal(db, a.id) as Meal, await readMeal(db, b.id) as Meal], 200);
});

type Ctx = Context<{ Bindings: Env }>;
type EventStart = z.infer<typeof MealEventStartSchema>;

/** The event a meal gets: at its own time, else the family's usual time for that slot (Settings),
 * lasting as long as the recipe takes (60 minutes when that's unknown); people are the eaters and the cook. */
async function mealEvent(db: KinwallDb, meal: Meal, from: EventStart) {
  const settings = await readSettings(db);
  const [y, mo, d] = meal.date.split('-').map(Number);
  const [h, mi] = (meal.plannedTime ?? settings.mealTimes[meal.slot]).split(':').map(Number);
  const at = zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, settings.timezone || hostTimezone()).getTime();
  const recipeMinutes = meal.recipeSnapshot?.totalMinutes
    ?? (meal.recipeId ? (await db.prepare('SELECT total_minutes FROM recipes WHERE id = ?').bind(meal.recipeId).first<{ total_minutes: number | null }>())?.total_minutes : null);
  const length = (recipeMinutes || 60) * 60000;
  const [start, end] = from === 'cooking' ? [at - length, at] : [at, at + length];
  return {
    title: `${meal.slot[0].toUpperCase()}${meal.slot.slice(1)} · ${meal.title}`,
    start: new Date(start).toISOString(), end: new Date(end).toISOString(), allDay: false,
    memberIds: [...new Set([...meal.eaterIds, ...(meal.assigneeMemberId ? [meal.assigneeMemberId] : [])])],
  };
}

/** Creates the meal's event through the Events API path (provider write-through, members, reminders,
 * events.changed) and links it as Kinwall's own. No calendarId: a local calendar, never a synced one. */
async function createMealEvent(c: Ctx, meal: Meal, calendarId: string | undefined, from: EventStart): Promise<string | { error: string; status: 400 | 403 | 502 }> {
  const db = c.env.DB;
  if (!calendarId) {
    calendarId = (await db.prepare("SELECT id FROM calendars WHERE kind = 'local' AND writable = 1 ORDER BY id LIMIT 1").first<{ id: string }>())?.id;
    if (!calendarId) {
      calendarId = crypto.randomUUID();
      await db.prepare("INSERT INTO calendars (id,kind,name,writable) VALUES (?, 'local', 'Meals', 1)").bind(calendarId).run();
    }
  }
  const created = await createEvent(c, { calendarId, ...await mealEvent(db, meal, from), ...(meal.notes ? { description: meal.notes } : {}) });
  if ('error' in created) return created;
  // ponytail: two simultaneous creates for one meal both make an event; the loser's stays on the calendar unlinked.
  await db.prepare('UPDATE meals SET calendar_event_id = ?, calendar_event_start = ?, updated_at = ? WHERE id = ? AND calendar_event_id IS NULL').bind(created.row.id, from, new Date().toISOString(), meal.id).run();
  emit(c, 'meal.changed', { id: meal.id });
  return created.row.id;
}

/** Keeps the event Kinwall created for a meal in step with the meal (date, time, slot, title, people,
 * notes) through the Events API path, so a synced calendar gets the change too. A linked event of
 * the family's own is never touched. Returns an error only when the calendar refused the change. */
async function syncMealEvent(c: Ctx, old: Meal, meal: Meal): Promise<{ error: string; status: 400 | 502 } | null> {
  const from = old.calendarEventStart;
  if (!old.calendarEventId || !from) return null;
  const [before, after] = await Promise.all([mealEvent(c.env.DB, old, from), mealEvent(c.env.DB, meal, from)]);
  const notesChanged = (old.notes ?? null) !== (meal.notes ?? null);
  if (JSON.stringify(before) === JSON.stringify(after) && !notesChanged) return null;
  const { memberIds, ...when } = after;
  const patch: Parameters<typeof updateEvent>[2] = when;
  if (JSON.stringify(before.memberIds) !== JSON.stringify(memberIds)) patch.memberIds = memberIds;
  if (notesChanged) {
    // Meal notes are the event's description - unless someone has written their own on the event.
    const current = await c.env.DB.prepare('SELECT description FROM events WHERE id = ?').bind(old.calendarEventId).first<{ description: string | null }>();
    if ((current?.description || null) === (old.notes || null)) patch.description = meal.notes ?? '';
  }
  const updated = await updateEvent(c, old.calendarEventId, patch);
  if (!('error' in updated)) return null;
  if (updated.status === 404) { meal.calendarEventId = null; meal.calendarEventStart = null; return null; } // deleted on the calendar
  if (updated.status === 403) return null; // ponytail: a device that can't edit that calendar (a cook updating notes) leaves the event as is
  return { error: updated.error, status: updated.status };
}

// The recipe card a meal kit links to, fetched server-side so the app can show it (a web view can't
// read another origin's PDF). Only the record's own stored sourceUrl - never a URL from the request.
for (const kind of ['recipes', 'meals'] as const) {
  mealsRoutes.openapi(createRoute({ method: 'get', path: `/api/${kind}/{id}/source.pdf`, tags: ['Meals'], summary: `The PDF recipe card at this ${kind === 'recipes' ? 'recipe' : 'meal'}'s own sourceUrl (public https, PDF only, at most 15 MB)`, security: [{ Bearer: [] }], request: { params },
    responses: { 200: { description: 'the PDF', content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } } }, 400: errors[400], 404: errors[404], 502: { description: 'the source could not be fetched or is not a PDF', content: { 'application/json': { schema: ErrorSchema } } } } }), async (c) => {
    const row = await c.env.DB.prepare(`SELECT source_url FROM ${kind} WHERE id = ?`).bind(c.req.valid('param').id).first<{ source_url: string | null }>();
    if (!row?.source_url) return c.json({ error: 'no recipe source' }, 404);
    const result = await fetchRecipePdf(c.env, row.source_url);
    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.body(result.pdf, 200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': 'inline' });
  });
}

// A recipe's photo (a meal: its recipe's), fetched server-side because the CSP keeps <img> on this
// origin. Only the record's own stored imageUrl - never a URL from the request. An <img> can't send
// the Bearer header, so this path also takes ?key= (auth.ts QUERY_KEY_PATH).
for (const kind of ['recipes', 'meals'] as const) {
  mealsRoutes.openapi(createRoute({ method: 'get', path: `/api/${kind}/{id}/image`, tags: ['Meals'], summary: `The photo at this ${kind === 'recipes' ? "recipe's" : "meal's recipe's"} imageUrl (public https, JPEG/PNG/WebP/GIF, at most 8 MB)`, security: [{ Bearer: [] }], request: { params },
    responses: { 200: { description: 'the image', content: { 'image/*': { schema: z.string().openapi({ format: 'binary' }) } } }, 400: errors[400], 404: errors[404], 502: { description: 'the image could not be fetched or is not an image', content: { 'application/json': { schema: ErrorSchema } } } } }), async (c) => {
    const sql = kind === 'recipes' ? 'SELECT image_url FROM recipes WHERE id = ?' : 'SELECT r.image_url FROM meals m JOIN recipes r ON r.id = m.recipe_id WHERE m.id = ?';
    const row = await c.env.DB.prepare(sql).bind(c.req.valid('param').id).first<{ image_url: string | null }>();
    if (!row?.image_url) return c.json({ error: 'no recipe image' }, 404);
    const result = await fetchRecipeImage(c.env, row.image_url);
    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.body(result.image, 200, { 'Content-Type': result.type, 'Cache-Control': 'private, max-age=604800', ...(result.etag && { ETag: result.etag }) });
  });
}

// One step's photo (steps are numbered from 1, as shown), the same way: only the step's own stored imageUrl.
mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/recipes/{id}/steps/{n}/image', tags: ['Meals'], summary: "The photo at this recipe step's imageUrl (steps number from 1; public https, JPEG/PNG/WebP/GIF, at most 8 MB)", security: [{ Bearer: [] }],
  request: { params: params.extend({ n: z.coerce.number().int().min(1).max(100) }) },
  responses: { 200: { description: 'the image', content: { 'image/*': { schema: z.string().openapi({ format: 'binary' }) } } }, 400: errors[400], 404: errors[404], 502: { description: 'the image could not be fetched or is not an image', content: { 'application/json': { schema: ErrorSchema } } } } }), async (c) => {
  const { id, n } = c.req.valid('param');
  const recipe = (await readRecipes(c.env.DB, { id, archived: true }))[0];
  const imageUrl = recipe?.steps?.[n - 1]?.imageUrl;
  if (!imageUrl) return c.json({ error: 'no step image' }, 404);
  const result = await fetchRecipeImage(c.env, imageUrl);
  if ('error' in result) return c.json({ error: result.error }, result.status);
  return c.body(result.image, 200, { 'Content-Type': result.type, 'Cache-Control': 'private, max-age=604800', ...(result.etag && { ETag: result.etag }) });
});
