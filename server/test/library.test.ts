// The family's library (routes/library.ts, migration 0089): books the family owns, apart from who's
// reading what. A reading entry started from a book carries its id (ReadingData.bookId), so each book
// lists its readers.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'fc_test_admin_key';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
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
  return { app, env, send, db };
}

const holes = { title: 'Holes', author: 'Louis Sachar', isbn: '9780440414803', pages: 233, coverUrl: 'https://covers.example.com/holes.jpg' };

test('library: add, list by title, search, edit; the same ISBN twice is a 409 with the book', async () => {
  const { send } = setup();
  const added = await send('POST', '/api/library', holes);
  assert.equal(added.status, 201);
  const { id: _id, createdAt: _c, updatedAt: _u, addedBy: _a, ...fields } = added.body;
  assert.deepEqual(fields, { ...holes, year: null, series: null, seriesNumber: null, lexile: null, description: null, genres: [], location: null, lentTo: null, lentOn: null, readers: [] });
  await send('POST', '/api/library', { title: "Charlotte's Web", author: 'E. B. White' });
  await send('POST', '/api/library', { title: 'Matilda', author: 'Roald Dahl' });

  assert.deepEqual((await send('GET', '/api/library')).body.map((b: any) => b.title), ["Charlotte's Web", 'Holes', 'Matilda'], 'A-Z');
  assert.deepEqual((await send('GET', '/api/library?q=dahl')).body.map((b: any) => b.title), ['Matilda'], 'searches authors too');
  // A series sorts under its name, in order: Warriors #1, #2, #10 among the other titles.
  for (const [title, n] of [['Fire and Ice', '2'], ['Into the Wild', '1'], ['The Darkest Hour', '10']]) await send('POST', '/api/library', { title, series: 'Warriors', seriesNumber: n });
  assert.deepEqual((await send('GET', '/api/library')).body.map((b: any) => b.title), ["Charlotte's Web", 'Holes', 'Matilda', 'Into the Wild', 'Fire and Ice', 'The Darkest Hour']);

  const again = await send('POST', '/api/library', { ...holes, title: 'Holes (copy)' });
  assert.equal(again.status, 409, 'already in the library');
  assert.equal(again.body.book.id, added.body.id);

  const edited = await send('PATCH', `/api/library/${added.body.id}`, { author: 'Louis Sachar', pages: 240, coverUrl: null });
  assert.equal(edited.body.pages, 240);
  assert.equal(edited.body.coverUrl, null);
  assert.equal((await send('POST', '/api/library', { title: 'X', coverUrl: 'http://insecure.example.com/x.jpg' })).status, 400);
  assert.equal((await send('POST', '/api/library', { title: ' ' })).status, 400);
});

test('library: a reading entry started from a book makes its reader show on the book', async () => {
  const { send } = setup();
  await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true });
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const book = (await send('POST', '/api/library', holes)).body;
  const entry = (await send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: 'Holes', data: { bookId: book.id, totalPages: 233 } })).body;
  assert.equal(entry.data.bookId, book.id);
  assert.deepEqual((await send('GET', '/api/library')).body[0].readers, [{ entryId: entry.id, memberId: maya.id, status: 'reading' }]);
  assert.equal((await send('GET', '/api/library?unread=1')).body.length, 0, 'someone has started it');

  await send('PATCH', `/api/trackers/${entry.id}`, { data: { status: 'finished' } });
  assert.equal((await send('GET', `/api/library/${book.id}`)).body.readers[0].status, 'finished');

  assert.equal((await send('DELETE', `/api/library/${book.id}`)).status, 200);
  assert.equal((await send('GET', `/api/trackers/${entry.id}`)).body.title, 'Holes', 'the reading entry stays');
});

test("library: wall screens and kids' devices browse and add; only parent devices remove", async () => {
  const { send } = setup();
  const book = (await send('POST', '/api/library', holes)).body;
  const wall = (await send('POST', '/api/keys', { name: 'Kitchen', scope: 'display' })).body.key;
  assert.equal((await send('GET', '/api/library', undefined, wall)).status, 200);
  assert.equal((await send('POST', '/api/library', { title: 'Matilda' }, wall)).status, 201);
  assert.equal((await send('PATCH', `/api/library/${book.id}`, { pages: 1 }, wall)).status, 200);
  assert.equal((await send('DELETE', `/api/library/${book.id}`, undefined, wall)).status, 403);
});

