// Outings from what's shared (outing-import.ts, share-text.ts parseOutingText, POST /api/share kind
// outing): a page's schema.org Event or place to visit, a flyer's cost, ticket dates and ages, and the
// share route's preview, save and "same name on the same day fills only what's empty".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { outingFromHtml, outingFromText, wallClock } from '../src/outing-import.ts';
import { parseEventText, parseOutingText } from '../src/share-text.ts';

const ld = (block: unknown) => `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify(block)}</script></head><body>Hi</body></html>`;
const TZ = 'America/New_York';
const Y = new Date().getUTCFullYear() + 1; // always ahead, so "on sale" dates are still to come

test('outing-import: a JSON-LD MusicEvent becomes an outing with price, tickets and ages', () => {
  const o = outingFromHtml(ld({
    '@context': 'https://schema.org', '@type': 'MusicEvent', name: 'Maple Grove Summer Concert', startDate: `${Y}-07-11T18:30:00-04:00`, endDate: `${Y}-07-11T20:30:00-04:00`,
    location: { '@type': 'Place', name: 'Maple Grove Common', address: { '@type': 'PostalAddress', streetAddress: '1 Green St', addressLocality: 'Maple Grove', addressRegion: 'ST', postalCode: '00000' } },
    offers: [{ '@type': 'Offer', price: '15.00', url: 'https://tickets.example/concert', validFrom: `${Y}-06-01T10:00:00-04:00`, validThrough: `${Y}-07-10` }, { '@type': 'Offer', price: 8 }],
    typicalAgeRange: '7-10', description: 'Bring a blanket.',
  }), 'https://events.example/concert', TZ, `${Y}-01-01`)!;
  assert.equal(o.kind, 'upcoming');
  assert.equal(o.title, 'Maple Grove Summer Concert');
  assert.equal(o.categoryId, 'oc-music');
  assert.deepEqual([o.startsOn, o.endsOn, o.startTime, o.endTime], [`${Y}-07-11`, null, '18:30', '20:30']);
  assert.deepEqual([o.placeName, o.address], ['Maple Grove Common', '1 Green St, Maple Grove, ST 00000']);
  assert.equal(o.priceCents, 800);
  assert.equal(o.ticketsUrl, 'https://tickets.example/concert');
  assert.equal(o.ticketsOnSaleAt, `${Y}-06-01T14:00:00.000Z`);
  assert.equal(o.buyBy, `${Y}-07-10`);
  assert.deepEqual([o.ageMin, o.ageMax, o.audience], [7, 10, ['kids']]);
  assert.equal(o.url, 'https://events.example/concert');
  assert.equal(o.notes, 'Bring a blanket.');
});

test('outing-import: a festival over days is a run; free; a past on-sale date is left out; UTC times move home', () => {
  const o = outingFromHtml(ld({ '@graph': [{ '@type': 'Organization', name: 'Town' }, { '@type': 'Festival', name: 'Harvest Fair', startDate: `${Y}-10-03`, endDate: `${Y}-10-05`, isAccessibleForFree: true, offers: { price: 0, validFrom: '2000-01-01' } }] }), 'https://fair.example/', TZ, `${Y}-01-01`)!;
  assert.deepEqual([o.startsOn, o.endsOn, o.startTime, o.priceCents, o.ticketsOnSaleAt, o.categoryId], [`${Y}-10-03`, `${Y}-10-05`, null, 0, null, 'oc-fairs']);
  assert.deepEqual(wallClock('2026-10-10T16:00:00Z', TZ), { date: '2026-10-10', time: '12:00' });
  assert.deepEqual(wallClock('2026-10-10T16:00:00+02:00', TZ), { date: '2026-10-10', time: '16:00' });
  // "21+" is for grown-ups.
  assert.deepEqual(outingFromHtml(ld({ '@type': 'ComedyEvent', name: 'Late show', startDate: `${Y}-03-01T21:00`, typicalAgeRange: '21+' }), 'https://x.example/', TZ, `${Y}-01-01`)!.audience, ['grownups']);
});

