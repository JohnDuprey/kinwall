// Meal planning domain: recipes are definitions; a meal owns the snapshot it was planned with.
import type { KinwallDb, KinwallStatement } from './db.ts';
import type { Actor } from './auth.ts';
import { KIT_QUALIFIER, type Ingredient, type Meal, type Recipe, type RecipeStep, type Projection } from './meal-schemas.ts';
import { fillPlace, itemKey, recall } from './item-memory.ts';

export function normalizeIngredient(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
// Words an ingredient line adds to a basic's name without meaning another thing ("Taco seasoning blend").
const BASIC_FILLER = new Set(['blend', 'mix', 'homemade']);
/** A name as basics match it: any case, punctuation and spacing, without filler words (web/src/recipe-search.ts has the same rule). */
export function basicKey(name: string): string {
  const words = name.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = words.filter((w) => !BASIC_FILLER.has(w));
  return (kept.length ? kept : words).join(' ');
}
/** The one basic whose name matches, or null when none or several do (never `selfId`). */
export function matchBasic<B extends { id: string; name: string }>(name: string, basics: B[], selfId?: string): B | null {
  const key = basicKey(name);
  const found = key ? basics.filter((b) => b.id !== selfId && basicKey(b.name) === key) : [];
  return found.length === 1 ? found[0] : null;
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
// Units an imported ingredient line may start with after its amount ("1.5 tablespoon Sour Cream").
const LINE_UNITS = new Set(['cup', 'cups', 'tablespoon', 'tablespoons', 'tbsp', 'tbs', 'teaspoon', 'teaspoons', 'tsp', 'ounce', 'ounces', 'oz', 'pound', 'pounds', 'lb', 'lbs',
  'gram', 'grams', 'g', 'kilogram', 'kilograms', 'kg', 'milliliter', 'milliliters', 'ml', 'liter', 'liters', 'l', 'package', 'packages', 'pack', 'packs', 'can', 'cans', 'jar', 'jars',
  'bunch', 'bunches', 'pinch', 'pinches', 'handful', 'handfuls', 'clove', 'cloves', 'thumb', 'thumbs', 'slice', 'slices', 'sprig', 'sprigs', 'stalk', 'stalks', 'head', 'heads',
  'bag', 'bags', 'box', 'boxes', 'container', 'containers', 'bottle', 'bottles', 'piece', 'pieces', 'each', 'count', 'dozen', 'unit', 'units']);
const FRACTIONS: Record<string, string> = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
/** One ingredient line as the source printed it ("1.5 tablespoon Sour Cream", "½ cup Rice", "Salt") in recipe terms.
 * "unit" (a kit's word for "one of") means no unit. Anything unrecognized stays in the name. */
export function parseIngredientLine(line: string): { name: string; quantity: number | null; unit: string | null } {
  const text = line.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (f) => ` ${FRACTIONS[f]}`).replace(/\u2044/g, '/').replace(/\s+/g, ' ').trim();
  const amount = /^(?:(\d+) )?(\d+)\/(\d+)(?= |$)|^(\d*\.?\d+)(?= |$)/.exec(text);
  if (!amount) return { name: text, quantity: null, unit: null };
  const quantity = amount[4] !== undefined ? Number(amount[4]) : Number(amount[1] ?? 0) + Number(amount[2]) / Number(amount[3]);
  let rest = text.slice(amount[0].length).trim();
  let unit: string | null = null;
  const word = /^(fl\.? oz\.?|[a-z]+\.?)(?= |$)/i.exec(rest);
  if (word && (LINE_UNITS.has(word[1].toLowerCase().replace(/\.$/, '')) || /^fl/i.test(word[1])) && rest.length > word[0].length) {
    unit = /^units?$/i.test(word[1]) ? null : word[1].toLowerCase().replace(/\.$/, '');
    rest = rest.slice(word[0].length).trim();
    // Kits repeat the unit abbreviated: "1 teaspoon (tsp) Cooking Oil".
    const abbr = /^\((fl\.? ?oz|[a-z]+)\.?\)(?= |$)/i.exec(rest);
    if (abbr && (LINE_UNITS.has(abbr[1].toLowerCase()) || /^fl/i.test(abbr[1])) && rest.length > abbr[0].length) rest = rest.slice(abbr[0].length).trim();
  }
  return { name: rest || text, quantity: rest && Number.isFinite(quantity) ? quantity : null, unit: rest ? unit : null };
}
export type ImportIngredient = string | { text: string; pantry?: boolean; category?: string | null; name?: string; quantity?: number | null; unit?: string | null; qualifier?: string | null; preparation?: string | null; basic?: string | null };
/** An imported ingredient (POST /api/recipes/import) in recipe terms: the line parsed, with any fields it
 * spells out winning (a qualifier over pantry). */
export function importIngredient(line: ImportIngredient) {
  const { text, pantry, category, ...own } = typeof line === 'string' ? { text: line } : line;
  return { ...parseIngredientLine(text), qualifier: pantry === false ? KIT_QUALIFIER : null, preparation: null as string | null, ...own, category: category ?? null };
}
export type RecipeRow = { id: string; name: string; description: string | null; instructions: string | null; preparation_notes: string | null; source_url: string | null; default_servings: number; archived: number; prep_minutes?: number | null; total_minutes?: number | null; source?: string | null; external_id?: string | null; image_url?: string | null; steps?: string | null; kind?: Recipe['kind']; makes?: string | null; created_at: string; updated_at: string };
export type IngredientRow = { id: string; recipe_id: string; name: string; normalized_name: string; quantity: number | null; unit: string | null; preparation: string | null; qualifier: string | null; category: string | null; sort: number; basic_id?: string | null; basic_name?: string | null };
export type MealRow = { id: string; date: string; slot: Meal['slot']; title: string; meal_kind: Meal['mealKind']; recipe_id: string | null; recipe_snapshot: string | null; servings: number; assignee_member_id: string | null; eater_ids?: string | null; notes: string | null; planned_time: string | null; calendar_event_id: string | null; calendar_event_start?: 'meal' | 'cooking' | null; status: Meal['status']; source_url: string | null; created_at: string; updated_at: string };
export function ingredientApi(r: IngredientRow): Ingredient {
  return { id: r.id, name: r.name, normalizedName: r.normalized_name, quantity: r.quantity, unit: r.unit, preparation: r.preparation, qualifier: r.qualifier, category: r.category, sort: r.sort, scalable: isScalable(r), basicId: r.basic_id ?? null, basicName: r.basic_name ?? null };
}
export function recipeApi(r: RecipeRow, ingredients: Ingredient[]): Recipe {
  return { id: r.id, name: r.name, description: r.description, instructions: r.instructions, preparationNotes: r.preparation_notes, sourceUrl: r.source_url, defaultServings: r.default_servings, prepMinutes: r.prep_minutes ?? null, totalMinutes: r.total_minutes ?? null, archived: !!r.archived, ingredients, source: r.source ?? null, externalId: r.external_id ?? null, imageUrl: r.image_url ?? null, kind: r.kind ?? 'meal', makes: r.makes ?? null, steps: r.steps ? (JSON.parse(r.steps) as RecipeStep[]).map((s) => ({ ...s, title: s.title ?? null, timers: s.timers ?? [] })) : null, createdAt: r.created_at, updatedAt: r.updated_at };
}
export function ratingApi(byMember: Record<string, number>): NonNullable<Recipe['rating']> {
  const stars = Object.values(byMember);
  return { average: stars.length ? Math.round(stars.reduce((a, b) => a + b, 0) / stars.length * 10) / 10 : null, count: stars.length, byMember };
}
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.replace(/^\s*[-*•·–]\s+/, '').trim()).filter(Boolean);
/** Steps as stored: a plain string is a step's text, and a text of several lines with no bullets
 * becomes a step of bullets (how a meal kit writes several short instructions in one step).
 * Empty steps are dropped. */
