import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { decodeEntities, isoMinutes, parseRecipeHtml, parseRecipeText, yieldServings } from '../src/recipe-web.ts';
import type { Env } from '../src/env.ts';

const page = (...blocks: unknown[]) => `<!doctype html><html><head><title>x</title>${blocks.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('')}</head><body>hi</body></html>`;
const plain = {
  '@context': 'https://schema.org', '@type': 'Recipe', name: 'Weeknight Chili', description: 'Beans &amp; beef, <b>fast</b>.',
  image: 'https://cdn.example.com/chili.jpg', recipeYield: '6 servings', prepTime: 'PT15M', cookTime: 'PT45M',
  recipeIngredient: ['1 lb ground beef', '2 cans kidney beans', '1 ½ cups diced tomatoes', 'Salt'],
  recipeInstructions: [{ '@type': 'HowToStep', text: 'Brown the beef.' }, { '@type': 'HowToStep', text: 'Add everything &amp; simmer 2-3 hours.' }],
};

test('recipe page: plain Recipe maps name, photo, servings, times, ingredients and steps', () => {
  const r = parseRecipeHtml(page(plain), 'https://example.com/chili')!;
  assert.equal(r.name, 'Weeknight Chili');
  assert.equal(r.description, 'Beans & beef, fast.');
  assert.equal(r.imageUrl, 'https://cdn.example.com/chili.jpg');
  assert.deepEqual([r.servings, r.prepMinutes, r.totalMinutes, r.sourceUrl], [6, 15, 60, 'https://example.com/chili']);
  assert.deepEqual(r.ingredients.map((i) => [i.text, i.name, i.quantity, i.unit]), [
    ['1 lb ground beef', 'ground beef', 1, 'lb'], ['2 cans kidney beans', 'kidney beans', 2, 'cans'], ['1 ½ cups diced tomatoes', 'diced tomatoes', 1.5, 'cups'], ['Salt', 'Salt', null, null],
  ]);
  assert.deepEqual(r.steps, [{ text: 'Brown the beef.', bullets: [] }, { text: 'Add everything & simmer 2-3 hours.', bullets: [] }]);
});

test('recipe page: Yoast-style @graph, @type arrays, image by @id, canonical link wins', () => {
  const graph = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebPage', '@id': 'https://example.com/pie/#webpage' },
    { '@type': 'ImageObject', '@id': 'https://example.com/pie/#primaryimage', url: '/img/pie.webp' },
    { '@type': ['Recipe', 'NewsArticle'], name: 'Apple Pie', image: { '@id': 'https://example.com/pie/#primaryimage' }, totalTime: 'P0DT1H30M', recipeYield: ['8', '8 slices'],
      recipeIngredient: ['6 apples'], recipeInstructions: 'Peel the apples.\nBake at 375°F.' },
  ] };
  const html = page(graph).replace('<title>', '<link rel="canonical" href="https://example.com/pie/"><title>');
  const r = parseRecipeHtml(html, 'https://example.com/pie/?utm_source=share')!;
  assert.equal(r.name, 'Apple Pie');
  assert.equal(r.imageUrl, 'https://example.com/img/pie.webp');
  assert.deepEqual([r.servings, r.totalMinutes, r.sourceUrl], [8, 90, 'https://example.com/pie/']);
  assert.deepEqual(r.steps.map((s) => s.text), ['Peel the apples.', 'Bake at 375°F.']);
});

test('recipe page: mainEntity, HowToSection, numbered steps and ImageObject lists', () => {
  const r = parseRecipeHtml(page({ '@type': 'WebPage', mainEntity: { '@type': 'Recipe', name: 'Tacos', image: [{ '@type': 'ImageObject', url: 'https://x.test/a.jpg' }],
    recipeInstructions: [
      { '@type': 'HowToSection', name: 'Filling', itemListElement: [{ '@type': 'HowToStep', text: '1. Brown the beef.' }, { '@type': 'HowToStep', text: 'Season it.' }] },
      { '@type': 'HowToSection', name: 'To serve', itemListElement: [{ '@type': 'HowToStep', name: 'Warm the tortillas.' }] },
    ] } }), 'https://x.test/tacos')!;
  assert.equal(r.imageUrl, 'https://x.test/a.jpg');
  assert.deepEqual(r.steps.map((s) => s.text), ['Filling: Brown the beef.', 'Season it.', 'To serve: Warm the tortillas.']);
});

test('recipe page: raw line breaks inside JSON strings, entities, image arrays of strings', () => {
  const broken = '{"@type":"Recipe","name":"Mom&#039;s  Soup","image":["https://x.test/1.jpg","https://x.test/2.jpg"],"recipeIngredient":["1 cup broth"],"recipeInstructions":"Heat.\n\tServe."}';
  const r = parseRecipeHtml(page(broken), 'https://x.test/soup')!;
  assert.equal(r.name, "Mom's Soup");
  assert.equal(r.imageUrl, 'https://x.test/1.jpg');
  assert.equal(r.steps.length, 1); // the break was not JSON, so it reads as one line
});

