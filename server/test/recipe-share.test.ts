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
  assert.match(html, /Shared from Kinwall/);
  assert.ok(html.includes('&lt;fresh&gt; toppings &amp; warm'), 'escaped');
  assert.ok(!html.includes('<fresh>'));

  const parsed = parseRecipeHtml(html, share.url)!;
  assert.equal(parsed.name, tacos.name);
  assert.equal(parsed.description, 'Beef tacos with toppings & warm tortillas.', 'the importer drops anything tag-shaped, as for any site');
  assert.equal(parsed.servings, 4);
  assert.equal(parsed.prepMinutes, 15);
  assert.equal(parsed.totalMinutes, 40);
  assert.equal(parsed.sourceUrl, tacos.sourceUrl, 'the original source, when there is one');
  assert.equal(parsed.imageUrl, tacos.imageUrl);
  assert.deepEqual(parsed.ingredients.map((i) => [i.name, i.quantity, i.unit]), [['Ground beef', 1, 'lb'], ['Corn tortillas', 8, null], ['Salt to taste', null, null]]);
  assert.deepEqual(parsed.steps.map((s) => s.text), tacos.steps.map((s) => s.text));

  // The page's own photos go through this link; the data carries the originals, so a copy keeps them.
  assert.deepEqual([...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1]), [`/r/${share.token}/image`, `/r/${share.token}/steps/1/image`]);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)![1]);
  assert.equal(ld.image, tacos.imageUrl);
  assert.deepEqual(ld.recipeInstructions.map((s: any) => s.image), [tacos.steps[0].imageUrl, undefined, undefined]);
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
    assert.deepEqual(copy.ingredients.map((i: any) => i.name), ['Ground beef', 'Corn tortillas', 'Salt to taste']);
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
