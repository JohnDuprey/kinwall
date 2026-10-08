import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { createApiKey } from '../src/auth.ts';
import { mapsPlace, parsePrice, parseRestaurantHtml, splitMenuHeader } from '../src/restaurant-import.ts';
import type { Env } from '../src/env.ts';

const ld = (...blocks: unknown[]) => `<!doctype html><html><head>${blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join('')}</head><body>Menu</body></html>`;
const CORNER = {
  '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', name: 'Corner Slice | Home', url: 'https://cornerslice.example/' },
    { '@type': ['Restaurant', 'LocalBusiness'], name: 'Corner Slice &amp; Co', telephone: '+1 555-0100', servesCuisine: ['Pizza', 'Italian'], url: 'https://cornerslice.example/',
      address: { '@type': 'PostalAddress', streetAddress: '12 Elm St', addressLocality: 'Springfield', addressRegion: 'IL', postalCode: '62701' },
      hasMenu: { '@type': 'Menu', url: '/menu' } },
  ],
};

function fixture(pages: Record<string, string> = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const fetched: string[] = [];
  const OUTBOUND_FETCH = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input); fetched.push(url);
    return pages[url] ? new Response(pages[url], { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('nope', { status: 404 });
  };
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', OUTBOUND_FETCH };
  const app = createApp();
  const post = async (path: string, body: unknown, key = 'test-admin'): Promise<{ status: number; json: any }> => {
    const res = await app.request(path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    return { status: res.status, json: await res.json() };
  };
  return { db, post, fetched };
}

test('restaurant page: schema.org Restaurant JSON-LD gives name, phone, address, cuisine, website and menu link', () => {
  assert.deepEqual(parseRestaurantHtml(ld(CORNER), 'https://cornerslice.example/'), {
    name: 'Corner Slice & Co', cuisine: 'Pizza, Italian', phone: '+1 555-0100', address: '12 Elm St, Springfield, IL 62701',
    website: 'https://cornerslice.example/', menuUrl: 'https://cornerslice.example/menu',
  });
  // A plain LocalBusiness with a text address and a menu URL string; a page with none gives nothing.
  assert.deepEqual(parseRestaurantHtml(ld({ '@type': 'LocalBusiness', name: 'Golden Bowl', address: '9 Oak Ave', hasMenu: 'https://golden.example/menu.pdf' }), 'https://golden.example/'),
    { name: 'Golden Bowl', cuisine: null, phone: null, address: '9 Oak Ave', website: null, menuUrl: 'https://golden.example/menu.pdf' });
  assert.equal(parseRestaurantHtml(ld({ '@type': 'Recipe', name: 'Chili' }), 'https://x.example/'), null);
  assert.equal(parseRestaurantHtml('<html>no data</html>', 'https://x.example/'), null);
});

test('restaurant import: Apple Maps links give the place name and address without a fetch', () => {
  assert.deepEqual(mapsPlace('https://maps.apple.com/place?address=12%20Elm%20St,%20Springfield&coordinate=1,2&name=Corner%20Slice&place-id=abc'), { name: 'Corner Slice', address: '12 Elm St, Springfield' });
  assert.deepEqual(mapsPlace('https://maps.apple.com/?q=Golden+Bowl&ll=1,2'), { name: 'Golden Bowl', address: null });
  assert.deepEqual(mapsPlace('https://maps.apple/p/AbCdEf'), { name: null, address: null });
  assert.equal(mapsPlace('https://cornerslice.example/?q=pizza'), null);
  // Google Maps: the place's name from /maps/place/, else q= as "Name, address"; short links carry nothing.
  assert.deepEqual(mapsPlace('https://www.google.com/maps/place/Corner+Slice/@1.2,3.4,17z/data=!3m1'), { name: 'Corner Slice', address: null });
  assert.deepEqual(mapsPlace('https://maps.google.com/?q=Golden%20Bowl,%2012%20Elm%20St,%20Springfield&ftid=0x1'), { name: 'Golden Bowl', address: '12 Elm St, Springfield' });
  assert.deepEqual(mapsPlace('https://maps.google.com/?q=41.9,-70.6'), { name: null, address: null });
  assert.deepEqual(mapsPlace('https://maps.app.goo.gl/AbCdEf'), { name: null, address: null });
  assert.deepEqual(mapsPlace('https://goo.gl/maps/AbCdEf'), { name: null, address: null });
  assert.equal(mapsPlace('https://www.google.com/search?q=pizza'), null);
});

test('restaurant import: prices are lenient and AI header lines become fields', () => {
  assert.deepEqual(['$12.99', '12.99', '12', 12.5, ' $ 3,25 ', 'market', '', null].map(parsePrice), [1299, 1299, 1200, 1250, 325, null, null, null]);
  assert.deepEqual(splitMenuHeader('Name: Corner Slice\nCuisine: Pizza\nPhone: unknown\nWebsite: cornerslice.example\nMenu:\nPizza\nCheese 12'), {
    fields: { name: 'Corner Slice', cuisine: 'Pizza', website: 'cornerslice.example' }, menuText: 'Pizza\nCheese 12',
  });
  // Plain photo text has no header.
  assert.deepEqual(splitMenuHeader('Pizza\nCheese 12'), { fields: {}, menuText: 'Pizza\nCheese 12' });
  // Several photos: each page may start with header lines (a model tidied them page by page); the
  // first page's win and the rest are filled from later pages only when empty.
  assert.deepEqual(splitMenuHeader('Name: Corner Slice\nMenu:\nPizza\nCheese 12\n--- Page 2 ---\nName: Corner Slice Pizzeria\nPhone: 555-0100\nMenu:\nSides\nFries 3'), {
    fields: { name: 'Corner Slice', phone: '555-0100' }, menuText: 'Pizza\nCheese 12\n--- Page 2 ---\nSides\nFries 3',
  });
});

test('restaurant import: creates a place, then matches it by name, fills only empty fields and appends new items', async () => {
  const { post } = fixture();
  const first = await post('/api/restaurants/import', { name: 'Corner Slice', phone: '555-0100', menuText: 'Pizza\nCheese $12.99\nPepperoni 14' });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.created, true);
  assert.equal(first.json.summary, 'Added Corner Slice with 2 menu items');
  const id = first.json.restaurant.id;
  const cheese = first.json.restaurant.menu[0];
  const second = await post('/api/restaurants/import', {
    name: 'corner  slice!', phone: '999-9999', cuisine: 'Pizza', website: 'cornerslice.example',
    menu: [{ section: 'Pizza', name: 'cheese', price: '$99' }, { section: 'Pizza', name: 'Veggie', price: '15' }, { section: 'Sides', name: 'Garlic knots', price: 5.5 }, { section: 'Sides', name: 'Garlic knots' }],
  });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.created, false);
  assert.equal(second.json.restaurant.id, id);
  assert.equal(second.json.restaurant.name, 'Corner Slice');
  assert.equal(second.json.restaurant.phone, '555-0100'); // never overwritten
  assert.equal(second.json.restaurant.cuisine, 'Pizza');
  assert.equal(second.json.restaurant.website, 'https://cornerslice.example/');
  assert.deepEqual(second.json.filled, ['cuisine', 'website']);
  assert.deepEqual([second.json.added, second.json.skipped], [2, 2]);
  assert.equal(second.json.summary, 'Added 2 items to Corner Slice (2 already there) and filled in cuisine and website');
  assert.deepEqual(second.json.restaurant.menu.map((i: any) => [i.section, i.name, i.priceCents]), [
    ['Pizza', 'Cheese', 1299], ['Pizza', 'Pepperoni', 1400], ['Pizza', 'Veggie', 1500], ['Sides', 'Garlic knots', 550],
  ]);
  assert.equal(second.json.restaurant.menu[0].id, cheese.id);
  // Nothing new: says so.
  const third = await post('/api/restaurants/import', { name: 'Corner Slice', menuText: 'Pizza\nCheese 1' });
  assert.equal(third.json.summary, 'Corner Slice is already up to date (1 already there)');
});