test('recipe page: a HowToStep name becomes its title, unless it just repeats the text', () => {
  const long = 'A very long name that some sites put on a step instead of a short heading for it, which is too long';
  const r = parseRecipeHtml(page({ '@type': 'Recipe', name: 'Stew', recipeInstructions: [
    { '@type': 'HowToStep', name: 'Brown the meat', text: 'Heat the oil and brown the beef in batches.' },
    { '@type': 'HowToStep', name: 'Add the onions', text: 'Add the onions and cook until soft.' },
    { '@type': 'HowToStep', name: 'Add the carrots and…', text: 'Add the carrots and potatoes.' },
    { '@type': 'HowToStep', name: 'Step 4', text: 'Simmer for an hour.' },
    { '@type': 'HowToStep', name: long, text: 'Serve.' },
    { '@type': 'HowToStep', name: 'Only a name.' },
  ] }), 'https://x.test/stew')!;
  assert.deepEqual(r.steps, [
    { text: 'Heat the oil and brown the beef in batches.', bullets: [], title: 'Brown the meat' },
    { text: 'Add the onions and cook until soft.', bullets: [] },
    { text: 'Add the carrots and potatoes.', bullets: [] },
    { text: 'Simmer for an hour.', bullets: [] },
    { text: 'Serve.', bullets: [] },
    { text: 'Only a name.', bullets: [] },
  ]);
});

test('recipe page: a HowToStep image becomes the step photo (https only, resolved against the page)', () => {
  const r = parseRecipeHtml(page({ '@graph': [
    { '@type': 'ImageObject', '@id': '#s4', url: 'https://cdn.x.test/s4.jpg' },
    { '@type': 'Recipe', name: 'Stew', recipeInstructions: [
      { '@type': 'HowToStep', text: 'One.', image: '/img/s1.jpg' },
      { '@type': 'HowToStep', text: 'Two.', image: { '@type': 'ImageObject', url: 'https://cdn.x.test/s2.jpg' } },
      { '@type': 'HowToStep', text: 'Three.', image: ['https://cdn.x.test/s3.jpg', 'https://cdn.x.test/s3b.jpg'] },
      { '@type': 'HowToStep', text: 'Four.', image: { '@id': '#s4' } },
      { '@type': 'HowToStep', text: 'Five.', image: 'http://cdn.x.test/s5.jpg' },
      { '@type': 'HowToStep', text: 'Six.', image: 'javascript:alert(1)' },
    ] },
  ] }), 'https://x.test/stew')!;
  assert.deepEqual(r.steps.map((s) => s.imageUrl), ['https://x.test/img/s1.jpg', 'https://cdn.x.test/s2.jpg', 'https://cdn.x.test/s3.jpg', 'https://cdn.x.test/s4.jpg', undefined, undefined]);
});

test('recipe page: a HowToStep of several lines stays one step, of bullets', () => {
  const r = parseRecipeHtml(page({ '@type': 'Recipe', name: 'Bowls', recipeInstructions: [
    { '@type': 'HowToStep', name: 'Prep', text: '<p>Dice the onion.</p><p>Mince the garlic.</p>' },
    { '@type': 'HowToStep', text: 'Cook the rice.' },
    { '@type': 'HowToSection', name: 'Sauce', itemListElement: [{ '@type': 'HowToStep', text: 'Whisk the soy sauce.\nAdd the honey.' }] },
  ] }), 'https://x.test/bowls')!;
  assert.deepEqual(r.steps, [
    { text: '', bullets: ['Dice the onion.', 'Mince the garlic.'], title: 'Prep' },
    { text: 'Cook the rice.', bullets: [] },
    { text: '', bullets: ['Sauce: Whisk the soy sauce.', 'Add the honey.'] },
  ]);
});

test('recipe page: helpers for durations, yields and entities', () => {
  assert.deepEqual(['PT1H30M', 'PT90M', 'P0DT0H20M', 'PT0.5H', 'PT0M', 'soon', undefined].map(isoMinutes), [90, 90, 20, 30, null, null, null]);
  assert.deepEqual([yieldServings('Serves 4-6'), yieldServings(['', '12 cookies']), yieldServings(3), yieldServings('a lot')], [4, 12, 3, null]);
  assert.equal(decodeEntities('&frac12; cup &amp;amp; &#x27;s &#8217; &rsquo; &bogus;'), '½ cup & \'s ’ ’ &bogus;');
  assert.equal(parseRecipeHtml('<html><script type="application/ld+json">{"@type":"Article"}</script></html>', 'https://x.test/'), null);
});

