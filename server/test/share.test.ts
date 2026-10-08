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
  'https://food.example/tacos': ld({ '@type': 'Recipe', name: 'Fish tacos', image: 'https://food.example/tacos.jpg', recipeYield: '4 servings', totalTime: 'PT1H15M', recipeIngredient: ['1 lb cod', '8 tortillas', '1 lime'], recipeInstructions: ['Season the fish.', 'Cook it.'] }),
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
  const asRecipe = await share({ url: 'https://maps.apple.com/place?name=Golden%20Bowl', kind: 'recipe' });
  assert.equal(asRecipe.status, 422);
  assert.equal(fetched.length, 1, 'not even when it is shared as a recipe');
  // A photo of a menu: kind restaurant with the text the Shortcut read.
  const menu = await share({ kind: 'restaurant', text: 'Name: Golden Bowl\nMenu:\nNoodles\nPad thai 12.50' });
  assert.equal(menu.json.summary, 'Added 1 item to Golden Bowl');
});

test('share: a menu from several photos is one restaurant, sections kept together; more pages later are added', async () => {
  const { share, call } = fixture();
  const items = (section: string, n: number, from = 0) => Array.from({ length: n }, (_, i) => `${section} special ${from + i + 1} ${10 + i}.99`).join('\n');
  // What the phone sends: the pages' words joined by page lines.
  const pages = [
    `Name: Corner Slice\nCuisine: Pizza\nMenu:\nPizza\n${items('Pizza', 12)}\nSalads\n${items('Salad', 6)}`,
    `Pizza (continued)\n${items('Pizza', 8, 12)}\nSides\n${items('Side', 10)}`,
    `Salads cont.\n${items('Salad', 4, 6)}\nDrinks:\n${items('Drink', 6)}`,
  ];
  const text = pages.map((p, i) => (i ? `--- Page ${i + 1} ---\n` : '') + p).join('\n');
  const res = await share({ kind: 'restaurant', text });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.summary, 'Added Corner Slice with 46 menu items');
  const [place] = (await call('GET', '/api/restaurants')).json;
  const sections = place.menu.map((i: { section: string | null }) => i.section).filter((s: string | null, i: number, all: (string | null)[]) => s !== all[i - 1]);
  assert.deepEqual(sections.slice(0, 4), ['Pizza', 'Salads', 'Sides', 'Drinks'], 'each section once, in the order first seen');
  assert.equal(place.menu.filter((i: { section: string }) => i.section === 'Pizza').length, 20);

  // The back of the menu, shared later: only what's new is added, into its section.
  const later = await share({ kind: 'restaurant', text: `Name: Corner Slice\nMenu:\nDrinks\n${items('Drink', 8)}\nDesserts\nCannoli 6.50` });
  assert.equal(later.json.summary, 'Added 3 items to Corner Slice (6 already there)');
  const after = (await call('GET', '/api/restaurants')).json[0].menu.map((i: { section: string }) => i.section);
  assert.deepEqual(after.slice(-9), [...Array(8).fill('Drinks'), 'Desserts'], 'new drinks join the drinks, not the end');
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
    event: { title: 'Spring fair', date: '2027-05-08', time: '10:00', end: '14:00', place: 'Lincoln Elementary', notes: null },
  });
  assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())?.n, 0);
  const noDate = await share({ kind: 'event', text: 'Pickup at 3:15 pm' });
  assert.equal(noDate.json.summary, 'Check the event: Pickup at 3:15 PM, no date found');
  assert.equal(noDate.json.link, 'https://kinwall.example/#/calendar?draft=event&title=Pickup&time=15%3A15');
  assert.equal((await share({ kind: 'event' })).status, 400);
  // The rest worth knowing rides along as notes, in the event and the link to check it.
  const rsvp = await share({ kind: 'event', text: 'Title: Swim party\nDate: 2027-05-08\n---\nSwim party\nBring a towel\nRSVP to Sam 555-0100' });
  assert.equal(rsvp.json.event.notes, 'Bring a towel\nRSVP to Sam 555-0100');
  assert.equal(new URLSearchParams(rsvp.json.link.split('?')[1]).get('notes'), 'Bring a towel\nRSVP to Sam 555-0100');
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
    assert.match(res.json.summary, /Meals is turned off in Settings → General → Features/);
  }
  const book = await share({ kind: 'book', text: '9780547928227' });
  assert.equal(book.status, 403);
  assert.match(book.json.error, /Reading is turned off/);
  assert.equal((await share({ kind: 'event', text: 'Title: Swim' })).status, 200, 'the calendar has no switch');
});

