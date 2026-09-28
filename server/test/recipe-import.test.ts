import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { parseIngredientLine } from '../src/meals.ts';
import type { Env } from '../src/env.ts';

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const request = (path: string, method = 'GET', body?: unknown, key = 'test-admin') => app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
  const json = async (path: string, method = 'GET', body?: unknown, key = 'test-admin'): Promise<any> => {
    const res = await request(path, method, body, key); const data = await res.json();
    assert.ok(res.ok, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data;
  };
  return { request, json };
}

test('recipe import: ingredient lines parse into amount, unit and name', () => {
  const cases: [string, { name: string; quantity: number | null; unit: string | null }][] = [
    ['1.5 tablespoon Sour Cream', { name: 'Sour Cream', quantity: 1.5, unit: 'tablespoon' }],
    ['2 unit Garlic Clove', { name: 'Garlic Clove', quantity: 2, unit: null }],
    ['½ cup Rice', { name: 'Rice', quantity: 0.5, unit: 'cup' }],
    ['1½ cups Rice', { name: 'Rice', quantity: 1.5, unit: 'cups' }],
    ['1 1/2 teaspoon Chili Flakes', { name: 'Chili Flakes', quantity: 1.5, unit: 'teaspoon' }],
    ['1 package Chicken Thighs', { name: 'Chicken Thighs', quantity: 1, unit: 'package' }],
    ['2 Tomatoes', { name: 'Tomatoes', quantity: 2, unit: null }],
    ['4 fl oz Cream', { name: 'Cream', quantity: 4, unit: 'fl oz' }],
    ['Salt', { name: 'Salt', quantity: null, unit: null }],
    ['  Pepper  ', { name: 'Pepper', quantity: null, unit: null }],
    ['2x Bacon', { name: '2x Bacon', quantity: null, unit: null }],
    ['1 teaspoon (tsp) Cooking Oil', { name: 'Cooking Oil', quantity: 1, unit: 'teaspoon' }],
    ['2 tablespoon (tbsp) Butter', { name: 'Butter', quantity: 2, unit: 'tablespoon' }],
    ['10 ounce (oz) Chicken', { name: 'Chicken', quantity: 10, unit: 'ounce' }],
    ['4 fl oz (fl oz) Cream', { name: 'Cream', quantity: 4, unit: 'fl oz' }],
    ['1 pound (lb.) Beef', { name: 'Beef', quantity: 1, unit: 'pound' }],
    ['250 grams (g) Rice', { name: 'Rice', quantity: 250, unit: 'grams' }],
    ['1 cup (cup) Milk', { name: 'Milk', quantity: 1, unit: 'cup' }],
    ['1 can (Diced) Tomatoes', { name: '(Diced) Tomatoes', quantity: 1, unit: 'can' }],
  ];
  for (const [line, expected] of cases) assert.deepEqual(parseIngredientLine(line), expected, line);
});

const kit = (plan?: unknown) => ({
  source: 'hellofresh', externalId: 'abc123', name: 'Creamy Chicken', description: 'Weeknight', sourceUrl: 'https://example.com/card.pdf', imageUrl: 'https://example.com/a.jpg', servings: 2,
  ingredients: [{ text: '1.5 tablespoon Sour Cream', pantry: false }, { text: '2 unit Garlic Clove', pantry: false, category: 'Produce' }, { text: '1 teaspoon Olive Oil', pantry: true }, 'Salt'],
  steps: ['Boil water.', 'Cook chicken.'], ...(plan ? { plan } : {}),
});

