// The pantry: what food the family has, on pantry lists (to-do lists with purpose 'pantry', 0143). An item's due_date
// is its use-by date and its category is where it's kept (Fridge, Freezer, Pantry...). This module
// reads what's expiring and ranks the family's recipes by how much of it they use up. Pure matching
// and scoring here; routes/pantry.ts serves it, and mcp.ts hands it to AI assistants.
// web/src/pantry.ts also calculates use-by status for display; the demo uses simple ingredient matches.
import type { KinwallDb } from './db.ts';
import { itemKey } from './item-memory.ts';
import { KIT_QUALIFIER, type Recipe } from './meal-schemas.ts';
import { readRecipes } from './meals.ts';

export type UseByStatus = 'expired' | 'today' | 'soon' | 'later';
/** Within this many days (and not today) an item is "soon". */
export const SOON_DAYS = 3;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;

/** Days from `today` to a use-by date (both YYYY-MM-DD, household calendar) and what that means;
 * null without a date, or with one that isn't a real date (so nothing is called expired by mistake). */
export function expiryStatus(useBy: string | null, today: string): { daysLeft: number; status: UseByStatus } | null {
  if (!useBy || !DATE.test(useBy) || Number.isNaN(Date.parse(useBy))) return null;
  const daysLeft = Math.round(dayNumber(useBy) - dayNumber(today));
  return { daysLeft, status: daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'today' : daysLeft <= SOON_DAYS ? 'soon' : 'later' };
}

// Words that don't change which food it is ("Fresh baby spinach" is spinach).
const FILLER = new Set(['fresh', 'frozen', 'organic', 'baby', 'raw', 'ripe', 'boneless', 'skinless', 'chopped', 'diced', 'sliced', 'minced', 'shredded', 'grated', 'cubed', 'crushed',
  'leftover', 'leftovers', 'homemade', 'large', 'small', 'medium', 'a', 'an', 'the', 'of', 'and', 'or', 'some', 'can', 'canned', 'bag', 'box', 'package', 'jar', 'bunch']);
// Extra words that still name what you have: a cut of it ("Chicken" covers chicken thighs) or a
// variety ("Tomatoes" covers cherry tomatoes). Any other extra word is a different food
// ("Milk" isn't coconut milk, "Garlic" isn't garlic powder, "Potatoes" aren't sweet potatoes).
const SAME_FOOD = new Set([
  'breast', 'thigh', 'drumstick', 'wing', 'leg', 'tender', 'tenderloin', 'fillet', 'filet', 'loin', 'chop', 'steak', 'ground', 'strip', 'cutlet', 'piece', 'mince',
  'red', 'yellow', 'purple', 'orange', 'gold', 'golden', 'cherry', 'grape', 'roma', 'plum', 'heirloom', 'russet', 'yukon', 'english', 'seedless',
  'greek', 'plain', 'whole', 'skim', 'nonfat', 'lowfat', 'low', 'fat', 'reduced', 'unsalted', 'salted', 'lean', 'extra', 'sharp', 'mild', 'aged', 'block', 'shell', 'hard', 'boiled',
].map(itemKey));
// Green, white, brown and black aren't in it: green beans aren't beans, brown sugar isn't sugar, black pepper isn't peppers.
// Assumed on hand, compared word for word with plurals kept: "pepper" is the spice, "peppers" the vegetable.
const STAPLES = new Set(['salt', 'pepper', 'black pepper', 'ground black pepper', 'ground pepper', 'salt pepper', 'kosher salt', 'sea salt', 'water', 'ice', 'oil', 'cooking oil', 'olive oil', 'vegetable oil', 'canola oil', 'cooking spray']);

/** A food name as matching words: any case and plural, filler left out ("Fresh Tomatoes" → tomato). */
export function foodWords(name: string): string[] {
  const words = name.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const kept = words.filter((w) => !FILLER.has(w));
  return [...new Set((kept.length ? kept : words).map(itemKey))];
}

/** Whether a pantry item and a recipe ingredient are the same food: the same words, or one adds only a
 * cut or a variety to the other ("Chicken" ~ "chicken thighs", "Greek yogurt" ~ "yogurt"). */
export function foodMatches(a: string, b: string): boolean {
  const x = foodWords(a), y = foodWords(b);
  if (!x.length || !y.length) return false;
  const [small, large] = x.length <= y.length ? [x, y] : [y, x];
  if (!small.every((w) => large.includes(w))) return false;
  return large.filter((w) => !small.includes(w)).every((w) => SAME_FOOD.has(w));
}

export const isStaple = (name: string) => STAPLES.has((name.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !FILLER.has(w)).join(' '));

export type PantryItem = {
  id: string; listId: string; listName: string; title: string; quantity: string | null
  kept: string | null; useBy: string | null; daysLeft: number | null; status: UseByStatus | null
};
type ItemRow = { id: string; list_id: string; list_name: string; title: string; quantity: string | null; category: string | null; due_date: string | null };

