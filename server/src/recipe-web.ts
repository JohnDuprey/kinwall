// Reading a recipe off a web page (schema.org Recipe in JSON-LD) or out of pasted text, into the
// preview POST /api/recipes/import-url and /parse-text return. No DOM here (Workers has none):
// JSON-LD blocks are found with a regex and parsed as JSON.
import { z } from '@hono/zod-openapi';
import { importIngredient, normalizeSteps, parseIngredientLine } from './meals.ts';
import { RecipeImportSchema, type RecipeStep } from './meal-schemas.ts';

/** qualifier, preparation and category are only set from a Kinwall share link's data. */
export type PreviewIngredient = { text: string; name: string; quantity: number | null; unit: string | null; qualifier?: string | null; preparation?: string | null; category?: string | null };
type Step = { text: string; bullets: string[]; title?: string | null; imageUrl?: string | null; timers?: RecipeStep['timers'] };
export type RecipePreview = {
  name: string; description: string | null; imageUrl: string | null; sourceUrl: string | null;
  servings: number | null; prepMinutes: number | null; totalMinutes: number | null;
  ingredients: PreviewIngredient[]; steps: Step[];
};

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', deg: '°', times: '×', frasl: '⁄',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', frac12: '½', frac13: '⅓', frac14: '¼', frac34: '¾', frac23: '⅔', reg: '®', copy: '©', trade: '™',
  eacute: 'é', egrave: 'è', ecirc: 'ê', aacute: 'á', agrave: 'à', acirc: 'â', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç', auml: 'ä', ouml: 'ö', uuml: 'ü', szlig: 'ß',
};
/** HTML entities, twice over for the sites that encode them twice ("&amp;#39;"). */
export function decodeEntities(s: string): string {
  const once = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, e: string) => {
    if (e[0] !== '#') return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
  return once(once(s));
}
/** Text from a value that may hold HTML: tags gone, entities decoded, whitespace collapsed
 * (line breaks kept when `keepLines`). */
function clean(value: unknown, keepLines = false): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const tags = (t: string) => t.replace(/<br\s*\/?>|<\/(p|li|div|h\d|tr)>/gi, '\n').replace(/<[^>]*>/g, '');
  const s = tags(decodeEntities(tags(String(value)))); // twice: markup that was itself entity-encoded
  return keepLines ? s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n') : s.replace(/\s+/g, ' ').trim();
}

/** ISO 8601 duration ("PT1H30M", "P0DT0H20M") in whole minutes; null when absent, zero or unreadable. */
export function isoMinutes(value: unknown): number | null {
  const m = typeof value === 'string' ? /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(value.trim()) : null;
  if (!m) return null;
  const minutes = Math.round(Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60);
  return minutes > 0 && minutes <= 10000 ? minutes : null;
}
/** recipeYield ("4", "4 servings", ["4", "4 servings"], "Makes 12", 6) as the first number in it. */
export function yieldServings(value: unknown): number | null {
  for (const v of Array.isArray(value) ? value : [value]) {
    const n = Number(/\d+(?:\.\d+)?/.exec(String(v ?? ''))?.[0]);
    if (n > 0 && n <= 10000) return n;
  }
  return null;
}

type Node = Record<string, unknown>;
const isObj = (v: unknown): v is Node => !!v && typeof v === 'object' && !Array.isArray(v);
const types = (n: Node) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).map(String);
const isType = (n: Node, t: string) => types(n).some((x) => x === t || x.endsWith(`/${t}`) || x.endsWith(`:${t}`));

/** Every object in the page's JSON-LD blocks: arrays, @graph and nested values (mainEntity) flattened. */
function jsonLdNodes(html: string): Node[] {
  const out: Node[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 8) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (!isObj(v)) return;
    out.push(v);
    for (const [k, x] of Object.entries(v)) if (k === '@graph' || k === 'mainEntity' || k === 'mainEntityOfPage' || (isObj(x) && isType(x, 'Recipe'))) walk(x, depth + 1);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '');
    try { walk(JSON.parse(raw), 0); continue; } catch { /* below */ }
    // Some sites leave raw line breaks and tabs inside strings, which JSON doesn't allow.
    try { walk(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')), 0); } catch { /* not JSON: skip it */ }
  }
  return out;
}