test('recipe import: upserts by source and externalId, keeps the card link, numbers the steps', async () => {
  const { json } = fixture();
  const first = await json('/api/recipes/import', 'POST', kit());
  assert.deepEqual({ created: first.created, planned: first.planned }, { created: true, planned: false });
  let recipe = await json(`/api/recipes/${first.recipeId}`);
  assert.equal(recipe.sourceUrl, 'https://example.com/card.pdf');
  assert.equal(recipe.imageUrl, 'https://example.com/a.jpg');
  assert.deepEqual([recipe.source, recipe.externalId, recipe.defaultServings], ['hellofresh', 'abc123', 2]);
  assert.equal(recipe.instructions, '1. Boil water.\n2. Cook chicken.');
  assert.deepEqual(recipe.ingredients.map((i: any) => [i.name, i.quantity, i.unit, i.qualifier, i.category]), [
    ['Sour Cream', 1.5, 'tablespoon', 'in the kit', null], ['Garlic Clove', 2, null, 'in the kit', 'Produce'], ['Olive Oil', 1, 'teaspoon', null, null], ['Salt', null, null, null, null],
  ]);
  const again = await json('/api/recipes/import', 'POST', { ...kit(), name: 'Creamy Chicken v2', steps: ['Just eat.'] });
  assert.deepEqual([again.recipeId, again.created], [first.recipeId, false]);
  recipe = await json(`/api/recipes/${first.recipeId}`);
  assert.equal(recipe.name, 'Creamy Chicken v2');
  assert.equal(recipe.instructions, '1. Just eat.');
  assert.equal((await json('/api/recipes')).length, 1);
  const other = await json('/api/recipes/import', 'POST', { ...kit(), source: 'other-kit' });
  assert.notEqual(other.recipeId, first.recipeId);
});

test('recipe import: planning is idempotent and skips an occupied slot', async () => {
  const { json } = fixture();
  const planned = await json('/api/recipes/import', 'POST', kit({ date: '2026-10-05', slot: 'dinner', servings: 4 }));
  assert.equal(planned.planned, true);
  const meal = await json(`/api/meals/${planned.mealId}`);
  assert.deepEqual([meal.date, meal.slot, meal.servings, meal.recipeId, meal.sourceUrl], ['2026-10-05', 'dinner', 4, planned.recipeId, 'https://example.com/card.pdf']);
  // Again (same or a later night in that week): the meal it already planned, not a second one.
  const again = await json('/api/recipes/import', 'POST', kit({ date: '2026-10-05', slot: 'dinner' }));
  assert.deepEqual([again.planned, again.mealId], [true, planned.mealId]);
  assert.equal((await json('/api/recipes/import', 'POST', kit({ date: '2026-10-04', slot: 'dinner' }))).mealId, planned.mealId);
  assert.equal((await json('/api/meals?from=2026-10-01&to=2026-10-12')).length, 1);
  // Another recipe for that night is refused with the reason; the next night is free.
  const busy = await json('/api/recipes/import', 'POST', { ...kit({ date: '2026-10-05', slot: 'dinner' }), externalId: 'xyz' });
  assert.equal(busy.planned, false);
  assert.equal(busy.mealId, undefined);
  assert.match(busy.reason, /dinner on 2026-10-05 already has Creamy Chicken/);
  assert.equal((await json('/api/recipes/import', 'POST', { ...kit({ date: '2026-10-06', slot: 'dinner' }), externalId: 'xyz' })).planned, true);
});

test('recipe import: grocery lists skip what ships in the kit unless asked', async () => {
  const { json } = fixture();
  await json('/api/recipes/import', 'POST', kit({ date: '2026-10-05', slot: 'dinner' }));
  const list = await json('/api/lists', 'POST', { name: 'Groceries', kind: 'shopping' });
  const range = { from: '2026-10-05', to: '2026-10-11', listId: list.id };
  const preview = await json(`/api/meals/projection?${new URLSearchParams(range)}`);
  assert.equal(preview.items.length, 4, 'the preview still shows everything');
  const applied = await json('/api/meals/projection/apply', 'POST', range);
  assert.deepEqual(applied.projection.items.filter((i: any) => i.applied).map((i: any) => i.name).sort(), ['Olive Oil', 'Salt']);
  assert.equal((await json('/api/meals/projection/apply', 'POST', { ...range, includeKitItems: true })).added, 2);
});

test('recipe import: a display key cannot import', async () => {
  const { json, request } = fixture();
  const display = await json('/api/keys', 'POST', { name: 'wall', scope: 'display' });
  assert.equal((await request('/api/recipes/import', 'POST', kit(), display.key)).status, 403);
  assert.equal((await request('/api/recipes/import', 'POST', { ...kit(), ingredients: [{ text: 'x', shipped: true }] })).status, 400);
});

