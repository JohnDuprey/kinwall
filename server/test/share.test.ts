// POST /api/share: the one "Add to Kinwall" Shortcut. A link is read once and sent where its
// JSON-LD says (Recipe or Restaurant), a Maps place is a restaurant, text is a book or an event
// (which is never saved: it comes back as a link to check it first). Parent devices only.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ld = (block: unknown) => `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(block)}</script></head><body>Hi</body></html>`;
const PAGES: Record<string, string> = {
  'https://food.example/lemon-chicken': ld({ '@context': 'https://schema.org', '@type': 'Recipe', name: 'Lemon chicken', recipeYield: '4', recipeIngredient: ['1 lemon', '2 lb chicken thighs'], recipeInstructions: ['Roast it.'] }),
  'https://cornerslice.example/': ld({ '@type': ['Restaurant', 'LocalBusiness'], name: 'Corner Slice', telephone: '555-0100', servesCuisine: 'Pizza', url: 'https://cornerslice.example/' }),
  'https://news.example/story': '<html><head><title>News</title></head><body>No data</body></html>',
};
const HOBBIT = { key: '/works/OL1W', title: 'The Hobbit', author_name: ['J.R.R. Tolkien'], isbn: ['9780547928227'], first_publish_year: 1937 };

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
/** Open Library's search answers with these docs. */
function openLibrary(docs: unknown[]) {
  globalThis.fetch = (async () => Response.json({ docs })) as typeof fetch;
}

function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const fetched: string[] = [];
  const OUTBOUND_FETCH = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input); fetched.push(url);
    return PAGES[url] ? new Response(PAGES[url], { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('nope', { status: 404 });
  };
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'https://kinwall.example', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', OUTBOUND_FETCH };
  const app = createApp();
  const call = async (method: string, path: string, body?: unknown, key = 'test-admin'): Promise<{ status: number; json: any }> => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, json: await res.json() };
  };
  const share = (body: unknown, key?: string) => call('POST', '/api/share', body, key);
  return { db, call, share, fetched };
}
const shape = (json: object) => Object.keys(json).sort();