test('share: save adds the event to the chosen calendar in the household timezone; edited fields win', async () => {
  const { share, call, db } = fixture();
  await call('PATCH', '/api/settings', { timezone: 'America/New_York' });
  const family = (await call('POST', '/api/calendars', { kind: 'local', name: 'Family' })).json;
  const text = 'Title: Spring fair\nDate: 2027-05-08\nTime: 10 AM - 2 PM\nPlace: Lincoln Elementary';
  const res = await share({ kind: 'event', text, save: true, calendarId: family.id });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const row = await db.prepare('SELECT * FROM events').first<any>();
  assert.deepEqual([row.calendar_id, row.title, row.start, row.end, row.all_day, row.location], [family.id, 'Spring fair', '2027-05-08T14:00:00.000Z', '2027-05-08T18:00:00.000Z', 0, 'Lincoln Elementary']);
  assert.deepEqual(res.json, { kind: 'event', review: false, summary: 'Added Spring fair to Family, Sat May 8', link: `https://kinwall.example/#/calendar?event=${row.id}&at=2027-05-08T14%3A00%3A00.000Z` });

  // What the person fixed in the sheet goes instead of the text; no time is all day.
  const edited = await share({ kind: 'event', text, save: true, calendarId: family.id, event: { title: 'Spring Fair', date: '2027-05-09', time: null, end: null, place: 'Lincoln Elementary, 1 School St' } });
  assert.equal(edited.json.summary, 'Added Spring Fair to Family, Sun May 9');
  const day = await db.prepare("SELECT * FROM events WHERE title = 'Spring Fair'").first<any>();
  assert.deepEqual([day.start, day.end, day.all_day, day.location], ['2027-05-09', '2027-05-10', 1, 'Lincoln Elementary, 1 School St']);
  // A start with no end is an hour; an end before the start is after midnight.
  await share({ kind: 'event', save: true, calendarId: family.id, event: { title: 'Late show', date: '2027-05-08', time: '22:00', end: '01:00' } });
  const late = await db.prepare("SELECT * FROM events WHERE title = 'Late show'").first<any>();
  assert.deepEqual([late.start, late.end], ['2027-05-09T02:00:00.000Z', '2027-05-09T05:00:00.000Z']);

  // Notes are saved as the event's notes (its description); the checked ones win.
  await share({ kind: 'event', save: true, calendarId: family.id, text: 'Title: Swim party\nDate: 2027-05-08\n---\nSwim party\nBring a towel' });
  assert.equal((await db.prepare("SELECT description FROM events WHERE title = 'Swim party'").first<any>()).description, 'Bring a towel');
  await share({ kind: 'event', save: true, calendarId: family.id, event: { title: 'Pool day', date: '2027-05-08', notes: ' Bring goggles ' } });
  assert.equal((await db.prepare("SELECT description FROM events WHERE title = 'Pool day'").first<any>()).description, 'Bring goggles');
  await db.prepare("DELETE FROM events WHERE title IN ('Swim party', 'Pool day')").run();

  // Without save, nothing is added even with a calendar.
  assert.equal((await share({ kind: 'event', text, calendarId: family.id })).json.review, true);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())?.n, 3);
});

test('share: save needs a writable calendar, a title and a date', async () => {
  const { share, call, db } = fixture();
  const school = (await call('POST', '/api/calendars', { kind: 'ics', name: 'School', url: 'https://school.example/cal.ics' })).json;
  const text = 'Title: Swim\nDate: 2027-05-08';
  assert.equal((await share({ kind: 'event', text, save: true })).status, 400, 'no writable calendar to default to');
  const family = (await call('POST', '/api/calendars', { kind: 'local', name: 'Family' })).json;
  assert.equal((await share({ kind: 'event', text, save: true, calendarId: 'nope' })).status, 400);
  assert.ok(school.id, JSON.stringify(school));
  assert.equal((await share({ kind: 'event', text, save: true, calendarId: school.id })).status, 400, 'read-only');
  assert.match((await share({ kind: 'event', text: 'Title: Swim', save: true, calendarId: family.id })).json.summary, /date/);
  assert.match((await share({ kind: 'event', save: true, calendarId: family.id, event: { title: ' ', date: '2027-05-08' } })).json.summary, /title/);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())?.n, 0);
});