test('outing-import: a park or museum is a place to visit; other pages are not outings', () => {
  const p = outingFromHtml(ld({ '@type': ['Museum', 'TouristAttraction'], name: 'Maple Grove Science Museum', address: '5 Oak Ave, Maple Grove', url: 'https://museum.example/' }), 'https://museum.example/visit', TZ, `${Y}-01-01`)!;
  assert.deepEqual([p.kind, p.title, p.address, p.categoryId, p.url, p.startsOn], ['place', 'Maple Grove Science Museum', '5 Oak Ave, Maple Grove', 'oc-art', 'https://museum.example/', null]);
  assert.equal(outingFromHtml(ld({ '@type': 'Park', name: 'Lakeside Park', isAccessibleForFree: true }), 'https://p.example/', TZ, `${Y}-01-01`)!.priceCents, 0);
  assert.equal(outingFromHtml(ld({ '@type': 'Recipe', name: 'Soup' }), 'https://r.example/', TZ, `${Y}-01-01`), null);
  assert.equal(outingFromHtml('<html>nothing</html>', 'https://r.example/', TZ, `${Y}-01-01`), null);
});

test('share-text: a flyer\'s cost, ticket dates, ages and run', () => {
  const t = parseOutingText([
    'Maple Grove Fall Fest',
    'Saturday, October 17 10am - 2pm',
    'at Maple Grove Common',
    'Tickets on sale October 1 at 10am',
    'Adults $15, kids $5. Ages 7–10 craft tent.',
  ].join('\n'), '2026-09-01');
  assert.equal(t.title, 'Maple Grove Fall Fest');
  assert.equal(t.date, '2026-10-17', 'the ticket line is not the date');
  assert.deepEqual([t.time, t.end], ['10:00', '14:00']);
  assert.equal(t.priceCents, 500);
  assert.deepEqual(t.onSale, { date: '2026-10-01', time: '10:00' });
  assert.deepEqual([t.ageMin, t.ageMax], [7, 10]);
  assert.equal(outingFromText(t, TZ).ticketsOnSaleAt, '2026-10-01T14:00:00.000Z');
  assert.deepEqual(outingFromText(t, TZ).audience, ['kids']);

  const free = parseOutingText('Story time in the park\nSaturday Oct 10, 10am\nFree! Register by Oct 8.\nGluten-free snacks', '2026-09-01');
  assert.deepEqual([free.priceCents, free.buyBy, free.date], [0, '2026-10-08', '2026-10-10']);
  assert.equal(parseOutingText('Bake sale\nOct 10 9am\nGluten-free treats', '2026-09-01').priceCents, null);
  assert.equal(parseOutingText('Used book sale\nBooks on sale Oct 10 9am', '2026-09-01').date, '2026-10-10', 'a book sale is not a ticket line');

  const run = parseOutingText('Pumpkin Patch\nOct 3–5, 9am to 5pm', '2026-09-01');
  assert.deepEqual([run.date, run.endsOn], ['2026-10-03', '2026-10-05']);
  assert.equal(parseOutingText('Corn maze\nOpen Sept 20 through Oct 31', '2026-09-01').endsOn, '2026-10-31');
  assert.equal(parseOutingText('Trivia night\nOct 9 at 8pm\n21+', '2026-09-01').grownUps, true);
});

