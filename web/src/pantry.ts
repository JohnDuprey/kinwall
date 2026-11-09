// Pantry lists (food at home): an item's dueDate is its use-by date and its category where it's kept.
// expiryStatus, foodMatches and rankRecipes mirror server/src/pantry.ts (the demo build ranks with
// them); keep the two in step.
import { DAY, formatDate, MONTH_DAY, msg, t } from './i18n.ts'
import type { PantryItem, PantrySuggestions, PantryUse, UseByStatus } from './types.ts'
import { KIT_QUALIFIER, type Recipe } from './meal-types.ts'
import { itemKey } from './itemSuggest.ts'

/** Within this many days (and not today) an item is "soon". */
export const SOON_DAYS = 3
/** Where food is kept, offered before the family has its own places. */
export const KEPT_STARTERS = [msg('Fridge'), msg('Freezer'), msg('Pantry')]

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000

/** Days from `today` to a use-by date (YYYY-MM-DD) and what that means; null without a real date. */
export function expiryStatus(useBy: string | null | undefined, today: string): { daysLeft: number; status: UseByStatus } | null {
  if (!useBy || !DATE.test(useBy) || Number.isNaN(Date.parse(useBy))) return null
  const daysLeft = Math.round(dayNumber(useBy) - dayNumber(today))
  return { daysLeft, status: daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'today' : daysLeft <= SOON_DAYS ? 'soon' : 'later' }
}

/** A pantry item's line: "⚠ Expired · Nov 6", "⏳ Use today", "⏳ Use by tomorrow", "⏳ Use by Tue, Nov 11",
 * "Use by Nov 20". The words and the mark carry it, not just the color. Nothing once used up or undated. */
export function expiryLabel(item: { dueDate: string | null; done: boolean }, today: string): { text: string; status: UseByStatus } | null {
  const when = item.done ? null : expiryStatus(item.dueDate, today)
  if (!when) return null
  const d = new Date(item.dueDate + 'T00:00:00')
  if (when.status === 'expired') return { text: t('⚠ Expired · {date}', { date: formatDate(d, MONTH_DAY) }), status: when.status }
  if (when.status === 'today') return { text: t('⏳ Use today'), status: when.status }
  if (when.daysLeft === 1) return { text: t('⏳ Use by tomorrow'), status: when.status }
  if (when.status === 'soon') return { text: t('⏳ Use by {date}', { date: formatDate(d, DAY) }), status: when.status }
  return { text: t('Use by {date}', { date: formatDate(d, MONTH_DAY) }), status: when.status }
}

/** Pantry groups (Fridge, Freezer...) in the order to look at them: the one with the soonest use-by
 * date first, groups with no dated food after, then A-Z. Each group's items are its open ones. */
export function soonestGroupFirst(a: { name: string; items: { dueDate: string | null }[] }, b: { name: string; items: { dueDate: string | null }[] }): number {
  const soonest = (items: { dueDate: string | null }[]) => items.reduce<string | null>((min, i) => (i.dueDate && (!min || i.dueDate < min) ? i.dueDate : min), null)
  const x = soonest(a.items), y = soonest(b.items)
  return x && y ? x.localeCompare(y) || a.name.localeCompare(b.name) : x ? -1 : y ? 1 : a.name.localeCompare(b.name)
}

/** A short "when" for a pantry item in a sentence ("today", "tomorrow", "Tue", "expired"). */
export function expiryShort(item: Pick<PantryItem, 'useBy' | 'daysLeft' | 'status'>): string {
  if (item.status === 'expired') return t('expired')
  if (item.daysLeft === 0) return t('today')
  if (item.daysLeft === 1) return t('tomorrow')
  return item.useBy ? formatDate(new Date(item.useBy + 'T00:00:00'), { weekday: 'short' }) : ''
}

// Matching, as server/src/pantry.ts does it.
const FILLER = new Set(['fresh', 'frozen', 'organic', 'baby', 'raw', 'ripe', 'boneless', 'skinless', 'chopped', 'diced', 'sliced', 'minced', 'shredded', 'grated', 'cubed', 'crushed',
  'leftover', 'leftovers', 'homemade', 'large', 'small', 'medium', 'a', 'an', 'the', 'of', 'and', 'or', 'some', 'can', 'canned', 'bag', 'box', 'package', 'jar', 'bunch'])