test('restaurant import: stars and parent edits survive an import', async () => {
  const { post, db } = fixture();
  const made = await post('/api/restaurants', { name: 'Golden Bowl', menu: [{ name: 'Lo mein', favorite: true, description: 'Ask for extra sauce' }] });
  const res = await post('/api/restaurants/import', { name: 'GOLDEN BOWL', menu: [{ name: 'Egg rolls', price: '4.50' }] });
  assert.deepEqual(res.json.restaurant.menu.map((i: any) => [i.id === made.json.menu[0].id, i.name, i.favorite, i.description]), [[true, 'Lo mein', true, 'Ask for extra sauce'], [false, 'Egg rolls', false, null]]);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM restaurants').first<{ n: number }>())!.n, 1);
});

test('restaurant import: a link fills details from the page; Maps links are read without a fetch; no name is a 400', async () => {
  const { post, fetched } = fixture({ 'https://cornerslice.example/': ld(CORNER) });
  const res = await post('/api/restaurants/import', { url: 'http://cornerslice.example/' });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.deepEqual([res.json.restaurant.name, res.json.restaurant.phone, res.json.restaurant.cuisine, res.json.restaurant.menuUrl], ['Corner Slice & Co', '+1 555-0100', 'Pizza, Italian', 'https://cornerslice.example/menu']);
  // The preview reads the same details and saves nothing.
  const preview = await post('/api/restaurants/details', { url: 'https://cornerslice.example/' });
  assert.equal(preview.json.details.phone, '+1 555-0100');
  // A page that fails is just nothing filled.
  const quiet = await post('/api/restaurants/import', { name: 'Golden Bowl', url: 'https://golden.example/' });
  assert.equal(quiet.status, 201);
  assert.equal(quiet.json.restaurant.website, 'https://golden.example/');
  const before = fetched.length;
  const maps = await post('/api/restaurants/import', { url: 'https://maps.apple.com/place?name=Taco%20Town&address=1%20Main%20St', phone: '555-0199' });
  assert.equal(maps.status, 201);
  assert.deepEqual([maps.json.restaurant.name, maps.json.restaurant.address, maps.json.restaurant.website], ['Taco Town', '1 Main St', null]);
  assert.equal(fetched.length, before);
  const none = await post('/api/restaurants/import', { url: 'https://maps.apple/p/xyz', menuText: 'Cheese 12' });
  assert.equal(none.status, 400);
  assert.match(none.json.error, /restaurant's name/);
  assert.equal((await post('/api/restaurants/import', {})).status, 400);
});

test('restaurant import: only parents can import or preview', async () => {
  const { db, post } = fixture();
  const wall = await createApiKey(db, 'Wall', 'display', { owner: 'shared' });
  assert.equal((await post('/api/restaurants/import', { name: 'X' }, wall.key)).status, 403);
  assert.equal((await post('/api/restaurants/details', { url: 'https://x.example/' }, wall.key)).status, 403);
});
