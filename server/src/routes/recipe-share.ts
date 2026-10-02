// Public recipe share links. An admin makes one per recipe (POST /api/recipes/{id}/share); anyone
// with the link gets a server-rendered page at /r/{token} with the recipe and nothing else: no
// members, ratings, meals, notes or preparation notes. The page carries schema.org Recipe JSON-LD,
// so Kinwall's own link import (recipe-web.ts) and other apps can read it back.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import { requestKey } from '../auth.ts';
import { checkRate, clientIp } from '../ratelimit.ts';
import { fetchRecipeImage } from '../outbound.ts';
import { readRecipes } from '../meals.ts';
import { ErrorSchema } from '../schemas.ts';
import { KIT_QUALIFIER, type Recipe } from '../meal-schemas.ts';
import type { Env } from '../env.ts';

type Ctx = Context<{ Bindings: Env }>;
type ShareRow = { recipe_id: string; token: string; created_at: string };

export const recipeShareRoutes = createRouter();

// Behind a TLS-terminating proxy the request says http://; PUBLIC_URL (hosted: the family's own
// https address) knows better.
const origin = (c: Ctx) => (c.env.PUBLIC_URL ? new URL(c.env.PUBLIC_URL).origin : new URL(c.req.url).origin);
const shareUrl = (c: Ctx, token: string) => `${origin(c)}/r/${token}`;

/** Adds `share` ({ url, createdAt } or null) to recipes for admin keys; other keys get them as they are. */
export async function withShares(c: Ctx, recipes: Recipe[]): Promise<Recipe[]> {
  if ((await requestKey(c))?.scope !== 'admin') return recipes;
  const { results } = await c.env.DB.prepare('SELECT recipe_id, token, created_at FROM recipe_shares').all<ShareRow>();
  const by = new Map(results.map((r) => [r.recipe_id, r]));
  return recipes.map((r) => {
    const s = by.get(r.id);
    return { ...r, share: s ? { url: shareUrl(c, s.token), createdAt: s.created_at } : null };
  });
}

function newToken(): string {
  let bin = '';
  for (const b of crypto.getRandomValues(new Uint8Array(24))) bin += String.fromCharCode(b); // 192 bits
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const params = z.object({ id: z.string() });
const notFound = { 404: { description: 'recipe (or share) not found', content: { 'application/json': { schema: ErrorSchema } } } };
const ShareSchema = z.object({ url: z.string(), token: z.string(), createdAt: z.string() }).openapi('RecipeShare');

recipeShareRoutes.openapi(createRoute({ method: 'post', path: '/api/recipes/{id}/share', tags: ['Meals'], summary: "Make a public link to this recipe (just the recipe: no family, ratings, meals or notes), or get the one it already has (admin)", security: [{ Bearer: [] }], request: { params },
  responses: { 200: { description: 'the link', content: { 'application/json': { schema: ShareSchema } } }, ...notFound } }), async (c) => {
  const { id } = c.req.valid('param');
  const db = c.env.DB;
  if (!await db.prepare('SELECT id FROM recipes WHERE id = ?').bind(id).first()) return c.json({ error: 'recipe not found' }, 404);
  await db.prepare('INSERT INTO recipe_shares (recipe_id, token, created_at) VALUES (?, ?, ?) ON CONFLICT(recipe_id) DO NOTHING').bind(id, newToken(), new Date().toISOString()).run();
  const row = (await db.prepare('SELECT recipe_id, token, created_at FROM recipe_shares WHERE recipe_id = ?').bind(id).first<ShareRow>())!;
  return c.json({ url: shareUrl(c, row.token), token: row.token, createdAt: row.created_at }, 200);
});

recipeShareRoutes.openapi(createRoute({ method: 'delete', path: '/api/recipes/{id}/share', tags: ['Meals'], summary: "Stop sharing this recipe: its link stops working (admin)", security: [{ Bearer: [] }], request: { params },
  responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } }, ...notFound } }), async (c) => {
  const result = await c.env.DB.prepare('DELETE FROM recipe_shares WHERE recipe_id = ?').bind(c.req.valid('param').id).run();
  return result.meta.changes ? c.json({ ok: true }, 200) : c.json({ error: 'recipe is not shared' }, 404);
});

