/** Small, deterministic English rules. Nothing is written until a person accepts a suggestion. */
export interface SuggestionRecipe {
  id?: string; name: string; description?: string | null; totalMinutes?: number | null; kind?: string;
  ingredients: { name: string }[]; tags?: { id: string; name: string }[];
  recipeCategory?: string[]; keywords?: string[]; cuisine?: string[];
}
interface Tag { id: string; name: string }
export interface TagSuggestion {
  tagId: string; rule: 'words' | 'facts' | 'habits'; reason: string;
  fact?: 'quick' | 'vegetarian' | 'vegan' | 'kind';
}
export interface NewTagIdea { name: string; count: number; examples: string[] }
export const PANTRY_STAPLES = ['salt', 'pepper', 'oil', 'water', 'butter', 'sugar', 'flour', 'garlic'];
const STOP = new Set('a an the and or with without of for in on to from fresh dried chopped diced minced sliced ground large small medium cup tbsp tsp tablespoon teaspoon oz lb ounce pound gram kg ml clove can optional taste divided recipe dinner lunch meal easy homemade'.split(' '));
const MEAT = new Set('chicken beef pork turkey bacon sausage ham lamb fish salmon tuna shrimp prawn anchovy cod haddock trout sardine crab lobster mussel oyster clam duck veal venison gelatin lard'.split(' '));
const DAIRY_EGG = new Set('milk cream cheese butter yogurt yoghurt egg whey casein ghee honey parmesan mozzarella cheddar feta'.split(' '));
const MAIN_INGREDIENTS = new Set('chicken beef pork turkey fish salmon shrimp tofu bean lentil pasta rice egg'.split(' '));
function singular(word: string): string {
  if (/^(cookies|brownies|smoothies|pies|veggies)$/.test(word)) return word.slice(0, -1);
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(?:oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  return word.length > 3 && word.endsWith('s') && !/(ss|us)$/.test(word) ? word.slice(0, -1) : word;
}
function words(text: string): string[] {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ').match(/[\p{L}\p{N}]+/gu)?.map(singular) ?? [];
}
function phrase(text: string): string { return words(text).join(' '); }
function hints(recipe: SuggestionRecipe): string[] { return [...(recipe.recipeCategory ?? []), ...(recipe.keywords ?? []), ...(recipe.cuisine ?? [])]; }
function ingredients(recipe: SuggestionRecipe, staples: readonly string[]): Set<string> {
  const ignored = new Set(staples.flatMap(words));
  return new Set(recipe.ingredients.map(i => {
    const tokens = words(i.name);
    if (tokens.some(w => ignored.has(w))) return '';
    return tokens.filter(w => w.length > 2 && !STOP.has(w) && !/\p{N}/u.test(w)).join(' ');
  }).filter(Boolean));
}
export function suggestTags(recipe: SuggestionRecipe, tags: readonly Tag[], library: readonly SuggestionRecipe[], staples: readonly string[] = PANTRY_STAPLES): TagSuggestion[] {
  const selected = new Set(recipe.tags?.map(t => t.id));
  const sources = [recipe.name, recipe.description ?? '', ...hints(recipe)].map(text => ` ${phrase(text)} `);
  const rawIngredients = new Set(recipe.ingredients.flatMap(i => words(i.name)));
  const distinct = ingredients(recipe, staples);
  const matches: (TagSuggestion & { priority: number; score: number; index: number })[] = [];
  tags.forEach((tag, index) => {
    if (selected.has(tag.id)) return;
    const name = phrase(tag.name);
    const add = (rule: TagSuggestion['rule'], reason: string, priority: number, score = 0, fact?: TagSuggestion['fact']) => matches.push({ tagId: tag.id, rule, reason, priority, score, index, ...(fact && { fact }) });
    if (name && sources.some(source => source.includes(` ${name} `))) { add('words', 'In the name, description or page details', 0); return; }
    let fact: TagSuggestion['fact'];
    if (/^(quick(?: and easy)?|weeknight|30 minute|fast)$/.test(name) && recipe.totalMinutes != null && recipe.totalMinutes > 0 && recipe.totalMinutes <= 30) fact = 'quick';
    const noMeat = rawIngredients.size > 0 && ![...rawIngredients].some(w => MEAT.has(w));
    if (/^(vegetarian|meatless|veggie)$/.test(name) && noMeat) fact = 'vegetarian';
    if (name === 'vegan' && noMeat && ![...rawIngredients].some(w => DAIRY_EGG.has(w))) fact = 'vegan';
    if (['dessert', 'side', 'basic'].includes(name) && recipe.kind === name) fact = 'kind';
    if (fact) {
      const reasons = { quick: '30 minutes or less', vegetarian: 'No meat or fish', vegan: 'No meat, fish, dairy or eggs', kind: 'Matches the recipe type' };
      add('facts', reasons[fact], 1, 0, fact); return;
    }
    const tagged = library.filter(r => (!recipe.id || r.id !== recipe.id) && r.tags?.some(t => t.id === tag.id));
    if (tagged.length < 2 || !distinct.size) return;
    let best = 0;
    for (const other of tagged) {
      const otherWords = ingredients(other, staples);
      const shared = [...distinct].filter(w => otherWords.has(w)).length;
      const jaccard = shared / (distinct.size + otherWords.size - shared);
      if (jaccard >= 0.4 || shared >= 3) best = Math.max(best, jaccard);
    }
    if (best) add('habits', `Like your other '${tag.name}' recipes`, 2, best);
  });
  return matches.sort((a, b) => a.priority - b.priority || b.score - a.score || a.index - b.index).slice(0, 5).map(({ tagId, rule, reason, fact }) => ({ tagId, rule, reason, ...(fact && { fact }) }));
}
export function suggestNewTags(library: readonly SuggestionRecipe[], tags: readonly Tag[], staples: readonly string[] = PANTRY_STAPLES): NewTagIdea[] {
  // A whole word in an existing tag covers that idea too: Pasta night already covers Pasta.
  const existing = new Set(tags.flatMap(t => words(t.name)));
  const ignored = new Set(staples.flatMap(words));
  const counts = new Map<string, { named: number; count: number; namedExamples: string[]; examples: string[] }>();
  for (const recipe of library) {
    const named = new Set([recipe.name, ...hints(recipe)].flatMap(words).filter(w => w.length > 2 && !STOP.has(w) && !ignored.has(w) && !/\p{N}/u.test(w)));
    const main = [...ingredients(recipe, staples)].flatMap(words).filter(w => MAIN_INGREDIENTS.has(w));
    const tokens = new Set([...named, ...main]);
    for (const word of tokens) {
      if (existing.has(word)) continue;
      const entry = counts.get(word) ?? { named: 0, count: 0, namedExamples: [], examples: [] };
      entry.count++;
      if (entry.examples.length < 3) entry.examples.push(recipe.name);
      if (named.has(word)) {
        entry.named++;
        if (entry.namedExamples.length < 3) entry.namedExamples.push(recipe.name);
      }
      counts.set(word, entry);
    }
  }
  const namedMinimum = Math.max(2, Math.ceil(library.length * 0.1));
  const mainMinimum = Math.max(3, Math.ceil(library.length * 0.1));
  return [...counts].flatMap(([word, value]) => {
    const named = value.named >= namedMinimum;
    if (!named && (!MAIN_INGREDIENTS.has(word) || value.count < mainMinimum)) return [];
    return [{ word, priority: named ? 0 : 1, count: named ? value.named : value.count, examples: named ? value.namedExamples : value.examples }];
  }).sort((a, b) => a.priority - b.priority || b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)).slice(0, 8)
    .map(({ word, count, examples }) => ({ name: word[0].toUpperCase() + word.slice(1), count, examples }));
}
