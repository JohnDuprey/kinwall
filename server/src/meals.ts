// Meal planning domain: recipes are definitions; a meal owns the snapshot it was planned with.
import type { KinwallDb, KinwallStatement } from './db.ts';
import type { Ingredient, Meal, Recipe, Projection } from './meal-schemas.ts';
import { fillPlace, itemKey, recall } from './item-memory.ts';

export function normalizeIngredient(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
export function canonicalUnit(value: string | null): { unit: string | null; factor: number; scalable: boolean } {
  const unit = normalizeIngredient(value ?? '');
  if (['', 'each', 'count', 'piece', 'pieces'].includes(unit)) return { unit: null, factor: 1, scalable: true };
  if (['dozen', 'dozens', 'doz'].includes(unit)) return { unit: null, factor: 12, scalable: true };
  const aliases: Record<string, string> = { cups: 'cup', lbs: 'lb', pound: 'lb', pounds: 'lb', ounces: 'oz', ounce: 'oz', grams: 'g', gram: 'g', kilograms: 'kg', kilogram: 'kg', teaspoons: 'tsp', teaspoon: 'tsp', tablespoons: 'tbsp', tablespoon: 'tbsp', milliliters: 'ml', liters: 'l' };
  return { unit: aliases[unit] ?? unit, factor: 1, scalable: !/^(packages?|packs?|cans?|jars?|bunch(es)?|pinch(es)?|handfuls?)$/.test(unit) };
}
/** Whether an amount scales with servings (clients read it off each ingredient rather than re-deriving it). */
export function isScalable(i: { quantity: number | null; unit: string | null; qualifier: string | null }): boolean {
  return i.quantity !== null && !i.qualifier && canonicalUnit(i.unit).scalable;
}
export type RecipeRow = { id: string; name: string; description: string | null; instructions: string | null; preparation_notes: string | null; source_url: string | null; default_servings: number; archived: number; created_at: string; updated_at: string };
export type IngredientRow = { id: string; recipe_id: string; name: string; normalized_name: string; quantity: number | null; unit: string | null; preparation: string | null; qualifier: string | null; category: string | null; sort: number };
export type MealRow = { id: string; date: string; slot: Meal['slot']; title: string; meal_kind: Meal['mealKind']; recipe_id: string | null; recipe_snapshot: string | null; servings: number; assignee_member_id: string | null; notes: string | null; planned_time: string | null; calendar_event_id: string | null; status: Meal['status']; source_url: string | null; created_at: string; updated_at: string };
export function ingredientApi(r: IngredientRow): Ingredient {
  return { id: r.id, name: r.name, normalizedName: r.normalized_name, quantity: r.quantity, unit: r.unit, preparation: r.preparation, qualifier: r.qualifier, category: r.category, sort: r.sort, scalable: isScalable(r) };
}
export function recipeApi(r: RecipeRow, ingredients: Ingredient[]): Recipe {
  return { id: r.id, name: r.name, description: r.description, instructions: r.instructions, preparationNotes: r.preparation_notes, sourceUrl: r.source_url, defaultServings: r.default_servings, archived: !!r.archived, ingredients, createdAt: r.created_at, updatedAt: r.updated_at };
}
// Snapshots saved before ingredients carried `scalable` get it on the way out.
const snapshotApi = (s: NonNullable<Meal['recipeSnapshot']>) => ({ ...s, ingredients: s.ingredients.map((i) => ({ ...i, scalable: isScalable(i) })) });
export function mealApi(r: MealRow): Meal {
  return { id: r.id, date: r.date, slot: r.slot, title: r.title, mealKind: r.meal_kind, recipeId: r.recipe_id, recipeSnapshot: r.recipe_snapshot ? snapshotApi(JSON.parse(r.recipe_snapshot)) : null, servings: r.servings, assigneeMemberId: r.assignee_member_id, notes: r.notes, plannedTime: r.planned_time, calendarEventId: r.calendar_event_id, status: r.status, sourceUrl: r.source_url, createdAt: r.created_at, updatedAt: r.updated_at };
}
export async function readRecipes(db: KinwallDb, opts: { id?: string; search?: string; archived?: boolean; category?: string } = {}): Promise<Recipe[]> {
  const [recipes, ingredients] = await db.batch<unknown>([
    db.prepare('SELECT * FROM recipes WHERE (? IS NULL OR id = ?) AND (? = 1 OR archived = 0) AND (? IS NULL OR instr(lower(name || coalesce(description, \'\')), lower(?)) > 0) ORDER BY name, id').bind(opts.id ?? null, opts.id ?? null, opts.archived ? 1 : 0, opts.search ?? null, opts.search ?? null),
    db.prepare('SELECT * FROM recipe_ingredients WHERE (? IS NULL OR recipe_id = ?) ORDER BY sort, id').bind(opts.id ?? null, opts.id ?? null),
  ]);
  const byRecipe = new Map<string, Ingredient[]>();
  for (const row of ingredients.results as IngredientRow[]) {
    const values = byRecipe.get(row.recipe_id) ?? [];
    values.push(ingredientApi(row)); byRecipe.set(row.recipe_id, values);
  }
  return (recipes.results as RecipeRow[]).map((r) => recipeApi(r, byRecipe.get(r.id) ?? [])).filter((r) => !opts.category || r.ingredients.some((i) => normalizeIngredient(i.category ?? '') === normalizeIngredient(opts.category!)));
}
export async function readMeals(db: KinwallDb, from: string, to: string): Promise<Meal[]> {
  const { results } = await db.prepare("SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date, CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, planned_time, created_at, id").bind(from, to).all<MealRow>();
  return results.map(mealApi);
}
export async function readMeal(db: KinwallDb, id: string): Promise<Meal | null> {
  const row = await db.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first<MealRow>();
  return row ? mealApi(row) : null;
}
export function mealWrite(db: KinwallDb, meal: Meal): KinwallStatement {
  return db.prepare(`INSERT INTO meals (id,date,slot,title,meal_kind,recipe_id,recipe_snapshot,servings,assignee_member_id,notes,planned_time,calendar_event_id,status,source_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,slot=excluded.slot,title=excluded.title,meal_kind=excluded.meal_kind,recipe_id=excluded.recipe_id,recipe_snapshot=excluded.recipe_snapshot,servings=excluded.servings,assignee_member_id=excluded.assignee_member_id,notes=excluded.notes,planned_time=excluded.planned_time,calendar_event_id=excluded.calendar_event_id,status=excluded.status,source_url=excluded.source_url,updated_at=excluded.updated_at`)
    .bind(meal.id, meal.date, meal.slot, meal.title, meal.mealKind, meal.recipeId, meal.recipeSnapshot ? JSON.stringify(meal.recipeSnapshot) : null, meal.servings, meal.assigneeMemberId, meal.notes, meal.plannedTime, meal.calendarEventId, meal.status, meal.sourceUrl, meal.createdAt, meal.updatedAt);
}
export function sourceFingerprint(source: Projection['items'][number]['sources'][number], key: string): string {
  return JSON.stringify([key, source.quantity, source.servings, source.defaultServings, source.date]);
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000000) / 1000000;
export async function shoppingProjection(db: KinwallDb, from: string, to: string, listId?: string): Promise<Projection> {
  const meals = await readMeals(db, from, to);
  const [appliedRows, existingRows] = listId ? await db.batch<unknown>([
    db.prepare('SELECT source_ref, fingerprint FROM meal_shopping_sources WHERE list_id = ?').bind(listId),
    db.prepare('SELECT id, title, quantity, done FROM list_items WHERE list_id = ?').bind(listId),
  ]) : [{ results: [] }, { results: [] }];
  const applied = new Map((appliedRows.results as { source_ref: string; fingerprint: string }[]).map((r) => [r.source_ref, r.fingerprint]));
  const existing = existingRows.results as { id: string; title: string; quantity: string | null; done: number }[];
  const groups = new Map<string, Projection['items'][number]>();
  for (const meal of meals) {
    if (meal.mealKind !== 'recipe' || !meal.recipeSnapshot) continue;
    const snapshot = meal.recipeSnapshot;
    for (const ing of snapshot.ingredients) {
      const normalizedName = normalizeIngredient(ing.name);
      const unit = canonicalUnit(ing.unit);
      const scalable = ing.scalable;
      const sourceRef = `meal-plan:${meal.id}:ingredient:${ing.id}`;
      // Ambiguous quantities remain individual requirements with their original amount and servings.
      const key = JSON.stringify([normalizedName, unit.unit, scalable ? null : sourceRef]);
      const quantity = ing.quantity === null ? null : scalable ? round(ing.quantity * unit.factor * meal.servings / snapshot.defaultServings) : ing.quantity;
      const source = { sourceRef, mealId: meal.id, date: meal.date, slot: meal.slot, title: meal.title, recipeName: snapshot.name, quantity, unit: scalable ? unit.unit : ing.unit, qualifier: ing.qualifier, preparation: ing.preparation, scalable, servings: meal.servings, defaultServings: snapshot.defaultServings, applied: applied.has(sourceRef), changedSinceApplied: false };
      source.changedSinceApplied = source.applied && applied.get(sourceRef) !== sourceFingerprint(source, key);
      let group = groups.get(key);
      if (!group) {
        group = { key, name: ing.name, normalizedName, quantity: null, unit: source.unit, qualifier: ing.qualifier, category: ing.category, scalable, sources: [], matches: existing.filter((item) => normalizeIngredient(item.title) === normalizedName).map((item) => ({ ...item, done: !!item.done })), applied: false, partiallyApplied: false, changedSinceApplied: false };
        groups.set(key, group);
      }
      group.sources.push(source);
      if (quantity !== null) group.quantity = round((group.quantity ?? 0) + quantity);
    }
  }
  const items = [...groups.values()].map((item) => ({ ...item, applied: item.sources.every((s) => s.applied), partiallyApplied: item.sources.some((s) => s.applied) && item.sources.some((s) => !s.applied), changedSinceApplied: item.sources.some((s) => s.changedSinceApplied) })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { from, to, listId: listId ?? null, items };
}

/** Each item insert and its source claims run in one transaction. The SQL rechecks the ledger,
 * so concurrent/overlapping previews add only still-unclaimed contributions, never duplicates. */
export async function applyProjection(db: KinwallDb, projection: Projection, listId: string, omitKeys: string[], includeNotes: boolean): Promise<string[]> {
  const omitted = new Set(omitKeys);
  const now = new Date().toISOString();
  const wanted = projection.items.filter((item) => !omitted.has(item.key) && !item.applied);
  // Where the household keeps each ingredient (store, category, aisle); the recipe's category otherwise.
  const memory = await recall(db, wanted.map((item) => item.name));
  const rows = wanted.map((item) => ({ item, place: fillPlace(memory, item.name, {}) })).map(({ item, place }) => ({
    id: crypto.randomUUID(), name: item.name, key: itemKey(item.name), category: place.category ?? item.category, store: place.store, aisle: place.aisle, qualifier: item.qualifier,
    suffix: `${item.unit ? ` ${item.unit}` : ''}${item.qualifier ? ` · ${item.qualifier}` : ''}`,
    sources: item.sources.map((s) => ({ ref: s.sourceRef, quantity: s.quantity, fingerprint: sourceFingerprint(s, item.key),
      note: includeNotes ? `${s.date} · ${s.slot} · ${s.title}${s.title === s.recipeName ? '' : ` (${s.recipeName})`}${s.preparation ? ` · ${s.preparation}` : ''}${!s.scalable ? ` · check amount for ${s.servings} servings (recipe: ${s.defaultServings})` : ''}` : null,
    })),
  }));
  // json_each keeps the batch's statement/parameter count small on D1 even for large plans.
  // Chunk by bytes like the export importer; every chunk is still in the same transaction.
  const chunks: string[] = [];
  let chunk: typeof rows = []; let bytes = 2;
  for (const row of rows) {
    const size = new TextEncoder().encode(JSON.stringify(row)).length + 1;
    if (chunk.length && bytes + size > 512 * 1024) { chunks.push(JSON.stringify(chunk)); chunk = []; bytes = 2; }
    chunk.push(row); bytes += size;
  }
  if (chunk.length) chunks.push(JSON.stringify(chunk));
  const writes: KinwallStatement[] = [];
  for (const payload of chunks) {
    writes.push(db.prepare(`INSERT INTO list_items (id,list_id,title,name_key,quantity,notes,category,store,aisle,sort,created_at,updated_at)
      SELECT i.value->>'id', ?, i.value->>'name', i.value->>'key',
        CASE WHEN count(s.value->>'quantity') = 0 THEN i.value->>'qualifier'
          ELSE rtrim(rtrim(printf('%.6f',sum(s.value->>'quantity')),'0'),'.') || (i.value->>'suffix') END,
        group_concat(s.value->>'note', char(10)), i.value->>'category', i.value->>'store', i.value->>'aisle',
        (SELECT coalesce(max(sort),-1) FROM list_items WHERE list_id=?) + row_number() OVER (ORDER BY cast(i.key AS INTEGER)), ?, ?
      FROM json_each(?) i JOIN json_each(i.value->'sources') s
      WHERE NOT EXISTS (SELECT 1 FROM meal_shopping_sources claimed WHERE claimed.list_id=? AND claimed.source_ref=s.value->>'ref')
      GROUP BY i.key`).bind(listId, listId, now, now, payload, listId));
    writes.push(db.prepare(`INSERT INTO meal_shopping_sources (list_id,source_ref,item_id,fingerprint)
      SELECT ?,s.value->>'ref',i.value->>'id',s.value->>'fingerprint' FROM json_each(?) i JOIN json_each(i.value->'sources') s
      WHERE EXISTS (SELECT 1 FROM list_items WHERE id=i.value->>'id') ON CONFLICT(list_id,source_ref) DO NOTHING`).bind(listId, payload));
  }
  // A racing apply may have claimed some or all contributions since the preview was read.
  writes.push(db.prepare('SELECT id FROM list_items WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map((r) => r.id))));
  const results = await db.batch<{ id: string }>(writes);
  return results.at(-1)!.results.map((r) => r.id);
}