test('share-text: the model\'s Cost, Ends, Tickets and Ages lines', () => {
  const text = ['Title: Lantern Walk', 'Date: Friday, October 30, 2026', 'Time: 6:00 PM - 8:00 PM', 'Place: Maple Grove Arboretum', 'Cost: Adults $12, kids free', 'Ends: Sunday, November 1, 2026', 'Tickets: On sale Monday, October 5, 2026 at 9 AM', 'Ages: 5-12', '---', 'LANTERN WALK', 'Oct 30 - Nov 1', 'Tickets on sale Oct 5'].join('\n');
  const t = parseOutingText(text, '2026-09-01');
  assert.deepEqual([t.title, t.date, t.time, t.end, t.endsOn], ['Lantern Walk', '2026-10-30', '18:00', '20:00', '2026-11-01']);
  assert.deepEqual([t.priceCents, t.priceNote], [1200, 'Adults $12, kids free']);
  assert.deepEqual(t.onSale, { date: '2026-10-05', time: '09:00' });
  assert.deepEqual([t.ageMin, t.ageMax], [5, 12]);
  // The calendar's event reading ignores those lines for its date.
  assert.equal(parseEventText('Fall Fest\nTickets: on sale Oct 1\nDate: Oct 17', '2026-09-01').date, '2026-10-17');
  assert.equal(parseEventText('Cost: $5\nFall Fest Oct 17 10am', '2026-09-01').title, 'Fall Fest');
  // "Register by" in a Tickets line is the buy-by date.
  assert.equal(parseOutingText('Title: Swim lessons\nDate: Oct 20\nTickets: Register by October 12', '2026-09-01').buyBy, '2026-10-12');
});

// --- POST /api/share kind outing -------------------------------------------------------------------

const PAGES: Record<string, string> = {
  'https://events.example/lantern': ld({ '@type': 'Event', name: 'Lantern Walk', startDate: `${Y}-10-30T18:00:00-04:00`, endDate: `${Y}-10-30T20:00:00-04:00`, location: { '@type': 'Place', name: 'Maple Grove Arboretum' }, offers: { price: '12', url: 'https://tickets.example/lantern' } }),
  'https://park.example/': ld({ '@type': 'Park', name: 'Lakeside Park', address: { streetAddress: '9 Lake Rd', addressLocality: 'Maple Grove' } }),
  'https://brewery.example/trivia': ld([{ '@type': 'Brewery', name: 'Maple Grove Brewing', telephone: '555-0100' }, { '@type': 'Event', name: 'Trivia night', startDate: `${Y}-11-02T19:00` }]),
};
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
  return { db, call, share: (body: unknown) => call('POST', '/api/share', body), fetched };
}

test('share: an event link is an outing to check first, then saved from the page read once', async () => {
  const { share, call, fetched } = fixture();
  const shown = await share({ url: 'https://events.example/lantern', preview: true });
  assert.equal(shown.status, 200, JSON.stringify(shown.json));
  assert.equal(shown.json.kind, 'outing');
  assert.equal(shown.json.review, true);
  assert.equal(shown.json.preview.title, 'Lantern Walk');
  assert.ok(shown.json.preview.lines.includes('From $12'), shown.json.preview.lines.join(' | '));
  assert.ok(shown.json.preview.lines.some((l: string) => l.startsWith('Tickets: tickets.example')));
  assert.equal(shown.json.preview.outing.startsOn, `${Y}-10-30`);
  assert.equal((await call('GET', '/api/outings')).json.length, 0, 'nothing saved by a preview');
  const saved = await share({ url: 'https://events.example/lantern', token: shown.json.preview.token });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.summary, 'Added Lantern Walk to Outings');
  assert.deepEqual(fetched, ['https://events.example/lantern'], 'read once');
  const [o] = (await call('GET', '/api/outings')).json;
  assert.deepEqual([o.title, o.startTime, o.endTime, o.placeName, o.priceCents, o.ticketsUrl, o.source], ['Lantern Walk', '18:00', '20:00', 'Maple Grove Arboretum', 1200, 'https://tickets.example/lantern', 'share']);
  assert.equal(saved.json.link, `https://kinwall.example/#/outings?outing=${o.id}`);

  // The same name on the same day fills only what's empty, never a second one.
  await call('PATCH', `/api/outings/${o.id}`, { placeName: 'The arboretum gate', priceCents: null });
  const again = await share({ kind: 'outing', text: `Lantern Walk\nOctober 30, ${Y} 6pm\nat Somewhere Else Park\n$9` , preview: true });
  assert.equal(again.json.preview.exists, true);
  assert.equal(again.json.preview.already, 'Already in Outings: its price and notes will be filled in.');
  await share({ kind: 'outing', text: `Lantern Walk\nOctober 30, ${Y} 6pm\nat Somewhere Else Park\n$9` });
  const list = (await call('GET', '/api/outings')).json;
  assert.equal(list.length, 1);
  assert.deepEqual([list[0].placeName, list[0].priceCents], ['The arboretum gate', 900]);
});

