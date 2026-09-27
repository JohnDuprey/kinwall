import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { resolveKey } from '../auth.ts';
import { emit } from '../bus.ts';
import { hostTimezone } from '../env.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { ErrorSchema } from '../schemas.ts';
import { IngredientInputSchema, MealInputSchema, MealPatchSchema, MealRangeSchema, MealSchema, ProjectionApplySchema, ProjectionQuerySchema, ProjectionSchema, RecipeInputSchema, RecipeSchema, type Meal, type Recipe } from '../meal-schemas.ts';
import { applyProjection, mealWrite, normalizeIngredient, readMeal, readMeals, readRecipes, shoppingProjection } from '../meals.ts';
import type { KinwallDb } from '../db.ts';

export const mealsRoutes = createRouter();
const params = z.object({ id: z.string() });
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: 'admin or assigned device required', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
};
const ok = { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } };
const recipeResponse = { description: 'recipe', content: { 'application/json': { schema: RecipeSchema } } };
const mealResponse = { description: 'meal', content: { 'application/json': { schema: MealSchema } } };
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/recipes', tags: ['Meals'], summary: 'Search recipes (archived=true includes archived recipes)', security: [{ Bearer: [] }], request: { query: z.object({ search: z.string().optional(), category: z.string().optional(), archived: z.enum(['true', 'false']).optional() }) }, responses: { 200: { description: 'recipes', content: { 'application/json': { schema: z.array(RecipeSchema) } } } } }), async (c) => {
  const query = c.req.valid('query');
  return c.json(await readRecipes(c.env.DB, { ...query, archived: query.archived === 'true' }), 200);
});
mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/recipes/{id}', tags: ['Meals'], summary: 'Get a recipe', security: [{ Bearer: [] }], request: { params }, responses: { 200: recipeResponse, ...errors } }), async (c) => {
  const recipe = (await readRecipes(c.env.DB, { id: c.req.valid('param').id, archived: true }))[0];
  return recipe ? c.json(recipe, 200) : c.json({ error: 'recipe not found' }, 404);
});