test('recipe card PDF: proxies only the stored https sourceUrl, checks type and size', async () => {
  const { json, request } = fixture();
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  let reply = (): Response => new Response('%PDF-1.4 card', { headers: { 'Content-Type': 'application/pdf' } });
  globalThis.fetch = (async (url: unknown) => { fetched.push(String(url)); return reply(); }) as typeof fetch;
  try {
    const { recipeId, mealId } = await json('/api/recipes/import', 'POST', kit({ date: '2026-03-02', slot: 'dinner' }));
    const display = await json('/api/keys', 'POST', { name: 'wall', scope: 'display' });
    for (const path of [`/api/recipes/${recipeId}/source.pdf`, `/api/meals/${mealId}/source.pdf`]) {
      const res = await request(`${path}?url=https://evil.example/x.pdf`, 'GET', undefined, display.key);
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.equal(res.headers.get('cache-control'), 'private, max-age=86400');
      assert.equal(await res.text(), '%PDF-1.4 card');
    }
    assert.deepEqual(fetched, ['https://example.com/card.pdf', 'https://example.com/card.pdf'], 'never the ?url= param');

    // octet-stream passes only with the %PDF magic; HTML never passes.
    reply = () => new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal((await request(`/api/recipes/${recipeId}/source.pdf`)).status, 200);
    reply = () => new Response('<html>nope</html>', { headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal((await request(`/api/recipes/${recipeId}/source.pdf`)).status, 502);
    reply = () => new Response('%PDF-1.4', { headers: { 'Content-Type': 'text/html' } });
    assert.equal((await request(`/api/recipes/${recipeId}/source.pdf`)).status, 502);
    // Size cap, whether or not the server declares a length.
    const big = new Uint8Array(15 * 1024 * 1024 + 1); big.set([0x25, 0x50, 0x44, 0x46]);
    reply = () => new Response(new ReadableStream({ start(c) { c.enqueue(big); c.close(); } }), { headers: { 'Content-Type': 'application/pdf' } });
    assert.equal((await request(`/api/recipes/${recipeId}/source.pdf`)).status, 502);
    // Redirects are re-checked: a hop to a private address is refused.
    reply = () => new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/card.pdf' } });
    assert.equal((await request(`/api/recipes/${recipeId}/source.pdf`)).status, 400);

    fetched.length = 0;
    reply = () => new Response('%PDF-1.4', { headers: { 'Content-Type': 'application/pdf' } });
    await json(`/api/recipes/${recipeId}`, 'PATCH', { sourceUrl: 'http://example.com/card.pdf' });
    assert.equal((await request(`/api/recipes/${recipeId}/source.pdf`)).status, 400, 'http refused');
    await json(`/api/recipes/${recipeId}`, 'PATCH', { sourceUrl: null });
    assert.equal((await request(`/api/recipes/${recipeId}/source.pdf`)).status, 404, 'no sourceUrl');
    assert.equal((await request('/api/recipes/nope/source.pdf')).status, 404);
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('recipe image: proxies only the stored https imageUrl, sniffs the bytes, caps the size, takes ?key=', async () => {
  const { json, request } = fixture();
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  let reply = (): Response => new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg', ETag: '"v1"' } });
  globalThis.fetch = (async (url: unknown) => { fetched.push(String(url)); return reply(); }) as typeof fetch;
  try {
    const { recipeId, mealId } = await json('/api/recipes/import', 'POST', kit({ date: '2026-03-02', slot: 'dinner' }));
    const display = await json('/api/keys', 'POST', { name: 'wall', scope: 'display' });
    for (const path of [`/api/recipes/${recipeId}/image`, `/api/meals/${mealId}/image`]) {
      // An <img> sends no header: the key rides as ?key=.
      const res = await request(`${path}?key=${display.key}&url=https://evil.example/x.jpg`, 'GET', undefined, '');
      assert.equal(res.status, 200, path);
      assert.equal(res.headers.get('content-type'), 'image/jpeg');
      assert.equal(res.headers.get('cache-control'), 'private, max-age=604800');
      assert.equal(res.headers.get('etag'), '"v1"');
      assert.deepEqual(new Uint8Array(await res.arrayBuffer()), jpeg);
    }
    assert.deepEqual(fetched, ['https://example.com/a.jpg', 'https://example.com/a.jpg'], 'never the ?url= param');
    assert.equal((await request(`/api/recipes/${recipeId}/image`, 'GET', undefined, '')).status, 401, 'no key, no image');
    assert.equal((await request(`/api/recipes/${recipeId}?key=test-admin`, 'GET', undefined, '')).status, 401, '?key= only on the image path');

    // The type served is what the bytes are; a claimed image that isn't one (or SVG, or HTML) is refused.
    reply = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), { headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal((await request(`/api/recipes/${recipeId}/image`)).headers.get('content-type'), 'image/png');
    reply = () => new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } });
    assert.equal((await request(`/api/recipes/${recipeId}/image`)).status, 502);
    reply = () => new Response('<html>nope</html>', { headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal((await request(`/api/recipes/${recipeId}/image`)).status, 502);
    // Size cap, whether or not the server declares a length.
    const big = new Uint8Array(8 * 1024 * 1024 + 1); big.set([0xff, 0xd8, 0xff]);
    reply = () => new Response(new ReadableStream({ start(c) { c.enqueue(big); c.close(); } }), { headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal((await request(`/api/recipes/${recipeId}/image`)).status, 502);
    reply = () => new Response(null, { status: 302, headers: { Location: 'https://10.0.0.1/a.jpg' } });
    assert.equal((await request(`/api/recipes/${recipeId}/image`)).status, 400);

    fetched.length = 0;
    await json(`/api/recipes/${recipeId}`, 'PATCH', { imageUrl: 'http://example.com/a.jpg' });
    assert.equal((await request(`/api/recipes/${recipeId}/image`)).status, 400, 'http refused');
    // The editor can clear it.
    assert.equal((await json(`/api/recipes/${recipeId}`, 'PATCH', { imageUrl: null })).imageUrl, null);
    assert.equal((await request(`/api/recipes/${recipeId}/image`)).status, 404, 'no imageUrl');
    assert.equal((await request(`/api/meals/${mealId}/image`)).status, 404);
    assert.equal((await request('/api/recipes/nope/image')).status, 404);
    const free = await json('/api/meals', 'POST', { date: '2026-03-03', slot: 'lunch', title: 'Soup' });
    assert.equal((await request(`/api/meals/${free.id}/image`)).status, 404, 'a meal without a recipe');
    assert.deepEqual(fetched, []);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('recipe times: import, edit, plan (snapshot) and export/import round trip', async () => {
  const { json } = fixture();
  const { recipeId, mealId } = await json('/api/recipes/import', 'POST', { ...kit({ date: '2026-03-02', slot: 'dinner' }), prepMinutes: 10, totalMinutes: 35 });
  let recipe = await json(`/api/recipes/${recipeId}`);
  assert.deepEqual([recipe.prepMinutes, recipe.totalMinutes], [10, 35]);
  const meal = await json(`/api/meals/${mealId}`);
  assert.deepEqual([meal.recipeSnapshot.prepMinutes, meal.recipeSnapshot.totalMinutes], [10, 35]);
  // Importing again without times keeps them; an edit can clear one.
  await json('/api/recipes/import', 'POST', kit());
  recipe = await json(`/api/recipes/${recipeId}`, 'PATCH', { prepMinutes: null });
  assert.deepEqual([recipe.prepMinutes, recipe.totalMinutes], [null, 35]);
  const manual = await json('/api/recipes', 'POST', { name: 'Toast', totalMinutes: 5 });
  assert.deepEqual([manual.prepMinutes, manual.totalMinutes], [null, 5]);

  const backup = await json('/api/export');
  const other = fixture();
  await other.json('/api/import', 'POST', backup);
  assert.deepEqual((await other.json(`/api/recipes/${recipeId}`)).totalMinutes, 35);
  assert.equal((await other.json(`/api/meals/${mealId}`)).recipeSnapshot.totalMinutes, 35);
});

test("meal eaters: who's eating sets servings, round-trips, validates, and leaves with a deleted member", async () => {
  const { json, request } = fixture();
  const leo = await json('/api/members', 'POST', { name: 'Leo', color: '#e57' });
  const maya = await json('/api/members', 'POST', { name: 'Maya', color: '#57e' });
  const ava = await json('/api/members', 'POST', { name: 'Ava', color: '#5e7' });
  // Import plan: eaters without servings -> servings = how many.
  const { mealId } = await json('/api/recipes/import', 'POST', kit({ date: '2026-03-02', slot: 'dinner', eaterIds: [leo.id, maya.id, ava.id] }));
  let meal = await json(`/api/meals/${mealId}`);
  assert.deepEqual([meal.eaterIds, meal.servings], [[leo.id, maya.id, ava.id], 3]);
  // Given servings win; duplicates collapse.
  meal = await json('/api/meals', 'POST', { date: '2026-03-03', slot: 'lunch', title: 'Soup', eaterIds: [leo.id, leo.id], servings: 4 });
  assert.deepEqual([meal.eaterIds, meal.servings], [[leo.id], 4]);
  meal = await json(`/api/meals/${meal.id}`, 'PATCH', { eaterIds: [leo.id, maya.id] });
  assert.deepEqual([meal.eaterIds, meal.servings], [[leo.id, maya.id], 2]);
  assert.deepEqual((await json('/api/meals', 'POST', { date: '2026-03-04', slot: 'lunch', title: 'Toast' })).eaterIds, []);
  assert.equal((await request('/api/meals', 'POST', { date: '2026-03-04', slot: 'lunch', title: 'X', eaterIds: ['nobody'] })).status, 400);

  const backup = await json('/api/export');
  const other = fixture();
  await other.json('/api/import', 'POST', backup);
  assert.deepEqual((await other.json(`/api/meals/${mealId}`)).eaterIds, [leo.id, maya.id, ava.id]);

  await json(`/api/members/${maya.id}`, 'DELETE');
  assert.deepEqual((await json(`/api/meals/${mealId}`)).eaterIds, [leo.id, ava.id]);
});

test('recipe steps: import strings or objects, lines become bullets, instructions follows, CRUD and export keep them', async () => {
  const { json, request } = fixture();
  const { recipeId } = await json('/api/recipes/import', 'POST', { ...kit(), steps: [
    'Preheat oven to 425 degrees.',
    'Halve the peppers.\n• Toss with oil, salt and pepper.\n\n- Roast 15 minutes.',
    { text: 'Sear the chicken', bullets: ['Heat oil.', ' ', 'Cook 5 minutes per side.'], imageUrl: 'https://example.com/s3.jpg' },
    { bullets: ['Stir in cream.'] },
    { text: 'Plate.\nServe.' },
    { text: ' ' },
  ] });
  let recipe = await json(`/api/recipes/${recipeId}`);
  assert.deepEqual(recipe.steps, [
    { text: 'Preheat oven to 425 degrees.', bullets: [], imageUrl: null },
    { text: '', bullets: ['Halve the peppers.', 'Toss with oil, salt and pepper.', 'Roast 15 minutes.'], imageUrl: null },
    { text: 'Sear the chicken', bullets: ['Heat oil.', 'Cook 5 minutes per side.'], imageUrl: 'https://example.com/s3.jpg' },
    { text: '', bullets: ['Stir in cream.'], imageUrl: null },
    { text: '', bullets: ['Plate.', 'Serve.'], imageUrl: null },
  ]);
  assert.equal(recipe.instructions, '1. Preheat oven to 425 degrees.\n2. Halve the peppers.\n- Toss with oil, salt and pepper.\n- Roast 15 minutes.\n3. Sear the chicken\n- Heat oil.\n- Cook 5 minutes per side.\n4. Stir in cream.\n5. Plate.\n- Serve.');
  // Re-import without steps leaves them; with [] clears both.
  const { steps: _s, ...noSteps } = kit();
  assert.equal((await json(`/api/recipes/${(await json('/api/recipes/import', 'POST', noSteps)).recipeId}`)).steps.length, 5);

  // Export and import bring the steps back.
  const file = await (await request('/api/export')).json() as any;
  await json(`/api/recipes/${recipeId}`, 'DELETE');
  assert.equal((await request('/api/import', 'POST', file)).status, 200);
  assert.deepEqual((await json(`/api/recipes/${recipeId}`)).steps, recipe.steps);

  // Editing steps rewrites instructions; instructions sent alone replace the steps.
  recipe = await json(`/api/recipes/${recipeId}`, 'PATCH', { steps: [{ text: 'Only step', bullets: ['a', 'b'] }] });
  assert.deepEqual([recipe.steps, recipe.instructions], [[{ text: 'Only step', bullets: ['a', 'b'], imageUrl: null }], '1. Only step\n- a\n- b']);
  recipe = await json(`/api/recipes/${recipeId}`, 'PATCH', { name: 'Renamed' });
  assert.equal(recipe.steps.length, 1, 'other edits keep the steps');
  recipe = await json(`/api/recipes/${recipeId}`, 'PATCH', { instructions: 'Just wing it.' });
  assert.deepEqual([recipe.steps, recipe.instructions], [null, 'Just wing it.']);
  assert.equal((await json('/api/recipes/import', 'POST', { ...kit(), steps: [] })).recipeId, recipeId);
  assert.deepEqual([(await json(`/api/recipes/${recipeId}`)).steps, (await json(`/api/recipes/${recipeId}`)).instructions], [null, null]);
  const made = await json('/api/recipes', 'POST', { name: 'Toast', steps: [{ text: 'Toast bread.' }] });
  assert.equal(made.instructions, '1. Toast bread.');
  assert.equal((await request('/api/recipes', 'POST', { name: 'Bad', steps: [{ text: 'x', imageUrl: 'javascript:alert(1)' }] })).status, 400);
});

test('recipe step image: proxies only that step\'s stored imageUrl, numbered from 1, takes ?key=', async () => {
  const { json, request } = fixture();
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  let reply = (): Response => new Response(jpeg, { headers: { 'Content-Type': 'image/jpeg' } });
  globalThis.fetch = (async (url: unknown) => { fetched.push(String(url)); return reply(); }) as typeof fetch;
  try {
    const { recipeId } = await json('/api/recipes/import', 'POST', { ...kit(), steps: [{ text: 'One', imageUrl: 'https://example.com/1.jpg' }, 'Two', { text: 'Three', imageUrl: 'http://example.com/3.jpg' }] });
    const display = await json('/api/keys', 'POST', { name: 'wall', scope: 'display' });
    const res = await request(`/api/recipes/${recipeId}/steps/1/image?key=${display.key}&url=https://evil.example/x.jpg`, 'GET', undefined, '');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), jpeg);
    assert.deepEqual(fetched, ['https://example.com/1.jpg']);
    assert.equal((await request(`/api/recipes/${recipeId}/steps/1/image`, 'GET', undefined, '')).status, 401, 'no key, no image');
    assert.equal((await request(`/api/recipes/${recipeId}/steps/2/image`)).status, 404, 'a step without a photo');
    assert.equal((await request(`/api/recipes/${recipeId}/steps/4/image`)).status, 404, 'no such step');
    assert.equal((await request(`/api/recipes/${recipeId}/steps/0/image`)).status, 400);
    assert.equal((await request(`/api/recipes/${recipeId}/steps/3/image`)).status, 400, 'http refused');
    assert.equal((await request('/api/recipes/nope/steps/1/image')).status, 404);
    reply = () => new Response('<html>nope</html>', { headers: { 'Content-Type': 'image/jpeg' } });
    assert.equal((await request(`/api/recipes/${recipeId}/steps/1/image`)).status, 502);
  } finally {
    globalThis.fetch = realFetch;
  }
});