test('share: a recipe link (JSON-LD Recipe) is imported, read once', async () => {
  const { share, call, fetched } = fixture();
  const res = await share({ url: 'https://food.example/lemon-chicken' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(shape(res.json), ['kind', 'link', 'review', 'summary']);
  assert.equal(res.json.kind, 'recipe');
  assert.equal(res.json.summary, 'Imported Lemon chicken');
  assert.equal(res.json.review, false);
  const recipes = (await call('GET', '/api/recipes')).json;
  assert.equal(recipes.length, 1);
  assert.equal(res.json.link, `https://kinwall.example/#/meals?recipe=${recipes[0].id}`);
  assert.deepEqual(fetched, ['https://food.example/lemon-chicken']);
  // What a Shortcut sends with unset variables: empty strings.
  assert.equal((await share({ kind: '', url: 'https://food.example/lemon-chicken', text: '', name: '' })).json.kind, 'recipe');
  // Again: the same recipe, updated.
  assert.equal((await share({ url: 'https://food.example/lemon-chicken', kind: 'recipe' })).json.summary, 'Updated Lemon chicken');
  assert.equal((await call('GET', '/api/recipes')).json.length, 1);
});

test('share: a restaurant page goes to the restaurant import without a second fetch; a Maps place too', async () => {
  const { share, fetched } = fixture();
  const res = await share({ url: 'https://cornerslice.example/' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.kind, 'restaurant');
  assert.equal(res.json.summary, 'Added Corner Slice to the binder');
  assert.match(res.json.link, /^https:\/\/kinwall\.example\/#\/meals\?restaurant=[\w-]+$/);
  assert.deepEqual(fetched, ['https://cornerslice.example/']);

  const maps = await share({ url: 'https://maps.apple.com/place?name=Golden%20Bowl&address=9%20Oak%20Ave' });
  assert.equal(maps.status, 200, JSON.stringify(maps.json));
  assert.deepEqual([maps.json.kind, maps.json.summary], ['restaurant', 'Added Golden Bowl to the binder']);
  assert.equal(fetched.length, 1, 'a Maps link is read off the link itself');
  // A photo of a menu: kind restaurant with the text the Shortcut read.
  const menu = await share({ kind: 'restaurant', text: 'Name: Golden Bowl\nMenu:\nNoodles\nPad thai 12.50' });
  assert.equal(menu.json.summary, 'Added 1 item to Golden Bowl');
});

test('share: a link that is neither is a 400 asking what it is; a page that won\'t load says so', async () => {
  const { share } = fixture();
  const res = await share({ url: 'https://news.example/story' });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /what it is/);
  assert.equal(res.json.summary, res.json.error, 'the Shortcut shows summary either way');
  assert.equal((await share({ url: 'https://news.example/story', kind: 'recipe' })).status, 422);
  assert.equal((await share({ url: 'https://nowhere.example/' })).status, 502);
  assert.equal((await share({})).status, 400);
  assert.equal((await share({ url: 'mailto:x@example.com' })).status, 400);
});

test('share: a book by ISBN is added like add-by-ISBN, once', async () => {
  const { share } = fixture();
  openLibrary([HOBBIT]);
  const res = await share({ kind: 'book', text: 'ISBN 978-0-547-92822-7\n$14.99' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.summary, 'Added The Hobbit to the library');
  assert.match(res.json.link, /^https:\/\/kinwall\.example\/#\/trackers\/library\?book=[\w-]+$/);
  const again = await share({ kind: 'book', text: 'ISBN 0-547-92822-X' }); // the ISBN-10
  assert.equal(again.json.summary, 'The Hobbit is already in the library');
  assert.equal(again.json.link, res.json.link);
  openLibrary([]);
  const unknown = await share({ kind: 'book', text: '9780306406157' });
  assert.equal(unknown.status, 404);
});

test('share: a book by title adds only a confident match; otherwise a link to pick it', async () => {
  const { share, call } = fixture();
  openLibrary([HOBBIT, { ...HOBBIT, key: '/works/OL2W', title: 'The Hobbit: Graphic Novel' }]);
  const one = await share({ kind: 'Book', text: 'THE HOBBIT\nby J.R.R. Tolkien' }); // a menu item, as typed
  assert.equal(one.json.summary, 'Added The Hobbit to the library');
  assert.equal(one.json.review, false);

  openLibrary([{ key: '/works/OL3W', title: 'Holes', author_name: ['Louis Sachar'] }, { key: '/works/OL4W', title: 'Holes', author_name: ['Someone Else'] }]);
  const two = await share({ kind: 'book', text: 'Holes' });
  assert.equal(two.status, 200);
  assert.equal(two.json.review, true);
  assert.equal(two.json.summary, 'Pick the right book: Holes');
  assert.equal(two.json.link, 'https://kinwall.example/#/trackers/library?add=Holes');
  assert.equal((await call('GET', '/api/library')).json.length, 1, 'nothing added');
});

test('share: an event is never saved; it comes back as a link to check it', async () => {
  const { share, db } = fixture();
  const res = await share({ kind: 'event', text: 'Title: Spring fair\nDate: 2027-05-08\nTime: 10 AM - 2 PM\nPlace: Lincoln Elementary' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(res.json, {
    kind: 'event', review: true, summary: 'Check the event: Spring fair, Sat May 8 at 10 AM',
    link: 'https://kinwall.example/#/calendar?draft=event&title=Spring+fair&date=2027-05-08&time=10%3A00&end=14%3A00&place=Lincoln+Elementary',
  });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())?.n, 0);
  const noDate = await share({ kind: 'event', text: 'Pickup at 3:15 pm' });
  assert.equal(noDate.json.summary, 'Check the event: Pickup at 3:15 PM, no date found');
  assert.equal(noDate.json.link, 'https://kinwall.example/#/calendar?draft=event&title=Pickup&time=15%3A15');
  assert.equal((await share({ kind: 'event' })).status, 400);
});

test('share: parent devices only; Meals or Reading off refuses with a clear message', async () => {
  const { share, call } = fixture();
  const wall = (await call('POST', '/api/keys', { name: 'Wall', scope: 'display' })).json;
  assert.equal((await share({ kind: 'event', text: 'Title: Swim' }, wall.key)).status, 403);

  const all = (await call('GET', '/api/settings')).json.features;
  await call('PATCH', '/api/settings', { features: { ...all, meals: false, trackersReading: false } });
  for (const body of [{ url: 'https://food.example/lemon-chicken' }, { url: 'https://cornerslice.example/' }, { kind: 'restaurant', name: 'Golden Bowl' }]) {
    const res = await share(body);
    assert.equal(res.status, 403, JSON.stringify(body));
    assert.match(res.json.summary, /Meals is turned off in Settings → Features/);
  }
  const book = await share({ kind: 'book', text: '9780547928227' });
  assert.equal(book.status, 403);
  assert.match(book.json.error, /Reading is turned off/);
  assert.equal((await share({ kind: 'event', text: 'Title: Swim' })).status, 200, 'the calendar has no switch');
});