/** Every open item on the (unarchived) pantry lists, or one list's, soonest use-by first, then A-Z. */
export async function readPantry(db: KinwallDb, today: string, listId?: string): Promise<PantryItem[]> {
  const { results } = await db.prepare(
    `SELECT li.id, li.list_id, l.name AS list_name, li.title, li.quantity, li.category, li.due_date
       FROM list_items li JOIN lists l ON l.id = li.list_id
      WHERE l.kind = 'todo' AND l.purpose = 'pantry' AND l.archived = 0 AND li.done = 0 AND (?1 IS NULL OR l.id = ?1)`,
  ).bind(listId ?? null).all<ItemRow>();
  return results
    .map((r) => {
      const when = expiryStatus(r.due_date, today);
      return { id: r.id, listId: r.list_id, listName: r.list_name, title: r.title, quantity: r.quantity, kept: r.category, useBy: r.due_date, daysLeft: when?.daysLeft ?? null, status: when?.status ?? null };
    })
    .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }));
}

/** Items to use within `days` (0: today and anything past its date). */
export const expiringWithin = (items: PantryItem[], days: number) => items.filter((i) => i.daysLeft !== null && i.daysLeft <= days);

export type PantryUse = PantryItem & { ingredient: string };
export type PantrySuggestion = {
  recipe: { id: string; name: string; imageUrl: string | null; totalMinutes: number | null; rating: number | null }
  score: number; uses: PantryUse[]; alsoHave: PantryUse[]; missing: string[]
};

// How much using an item counts: today (or past it) 1, tomorrow ½, in six days ⅐.
const urgency = (i: PantryItem) => 1 / (1 + Math.max(0, i.daysLeft ?? Infinity));

/** The family's meals (not basics, not archived) that use at least one expiring item, best first:
 * the more and sooner-expiring items a recipe uses up the higher it ranks, then what else it uses
 * from the pantry, then fewer things to buy, then the family's rating, then A-Z. */
export function rankRecipes(recipes: Recipe[], pantry: PantryItem[], expiring: PantryItem[]): PantrySuggestion[] {
  const soon = new Set(expiring.map((i) => i.id));
  const out: PantrySuggestion[] = [];
  // Soonest to expire first, so each ingredient uses up the item that needs it most.
  const ordered = [...pantry].sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
  for (const recipe of recipes) {
    if (recipe.archived || recipe.kind === 'basic') continue;
    const uses: PantryUse[] = [], alsoHave: PantryUse[] = [], missing: string[] = [];
    const seen = new Set<string>();
    for (const ing of recipe.ingredients) {
      // Assumed on hand, and never matched: "Peppers" aren't the pepper in "salt and pepper".
      if (isStaple(ing.name)) continue;
      const found = ordered.filter((i) => foodMatches(i.title, ing.name));
      // Nothing to buy for what ships in a meal kit.
      if (!found.length) { if (ing.qualifier !== KIT_QUALIFIER && !missing.includes(ing.name)) missing.push(ing.name); continue; }
      // One item per ingredient (two packs of chicken don't make the curry count twice), one ingredient per item.
      const item = found.find((i) => !seen.has(i.id));
      if (!item) continue;
      seen.add(item.id);
      (soon.has(item.id) ? uses : alsoHave).push({ ...item, ingredient: ing.name });
    }
    if (!uses.length) continue;
    uses.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    const score = uses.reduce((n, i) => n + urgency(i), 0) + 0.1 * alsoHave.length - 0.02 * missing.length;
    out.push({
      recipe: { id: recipe.id, name: recipe.name, imageUrl: recipe.imageUrl ?? null, totalMinutes: recipe.totalMinutes ?? null, rating: recipe.rating?.average ?? null },
      score: Math.round(score * 1000) / 1000, uses, alsoHave, missing,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.missing.length - b.missing.length || (b.recipe.rating ?? 0) - (a.recipe.rating ?? 0) || a.recipe.name.localeCompare(b.recipe.name, 'en', { sensitivity: 'base' }));
}

/** What to eat to use up what's expiring: the expiring items, ranked recipes, and the expiring items
 * none of the shown recipes use (for an assistant to suggest something new, or just a reminder). */
export async function pantrySuggestions(db: KinwallDb, today: string, opts: { days: number; limit: number; listId?: string }) {
  const pantry = await readPantry(db, today, opts.listId);
  const expiring = expiringWithin(pantry, opts.days);
  const suggestions = expiring.length ? rankRecipes(await readRecipes(db, { kind: 'meal' }), pantry, expiring).slice(0, opts.limit) : [];
  const used = new Set(suggestions.flatMap((s) => s.uses.map((u) => u.id)));
  return { today, days: opts.days, expiring, suggestions, unmatched: expiring.filter((i) => !used.has(i.id)) };
}