test('pasted text: headings split ingredients from steps', () => {
  const r = parseRecipeText('Grandma\'s Pancakes\nServes 4\nFluffy.\n\nIngredients:\n- 2 cups flour\n• 1 1/2 cups milk\n2 eggs\n\nDirections\n1. Mix.\n2) Cook on a griddle.\n\nStep 3: Eat.')!;
  assert.equal(r.name, "Grandma's Pancakes");
  assert.deepEqual([r.servings, r.description], [4, 'Fluffy.']);
  assert.deepEqual(r.ingredients.map((i) => [i.name, i.quantity, i.unit]), [['flour', 2, 'cups'], ['milk', 1.5, 'cups'], ['eggs', 2, null]]);
  assert.deepEqual(r.steps.map((s) => s.text), ['Mix.', 'Cook on a griddle.', 'Eat.']);
  assert.equal(parseRecipeText('METHOD\nstir'), null);
  assert.deepEqual(parseRecipeText('INGREDIENTS\n1 egg\nMethod\nBoil it.')!.steps.map((s) => s.text), ['Boil it.']);
});

// A little web server for the fetch tests.
const routes: Record<string, { type: string; body: string | Buffer; status?: number; location?: string }> = {
  '/chili': { type: 'text/html; charset=utf-8', body: page(plain) },
  '/moved': { type: 'text/html', body: '', status: 302, location: '/chili' },
  '/plain': { type: 'text/html', body: '<html><body><h1>Just a blog post</h1></body></html>' },
  '/data.json': { type: 'application/json', body: JSON.stringify(plain) },
  '/huge': { type: 'text/html', body: Buffer.alloc(3 * 1024 * 1024 + 10, 'a') },
};
const server = createServer((req, res) => {
  const r = routes[req.url ?? ''];
  if (!r) { res.writeHead(404).end(); return; }
  res.writeHead(r.status ?? 200, { 'Content-Type': r.type, ...(r.location && { Location: r.location }) });
  res.end(r.body);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => server.close());

function fixture(env: Partial<Env> = { ALLOW_PRIVATE_FEED_URLS: '1' }) {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const full: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ...env };
  const app = createApp();
  return async (path: string, body: unknown, key = 'test-admin'): Promise<{ status: number; json: any }> => {
    const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, full);
    return { status: res.status, json: await res.json() };
  };
}

test('import-url: previews without saving, then save upserts by page address', async () => {
  const post = fixture();
  const preview = await post('/api/recipes/import-url', { url: `${base}/moved` });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.recipe.name, 'Weeknight Chili');
  assert.equal(preview.json.recipe.sourceUrl, `${base}/chili`); // after the redirect
  assert.deepEqual(preview.json.warnings, []);
  assert.equal(preview.json.recipeId, undefined);
  const first = await post('/api/recipes/import-url', { url: `${base}/chili`, save: true });
  assert.equal(first.json.created, true);
  const again = await post('/api/recipes/import-url', { url: `${base}/chili`, save: true });
  assert.deepEqual([again.json.recipeId, again.json.created], [first.json.recipeId, false]);
  // The web app saves an edited preview through /api/recipes/import with the same key: still one recipe.
  const edited = await post('/api/recipes/import', { source: 'web', externalId: `${base}/chili`, name: 'Our Chili', servings: 4, ingredients: preview.json.recipe.ingredients.map((i: any) => i.text), steps: preview.json.recipe.steps });
  assert.equal(edited.json.recipeId, first.json.recipeId);
});

test('import-url: pages without recipe data, non-HTML, oversize and private addresses are refused', async () => {
  const post = fixture();
  const none = await post('/api/recipes/import-url', { url: `${base}/plain` });
  assert.deepEqual([none.status, none.json.error], [422, 'This page has no recipe data Kinwall can read. Paste the recipe text instead.']);
  assert.equal((await post('/api/recipes/import-url', { url: `${base}/data.json` })).status, 502);
  const huge = await post('/api/recipes/import-url', { url: `${base}/huge` });
  assert.deepEqual([huge.status, huge.json.error], [502, 'Recipe page is too large.']);
  const strict = fixture({});
  for (const url of [`${base}/chili`, 'https://127.0.0.1/x', 'https://192.168.1.10/x', 'https://localhost/x', 'https://[::1]/x']) {
    const refused = await strict('/api/recipes/import-url', { url });
    assert.equal(refused.status, 400, url);
    assert.match(refused.json.error, /public https address/);
  }
});

test('parse-text and import-url are admin only; parse-text previews', async () => {
  const post = fixture();
  const parsed = await post('/api/recipes/parse-text', { text: 'Toast\nIngredients\n2 slices bread\nSteps\nToast it.', url: 'https://example.com/toast' });
  assert.equal(parsed.status, 200);
  assert.deepEqual([parsed.json.recipe.name, parsed.json.recipe.sourceUrl, parsed.json.recipe.ingredients[0].unit], ['Toast', 'https://example.com/toast', 'slices']);
  assert.deepEqual(parsed.json.warnings, ['No servings found. It will be saved for 4; change it if that is wrong.']);
  assert.equal((await post('/api/recipes/parse-text', { text: 'just words' })).status, 422);
  const key = (await post('/api/keys', { name: 'wall', scope: 'display' })).json.key;
  assert.equal((await post('/api/recipes/parse-text', { text: 'x' }, key)).status, 403);
  assert.equal((await post('/api/recipes/import-url', { url: `${base}/chili` }, key)).status, 403);
});