test("library: a book's cover is fetched by the server; the export keeps the library", async () => {
  const { app, env, send, db } = setup();
  const book = (await send('POST', '/api/library', holes)).body;
  globalThis.fetch = (async () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })) as typeof fetch;
  const wall = (await send('POST', '/api/keys', { name: 'Kitchen', scope: 'display' })).body.key;
  const { token } = (await send('GET', '/api/media-token', undefined, wall)).body; // an <img> takes a media token, never a key
  const cover = await app.request(`/api/library/${book.id}/cover?key=${token}`, {}, env);
  assert.equal((await app.request(`/api/library/${book.id}/cover?key=${wall}`, {}, env)).status, 401, 'a full key in a URL is refused');
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get('content-type'), 'image/jpeg');

  const exported = (await send('GET', '/api/export')).body;
  assert.deepEqual(exported.libraryBooks.map((b: any) => b.title), ['Holes']);
  db.prepare('DELETE FROM library_books').run();
  assert.ok((await send('POST', '/api/import', exported)).status < 300);
  assert.deepEqual((await send('GET', '/api/library')).body.map((b: any) => b.id), [book.id]);
});

test('library: adding by ISBN alone looks the book up, details and description included', async () => {
  const { send } = setup();
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input); calls.push(url);
    if (url.includes('search.json')) return Response.json({ docs: [{ key: '/works/OL1W', title: 'Into the Wild', author_name: ['Erin Hunter'], number_of_pages_median: 272, cover_i: 9, first_publish_year: 2003, series_name: ['Warriors'], series_position: ['1'], lexile: [970], subject: ['Fantasy', 'Cats', 'Fiction'] }] });
    if (url.includes('/works/OL1W.json')) return Response.json({ description: { value: 'Fire alone can save our Clan.' } });
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  const book = await send('POST', '/api/library', { isbn: '9780060000028' });
  assert.equal(book.status, 201, JSON.stringify(book.body));
  const { id: _i, createdAt: _c, updatedAt: _u, addedBy: _a, ...fields } = book.body;
  assert.deepEqual(fields, {
    title: 'Into the Wild', author: 'Erin Hunter', isbn: '9780060000028', pages: 272, coverUrl: 'https://covers.openlibrary.org/b/id/9-M.jpg',
    year: 2003, series: 'Warriors', seriesNumber: '1', lexile: 970, description: 'Fire alone can save our Clan.', genres: ['Fantasy', 'Animals'], location: null, lentTo: null, lentOn: null, readers: [],
  });
  assert.ok(new URL(calls[0]).searchParams.get('q') === '9780060000028');

  globalThis.fetch = (async () => Response.json({ docs: [] })) as typeof fetch;
  assert.equal((await send('POST', '/api/library', { isbn: '9780000000002' })).status, 404, 'not found anywhere');
  assert.equal((await send('POST', '/api/library', {})).status, 400, 'a title or an ISBN');
});

test('library: where a book lives, lending it out and getting it back', async () => {
  const { send } = setup();
  const book = (await send('POST', '/api/library', { ...holes, location: "Maya's room" })).body;
  assert.equal(book.location, "Maya's room");
  await send('POST', '/api/library', { title: 'Matilda', location: 'Living room shelf' });

  const lent = (await send('PATCH', `/api/library/${book.id}`, { lentTo: 'Grandma' })).body;
  assert.equal(lent.lentTo, 'Grandma');
  assert.match(lent.lentOn, /^\d{4}-\d{2}-\d{2}$/, 'dated today when lent');
  assert.deepEqual((await send('GET', '/api/library?lent=1')).body.map((b: any) => b.title), ['Holes']);
  assert.deepEqual((await send('GET', '/api/library?location=Living room shelf')).body.map((b: any) => b.title), ['Matilda']);
  assert.deepEqual((await send('GET', '/api/library?q=grandma')).body.map((b: any) => b.title), ['Holes'], 'search finds who has it');

  const back = (await send('PATCH', `/api/library/${book.id}`, { lentTo: null })).body;
  assert.deepEqual([back.lentTo, back.lentOn, back.location], [null, null, "Maya's room"], 'returned: back where it lives');
  assert.equal((await send('PATCH', `/api/library/${book.id}`, { lentTo: 'Sam', lentOn: '2026-09-01' })).body.lentOn, '2026-09-01');
});

test('library: descriptions saved before the Markdown cleanup show clean', async () => {
  const { send, db } = setup();
  const book = (await send('POST', '/api/library', { title: 'The Gunslinger' })).body;
  db.prepare('UPDATE library_books SET description = ? WHERE id = ?').bind('[The Dark Tower][1] begins.\n\n  [1]: https://openlibrary.org/works/OL1W', book.id).run();
  assert.equal((await send('GET', `/api/library/${book.id}`)).body.description, 'The Dark Tower begins.');
});