async function saveRecipe(db: KinwallDb, input: z.infer<typeof RecipeInputSchema>, old: Recipe | undefined, createdBy: string | null): Promise<Recipe> {
  const id = old?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const recipe = { description: null, instructions: null, preparationNotes: null, sourceUrl: null, defaultServings: 4, archived: false, ...old, ...input, id, createdAt: old?.createdAt ?? now, updatedAt: now };
  const writes = [db.prepare(`INSERT INTO recipes (id,name,description,instructions,preparation_notes,source_url,default_servings,archived,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,instructions=excluded.instructions,preparation_notes=excluded.preparation_notes,source_url=excluded.source_url,default_servings=excluded.default_servings,archived=excluded.archived,updated_at=excluded.updated_at`)
    .bind(id, recipe.name, recipe.description, recipe.instructions, recipe.preparationNotes, recipe.sourceUrl, recipe.defaultServings, recipe.archived ? 1 : 0, createdBy, recipe.createdAt, now)];
  if (input.ingredients !== undefined || !old) {
    const previous = [...(old?.ingredients ?? [])];
    const ingredients = (input.ingredients ?? []).map((i: z.infer<typeof IngredientInputSchema>, index) => {
      // Keep identity through ordinary edits and explicit snapshot refreshes.
      const match = previous.findIndex((p) => normalizeIngredient(p.name) === normalizeIngredient(i.name) && normalizeIngredient(p.unit ?? '') === normalizeIngredient(i.unit ?? ''));
      const ingredientId = match >= 0 ? previous.splice(match, 1)[0].id : crypto.randomUUID();
      return { id: ingredientId, name: i.name, normalized_name: normalizeIngredient(i.name), quantity: i.quantity ?? null, unit: i.unit || null, preparation: i.preparation || null, qualifier: i.qualifier || null, category: i.category || null, sort: i.sort ?? index };
    });
    writes.push(db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').bind(id));
    writes.push(db.prepare(`INSERT INTO recipe_ingredients (id,recipe_id,name,normalized_name,quantity,unit,preparation,qualifier,category,sort)
      SELECT value->>'id',?,value->>'name',value->>'normalized_name',value->>'quantity',value->>'unit',value->>'preparation',value->>'qualifier',value->>'category',value->>'sort' FROM json_each(?)`).bind(id, JSON.stringify(ingredients)));
  }
  await db.batch(writes);
  return (await readRecipes(db, { id, archived: true }))[0];
}
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/recipes', tags: ['Meals'], summary: 'Create a recipe (admin)', security: [{ Bearer: [] }], request: { body: body(RecipeInputSchema) }, responses: { 201: recipeResponse, ...errors } }), async (c) => {
  const recipe = await saveRecipe(c.env.DB, c.req.valid('json'), undefined, (await resolveKey(c))?.id ?? null);
  emit(c, 'recipe.changed', { id: recipe.id }); return c.json(recipe, 201);
});
mealsRoutes.openapi(createRoute({ method: 'patch', path: '/api/recipes/{id}', tags: ['Meals'], summary: 'Edit or archive a recipe without changing planned meal snapshots (admin)', security: [{ Bearer: [] }], request: { params, body: body(RecipeInputSchema.partial()) }, responses: { 200: recipeResponse, ...errors } }), async (c) => {
  const old = (await readRecipes(c.env.DB, { id: c.req.valid('param').id, archived: true }))[0];
  if (!old) return c.json({ error: 'recipe not found' }, 404);
  const recipe = await saveRecipe(c.env.DB, { name: old.name, ...c.req.valid('json') }, old, null);
  emit(c, 'recipe.changed', { id: recipe.id }); return c.json(recipe, 200);
});
mealsRoutes.openapi(createRoute({ method: 'delete', path: '/api/recipes/{id}', tags: ['Meals'], summary: 'Delete a recipe; existing meals retain their snapshots (admin)', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  const result = await c.env.DB.prepare('DELETE FROM recipes WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'recipe not found' }, 404);
  emit(c, 'recipe.changed', { id }); return c.json({ ok: true }, 200);
});

mealsRoutes.openapi(createRoute({ method: 'get', path: '/api/meals', tags: ['Meals'], summary: 'Meals in an inclusive date range, independent of week preferences', security: [{ Bearer: [] }], request: { query: MealRangeSchema }, responses: { 200: { description: 'meals', content: { 'application/json': { schema: z.array(MealSchema) } } }, ...errors } }), async (c) => {
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
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals/projection/apply', tags: ['Meals'], summary: 'Explicitly add unclaimed ingredient requirements to a shopping list (admin, idempotent)', security: [{ Bearer: [] }], request: { body: body(ProjectionApplySchema) }, responses: { 200: { description: 'applied', content: { 'application/json': { schema: z.object({ added: z.number(), itemIds: z.array(z.string()), projection: ProjectionSchema }) } } }, ...errors } }), async (c) => {
  const { from, to, listId, omitKeys = [], includeNotes = false } = c.req.valid('json');
  if (!await shoppingList(c.env.DB, listId)) return c.json({ error: 'active shopping list not found' }, 400);
  const projection = await shoppingProjection(c.env.DB, from, to, listId);
  const itemIds = await applyProjection(c.env.DB, projection, listId, omitKeys, includeNotes);
  if (itemIds.length) emit(c, 'list.item.changed', { listId });
  return c.json({ added: itemIds.length, itemIds, projection: await shoppingProjection(c.env.DB, from, to, listId) }, 200);
});

async function buildMeal(db: KinwallDb, input: z.infer<typeof MealPatchSchema>, old?: Meal): Promise<Meal | string> {
  const now = new Date().toISOString();
  const meal: Meal = { id: crypto.randomUUID(), date: input.date!, slot: input.slot!, title: '', mealKind: input.recipeId ? 'recipe' : 'freeform', recipeId: null, recipeSnapshot: null, servings: 1, assigneeMemberId: null, notes: null, plannedTime: null, calendarEventId: null, status: 'planned', sourceUrl: null, createdAt: now, ...old, ...input, updatedAt: now };
  if (input.recipeId && input.mealKind === undefined) meal.mealKind = 'recipe';
  if (meal.assigneeMemberId && !await db.prepare('SELECT id FROM members WHERE id = ?').bind(meal.assigneeMemberId).first()) return 'assignee not found';
  if (meal.mealKind === 'recipe') {
    if (!meal.recipeId && !meal.recipeSnapshot) return 'recipe meals require a recipe';
    if (!old || input.recipeId !== undefined && input.recipeId !== old.recipeId || input.refreshRecipe || !meal.recipeSnapshot) {
      if (!meal.recipeId) return 'recipe no longer exists';
      const recipe = (await readRecipes(db, { id: meal.recipeId }))[0];
      if (!recipe) return 'recipe not found or archived';
      meal.recipeSnapshot = { name: recipe.name, defaultServings: recipe.defaultServings, ingredients: recipe.ingredients };
      if (input.title === undefined) meal.title = recipe.name;
      if (input.servings === undefined && (!old || old.recipeId !== meal.recipeId)) meal.servings = recipe.defaultServings;
    }
    if (!meal.title) meal.title = meal.recipeSnapshot!.name;
  } else {
    meal.recipeId = null; meal.recipeSnapshot = null;
    if (!meal.title && meal.mealKind === 'dining_out') meal.title = 'Eating out';
  }
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
mealsRoutes.openapi(createRoute({ method: 'patch', path: '/api/meals/{id}', tags: ['Meals'], summary: 'Edit a meal; assigned members may change only notes/status', security: [{ Bearer: [] }], request: { params, body: body(MealPatchSchema) }, responses: { 200: mealResponse, ...errors } }), async (c) => {
  const old = await readMeal(c.env.DB, c.req.valid('param').id);
  if (!old) return c.json({ error: 'meal not found' }, 404);
  const patch = c.req.valid('json');
  const key = await resolveKey(c);
  if (key?.scope !== 'admin' && (!old.assigneeMemberId || key?.owner !== old.assigneeMemberId || Object.keys(patch).some((k) => k !== 'notes' && k !== 'status'))) return c.json({ error: 'Only admins can change the plan; assigned members may update notes and status' }, 403);
  const meal = await buildMeal(c.env.DB, patch, old);
  if (typeof meal === 'string') return c.json({ error: meal }, 400);
  const linked = old.calendarEventId?.startsWith('meal:')
    ? await c.env.DB.prepare('SELECT id, calendar_id, start, end, all_day FROM events WHERE id = ?').bind(old.calendarEventId).first<{ id: string; calendar_id: string; start: string; end: string; all_day: number }>()
    : null;
  if (old.calendarEventId?.startsWith('meal:') && !linked) meal.calendarEventId = null;
  const writes = [mealWrite(c.env.DB, meal)];
  if (linked) {
    const tz = (await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>())?.value || hostTimezone();
    const [y, m, d] = meal.date.split('-').map(Number);
    const [hour, minute] = (meal.plannedTime ?? '00:00').split(':').map(Number);
    const timed = !!meal.plannedTime;
    const start = timed ? zonedTimeToUtc({ y, mo: m - 1, d, h: hour, mi: minute, s: 0 }, tz).toISOString() : meal.date;
    const duration = linked.all_day ? 60 : Math.max(1, (Date.parse(linked.end) - Date.parse(linked.start)) / 60000);
    const end = timed ? new Date(Date.parse(start) + duration * 60000).toISOString() : new Date(Date.parse(meal.date) + 86400000).toISOString().slice(0, 10);
    // The meal:<id> event only mirrors the meal, so keep it in step; its description is set once at
    // creation and left alone, so notes typed on the event in Calendar survive.
    writes.push(c.env.DB.prepare('UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, member_ids = ?, updated_at = ? WHERE id = ?').bind(
      `${meal.slot[0].toUpperCase()}${meal.slot.slice(1)} · ${meal.title}`, start, end, timed ? 0 : 1, JSON.stringify(meal.assigneeMemberId ? [meal.assigneeMemberId] : []), new Date().toISOString(), linked.id,
    ));
  }
  await c.env.DB.batch(writes);
  emit(c, 'meal.changed', { id: meal.id });
  if (linked) emit(c, 'events.changed', { calendarId: linked.calendar_id });
  return c.json(await readMeal(c.env.DB, meal.id) as Meal, 200);
});
mealsRoutes.openapi(createRoute({ method: 'delete', path: '/api/meals/{id}', tags: ['Meals'], summary: 'Remove a meal and the calendar event Kinwall created for it (keeps a linked event of your own and shopping items)', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  const db = c.env.DB;
  if (!await db.prepare('SELECT id FROM meals WHERE id = ?').bind(id).first()) return c.json({ error: 'meal not found' }, 404);
  const own = await db.prepare('SELECT calendar_id FROM events WHERE id = ?').bind(`meal:${id}`).first<{ calendar_id: string }>();
  await db.batch([
    db.prepare('DELETE FROM meals WHERE id = ?').bind(id),
    db.prepare('DELETE FROM events WHERE id = ?').bind(`meal:${id}`),
    db.prepare("DELETE FROM notes WHERE target_type = 'event' AND target_id = ?").bind(`meal:${id}`),
  ]);
  emit(c, 'meal.changed', { id });
  if (own) emit(c, 'events.changed', { calendarId: own.calendar_id });
  return c.json({ ok: true }, 200);
});
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals/{id}/calendar-link', tags: ['Meals'], summary: 'Link an existing event without creating a duplicate (admin)', security: [{ Bearer: [] }], request: { params, body: body(z.object({ eventId: z.string().min(1) }).strict()) }, responses: { 200: mealResponse, ...errors } }), async (c) => {
  const meal = await readMeal(c.env.DB, c.req.valid('param').id);
  if (!meal) return c.json({ error: 'meal not found' }, 404);
  const { eventId } = c.req.valid('json');
  if (!await c.env.DB.prepare('SELECT id FROM events WHERE id = ?').bind(eventId).first()) return c.json({ error: 'event not found' }, 400);
  await c.env.DB.prepare('UPDATE meals SET calendar_event_id = ?, updated_at = ? WHERE id = ?').bind(eventId, new Date().toISOString(), meal.id).run();
  emit(c, 'meal.changed', { id: meal.id }); return c.json(await readMeal(c.env.DB, meal.id) as Meal, 200);
});
mealsRoutes.openapi(createRoute({ method: 'delete', path: '/api/meals/{id}/calendar-link', tags: ['Meals'], summary: 'Unlink a calendar event without deleting it (admin)', security: [{ Bearer: [] }], request: { params }, responses: { 200: mealResponse, ...errors } }), async (c) => {
  const { id } = c.req.valid('param');
  const result = await c.env.DB.prepare('UPDATE meals SET calendar_event_id = NULL, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
  if (!result.meta.changes) return c.json({ error: 'meal not found' }, 404);
  emit(c, 'meal.changed', { id }); return c.json(await readMeal(c.env.DB, id) as Meal, 200);
});
mealsRoutes.openapi(createRoute({ method: 'post', path: '/api/meals/{id}/calendar-event', tags: ['Meals'], summary: 'Create and link a local calendar event; external writes are never implicit (admin)', security: [{ Bearer: [] }], request: { params, body: body(z.object({ calendarId: z.string().optional(), durationMinutes: z.number().int().min(1).max(1440).optional() }).strict()) }, responses: { 200: mealResponse, ...errors } }), async (c) => {
  const db = c.env.DB;
  const meal = await readMeal(db, c.req.valid('param').id);
  if (!meal) return c.json({ error: 'meal not found' }, 404);
  if (meal.calendarEventId) {
    const existing = await db.prepare('SELECT id FROM events WHERE id = ?').bind(meal.calendarEventId).first();
    if (existing) return c.json(meal, 200);
    await db.prepare('UPDATE meals SET calendar_event_id = NULL, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), meal.id).run();
    meal.calendarEventId = null;
  }
  const { calendarId, durationMinutes = 60 } = c.req.valid('json');
  const calendar = calendarId ? await db.prepare('SELECT id, kind, writable FROM calendars WHERE id = ?').bind(calendarId).first<{ id: string; kind: string; writable: number }>() : await db.prepare("SELECT id, kind, writable FROM calendars WHERE kind = 'local' AND writable = 1 ORDER BY id LIMIT 1").first<{ id: string; kind: string; writable: number }>();
  if (calendarId && (!calendar || !calendar.writable || calendar.kind !== 'local')) return c.json({ error: 'Choose a writable local calendar; create external events explicitly through the Events API and link them' }, 400);
  const localId = calendar?.id ?? crypto.randomUUID();
  const tz = (await db.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>())?.value || hostTimezone();
  const [y, m, d] = meal.date.split('-').map(Number);
  const [hour, minute] = (meal.plannedTime ?? '00:00').split(':').map(Number);
  const start = meal.plannedTime ? zonedTimeToUtc({ y, mo: m - 1, d, h: hour, mi: minute, s: 0 }, tz).toISOString() : meal.date;
  const end = meal.plannedTime ? new Date(Date.parse(start) + durationMinutes * 60000).toISOString() : new Date(Date.parse(meal.date) + 86400000).toISOString().slice(0, 10);
  const eventId = `meal:${meal.id}`;
  const now = new Date().toISOString();
  await db.batch([
    ...(calendar ? [] : [db.prepare("INSERT INTO calendars (id,kind,name,writable) VALUES (?, 'local', 'Meals', 1) ON CONFLICT(id) DO NOTHING").bind(localId)]),
    db.prepare(`INSERT INTO events (id,calendar_id,title,start,end,all_day,description,member_ids,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(eventId, localId, `${meal.slot[0].toUpperCase()}${meal.slot.slice(1)} · ${meal.title}`, start, end, meal.plannedTime ? 0 : 1, meal.notes, JSON.stringify(meal.assigneeMemberId ? [meal.assigneeMemberId] : []), now),
    db.prepare('UPDATE meals SET calendar_event_id = ?, updated_at = ? WHERE id = ? AND calendar_event_id IS NULL').bind(eventId, now, meal.id),
  ]);
  emit(c, 'events.changed', { calendarId: localId }); emit(c, 'meal.changed', { id: meal.id });
  return c.json(await readMeal(db, meal.id) as Meal, 200);
});