export function normalizeSteps(steps: (string | { text?: string; bullets?: string[]; imageUrl?: string | null; title?: string | null; timers?: RecipeStep['timers'] })[]): RecipeStep[] {
  return steps.map((step) => {
    const { text = '', bullets = [], imageUrl = null, title = null, timers = [] } = typeof step === 'string' ? { text: step } : step;
    const own = bullets.map((b) => b.trim()).filter(Boolean);
    const split = own.length ? [text.trim()] : lines(text);
    const extra = { imageUrl, title: title?.trim() || null, timers };
    return split.length > 1 ? { text: '', bullets: split, ...extra } : { text: split[0] ?? '', bullets: own, ...extra };
  }).filter((s) => s.text || s.bullets.length);
}
/** The same steps as numbered text (the recipe's instructions), bullets as "- " lines under their number. */
export function stepsText(steps: RecipeStep[]): string {
  return steps.map((s, i) => {
    const [first, ...rest] = s.text ? [s.text, ...s.bullets.map((b) => `- ${b}`)] : s.bullets.map((b, j) => j ? `- ${b}` : b);
    return [`${i + 1}. ${s.title ? `${s.title}: ` : ''}${first}`, ...rest].join('\n');
  }).join('\n');
}
// Snapshots saved before ingredients carried `scalable` get it on the way out.
const snapshotApi = (s: NonNullable<Meal['recipeSnapshot']>) => ({ ...s, ingredients: s.ingredients.map((i) => ({ ...i, scalable: isScalable(i) })) });
export function mealApi(r: MealRow): Meal {
  return { id: r.id, date: r.date, slot: r.slot, title: r.title, mealKind: r.meal_kind, recipeId: r.recipe_id, recipeSnapshot: r.recipe_snapshot ? snapshotApi(JSON.parse(r.recipe_snapshot)) : null, servings: r.servings, assigneeMemberId: r.assignee_member_id, eaterIds: r.eater_ids ? JSON.parse(r.eater_ids) : [], notes: r.notes, plannedTime: r.planned_time, calendarEventId: r.calendar_event_id, calendarEventStart: r.calendar_event_start ?? null, status: r.status, sourceUrl: r.source_url, createdAt: r.created_at, updatedAt: r.updated_at };
}
export async function readRecipes(db: KinwallDb, opts: { id?: string; search?: string; archived?: boolean; category?: string; kind?: Recipe['kind'] } = {}): Promise<Recipe[]> {
  const [recipes, ingredients, ratings] = await db.batch<unknown>([
    db.prepare('SELECT * FROM recipes WHERE (? IS NULL OR id = ?) AND (? = 1 OR archived = 0) AND (? IS NULL OR kind = ?) AND (? IS NULL OR instr(lower(name || coalesce(description, \'\')), lower(?)) > 0) ORDER BY name, id').bind(opts.id ?? null, opts.id ?? null, opts.archived ? 1 : 0, opts.kind ?? null, opts.kind ?? null, opts.search ?? null, opts.search ?? null),
    db.prepare('SELECT i.*, b.name AS basic_name FROM recipe_ingredients i LEFT JOIN recipes b ON b.id = i.basic_id WHERE (? IS NULL OR i.recipe_id = ?) ORDER BY i.sort, i.id').bind(opts.id ?? null, opts.id ?? null),
    db.prepare('SELECT recipe_id, member_id, stars FROM recipe_ratings WHERE (? IS NULL OR recipe_id = ?)').bind(opts.id ?? null, opts.id ?? null),
  ]);
  const starsBy = new Map<string, Record<string, number>>();
  for (const r of ratings.results as { recipe_id: string; member_id: string; stars: number }[]) starsBy.set(r.recipe_id, { ...starsBy.get(r.recipe_id), [r.member_id]: r.stars });
  const byRecipe = new Map<string, Ingredient[]>();
  for (const row of ingredients.results as IngredientRow[]) {
    const values = byRecipe.get(row.recipe_id) ?? [];
    values.push(ingredientApi(row)); byRecipe.set(row.recipe_id, values);
  }
  return (recipes.results as RecipeRow[]).map((r) => ({ ...recipeApi(r, byRecipe.get(r.id) ?? []), rating: ratingApi(starsBy.get(r.id) ?? {}) })).filter((r) => !opts.category || r.ingredients.some((i) => normalizeIngredient(i.category ?? '') === normalizeIngredient(opts.category!)));
}
export async function readMeals(db: KinwallDb, from: string, to: string): Promise<Meal[]> {
  const { results } = await db.prepare("SELECT * FROM meals WHERE date >= ? AND date <= ? ORDER BY date, CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, planned_time, created_at, id").bind(from, to).all<MealRow>();
  return results.map(mealApi);
}
export async function readMeal(db: KinwallDb, id: string): Promise<Meal | null> {
  const row = await db.prepare('SELECT * FROM meals WHERE id = ?').bind(id).first<MealRow>();
  return row ? mealApi(row) : null;
}
export function mealWrite(db: KinwallDb, meal: Omit<Meal, 'eaterIds' | 'calendarEventStart'> & { eaterIds?: string[]; calendarEventStart?: Meal['calendarEventStart'] }): KinwallStatement {
  return db.prepare(`INSERT INTO meals (id,date,slot,title,meal_kind,recipe_id,recipe_snapshot,servings,assignee_member_id,eater_ids,notes,planned_time,calendar_event_id,calendar_event_start,status,source_url,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET date=excluded.date,slot=excluded.slot,title=excluded.title,meal_kind=excluded.meal_kind,recipe_id=excluded.recipe_id,recipe_snapshot=excluded.recipe_snapshot,servings=excluded.servings,assignee_member_id=excluded.assignee_member_id,eater_ids=excluded.eater_ids,notes=excluded.notes,planned_time=excluded.planned_time,calendar_event_id=excluded.calendar_event_id,calendar_event_start=excluded.calendar_event_start,status=excluded.status,source_url=excluded.source_url,updated_at=excluded.updated_at`)
    .bind(meal.id, meal.date, meal.slot, meal.title, meal.mealKind, meal.recipeId, meal.recipeSnapshot ? JSON.stringify(meal.recipeSnapshot) : null, meal.servings, meal.assigneeMemberId, JSON.stringify(meal.eaterIds ?? []), meal.notes, meal.plannedTime, meal.calendarEventId, meal.calendarEventId ? meal.calendarEventStart ?? null : null, meal.status, meal.sourceUrl, meal.createdAt, meal.updatedAt);
}
export function sourceFingerprint(source: Projection['items'][number]['sources'][number], key: string): string {
  return JSON.stringify([key, source.quantity, source.servings, source.defaultServings, source.date]);
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 1000000) / 1000000;
export type BasicChoices = Record<string, 'made' | 'ingredients'>;
/** `basics` answers, per basic, for lines made from one: made (skip it) or ingredients (its own
 * ingredients, as written, once for the range). A basic whose ingredients were already added for this
 * range counts as applied; one with no answer is listed as its line. */