const httpUrl = (value: unknown, base: string): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const u = new URL(decodeEntities(value.trim()), base); return /^https?:$/.test(u.protocol) && u.href.length <= 2000 ? u.href : null; } catch { return null; }
};
/** image: a URL, a list of them, an ImageObject (or a list), or an @id pointing at one elsewhere in @graph. */
function imageUrl(value: unknown, byId: Map<string, Node>, base: string): string | null {
  for (let v of Array.isArray(value) ? value : [value]) {
    if (isObj(v) && typeof v['@id'] === 'string' && !v.url && !v.contentUrl) v = byId.get(v['@id']) ?? v;
    const url = httpUrl(isObj(v) ? v.url ?? v.contentUrl : v, base);
    if (url) return url;
  }
  return null;
}

// "1.", "2)", "Step 3:" in front of a step (not "2-3 minutes").
const STEP_NUMBER = /^(?:step\s*\d+\s*[:.)-]?|\d+[.)])\s+/i;
/** recipeInstructions: one string (lines become steps), strings, HowToStep, or HowToSection holding
 * steps (its name goes in front of its first step). A HowToStep stays one step (several lines become
 * its bullets), with its name as the title unless that just repeats the text, and its https image. */
function instructionSteps(value: unknown, byId: Map<string, Node>, base: string): Step[] {
  const steps: Step[] = [];
  const add = (text: string, prefix = '') => { const t = text.replace(STEP_NUMBER, '').trim(); if (t) steps.push({ text: (prefix ? `${prefix}: ${t}` : t).slice(0, 10000), bullets: [] }); };
  const walk = (v: unknown, section: string, depth: number) => {
    if (depth > 6) return;
    if (typeof v === 'string') { for (const line of clean(v, true).split('\n')) { add(line, section); section = ''; } return; }
    if (Array.isArray(v)) { for (const x of v) { const before = steps.length; walk(x, section, depth + 1); if (steps.length > before) section = ''; } return; }
    if (!isObj(v)) return;
    if (v.itemListElement !== undefined) {
      const name = clean(v.name);
      walk(v.itemListElement, [section, name].filter(Boolean).join(' – '), depth + 1);
      return;
    }
    const text = clean(v.text, true), name = clean(v.name);
    const lines = (text || clean(v.name, true) || clean(v.description, true)).split('\n').map((l) => l.replace(STEP_NUMBER, '').trim()).filter(Boolean);
    if (!lines.length) return;
    if (section) lines[0] = `${section}: ${lines[0]}`;
    const title = text && name.length <= 80 && !/^step\s*\d+\W*$/i.test(name) && !text.toLowerCase().startsWith(name.replace(/(…|\.\.\.)$/, '').trim().toLowerCase()) ? name : '';
    const image = imageUrl(v.image, byId, base);
    steps.push({
      ...(lines.length > 1 ? { text: '', bullets: lines.slice(0, 50).map((l) => l.slice(0, 2000)) } : { text: lines[0].slice(0, 10000), bullets: [] }),
      ...(title && { title }), ...(image?.startsWith('https:') && { imageUrl: image }),
    });
  };
  walk(value, '', 0);
  return steps.slice(0, 100);
}

function ingredientLines(lines: string[]): PreviewIngredient[] {
  return lines.map((l) => l.replace(/^\s*[-*•·–▢□☐]\s*/, '').trim()).filter(Boolean).slice(0, 300)
    .map((text) => ({ text: text.slice(0, 300), ...parseIngredientLine(text.slice(0, 300)) }));
}