test("share: a wall screen or a kid's device can't save an event", async () => {
  const { share, call, db } = fixture();
  const family = (await call('POST', '/api/calendars', { kind: 'local', name: 'Family' })).json;
  const leo = (await call('POST', '/api/members', { name: 'Leo', color: '#7AB8FF', grownUp: false })).json;
  const wall = (await call('POST', '/api/keys', { name: 'Wall', scope: 'display' })).json;
  const kid = (await call('POST', '/api/keys', { name: "Leo's tablet", scope: 'display' })).json;
  assert.equal((await call('PATCH', `/api/keys/${kid.id}`, { kind: 'kid', owner: leo.id })).status, 200);
  for (const key of [wall.key, kid.key]) {
    assert.equal((await share({ kind: 'event', text: 'Title: Swim\nDate: 2027-05-08', save: true, calendarId: family.id }, key)).status, 403);
  }
  assert.equal((await db.prepare('SELECT count(*) AS n FROM events').first<{ n: number }>())?.n, 0);
});

// preview: true answers with what would be saved (review: true) and saves nothing; the same share
// without preview saves it. The phones' share sheets show it before Add to Kinwall.
const count = async (db: ReturnType<typeof fixture>['db'], table: string) => (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())!.n;

test('share preview: a recipe link shows what would be saved; the save with its token reads the page once', async () => {
  const { share, db, fetched } = fixture();
  const res = await share({ url: 'https://food.example/tacos', preview: true });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const { token, ...preview } = res.json.preview;
  assert.match(token, /^[\w-]{20,}$/);
  assert.deepEqual({ ...res.json, preview }, {
    kind: 'recipe', review: true, summary: 'Ready to add: Fish tacos', link: 'https://kinwall.example/#/meals',
    preview: {
      title: 'Fish tacos', imageUrl: 'https://food.example/tacos.jpg', exists: false, already: null,
      lines: ['Serves 4', '3 ingredients, 2 steps', 'Ready in 1 hr 15 min', 'From food.example'],
      recipe: { servings: 4, ingredients: 3, steps: 2, totalMinutes: 75, site: 'food.example' },
    },
  });
  assert.equal(await count(db, 'recipes'), 0, 'nothing saved');
  const saved = await share({ url: 'https://food.example/tacos', token });
  assert.deepEqual([saved.json.summary, saved.json.review], ['Imported Fish tacos', false]);
  assert.deepEqual(fetched, ['https://food.example/tacos'], 'the save used what the preview read');
  // A token is used once; and one for another link isn't used.
  await share({ url: 'https://food.example/tacos', token });
  await share({ url: 'https://food.example/lemon-chicken', token: (await share({ url: 'https://food.example/tacos', preview: true })).json.preview.token });
  assert.equal(fetched.length, 4);

  const again = (await share({ url: 'https://food.example/tacos', preview: true })).json;
  assert.equal(again.preview.exists, true);
  assert.equal(again.preview.already, 'Already in Kinwall: adding it again updates it.');
  assert.match(again.link, /#\/meals\?recipe=[\w-]+$/);
});

test('share preview: a restaurant says what is new to a menu already in the binder; nothing is saved', async () => {
  const { share, call, db } = fixture();
  const page = await share({ url: 'https://cornerslice.example/', preview: true });
  assert.equal(page.status, 200, JSON.stringify(page.json));
  assert.deepEqual([page.json.kind, page.json.review, page.json.preview.title, page.json.preview.exists], ['restaurant', true, 'Corner Slice', false]);
  assert.deepEqual(page.json.preview.lines, ['Pizza', '555-0100']);
  assert.equal(await count(db, 'restaurants'), 0);
  assert.equal((await share({ url: 'https://cornerslice.example/', token: page.json.preview.token })).json.summary, 'Added Corner Slice to the binder');

  const menu = 'Name: Corner Slice\nAddress: 1 Main St\nMenu:\nPizza\nCheese 12\nPepperoni 14\nSalads\nCaesar 9';
  const first = (await share({ kind: 'restaurant', text: menu, preview: true })).json.preview;
  assert.deepEqual(first.restaurant, { cuisine: 'Pizza', phone: '555-0100', address: '1 Main St', items: 3, sections: 2, added: 3, alreadyThere: 0 });
  assert.deepEqual(first.lines, ['Pizza', '555-0100', '1 Main St', '3 menu items in 2 sections']);
  assert.equal(first.already, 'Already in Kinwall: 3 new items will be added.');
  assert.equal(first.token, null, 'text is sent again with the save');
  await share({ kind: 'restaurant', text: menu });
  const more = (await share({ kind: 'restaurant', text: `${menu}\nGreek 10`, preview: true })).json;
  assert.equal(more.preview.already, 'Already in Kinwall: 1 new item will be added, 3 are already there.');
  assert.match(more.link, /#\/meals\?restaurant=[\w-]+$/);
  assert.equal((await share({ kind: 'restaurant', text: menu, preview: true })).json.preview.already, 'Already in Kinwall and up to date.');
  assert.equal((await call('GET', '/api/restaurants')).json[0].menu.length, 3, 'previews add nothing');
});

test('share preview: a book shows its cover, author and shelf; one already there says so; unclear titles are picked as before', async () => {
  const { share, call } = fixture();
  openLibrary([{ ...HOBBIT, cover_i: 42, number_of_pages_median: 300, subject: ['Fantasy', 'Juvenile fiction'] }]);
  const res = await share({ kind: 'book', text: '9780547928227', preview: true });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual({ ...res.json.preview, token: undefined }, {
    title: 'The Hobbit', imageUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg', exists: false, already: null, token: undefined,
    lines: ['By J.R.R. Tolkien', 'Book', 'Shelf: Kids (Auto)'],
    book: { author: 'J.R.R. Tolkien', format: 'book', shelf: 'kids' },
  });
  assert.equal(res.json.review, true);
  assert.equal((await call('GET', '/api/library')).json.length, 0, 'nothing added');
  await share({ kind: 'book', text: '9780547928227' });
  const again = (await share({ kind: 'book', text: '9780547928227', preview: true })).json;
  assert.deepEqual([again.preview.exists, again.preview.already], [true, 'Already in the library.']);
  assert.match(again.link, /#\/trackers\/library\?book=[\w-]+$/);

  openLibrary([{ key: '/works/OL3W', title: 'Holes', author_name: ['Louis Sachar'] }, { key: '/works/OL4W', title: 'Holes', author_name: ['Someone Else'] }]);
  const pick = (await share({ kind: 'book', text: 'Holes', preview: true })).json;
  assert.deepEqual([pick.review, pick.summary, pick.preview], [true, 'Pick the right book: Holes', undefined]);
});

test("share preview: parent devices only; an event's answer is the same with or without it", async () => {
  const { share, call } = fixture();
  const wall = (await call('POST', '/api/keys', { name: 'Wall', scope: 'display' })).json;
  assert.equal((await share({ url: 'https://food.example/tacos', preview: true }, wall.key)).status, 403);
  const text = 'Title: Spring fair\nDate: 2027-05-08';
  assert.deepEqual((await share({ kind: 'event', text, preview: true })).json, (await share({ kind: 'event', text })).json);
  // Shortcuts sends a switch as text.
  assert.equal((await share({ url: 'https://food.example/tacos', preview: 'true' })).json.review, true);
});

test("share preview: a menu photo's QR code links show on their own lines, and only a clear one is saved", async () => {
  const { share, call } = fixture();
  const menu = 'Name: Golden Bowl\nMenu:\nNoodles\nPad thai 12.50';
  const order = (await share({ kind: 'restaurant', text: `Order online: https://order.golden.example/start\nMenu link: https://golden.example/menu.pdf\n${menu}`, preview: true })).json.preview;
  assert.deepEqual(order.lines, ['Order online: order.golden.example/start', 'Menu link: golden.example/menu.pdf', '1 menu item']);
  const unsure = (await share({ kind: 'restaurant', text: `QR code: https://golden.example/x?ref=flyer-2026-fall-promotion-code\n${menu}`, preview: true })).json.preview;
  assert.deepEqual(unsure.lines, ["Found a QR code: golden.example/x?ref=flyer-2026-fall-pr…, not sure what it's for", '1 menu item']);
  // Not a web link: nothing to show or save.
  assert.deepEqual((await share({ kind: 'restaurant', text: `Order online: javascript:alert(1)\n${menu}`, preview: true })).json.preview.lines, ['1 menu item']);

  await share({ kind: 'restaurant', text: `QR code: https://golden.example/x\n${menu}` });
  let [place] = (await call('GET', '/api/restaurants')).json;
  assert.deepEqual([place.orderUrl, place.menuUrl, place.website], [null, null, null], 'a QR code nothing said the purpose of is never saved');
  await share({ kind: 'restaurant', text: `Order online: https://order.golden.example/start\n${menu}` });
  [place] = (await call('GET', '/api/restaurants')).json;
  assert.equal(place.orderUrl, 'https://order.golden.example/start');
  await share({ kind: 'restaurant', text: `Order online: https://other.example/\n${menu}` });
  assert.equal((await call('GET', '/api/restaurants')).json[0].orderUrl, 'https://order.golden.example/start', 'filled only when empty');
});