export async function shoppingProjection(db: KinwallDb, from: string, to: string, listId?: string, basics: BasicChoices = {}): Promise<Projection> {
  const meals = await readMeals(db, from, to);
  const [appliedRows, existingRows] = listId ? await db.batch<unknown>([
    db.prepare('SELECT source_ref, fingerprint FROM meal_shopping_sources WHERE list_id = ?').bind(listId),
    db.prepare('SELECT id, title, quantity, done FROM list_items WHERE list_id = ?').bind(listId),
  ]) : [{ results: [] }, { results: [] }];
  const applied = new Map((appliedRows.results as { source_ref: string; fingerprint: string }[]).map((r) => [r.source_ref, r.fingerprint]));
  const existing = existingRows.results as { id: string; title: string; quantity: string | null; done: number }[];
  const lines = meals.flatMap((meal) => meal.mealKind === 'recipe' && meal.recipeSnapshot
    ? meal.recipeSnapshot.ingredients.map((ing) => ({ meal, snapshot: meal.recipeSnapshot!, ing, sourceRef: `meal-plan:${meal.id}:ingredient:${ing.id}` })) : []);
  // Basics as they are now (a snapshot may link one since deleted: then it's an ordinary line).
  const basicsById = lines.some((l) => l.ing.basicId) ? new Map((await readRecipes(db, { kind: 'basic', archived: true })).map((b) => [b.id, b])) : new Map<string, Recipe>();
  const expandedRefs = [...applied.keys()].filter((k) => k.includes(':basic:'));
  const onList = new Set(lines.filter((l) => l.ing.basicId && expandedRefs.some((k) => k.startsWith(`${l.sourceRef}:basic:`))).map((l) => l.ing.basicId!));
  const expanded = new Set<string>();
  const groups = new Map<string, Projection['items'][number]>();
  const add = (meal: Meal, ing: Ingredient, sourceRef: string, recipeName: string, servings: number, defaultServings: number, extra: { basic?: Recipe; ofBasic?: string; appliedAnyway?: boolean }) => {
    const normalizedName = normalizeIngredient(ing.name);
    const unit = canonicalUnit(ing.unit);
    const scalable = ing.scalable;
    // Ambiguous quantities remain individual requirements with their original amount and servings.
    // A line made from a basic stays its own item until the family answers for it.
    const key = JSON.stringify([normalizedName, unit.unit, scalable ? null : sourceRef, ...(extra.basic ? [`basic:${extra.basic.id}`] : [])]);
    const quantity = ing.quantity === null ? null : scalable ? round(ing.quantity * unit.factor * servings / defaultServings) : ing.quantity;
    const source = { sourceRef, mealId: meal.id, date: meal.date, slot: meal.slot, title: meal.title, recipeName, quantity, unit: scalable ? unit.unit : ing.unit, qualifier: ing.qualifier, preparation: ing.preparation, scalable, servings, defaultServings, applied: !!extra.appliedAnyway || applied.has(sourceRef), changedSinceApplied: false, basicName: extra.ofBasic ?? null };
    source.changedSinceApplied = applied.has(sourceRef) && applied.get(sourceRef) !== sourceFingerprint(source, key);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: ing.name, normalizedName, quantity: null, unit: source.unit, qualifier: ing.qualifier, category: ing.category, scalable, sources: [], matches: existing.filter((item) => normalizeIngredient(item.title) === normalizedName).map((item) => ({ ...item, done: !!item.done })), applied: false, partiallyApplied: false, changedSinceApplied: false, basicId: extra.basic?.id ?? null, basicName: extra.basic?.name ?? null };
      groups.set(key, group);
    }
    group.sources.push(source);
    if (quantity !== null) group.quantity = round((group.quantity ?? 0) + quantity);
  };
  for (const { meal, snapshot, ing, sourceRef } of lines) {
    const basic = ing.basicId ? basicsById.get(ing.basicId) : undefined;
    const answer = basic && !onList.has(basic.id) ? basics[basic.id] : undefined;
    if (answer === 'made') continue;
    if (answer === 'ingredients') {
      // One batch for the range, as written (scaling a basic is up to the cook).
      if (expanded.has(basic!.id)) continue;
      expanded.add(basic!.id);
      for (const own of basic!.ingredients) add(meal, own, `${sourceRef}:basic:${own.id}`, snapshot.name, basic!.defaultServings, basic!.defaultServings, { ofBasic: basic!.name });
      continue;
    }
    add(meal, ing, sourceRef, snapshot.name, meal.servings, snapshot.defaultServings, { basic, appliedAnyway: !!basic && onList.has(basic.id) });
  }
  const items = [...groups.values()].map((item) => ({ ...item, applied: item.sources.every((s) => s.applied), partiallyApplied: item.sources.some((s) => s.applied) && item.sources.some((s) => !s.applied), changedSinceApplied: item.sources.some((s) => s.changedSinceApplied) })).sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { from, to, listId: listId ?? null, items };
}

