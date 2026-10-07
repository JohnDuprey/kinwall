// Library books' details from Open Library (book-details.ts, migration 0098): matched by ISBN or by
// title and author, only empty fields filled, each book looked up once (no match: again after a
// month), a few per tick for books from before. Open Library is always mocked here.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { BATCH, RETRY_MS, lookUpBook, lookUpSome, pickMatch } from '../src/book-details.ts';

const ADMIN = 'fc_test_admin_key';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { env, send };
}

const holesDoc = {
  key: '/works/OL5W', title: 'Holes', author_name: ['Louis Sachar'], first_publish_year: 1998, number_of_pages_median: 233, cover_i: 77,
  isbn: ['0440414806', '9780440414803'], lexile: [660], subject: ['Juvenile fiction', 'Humorous stories', 'Adventure stories'], ratings_average: 4.18, ratings_count: 210,
};
/** Open Library: search answers by q (searches[] records each q), works answer a description. */
function openLibrary(docs: (q: string) => object[]) {
  const searches: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === '/search.json') { const q = url.searchParams.get('q')!; searches.push(q); return Response.json({ docs: docs(q) }); }
    if (url.pathname.startsWith('/works/')) return Response.json({ description: 'Stanley Yelnats digs holes.' });
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  return searches;
}
const settle = () => new Promise((r) => setTimeout(r, 20)); // background lookups finish

test('pickMatch: by ISBN the answer; by title the same title and author, else nothing', () => {
  const holes = { title: 'Holes', author: 'Louis Sachar' };
  const results = [{ title: 'Holes', author: 'Somebody Else' }, { title: 'Holes (Holes, #1)', author: 'Sachar, Louis' }, { title: 'Holes', author: 'Louis Sachar' }];
  assert.equal(pickMatch(holes, results, false), results[1], 'the first that is the same book');
  assert.equal(pickMatch(holes, [{ title: 'Holes' }], false), undefined, 'no author to compare: not confident');
  assert.equal(pickMatch(holes, [{ title: 'Small Steps', author: 'Louis Sachar' }], false), undefined);
  assert.equal(pickMatch({ title: 'Holes', author: null }, [{ title: 'Holes Revisited' }, { title: 'Holes', author: 'Louis Sachar' }], false), undefined, 'no author: only the top result');
  assert.equal(pickMatch({ title: 'Holes', author: null }, [{ title: 'Holes', author: 'Louis Sachar' }], false)?.author, 'Louis Sachar');
  assert.equal(pickMatch(holes, [{ title: 'Anything' }], true)?.title, 'Anything', 'an ISBN is that book');
});

