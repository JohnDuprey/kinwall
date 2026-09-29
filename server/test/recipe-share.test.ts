import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { parseRecipeHtml } from '../src/recipe-web.ts';
import type { Env } from '../src/env.ts';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown, key = 'test-admin') => app.request(`https://ourfamily.kinwall.test${path}`, { method, headers: { ...(key && { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown, key = 'test-admin'): Promise<any> => {
    const res = await request(path, method, body, key); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  return { db, request, json };
}

const tacos = {
  name: 'Tuesday Tacos', description: 'Beef tacos with <fresh> toppings & warm tortillas.', defaultServings: 4, prepMinutes: 15, totalMinutes: 40,
  sourceUrl: 'https://example.com/tacos', imageUrl: 'https://example.com/tacos.jpg', preparationNotes: 'Leo likes them mild',
  ingredients: [{ name: 'Ground beef', quantity: 1, unit: 'lb' }, { name: 'Corn tortillas', quantity: 8 }, { name: 'Salt', qualifier: 'to taste' }],
  steps: [{ text: 'Brown the beef.', imageUrl: 'https://example.com/step1.jpg' }, { text: 'Warm the tortillas.' }, { text: 'Fill and serve.' }],
};

async function sharedRecipe() {
  const f = fixture();
  const alex = await f.json('/api/members', 'POST', { name: 'Alex', color: '#123456' });
  const recipe = await f.json('/api/recipes', 'POST', tacos);
  await f.json(`/api/recipes/${recipe.id}/rating`, 'PUT', { memberId: alex.id, stars: 5 });
  await f.json('/api/meals', 'POST', { date: '2026-10-06', slot: 'dinner', recipeId: recipe.id, notes: 'Grandma visiting', eaterIds: [alex.id] });
  const share = await f.json(`/api/recipes/${recipe.id}/share`, 'POST');
  return { ...f, recipe, share, alex };
}

test('recipe share: admin creates (idempotent) and revokes; the recipe carries it for admins only', async () => {
  const { json, request, recipe, share } = await sharedRecipe();
  assert.match(share.token, /^[A-Za-z0-9_-]{22,}$/, 'base64url, at least 128 bits');
  assert.equal(share.url, `https://ourfamily.kinwall.test/r/${share.token}`);
  assert.ok(share.createdAt);
  assert.deepEqual(await json(`/api/recipes/${recipe.id}/share`, 'POST'), share, 'creating again returns the active link');
  assert.deepEqual((await json(`/api/recipes/${recipe.id}`)).share, { url: share.url, createdAt: share.createdAt });
  assert.deepEqual((await json('/api/recipes')).find((r: any) => r.id === recipe.id).share, { url: share.url, createdAt: share.createdAt });

  const display = await json('/api/keys', 'POST', { name: 'wall', scope: 'display' });
  assert.equal((await json(`/api/recipes/${recipe.id}`, 'GET', undefined, display.key)).share, undefined, 'a wall screen never sees the link');
  assert.equal((await json('/api/recipes', 'GET', undefined, display.key))[0].share, undefined);
  assert.equal((await request(`/api/recipes/${recipe.id}/share`, 'POST', undefined, display.key)).status, 403);
  assert.equal((await request(`/api/recipes/${recipe.id}/share`, 'DELETE', undefined, display.key)).status, 403);
  assert.equal((await request(`/api/recipes/${recipe.id}/share`, 'POST', undefined, '')).status, 401);
  assert.equal((await request('/api/recipes/nope/share', 'POST')).status, 404);

  assert.equal((await request(`/r/${share.token}`, 'GET', undefined, '')).status, 200);
  await json(`/api/recipes/${recipe.id}/share`, 'DELETE');
  assert.equal((await json(`/api/recipes/${recipe.id}`)).share, null);
  assert.equal((await request(`/r/${share.token}`, 'GET', undefined, '')).status, 404, 'revoked');
  assert.equal((await request(`/r/${share.token}/image`, 'GET', undefined, '')).status, 404);
  assert.equal((await request(`/api/recipes/${recipe.id}/share`, 'DELETE')).status, 404, 'nothing to stop');
  const again = await json(`/api/recipes/${recipe.id}/share`, 'POST');
  assert.notEqual(again.token, share.token, 'sharing again makes a new link');
});

test('recipe share: the page round-trips through the link importer', async () => {
  const { request, share } = await sharedRecipe();
  const res = await request(`/r/${share.token}`, 'GET', undefined, '');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type')!, /^text\/html/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const csp = res.headers.get('content-security-policy')!;
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.match(res.headers.get('cache-control')!, /max-age=\d+/);
  const html = await res.text();
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /Shared from <a [^>]*>Kinwall<\/a>/);
  assert.ok(html.includes('&lt;fresh&gt; toppings &amp; warm'), 'escaped');
  assert.ok(!html.includes('<fresh>'));

  const parsed = parseRecipeHtml(html, share.url)!;
  assert.equal(parsed.name, tacos.name);
  assert.equal(parsed.description, tacos.description, 'from the Kinwall data block, exactly as stored');
  assert.equal(parsed.servings, 4);
  assert.equal(parsed.prepMinutes, 15);
  assert.equal(parsed.totalMinutes, 40);
  assert.equal(parsed.sourceUrl, tacos.sourceUrl, 'the original source, when there is one');
  assert.equal(parsed.imageUrl, tacos.imageUrl);
  assert.deepEqual(parsed.ingredients.map((i) => [i.name, i.quantity, i.unit, i.qualifier]), [['Ground beef', 1, 'lb', null], ['Corn tortillas', 8, null, null], ['Salt', null, null, 'to taste']]);
  assert.deepEqual(parsed.steps.map((s) => s.text), tacos.steps.map((s) => s.text));

  // The page's own photos go through this link; the data carries the originals, so a copy keeps them.
  assert.deepEqual([...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]), [`/r/${share.token}/image`, `/r/${share.token}/steps/1/image`]);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
  assert.equal(ld.image, tacos.imageUrl);
  assert.deepEqual(ld.recipeInstructions.map((s: any) => s.image), [tacos.steps[0].imageUrl, undefined, undefined]);
});

test('recipe share: link previews (iMessage, Discord, Slack) get a title, description, photo and source label', async () => {
  const { request, share } = await sharedRecipe();
  const html = await (await request(`/r/${share.token}`, 'GET', undefined, '')).text();
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(html)?.[1];
  assert.equal(meta('og:type'), 'article');
  assert.equal(meta('og:site_name'), 'Kinwall');
  assert.equal(meta('og:title'), 'Tuesday Tacos');
  assert.equal(meta('og:description'), 'Beef tacos with &lt;fresh&gt; toppings &amp; warm tortillas.');
  assert.equal(meta('og:url'), share.url);
  assert.equal(meta('og:image'), `${share.url}/image`, 'absolute, through the link like the page photo');
  assert.equal(meta('twitter:card'), 'summary_large_image');
  assert.match(html, /<p class="src">Source: <a href="https:\/\/example\.com\/tacos"/);
  assert.ok(!html.includes('Original recipe'));
  assert.match(html, /<footer>Shared from <a href="https:\/\/kinwall\.family" rel="noopener">Kinwall<\/a><\/footer>/);

  // No photo or description: a text card that still says what it is.
  const f = fixture();
  const plain = await f.json('/api/recipes', 'POST', { name: 'Toast', defaultServings: 2, ingredients: [{ name: 'Bread' }], steps: [{ text: 'Toast it.' }] });
  const s2 = await f.json(`/api/recipes/${plain.id}/share`, 'POST');
  const html2 = await (await f.request(`/r/${s2.token}`, 'GET', undefined, '')).text();
  assert.match(html2, /<meta property="og:description" content="Serves 2">/);
  assert.doesNotMatch(html2, /og:image/);
  assert.match(html2, /<meta name="twitter:card" content="summary">/);
});

test('recipe share: reader modes (Edge, Safari, Firefox) find the whole recipe', async () => {
  const { request, share } = await sharedRecipe();
  const html = await (await request(`/r/${share.token}`, 'GET', undefined, '')).text();
  // The recipe is one <article>; the save form and footer sit outside it.
  const article = /<article>([\s\S]*)<\/article>/.exec(html)?.[1] ?? '';
  for (const text of ['Tuesday Tacos', '1 lb Ground beef', 'Salt to taste', 'Brown the beef.', 'Fill and serve.', 'Source:']) assert.ok(article.includes(text), text);
  assert.ok(!article.includes('Save to my Kinwall') && !article.includes('<form'), 'the form is not part of the recipe');
  assert.match(html, /<\/article><aside>[\s\S]*Save to my Kinwall[\s\S]*<\/aside>/);
  // Nothing wraps the lists, and no class names readers take for page chrome (meta, card, …).
  assert.doesNotMatch(article, /class="[^"]*\b(meta|card|hint|share|promo|sidebar|widget)\b/);
  assert.doesNotMatch(article, /<div/);
  // Photos say what they show.
  assert.match(article, /<img class="hero" src="[^"]+" alt="Tuesday Tacos">/);
  assert.match(article, /<img[^>]*steps\/1\/image[^>]*alt="Step 1"/);
});

test('recipe share: another Kinwall imports the link and keeps the original photo', async () => {
  const { request, share } = await sharedRecipe();
  const html = await (await request(`/r/${share.token}`, 'GET', undefined, '')).text();
  const other = fixture();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    assert.equal(String(url), share.url);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }) as typeof fetch;
  try {
    const saved = await other.json('/api/recipes/import-url', 'POST', { url: share.url, save: true });
    const copy = await other.json(`/api/recipes/${saved.recipeId}`);
    assert.equal(copy.name, tacos.name);
    assert.equal(copy.imageUrl, tacos.imageUrl);
    assert.equal(copy.sourceUrl, tacos.sourceUrl);
    assert.deepEqual(copy.ingredients.map((i: any) => [i.name, i.qualifier]), [['Ground beef', null], ['Corn tortillas', null], ['Salt', 'to taste']]);
    assert.deepEqual(copy.steps.map((s: any) => s.text), tacos.steps.map((s) => s.text));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('recipe share: photos that are not https stay out of the data', async () => {
  const { json, request } = fixture();
  const recipe = await json('/api/recipes', 'POST', { name: 'Toast', imageUrl: 'http://example.com/toast.jpg', ingredients: [], steps: [{ text: 'Toast it.', imageUrl: 'http://example.com/s.jpg' }] });
  const share = await json(`/api/recipes/${recipe.id}/share`, 'POST');
  const html = await (await request(`/r/${share.token}`, 'GET', undefined, '')).text();
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
  assert.equal(ld.image, undefined);
  assert.equal(ld.recipeInstructions[0].image, undefined);
});

test('recipe share: without a source the page itself is the source; unknown tokens 404', async () => {
  const { json, request } = fixture();
  const recipe = await json('/api/recipes', 'POST', { name: 'Pancakes', ingredients: [], instructions: '1. Mix.\n2. Fry.' });
  const share = await json(`/api/recipes/${recipe.id}/share`, 'POST');
  const parsed = parseRecipeHtml(await (await request(`/r/${share.token}`, 'GET', undefined, '')).text(), share.url)!;
  assert.equal(parsed.sourceUrl, share.url);
  assert.deepEqual(parsed.steps.map((s) => s.text), ['Mix.', 'Fry.']);
  for (const path of ['/r/nope', '/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/image', '/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/steps/1/image']) {
    const res = await request(path, 'GET', undefined, '');
    assert.equal(res.status, 404, path);
  }
  const missing = await request('/r/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'GET', undefined, '');
  assert.match(missing.headers.get('content-type')!, /^text\/html/);
  assert.match(await missing.text(), /noindex/);
});

test('recipe share: no family data on the page', async () => {
  const { request, share, alex } = await sharedRecipe();
  const html = await (await request(`/r/${share.token}`, 'GET', undefined, '')).text();
  for (const secret of ['Alex', alex.id, 'Grandma', 'Leo likes', 'rating', 'Rating', '★', 'test-admin', '2026-10-06']) assert.ok(!html.includes(secret), secret);
});

test('recipe share: deleting the recipe removes its link', async () => {
  const { db, json, request, recipe, share } = await sharedRecipe();
  await json(`/api/recipes/${recipe.id}`, 'DELETE');
  assert.equal((await request(`/r/${share.token}`, 'GET', undefined, '')).status, 404);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM recipe_shares').first<{ n: number }>())!.n, 0);
});

test('recipe share: export leaves the link out', async () => {
  const { json, share } = await sharedRecipe();
  const exported = JSON.stringify(await json('/api/export'));
  assert.ok(!exported.includes(share.token));
});

test('recipe share: photos serve only that recipe\'s own stored image urls', async () => {
  const { json, request, share } = await sharedRecipe();
  const other = await json('/api/recipes', 'POST', { name: 'Other', imageUrl: 'https://example.com/other.jpg', ingredients: [] });
  assert.ok(other.id);
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  globalThis.fetch = (async (url: unknown) => { fetched.push(String(url)); return new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } }); }) as typeof fetch;
  try {
    const hero = await request(`/r/${share.token}/image?url=https://evil.example/x.jpg`, 'GET', undefined, '');
    assert.equal(hero.status, 200);
    assert.equal(hero.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await hero.arrayBuffer()), jpeg);
    assert.equal((await request(`/r/${share.token}/steps/1/image`, 'GET', undefined, '')).status, 200);
    assert.equal((await request(`/r/${share.token}/steps/2/image`, 'GET', undefined, '')).status, 404, 'a step with no photo');
    assert.equal((await request(`/r/${share.token}/steps/99/image`, 'GET', undefined, '')).status, 404);
    assert.deepEqual(fetched, ['https://example.com/tacos.jpg', 'https://example.com/step1.jpg']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// A recipe with everything a share can carry, plus family data it must not.
const bowls = {
  name: 'Teriyaki Bowls', description: 'Sticky chicken <and> rice.', defaultServings: 2, prepMinutes: 10, totalMinutes: 35,
  sourceUrl: 'https://example.com/cards/bowls.pdf', imageUrl: 'https://example.com/bowls.jpg', preparationNotes: 'Sam skips the onions',
  ingredients: [
    { name: 'Chicken thighs', quantity: 10, unit: 'oz', category: 'Meat', qualifier: 'in the kit' },
    { name: 'Onion', quantity: 1, preparation: 'diced', category: 'Produce' },
    { name: 'Soy sauce', quantity: 2, unit: 'tablespoon', qualifier: 'low sodium' },
    { name: 'Salt', qualifier: 'to taste' },
  ],
  steps: [
    { title: 'Cook the rice', text: 'Boil the rice for 15 minutes.', timers: [{ name: 'Rice', minutes: 15 }], imageUrl: 'https://example.com/s1.jpg' },
    { title: 'Prep', bullets: ['Dice the onion.', 'Pat the chicken dry.'], imageUrl: 'http://example.com/s2.jpg' },
    { text: 'Sear the chicken.', bullets: ['Skin side down.', 'Flip once.'], timers: [{ name: null, minutes: 6 }, { name: 'Rest', minutes: 2 }] },
  ],
};
const SHARED = ['name', 'description', 'defaultServings', 'prepMinutes', 'totalMinutes', 'imageUrl', 'sourceUrl'] as const;
const kinwallBlock = (html: string) => /<script type="application\/json" id="kinwall-recipe">([\s\S]*?)<\/script>/.exec(html)?.[1];
const withoutBlock = (html: string) => html.replace(/<script type="application\/json" id="kinwall-recipe">[\s\S]*?<\/script>/, '');
const ingredientFields = (r: any) => r.ingredients.map(({ name, quantity, unit, preparation, qualifier, category, sort }: any) => ({ name, quantity, unit, preparation, qualifier, category, sort }));
// The original's steps as shared: a photo that isn't https stays behind.
const sharedSteps = (r: any) => r.steps.map((s: any) => ({ ...s, imageUrl: s.imageUrl?.startsWith('https:') ? s.imageUrl : null }));

async function richShare() {
  const f = fixture();
  const maya = await f.json('/api/members', 'POST', { name: 'Maya', color: '#654321' });
  const recipe = await f.json('/api/recipes', 'POST', bowls);
  await f.json(`/api/recipes/${recipe.id}/rating`, 'PUT', { memberId: maya.id, stars: 4 });
  await f.json('/api/meals', 'POST', { date: '2026-10-07', slot: 'dinner', recipeId: recipe.id, notes: 'Soccer night', eaterIds: [maya.id] });
  const share = await f.json(`/api/recipes/${recipe.id}/share`, 'POST');
  const html = await (await f.request(`/r/${share.token}`, 'GET', undefined, '')).text();
  return { ...f, maya, recipe, share, html };
}

test('recipe share: the page carries the recipe as import data, and nothing private', async () => {
  const { html, recipe, share, maya } = await richShare();
  const raw = kinwallBlock(html);
  assert.ok(raw, 'a kinwall-recipe data block in the page');
  assert.ok(html.indexOf(raw!) < html.indexOf('</head>'), 'in <head>');
  assert.ok(!raw!.includes('<'), 'nothing in it can close the tag');
  const data = JSON.parse(raw!);
  assert.equal(data.kinwall, 1);
  assert.deepEqual(Object.keys(data), ['kinwall', 'recipe']);
  assert.deepEqual(Object.keys(data.recipe).sort(), ['description', 'imageUrl', 'ingredients', 'kind', 'makes', 'name', 'prepMinutes', 'servings', 'sourceUrl', 'steps', 'totalMinutes']);
  assert.equal(data.recipe.description, bowls.description, 'as stored');
  assert.equal(data.recipe.servings, 2);
  assert.deepEqual(data.recipe.ingredients[0], { text: '10 oz Chicken thighs in the kit', name: 'Chicken thighs', quantity: 10, unit: 'oz', qualifier: 'in the kit', preparation: null, category: 'Meat', pantry: false });
  assert.deepEqual(data.recipe.steps[1], { text: '', bullets: ['Dice the onion.', 'Pat the chicken dry.'], title: 'Prep', timers: [], imageUrl: null });
  for (const secret of ['Maya', maya.id, 'Soccer', 'Sam skips', recipe.id, recipe.createdAt, share.token, 'rating', 'stars']) assert.ok(!raw!.includes(secret), secret);
});

test('recipe share: another Kinwall imports the link losslessly', async () => {
  const { html, recipe, share } = await richShare();
  const other = fixture();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })) as typeof fetch;
  try {
    // The server's save (import-url with save) and the web sheet's (preview, then POST /api/recipes/import).
    const saved = await other.json('/api/recipes/import-url', 'POST', { url: share.url, save: true });
    const preview = parseRecipeHtml(html, share.url)!;
    const sheet = await other.json('/api/recipes/import', 'POST', {
      source: 'web', externalId: 'https://example.com/other', name: preview.name, description: preview.description, sourceUrl: preview.sourceUrl, imageUrl: preview.imageUrl,
      servings: preview.servings, prepMinutes: preview.prepMinutes, totalMinutes: preview.totalMinutes,
      ingredients: preview.ingredients.map((i) => (i.qualifier !== undefined ? i : i.text)), steps: preview.steps,
    });
    for (const id of [saved.recipeId, sheet.recipeId]) {
      const copy = await other.json(`/api/recipes/${id}`);
      for (const key of SHARED) assert.deepEqual(copy[key], recipe[key], key);
      assert.deepEqual(ingredientFields(copy), ingredientFields(recipe));
      assert.deepEqual(copy.steps, sharedSteps(recipe));
      assert.equal(copy.preparationNotes, null);
      assert.deepEqual(copy.rating, { average: null, count: 0, byMember: {} });
    }
    assert.deepEqual(await other.json('/api/meals?from=2026-10-01&to=2026-10-31'), []);
    assert.deepEqual(await other.json('/api/members'), []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('recipe share: a tampered or unknown data block falls back to the JSON-LD', async () => {
  const { html, share } = await richShare();
  const fromLd = parseRecipeHtml(withoutBlock(html), share.url)!;
  const raw = kinwallBlock(html)!;
  const data = JSON.parse(raw);
  const swap = (v: unknown) => html.replace(raw, typeof v === 'string' ? v : JSON.stringify(v));
  for (const bad of [
    '{not json', { ...data, kinwall: 2 }, { recipe: data.recipe }, { kinwall: 1, recipe: { ...data.recipe, name: '' } },
    { kinwall: 1, recipe: { ...data.recipe, servings: -1 } }, { kinwall: 1, recipe: { ...data.recipe, plan: { date: '2026-10-07', slot: 'dinner' } } },
    { kinwall: 1, recipe: { ...data.recipe, ingredients: [{ text: 'x', rating: 5 }] } },
  ]) assert.deepEqual(parseRecipeHtml(swap(bad), share.url), fromLd, JSON.stringify(bad).slice(0, 60));
  // Photos in the block must be https; others are dropped, not fetched.
  const http = parseRecipeHtml(swap({ kinwall: 1, recipe: { ...data.recipe, imageUrl: 'http://example.com/a.jpg', steps: [{ text: 'Go.', imageUrl: 'http://example.com/b.jpg' }] } }), share.url)!;
  assert.equal(http.imageUrl, null);
  assert.equal(http.steps[0].imageUrl, null);
  assert.equal(http.name, bowls.name, 'the rest of the block is used');
});

test('recipe share: the JSON-LD still reads for other apps', async () => {
  const { html, share } = await richShare();
  const r = parseRecipeHtml(withoutBlock(html), share.url)!;
  assert.equal(r.name, bowls.name);
  assert.equal(r.imageUrl, bowls.imageUrl);
  assert.equal(r.sourceUrl, bowls.sourceUrl);
  assert.deepEqual([r.servings, r.prepMinutes, r.totalMinutes], [2, 10, 35]);
  assert.deepEqual(r.ingredients.map((i) => i.text), ['10 oz Chicken thighs in the kit', '1 Onion, diced', '2 tablespoon Soy sauce low sodium', 'Salt to taste']);
  assert.deepEqual(r.steps, [
    { text: 'Boil the rice for 15 minutes.', bullets: [], title: 'Cook the rice', imageUrl: 'https://example.com/s1.jpg' },
    { text: '', bullets: ['Dice the onion.', 'Pat the chicken dry.'], title: 'Prep' },
    { text: '', bullets: ['Sear the chicken.', 'Skin side down.', 'Flip once.'] },
  ]);
});