// ---- The public side: /r/{token}. No key; the token is the credential. ----

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
async function sharedRecipe(c: Ctx, token: string): Promise<Recipe | null> {
  if (!TOKEN.test(token)) return null;
  const row = await c.env.DB.prepare('SELECT recipe_id FROM recipe_shares WHERE token = ?').bind(token).first<{ recipe_id: string }>();
  return row ? (await readRecipes(c.env.DB, { id: row.recipe_id, archived: true }))[0] ?? null : null;
}
// ponytail: fixed window per address in D1 (one write per request); a KV/cache limiter if views get heavy.
const limited = async (c: Ctx) => !await checkRate(c.env.DB, `share:${clientIp(c) ?? 'direct'}`, 120, 60_000);

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ENT[ch]);
// JSON inside <script>: nothing in it may close the tag or start a comment.
const jsonScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const qty = (n: number) => String(Number(n.toFixed(3)));
const ingredientLine = (i: Recipe['ingredients'][number]) =>
  [i.quantity !== null ? qty(i.quantity) : '', i.unit, i.name, i.qualifier].filter(Boolean).join(' ') + (i.preparation ? `, ${i.preparation}` : '');
// The page's own lines read like the app's (web/src/meal-date.ts): "2½ cups", "⅓ cup", "8 oz"; the data
// blocks keep ingredientLine's plain numbers for other apps.
const FRACTIONS: Record<string, string> = { '0.125': '⅛', '0.250': '¼', '0.333': '⅓', '0.375': '⅜', '0.500': '½', '0.625': '⅝', '0.667': '⅔', '0.750': '¾', '0.875': '⅞' };
const amount = (n: number) => { const whole = Math.floor(n), f = FRACTIONS[(n - whole).toFixed(3)]; return f ? `${whole || ''}${f}` : String(Number(n.toFixed(2))); };
const ABBREVIATED = /^(oz|fl\.? ?oz|tsp|tbsp|tbs|lbs?|g|kg|mg|ml|l|doz|pt|qt|gal)\.?$/i;
const unitFor = (n: number | null, unit: string) => (n === null || n <= 1 || ABBREVIATED.test(unit) || /s$/i.test(unit) ? unit : /(ch|sh|x)$/i.test(unit) ? `${unit}es` : `${unit}s`);
const shownLine = (i: Recipe['ingredients'][number]) =>
  [i.quantity !== null ? amount(i.quantity) : '', i.unit && unitFor(i.quantity, i.unit), i.name, i.qualifier].filter(Boolean).join(' ') + (i.preparation ? `, ${i.preparation}` : '');
/** A web address, or null: rows written before sources were checked can hold anything. */
const web = (url: string | null | undefined) => { try { return url && /^https?:$/.test(new URL(url).protocol) ? url : null; } catch { return null; } };
const minutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);
type ShownStep = { title: string | null; text: string; bullets: string[] };
function shownSteps(r: Recipe): ShownStep[] {
  // `title` may be set by newer servers' structured steps; read it when present.
  if (r.steps?.length) return r.steps.map((s) => ({ title: (s as { title?: string | null }).title || null, text: s.text, bullets: s.bullets ?? [] }));
  return (r.instructions ?? '').split('\n').map((l) => l.replace(/^\s*\d+[.)]\s+/, '').trim()).filter(Boolean).map((text) => ({ title: null, text, bullets: [] }));
}
/** JSON-LD photos are the stored originals (https only), so a copy keeps its photos after the link is
 * stopped; the page's own <img> tags use this link's proxy routes, so a viewer never contacts that host. */