test('library details: fills only empty fields, never what a person set', async () => {
  const { env, send } = setup();
  openLibrary(() => []); // the add itself finds nothing
  const book = (await send('POST', '/api/library', { title: 'Holes', author: 'Louis Sachar', description: 'Our copy has a torn cover.', location: "Maya's room", genres: ['Mystery'] })).body;
  await settle();
  const searches = openLibrary((q) => (q.startsWith('Holes') ? [holesDoc] : []));
  const r = await send('POST', `/api/library/${book.id}/details`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(searches[0], 'Holes Louis Sachar');
  const b = r.body;
  assert.equal(b.description, 'Our copy has a torn cover.', 'kept');
  assert.deepEqual(b.genres, ['Mystery'], 'kept');
  assert.equal(b.location, "Maya's room");
  assert.deepEqual([b.year, b.pages, b.isbn, b.lexile, b.coverUrl, b.workKey, b.ratingsAverage, b.ratingsCount], [1998, 233, '9780440414803', 660, 'https://covers.openlibrary.org/b/id/77-M.jpg', '/works/OL5W', 4.2, 210]);
  assert.ok(b.lookedUpAt);

  // Another book can't take an ISBN that's already in the library (it's unique): left empty.
  const twin = (await send('POST', '/api/library', { title: 'Holes', author: 'Sachar', series: 'Camp Green Lake', seriesNumber: null })).body;
  const t = (await send('POST', `/api/library/${twin.id}/details`)).body;
  assert.equal(t.isbn, null);
  assert.equal(t.description, 'Stanley Yelnats digs holes.', 'an empty description is filled');
  assert.equal(t.series, 'Camp Green Lake');
});

test('library details: by ISBN first, then by title; a parent device only', async () => {
  const { env, send } = setup();
  const searches = openLibrary((q) => (q === 'Holes Louis Sachar' ? [holesDoc] : []));
  const book = (await send('POST', '/api/library', { title: 'Holes', author: 'Louis Sachar', isbn: '9781111111111' })).body; // an audiobook's ISBN Open Library doesn't have
  await settle();
  assert.deepEqual(searches, ['9781111111111', 'Holes Louis Sachar'], 'looked up in the background right after it was added');
  const got = (await send('GET', `/api/library/${book.id}`)).body;
  assert.equal(got.isbn, '9781111111111', 'its own ISBN stays');
  assert.equal(got.year, 1998);
  const wall = (await send('POST', '/api/keys', { name: 'Kitchen', scope: 'display' })).body.key;
  assert.equal((await send('POST', `/api/library/${book.id}/details`, undefined, wall)).status, 403);
  assert.equal(await lookUpBook(env.DB, 'nope'), 'gone');
});

test('library details: no match is recorded and not tried again for a month; a network failure is', async () => {
  const { env, send } = setup();
  globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  const book = (await send('POST', '/api/library', { title: 'Our Own Bedtime Stories', author: 'Sam' })).body;
  await settle();
  assert.equal((await send('GET', `/api/library/${book.id}`)).body.lookedUpAt, null, 'offline: nothing recorded, tried again');
  assert.equal((await send('POST', `/api/library/${book.id}/details`)).status, 502);

  const searches = openLibrary(() => []);
  assert.equal(await lookUpSome(env), 1);
  assert.equal(searches.length, 1);
  assert.ok((await send('GET', `/api/library/${book.id}`)).body.lookedUpAt, 'nothing found, and that is recorded');
  assert.equal(await lookUpSome(env), 0, 'not again tomorrow');
  assert.equal(await lookUpSome(env, 5, Date.now() + RETRY_MS + 60_000), 1, 'a month later it is tried again');
  assert.equal((await send('POST', `/api/library/${book.id}/details`)).status, 404, "a parent's lookup: Open Library doesn't know it");

  // A match isn't looked up again on its own, even with fields still empty (Open Library had no more).
  openLibrary(() => [{ key: '/works/OL9W', title: 'Our Own Bedtime Stories', author_name: ['Sam'] }]);
  assert.equal((await send('POST', `/api/library/${book.id}/details`)).status, 200);
  assert.equal(await lookUpSome(env, 5, Date.now() + 2 * RETRY_MS), 0);
});

test('library details: the backfill takes a few books per tick, never-looked-up first, and stops at the rate limit', async () => {
  const { env } = setup();
  const now = new Date().toISOString();
  for (let i = 0; i < BATCH + 2; i++) {
    await env.DB.prepare('INSERT INTO library_books (id, title, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(`b${i}`, `Book ${i}`, 'Alex', now, now).run();
  }
  // Already complete (a person typed it all in): never looked up.
  await env.DB.prepare("INSERT INTO library_books (id, title, author, isbn, year, description, genres, cover_url, created_at, updated_at) VALUES ('full', 'Full', 'Alex', '9780000000001', 2001, 'x', '[]', 'https://covers.example.com/x.jpg', ?, ?)").bind(now, now).run();
  const searches = openLibrary(() => []);
  assert.equal(await lookUpSome(env), BATCH);
  assert.equal(searches.length, BATCH);
  assert.equal(await lookUpSome(env), 2, 'the rest next tick');
  assert.ok(!searches.includes('Full Alex'));

  await env.DB.prepare("INSERT INTO rate_limits (key, count, window_start) VALUES ('books', 30, ?) ON CONFLICT(key) DO UPDATE SET count = 30, window_start = excluded.window_start").bind(new Date().toISOString()).run();
  await env.DB.prepare("UPDATE library_books SET looked_up_at = NULL WHERE id = 'b0'").run();
  searches.length = 0;
  await lookUpSome(env);
  assert.equal(searches.length, 0, 'the rate limit is spent: nothing called, nothing recorded');
  assert.equal((await env.DB.prepare("SELECT looked_up_at FROM library_books WHERE id = 'b0'").first<{ looked_up_at: string | null }>())!.looked_up_at, null);
});

test("library details: an audiobook made from a reading entry is looked up, without the print edition's ISBN or pages", async () => {
  const { send } = setup();
  openLibrary((q) => (q.startsWith('Holes') ? [holesDoc] : []));
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const entry = (await send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: 'Holes', data: { format: 'audiobook', author: 'Louis Sachar', narrator: 'Kerry Beyer', totalMinutes: 270 } })).body;
  await settle();
  const book = (await send('GET', `/api/library/${entry.data.bookId}`)).body;
  assert.equal(book.description, 'Stanley Yelnats digs holes.');
  assert.deepEqual(book.genres, ['Adventure', 'Humor']);
  assert.equal(book.format, 'audiobook');
  assert.equal(book.year, 1998);
  assert.deepEqual([book.isbn, book.pages], [null, null], "the paper copy's");
  assert.equal(book.readers[0].narrator, 'Kerry Beyer');
});