test('share: a park link is a place to visit; a restaurant page stays a restaurant; Outings off keeps old routing', async () => {
  const { share, call } = fixture();
  const park = await share({ url: 'https://park.example/', preview: true });
  assert.equal(park.json.kind, 'outing');
  assert.equal(park.json.preview.lines[0], 'Place to visit, any time');
  assert.equal((await share({ url: 'https://brewery.example/trivia', preview: true })).json.kind, 'restaurant');
  const { features } = (await call('GET', '/api/settings')).json;
  await call('PATCH', '/api/settings', { features: { ...features, outings: false } });
  assert.equal((await share({ url: 'https://events.example/lantern' })).status, 400, 'no event routing while Outings is off');
  assert.equal((await share({ kind: 'outing', text: 'Fair Oct 3' })).status, 403);
});

test('share: Save to Outings from the event sheet, and a Maps place as a place to visit', async () => {
  const { share, call } = fixture();
  // The phone's checked event wins; the flyer's words still give the cost, tickets and ages.
  const res = await share({ kind: 'outing', event: { title: 'Fall Fest', date: `${Y}-10-17`, time: '11:00', end: null, place: 'Maple Grove Common', notes: 'Bring cash' }, text: 'FALL FEST\nOct 16 10am\n$5 entry\nAges 3-12' });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const [o] = (await call('GET', '/api/outings')).json;
  assert.deepEqual([o.title, o.startsOn, o.startTime, o.endTime, o.placeName, o.priceCents, o.ageMin, o.ageMax, o.notes], ['Fall Fest', `${Y}-10-17`, '11:00', null, 'Maple Grove Common', 500, 3, 12, 'Bring cash']);
  // The web sheet sends the outing itself.
  assert.equal((await share({ kind: 'outing', outing: { title: 'Corn maze', startsOn: `${Y}-09-20`, endsOn: `${Y}-10-31`, priceCents: 0 } })).json.summary, 'Added Corn maze to Outings');
  // A Maps place: a place to visit with its map link and address.
  const maps = 'https://maps.apple.com/?name=Lakeside%20Beach&address=9%20Lake%20Rd';
  const place = await share({ kind: 'outing', url: maps, preview: true });
  assert.equal(place.json.preview.title, 'Lakeside Beach');
  await share({ kind: 'outing', url: maps });
  const beach = (await call('GET', '/api/outings?kind=place')).json[0];
  assert.deepEqual([beach.title, beach.kind, beach.address, beach.url], ['Lakeside Beach', 'place', '9 Lake Rd', maps]);
  // Older apps: a Maps place with no kind is still a restaurant.
  assert.equal((await share({ url: maps, preview: true })).json.kind, 'restaurant');
});

test('share: an event to check carries the flyer\'s cost, tickets and ages for Save to Outings', async () => {
  const { share } = fixture();
  const res = await share({ kind: 'event', text: `Fall Fest\nOctober 17, ${Y} 10am\n$15 at the gate\nRegister by October 10, ${Y}\nAges 5-12` });
  const q = new URLSearchParams(res.json.link.split('?')[1]);
  assert.deepEqual([q.get('cost'), q.get('buyBy'), q.get('ageMin'), q.get('ageMax'), q.get('date')], ['1500', `${Y}-10-10`, '5', '12', `${Y}-10-17`]);
  assert.deepEqual(Object.keys(res.json.event).sort(), ['date', 'end', 'notes', 'place', 'time', 'title'], 'the event itself is unchanged for the apps');
});