const original = (stored: string | null | undefined) => (stored && /^https:\/\//i.test(stored) ? stored : null);
/** The recipe as POST /api/recipes/import takes it, for another Kinwall to copy exactly (recipe-web.ts
 * reads it back): the same fields as the page, none of the family's (notes, ratings, meals, ids). */
const kinwallData = (r: Recipe, self: string) => ({ kinwall: 1, recipe: {
  name: r.name, description: r.description, kind: r.kind, makes: r.makes, servings: r.defaultServings, prepMinutes: r.prepMinutes ?? null, totalMinutes: r.totalMinutes ?? null,
  imageUrl: original(r.imageUrl), sourceUrl: web(r.sourceUrl) ?? self,
  ingredients: r.ingredients.map((i) => ({ text: ingredientLine(i).slice(0, 300), name: i.name, quantity: i.quantity, unit: i.unit, qualifier: i.qualifier, preparation: i.preparation, category: i.category, pantry: i.qualifier !== KIT_QUALIFIER, ...(i.basicName && { basic: i.basicName }) })),
  steps: shownSteps(r).map((s, i) => ({ text: s.text, bullets: s.bullets, title: s.title, timers: r.steps?.[i]?.timers ?? [], imageUrl: original(r.steps?.[i]?.imageUrl) })),
} });

const CSS = `
:root{--bg:#EEF3F8;--bg-alt:#DFE8F1;--card:#FAFCFE;--text:#102A43;--dim:#4A6078;--border:#C6D5E4;--accent:#123857;--ink:#fff;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0B1622;--bg-alt:#101E2D;--card:#16273A;--text:#E4ECF5;--dim:#9DB2C8;--border:#2A3F57;--accent:#6CB4EE;--ink:#0B1622}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:17px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-text-size-adjust:100%}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}
h1{font-size:1.9rem;line-height:1.2;margin:8px 0 12px}h2{font-size:1.25rem;margin:32px 0 12px}h3{font-size:1rem;margin:0 0 4px}
.hero{display:block;width:100%;max-height:420px;object-fit:cover;border-radius:20px;background:var(--bg-alt)}
.facts{color:var(--dim);font-weight:600;margin:8px 0 0}.desc{margin:8px 0 0}
ul.ing,aside{background:var(--card);border:1px solid var(--border);border-radius:20px;padding:16px 20px}
ul.ing{margin:0;padding-left:2.2em}ul.ing li{padding:4px 0}
ol.steps{list-style:none;margin:0;padding:0;counter-reset:s;display:grid;gap:16px}
ol.steps>li{counter-increment:s;position:relative;padding-left:48px;min-height:36px}
ol.steps>li::before{content:counter(s);position:absolute;left:0;top:0;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--accent);color:var(--ink);font-weight:800}
ol.steps h3{margin:6px 0 4px}ol.steps p{margin:4px 0}ol.steps ul{margin:4px 0;padding-left:1.2em}.step-img{display:block;width:100%;max-width:420px;border-radius:14px;margin:8px 0}
a{color:inherit;text-underline-offset:3px}.src{margin:24px 0 0;overflow-wrap:anywhere}
form{display:grid;gap:8px;margin-top:8px}label{font-weight:700}
.row{display:flex;gap:8px;flex-wrap:wrap}input{flex:1 1 220px;min-height:48px;padding:10px 14px;font:inherit;color:var(--text);background:var(--bg);border:2px solid var(--border);border-radius:14px}
button{min-height:48px;padding:10px 20px;font:inherit;font-weight:800;color:var(--ink);background:var(--accent);border:0;border-radius:999px;cursor:pointer}
aside{margin-top:32px}aside h2{margin-top:0}.hint{color:var(--dim);font-size:.9rem;margin:0}footer{color:var(--dim);font-size:.9rem;margin-top:32px;text-align:center}footer a{color:inherit}
.desc,ol.steps p{white-space:pre-line}
@media print{:root{--bg:#fff;--card:#fff;--text:#000;--dim:#444;--border:#ccc}body{font-size:12pt}main{max-width:none;padding:0}aside{display:none}.hero{max-height:240px;width:auto;max-width:100%}.step-img{max-width:200px}ul.ing li,ol.steps>li{break-inside:avoid}}`;

function page(nonce: string, title: string, body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style nonce="${nonce}">${CSS}</style>${head}</head><body><main>${body}<footer>Shared from <a href="https://kinwall.family" rel="noopener">Kinwall</a></footer></main></body></html>`;
}
function send(c: Ctx, html: string, nonce: string, status: 200 | 404 | 429) {
  return c.html(html, status, {
    'Content-Security-Policy': `default-src 'none'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'Cache-Control': 'private, max-age=60',
    'X-Robots-Tag': 'noindex',
  });
}
const missing = (c: Ctx, nonce: string) => send(c, page(nonce, 'Recipe not found', "<h1>This recipe isn't shared</h1><p>The link may have been turned off, or it was copied wrong.</p>"), nonce, 404);