const SAME_FOOD = new Set([
  'breast', 'thigh', 'drumstick', 'wing', 'leg', 'tender', 'tenderloin', 'fillet', 'filet', 'loin', 'chop', 'steak', 'ground', 'strip', 'cutlet', 'piece', 'mince',
  'red', 'yellow', 'purple', 'orange', 'gold', 'golden', 'cherry', 'grape', 'roma', 'plum', 'heirloom', 'russet', 'yukon', 'english', 'seedless',
  'greek', 'plain', 'whole', 'skim', 'nonfat', 'lowfat', 'low', 'fat', 'reduced', 'unsalted', 'salted', 'lean', 'extra', 'sharp', 'mild', 'aged', 'block', 'shell', 'hard', 'boiled',
].map(itemKey))
// Green, white, brown and black aren't in it: green beans aren't beans, brown sugar isn't sugar, black pepper isn't peppers.
// Assumed on hand, compared word for word with plurals kept: "pepper" is the spice, "peppers" the vegetable.
const STAPLES = new Set(['salt', 'pepper', 'black pepper', 'ground black pepper', 'ground pepper', 'salt pepper', 'kosher salt', 'sea salt', 'water', 'ice', 'oil', 'cooking oil', 'olive oil', 'vegetable oil', 'canola oil', 'cooking spray'])

export function foodWords(name: string): string[] {
  const words = name.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const kept = words.filter(w => !FILLER.has(w))
  return [...new Set((kept.length ? kept : words).map(itemKey))]
}
/** The same food: the same words, or one adds only a cut or a variety ("Chicken" ~ "chicken thighs"). */
export function foodMatches(a: string, b: string): boolean {
  const x = foodWords(a), y = foodWords(b)
  if (!x.length || !y.length) return false
  const [small, large] = x.length <= y.length ? [x, y] : [y, x]
  if (!small.every(w => large.includes(w))) return false
  return large.filter(w => !small.includes(w)).every(w => SAME_FOOD.has(w))
}
const isStaple = (name: string) => STAPLES.has((name.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => !FILLER.has(w)).join(' '))
const urgency = (i: PantryItem) => 1 / (1 + Math.max(0, i.daysLeft ?? Infinity))

/** Recipes that use up what's expiring, best first (server/src/pantry.ts rankRecipes). */
export function rankRecipes(recipes: Recipe[], pantry: PantryItem[], expiring: PantryItem[]): PantrySuggestions['suggestions'] {
  const soon = new Set(expiring.map(i => i.id))
  const out: PantrySuggestions['suggestions'] = []
  for (const recipe of recipes) {
    if (recipe.archived || recipe.kind === 'basic') continue
    const uses: PantryUse[] = [], alsoHave: PantryUse[] = [], missing: string[] = []
    const seen = new Set<string>()
    // Soonest to expire first, so each ingredient uses up the item that needs it most.
    const ordered = [...pantry].sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))
    for (const ing of recipe.ingredients) {
      // Assumed on hand, and never matched: "Peppers" aren't the pepper in "salt and pepper".
      if (isStaple(ing.name)) continue
      const found = ordered.filter((i) => foodMatches(i.title, ing.name))
      // Nothing to buy for what ships in a meal kit.
      if (!found.length) {
        if (ing.qualifier !== KIT_QUALIFIER && !missing.includes(ing.name)) missing.push(ing.name)
        continue
      }
      // One item per ingredient (two packs of chicken don't make the curry count twice), one ingredient per item.
      const item = found.find((i) => !seen.has(i.id))
      if (!item) continue
      seen.add(item.id)
      ;(soon.has(item.id) ? uses : alsoHave).push({ ...item, ingredient: ing.name })
    }
    if (!uses.length) continue
    uses.sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    const score = uses.reduce((n, i) => n + urgency(i), 0) + 0.1 * alsoHave.length - 0.02 * missing.length
    out.push({ recipe: { id: recipe.id, name: recipe.name, imageUrl: recipe.imageUrl ?? null, totalMinutes: recipe.totalMinutes ?? null, rating: recipe.rating?.average ?? null }, score: Math.round(score * 1000) / 1000, uses, alsoHave, missing })
  }
  return out.sort((a, b) => b.score - a.score || a.missing.length - b.missing.length || (b.recipe.rating ?? 0) - (a.recipe.rating ?? 0) || a.recipe.name.localeCompare(b.recipe.name, 'en', { sensitivity: 'base' }))
}