/** Each item insert and its source claims run in one transaction. The SQL rechecks the ledger,
 * so concurrent/overlapping previews add only still-unclaimed contributions, never duplicates. */
export async function applyProjection(db: KinwallDb, projection: Projection, listId: string, omitKeys: string[], includeNotes: boolean, includeKitItems = false, by: Actor = { memberId: null, label: null }): Promise<string[]> {
  const omitted = new Set(omitKeys);
  const now = new Date().toISOString();
  // What ships in a meal kit is already in the box, so it stays off the list unless asked for.
  const wanted = projection.items.filter((item) => !omitted.has(item.key) && !item.applied && (includeKitItems || item.qualifier !== KIT_QUALIFIER));
  // Where the household keeps each ingredient (store, category, aisle); the recipe's category otherwise.
  const memory = await recall(db, 'groceries', wanted.map((item) => item.name)); // meals add to Groceries lists only
  const rows = wanted.map((item) => ({ item, place: fillPlace(memory, item.name, {}) })).map(({ item, place }) => ({
    id: crypto.randomUUID(), name: item.name, key: itemKey(item.name), category: place.category ?? item.category, store: place.store, aisle: place.aisle, qualifier: item.qualifier,
    suffix: `${item.unit ? ` ${item.unit}` : ''}${item.qualifier ? ` · ${item.qualifier}` : ''}`,
    sources: item.sources.map((s) => ({ ref: s.sourceRef, quantity: s.quantity, fingerprint: sourceFingerprint(s, item.key),
      // A basic's own ingredient always says which basic it's for.
      note: includeNotes ? `${s.date} · ${s.slot} · ${s.title}${s.title === s.recipeName ? '' : ` (${s.recipeName})`}${s.basicName ? ` · for ${s.basicName}` : ''}${s.preparation ? ` · ${s.preparation}` : ''}${!s.scalable && !s.basicName ? ` · check amount for ${s.servings} servings (recipe: ${s.defaultServings})` : ''}` : s.basicName ? `For ${s.basicName}` : null,
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
    writes.push(db.prepare(`INSERT INTO list_items (id,list_id,title,name_key,quantity,notes,category,store,aisle,sort,created_at,updated_at,added_by,added_by_label)
      SELECT i.value->>'id', ?, i.value->>'name', i.value->>'key',
        CASE WHEN count(s.value->>'quantity') = 0 THEN i.value->>'qualifier'
          ELSE rtrim(rtrim(printf('%.6f',sum(s.value->>'quantity')),'0'),'.') || (i.value->>'suffix') END,
        group_concat(s.value->>'note', char(10)), i.value->>'category', i.value->>'store', i.value->>'aisle',
        (SELECT coalesce(max(sort),-1) FROM list_items WHERE list_id=?) + row_number() OVER (ORDER BY cast(i.key AS INTEGER)), ?, ?, ?, ?
      FROM json_each(?) i JOIN json_each(i.value->'sources') s
      WHERE NOT EXISTS (SELECT 1 FROM meal_shopping_sources claimed WHERE claimed.list_id=? AND claimed.source_ref=s.value->>'ref')
      GROUP BY i.key`).bind(listId, listId, now, now, by.memberId, by.label, payload, listId));
    // Autocomplete remembers the names actually added (src/item-memory.ts rememberName).
    writes.push(db.prepare(`INSERT INTO item_names (catalog,name_key,title,uses,last_used)
      SELECT 'groceries', i.value->>'key', i.value->>'name', 1, ? FROM json_each(?) i WHERE EXISTS (SELECT 1 FROM list_items WHERE id=i.value->>'id')
      ON CONFLICT(catalog,name_key) DO UPDATE SET title=excluded.title, uses=item_names.uses+1, last_used=excluded.last_used`).bind(now, payload));
    writes.push(db.prepare(`INSERT INTO meal_shopping_sources (list_id,source_ref,item_id,fingerprint)
      SELECT ?,s.value->>'ref',i.value->>'id',s.value->>'fingerprint' FROM json_each(?) i JOIN json_each(i.value->'sources') s
      WHERE EXISTS (SELECT 1 FROM list_items WHERE id=i.value->>'id') ON CONFLICT(list_id,source_ref) DO NOTHING`).bind(listId, payload));
  }
  // A racing apply may have claimed some or all contributions since the preview was read.
  writes.push(db.prepare('SELECT id FROM list_items WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(rows.map((r) => r.id))));
  const results = await db.batch<{ id: string }>(writes);
  return results.at(-1)!.results.map((r) => r.id);
}