// "Save to my Kinwall": remembers the family's address on this device and opens its import sheet with this page.
const SAVE_JS = `(function(){var f=document.getElementById('save'),i=document.getElementById('addr'),k='kinwall-address';try{i.value=localStorage.getItem(k)||''}catch(e){}
f.addEventListener('submit',function(e){e.preventDefault();var a=i.value.trim().replace(/\\/+$/,'');if(!a)return;if(!/^https?:\\/\\//i.test(a))a='https://'+a;
try{var u=new URL(a)}catch(e){i.setCustomValidity('Enter an address like yourfamily.kinwall.family');i.reportValidity();return}
try{localStorage.setItem(k,a)}catch(e){}location.href=u.origin+u.pathname.replace(/\\/+$/,'')+'/#/recipes/import?url='+encodeURIComponent(f.dataset.url)});
i.addEventListener('input',function(){i.setCustomValidity('')})})();`;

const tokenParam = z.object({ token: z.string() });
const htmlResponse = (description: string) => ({ description, content: { 'text/html': { schema: z.string() } } });
recipeShareRoutes.openapi(createRoute({ method: 'get', path: '/r/{token}', tags: ['Meals'], summary: 'A shared recipe as a web page with schema.org Recipe data (public, no key: the link is the credential)', request: { params: tokenParam },
  responses: { 200: htmlResponse('the recipe page'), 404: htmlResponse('not shared (unknown or stopped link)'), 429: htmlResponse('too many requests') } }), async (c) => {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  if (await limited(c)) return send(c, page(nonce, 'Slow down', '<h1>Too many requests</h1><p>Try again in a minute.</p>'), nonce, 429);
  const { token } = c.req.valid('param');
  const r = await sharedRecipe(c, token);
  if (!r) return missing(c, nonce);
  const self = shareUrl(c, token);
  const steps = shownSteps(r);
  const source = web(r.sourceUrl);
  // Only photos the image routes can fetch (https; http too when a self-hoster allows it), so the page
  // and link previews never show a broken image.
  const photo = (url: string | null | undefined) => !!url && (/^https:\/\//i.test(url) || (c.env.ALLOW_PRIVATE_FEED_URLS === '1' && /^http:\/\//i.test(url)));
  const hero = photo(r.imageUrl);
  const ld = {
    '@context': 'https://schema.org', '@type': 'Recipe', name: r.name,
    ...(r.description && { description: r.description }),
    ...(original(r.imageUrl) && { image: original(r.imageUrl) }),
    ...(source && { url: source }),
    recipeYield: String(r.defaultServings),
    ...(r.prepMinutes && { prepTime: `PT${r.prepMinutes}M` }),
    ...(r.totalMinutes && { totalTime: `PT${r.totalMinutes}M` }),
    recipeIngredient: r.ingredients.map(ingredientLine),
    recipeInstructions: steps.map((s, i) => ({
      '@type': 'HowToStep', ...(s.title && { name: s.title }), text: [s.text, ...s.bullets].filter(Boolean).join('\n'),
      ...(original(r.steps?.[i]?.imageUrl) && { image: original(r.steps?.[i]?.imageUrl) }),
    })),
  };
  const meta = [r.kind === 'basic' && r.makes ? `Makes ${r.makes}` : `Serves ${qty(r.defaultServings)}`, r.prepMinutes && `Prep ${minutes(r.prepMinutes)}`, r.totalMinutes && `Total ${minutes(r.totalMinutes)}`].filter(Boolean).join(' · ');
  const body = [
    hero && `<img class="hero" src="/r/${esc(token)}/image" alt="${esc(r.name)}">`,
    `<h1>${esc(r.name)}</h1>`,
    r.description && `<p class="desc">${esc(r.description)}</p>`,
    `<p class="facts">${esc(meta)}</p>`,
    r.ingredients.length && `<h2>Ingredients</h2><ul class="ing">${r.ingredients.map((i) => `<li>${esc(shownLine(i))}</li>`).join('')}</ul>`,
    steps.length && `<h2>Steps</h2><ol class="steps" role="list">${steps.map((s, i) => `<li>${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${photo(r.steps?.[i]?.imageUrl) ? `<img class="step-img" src="/r/${esc(token)}/steps/${i + 1}/image" alt="Step ${i + 1}" loading="lazy">` : ''}${s.text ? `<p>${esc(s.text)}</p>` : ''}${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`,
    source && `<p class="src">Source: <a href="${esc(source)}" rel="noopener noreferrer nofollow">${esc(new URL(source).hostname.replace(/^www\./, ''))}</a></p>`,
  ].filter(Boolean).join('');
  const aside = [
    `<h2>Save to my Kinwall</h2><form id="save" data-url="${esc(self)}"><label for="addr">Your Kinwall address</label><div class="row"><input id="addr" type="text" inputmode="url" autocapitalize="none" autocomplete="url" spellcheck="false" placeholder="yourfamily.kinwall.family" required><button type="submit">Save recipe</button></div><p class="hint">Opens your Kinwall to import this recipe. Remembered on this device.</p></form>`,
  ].join('');
  // Link previews (iMessage, Discord, Slack…): the photo goes through this link like the page's own.
  const summary = r.description ? (r.description.length > 200 ? `${r.description.slice(0, 199)}…` : r.description) : meta;
  const preview = [
    ['property', 'og:type', 'article'], ['property', 'og:site_name', 'Kinwall'], ['property', 'og:title', r.name],
    ['property', 'og:description', summary], ['property', 'og:url', self],
    ...(hero ? [['property', 'og:image', `${self}/image`]] : []),
    ['name', 'twitter:card', hero ? 'summary_large_image' : 'summary'],
  ].map(([attr, key, value]) => `<meta ${attr}="${key}" content="${esc(value)}">`).join('');
  const head = `${preview}<script type="application/ld+json">${jsonScript(ld)}</script><script type="application/json" id="kinwall-recipe">${jsonScript(kinwallData(r, self))}</script><script nonce="${nonce}">document.addEventListener('DOMContentLoaded',function(){${SAVE_JS}})</script>`;
  return send(c, page(nonce, r.name, `<article>${body}</article><aside>${aside}</aside>`, head), nonce, 200);
});

// Photos: only this recipe's own stored imageUrl (or a step's), fetched like /api/recipes/{id}/image.
const imageResponses = { 200: { description: 'the image', content: { 'image/*': { schema: z.string().openapi({ format: 'binary' }) } } }, 404: { description: 'not shared, or no photo', content: { 'application/json': { schema: ErrorSchema } } }, 429: { description: 'too many requests', content: { 'application/json': { schema: ErrorSchema } } }, 502: { description: 'the image could not be fetched', content: { 'application/json': { schema: ErrorSchema } } } };
async function image(c: Ctx, token: string, pick: (r: Recipe) => string | null | undefined) {
  if (await limited(c)) return c.json({ error: 'too many requests' }, 429);
  const r = await sharedRecipe(c, token);
  const url = r && pick(r);
  if (!url) return c.json({ error: 'not found' }, 404);
  const result = await fetchRecipeImage(c.env, url);
  if ('error' in result) return c.json({ error: result.error }, 502);
  return c.body(result.image, 200, { 'Content-Type': result.type, 'Cache-Control': 'private, max-age=300', 'Content-Security-Policy': "default-src 'none'", 'X-Robots-Tag': 'noindex' });
}
recipeShareRoutes.openapi(createRoute({ method: 'get', path: '/r/{token}/image', tags: ['Meals'], summary: "A shared recipe's photo (public)", request: { params: tokenParam }, responses: imageResponses }),
  (c) => image(c, c.req.valid('param').token, (r) => r.imageUrl));
recipeShareRoutes.openapi(createRoute({ method: 'get', path: '/r/{token}/steps/{n}/image', tags: ['Meals'], summary: "A shared recipe step's photo (steps number from 1; public)", request: { params: tokenParam.extend({ n: z.coerce.number().int().min(1).max(100) }) }, responses: imageResponses }),
  (c) => { const { token, n } = c.req.valid('param'); return image(c, token, (r) => r.steps?.[n - 1]?.imageUrl); });