// A Kinwall share page's own copy of the recipe, as POST /api/recipes/import takes it (routes/recipe-share.ts).
const SharedRecipeSchema = z.object({ kinwall: z.literal(1), recipe: RecipeImportSchema.omit({ source: true, externalId: true, plan: true }) });
const https = (url: string | null | undefined) => (url && /^https:\/\//i.test(url) ? url : null);
function kinwallRecipe(html: string, pageUrl: string): RecipePreview | null {
  const raw = /<script\b[^>]*\bid\s*=\s*["']?kinwall-recipe["']?[^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  let data: unknown;
  try { data = raw && JSON.parse(raw); } catch { return null; }
  const parsed = SharedRecipeSchema.safeParse(data);
  if (!parsed.success) return null;
  const r = parsed.data.recipe;
  return {
    name: r.name, description: r.description ?? null, imageUrl: https(r.imageUrl), sourceUrl: r.sourceUrl ?? pageUrl,
    servings: r.servings ?? null, prepMinutes: r.prepMinutes ?? null, totalMinutes: r.totalMinutes ?? null,
    ingredients: r.ingredients.map((line) => ({ text: typeof line === 'string' ? line : line.text, ...importIngredient(line) })),
    steps: normalizeSteps(r.steps ?? []).map((s) => ({ ...s, imageUrl: https(s.imageUrl) })),
  };
}

/** The recipe on the page as a preview, or null when there's none: a Kinwall share page's own data
 * when it's valid, else the first schema.org Recipe. `pageUrl` is where the page ended up; the page's
 * canonical link wins as the recipe's address. */
export function parseRecipeHtml(html: string, pageUrl: string): RecipePreview | null {
  const shared = kinwallRecipe(html, pageUrl);
  if (shared) return shared;
  const nodes = jsonLdNodes(html);
  const recipe = nodes.find((n) => isType(n, 'Recipe'));
  if (!recipe) return null;
  const byId = new Map(nodes.filter((n) => typeof n['@id'] === 'string').map((n) => [n['@id'] as string, n]));
  const canonical = /<link\b[^>]*rel\s*=\s*["']?canonical["']?[^>]*>/i.exec(html)?.[0];
  const sourceUrl = (httpUrl(canonical && /href\s*=\s*["']([^"']+)["']/i.exec(canonical)?.[1], pageUrl) ?? httpUrl(recipe.url, pageUrl) ?? pageUrl).replace(/#.*$/, '');
  const prep = isoMinutes(recipe.prepTime), cook = isoMinutes(recipe.cookTime);
  const ingredients = recipe.recipeIngredient ?? recipe.ingredients;
  return {
    name: clean(recipe.name).slice(0, 200), description: clean(recipe.description).slice(0, 10000) || null,
    imageUrl: imageUrl(recipe.image ?? recipe.thumbnailUrl, byId, pageUrl), sourceUrl,
    servings: yieldServings(recipe.recipeYield ?? recipe.yield), prepMinutes: prep,
    totalMinutes: isoMinutes(recipe.totalTime) ?? (prep || cook ? Math.min(10000, (prep ?? 0) + (cook ?? 0)) : null),
    ingredients: ingredientLines((Array.isArray(ingredients) ? ingredients : typeof ingredients === 'string' ? ingredients.split('\n') : []).map((l) => clean(l))),
    steps: instructionSteps(recipe.recipeInstructions, byId, pageUrl),
  };
}

const INGREDIENTS = /^(?:ingredients?|what you(?:'|’)?ll need|you will need)\s*:?$/i;
const STEPS = /^(?:directions?|instructions?|method|steps|preparation)\s*:?$/i;
/** Pasted recipe text: a name on the first line, then an "Ingredients" heading over one ingredient per
 * line, then "Directions" (or Instructions, Method, Steps) over the steps. Null without an
 * Ingredients heading. */
export function parseRecipeText(text: string, sourceUrl: string | null = null): RecipePreview | null {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const ing = lines.findIndex((l) => INGREDIENTS.test(l.replace(/^#+\s*/, '')));
  if (ing < 0) return null;
  const found = lines.findIndex((l, i) => i > ing && STEPS.test(l.replace(/^#+\s*/, '')));
  const stepAt = found < 0 ? lines.length : found;
  const head = lines.slice(0, ing).filter(Boolean);
  const yieldLine = head.find((l) => /^(serves|servings|yield|makes)\b/i.test(l));
  const about = head.slice(1).filter((l) => l !== yieldLine);
  return {
    name: (head[0] ?? '').replace(/^#+\s*/, '').slice(0, 200), description: about.join(' ').slice(0, 10000) || null, imageUrl: null, sourceUrl,
    servings: yieldLine ? yieldServings(yieldLine) : null, prepMinutes: null, totalMinutes: null,
    ingredients: ingredientLines(lines.slice(ing + 1, stepAt)),
    steps: lines.slice(stepAt + 1).map((l) => l.replace(STEP_NUMBER, '').trim()).filter(Boolean).slice(0, 100).map((t) => ({ text: t, bullets: [] })),
  };
}

/** What a family should check before saving. */
export function previewWarnings(r: RecipePreview): string[] {
  return [
    !r.name && 'No recipe name found. Give it one before saving.',
    !r.ingredients.length && 'No ingredients found.',
    !r.steps.length && 'No steps found.',
    r.servings === null && 'No servings found. It will be saved for 4; change it if that is wrong.',
  ].filter((w): w is string => !!w);
}
