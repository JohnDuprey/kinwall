// The library's shelves (migration 0103): who a book is for, Kids or Grown-ups (or Everyone). Only a
// parent's pick is stored (shelf); with none, autoShelf (shelve.ts) decides at read time (effectiveShelf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { autoShelf } from '../src/shelve.ts';
import { genresFrom } from '../src/routes/books.ts';

const ADMIN = 'fc_test_admin_key';
const KIDS = new Set(['maya']);
const book = (b: Partial<Parameters<typeof autoShelf>[0]> = {}) => ({ genres: [], lexile: null, pages: null, format: 'book', readers: [], ...b });

test('autoShelf: Open Library subjects saying juvenile, children\'s, picture book or young adult are Kids', () => {
  // Real subjects (Open Library search, 2026-10): Creepy Pair of Underwear!, Dark River, The Hunger Games.
  const creepy = genresFrom(['Fear', 'Underwear', 'Fiction', 'Rabbits', 'JUVENILE FICTION / Humorous Stories', 'JUVENILE FICTION / Bedtime & Dreams', 'Juvenile fiction', 'JUVENILE FICTION / Animals / Rabbits', "Children's fiction", 'nyt:picture-books=2017-09-10']);
  const warriors = genresFrom(['Cats', 'Fiction', 'Fantasy', 'Prophecies', 'Juvenile Fiction', "Children's fiction", 'Wildcat']);
  const hunger = genresFrom(['Survival', 'Fiction', 'Television programs', 'Juvenile works', 'Young adult works', 'Young adult fiction', 'Reading Level-Grade 9']);
  assert.ok(warriors.includes("Children's"), warriors.join());
  assert.ok(hunger.includes('Young adult'), hunger.join());
  for (const genres of [creepy, warriors, hunger, ['Picture book', 'Humor']]) assert.equal(autoShelf(book({ genres, pages: 300 }), KIDS), 'kids', genres.join());
  // Grown-ups' books: none of those words. "Middle Earth" isn't middle grade; grade levels alone aren't.
  const hobbitish = genresFrom(['Middle Earth (Imaginary place)', 'Fantasy fiction', 'Reading Level-Grade 11']);
  assert.ok(!hobbitish.includes("Children's"));
  const wool = genresFrom(['Science fiction', 'Dystopias', 'Fiction, science fiction, general']);
  assert.equal(autoShelf(book({ genres: wool, pages: 552 }), KIDS), 'grownups');
});

test('autoShelf: a lexile under 1000 or a picture-book length is Kids; books only kids read are Kids; else Grown-ups', () => {
  assert.equal(autoShelf(book({ lexile: 620, pages: 322 }), KIDS), 'kids', 'Dark River, 620L');
  assert.equal(autoShelf(book({ lexile: -100 }), KIDS), 'kids', 'BR100L');
  assert.equal(autoShelf(book({ lexile: 1170, genres: ['Science fiction', 'Animals'], format: 'audiobook' }), KIDS), 'grownups', 'Animal Farm, 1170L: animals are not a kids genre');
  assert.equal(autoShelf(book({ pages: 24 }), KIDS), 'kids', 'Cavecat Pete, 24 pages');
  assert.equal(autoShelf(book({ pages: 40 }), KIDS), 'kids');
  assert.equal(autoShelf(book({ pages: 120 }), KIDS), 'grownups');
  const r = (memberId: string | null, status = 'reading') => ({ memberId, status });
  assert.equal(autoShelf(book({ pages: 351, readers: [r('maya', 'finished')] }), KIDS), 'kids', 'The Sight: only June read it');
  assert.equal(autoShelf(book({ pages: 351, readers: [r('maya'), r('alex')] }), KIDS), 'grownups', 'a grown-up reads it too');
  assert.equal(autoShelf(book({ pages: 351, readers: [r('maya', 'want')] }), KIDS), 'grownups', 'wanting to read it is not reading it');
  assert.equal(autoShelf(book({ pages: 616, readers: [r('alex')] }), KIDS), 'grownups', 'Children of Time');
  assert.equal(autoShelf(book(), KIDS), 'grownups', 'nothing known');
});

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { send };
}

test('library shelves: stored shelf and effective shelf, the shelf filter, and a parent setting one', async () => {
  const { send } = setup();
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const pete = (await send('POST', '/api/library', { title: 'Cavecat Pete', pages: 24 })).body;
  const wool = (await send('POST', '/api/library', { title: 'Wool', pages: 552 })).body;
  const sight = (await send('POST', '/api/library', { title: 'The Sight', pages: 351 })).body;
  assert.equal(pete.shelf, null);
  assert.equal(pete.effectiveShelf, 'kids');
  assert.equal(wool.effectiveShelf, 'grownups');
  await send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: 'The Sight', data: { status: 'reading', bookId: sight.id } });

  const titles = async (q: string) => (await send('GET', `/api/library${q}`)).body.map((b: any) => b.title);
  assert.deepEqual(await titles('?shelf=kids'), ['Cavecat Pete', 'The Sight'], 'only a kid reads The Sight');
  assert.deepEqual(await titles('?shelf=grownups'), ['Wool']);

  // A parent's pick is stored and wins; Everyone is on both shelves; null goes back to Auto.
  const set = await send('PATCH', `/api/library/${wool.id}`, { shelf: 'everyone' });
  assert.equal(set.status, 200);
  assert.deepEqual([set.body.shelf, set.body.effectiveShelf], ['everyone', 'everyone']);
  assert.deepEqual(await titles('?shelf=kids'), ['Cavecat Pete', 'The Sight', 'Wool']);
  assert.deepEqual(await titles('?shelf=grownups'), ['Wool']);
  assert.equal((await send('PATCH', `/api/library/${pete.id}`, { shelf: 'grownups' })).body.effectiveShelf, 'grownups');
  const auto = (await send('PATCH', `/api/library/${pete.id}`, { shelf: null })).body;
  assert.deepEqual([auto.shelf, auto.effectiveShelf], [null, 'kids']);
  assert.equal((await send('POST', '/api/library', { title: 'Picked', shelf: 'kids' })).body.shelf, 'kids', 'adding a book can pick one');
  assert.equal((await send('PATCH', `/api/library/${pete.id}`, { shelf: 'teens' })).status, 400);
});

test("library shelves: only parents' devices change a shelf; walls and kids' devices see it and edit the rest", async () => {
  const { send } = setup();
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const wool = (await send('POST', '/api/library', { title: 'Wool', pages: 552 })).body;
  const wall = (await send('POST', '/api/keys', { name: 'Kitchen', scope: 'display' })).body.key;
  const tablet = (await send('POST', '/api/keys', { name: 'Tablet', scope: 'display' })).body;
  assert.equal((await send('PATCH', `/api/keys/${tablet.id}`, { owner: maya.id })).status, 200);
  for (const key of [wall, tablet.key]) {
    assert.equal((await send('PATCH', `/api/library/${wool.id}`, { shelf: 'kids' }, key)).status, 403);
    assert.equal((await send('POST', '/api/library', { title: 'Mine', shelf: 'kids' }, key)).status, 403);
    assert.equal((await send('PATCH', `/api/library/${wool.id}`, { pages: 553 }, key)).status, 200, 'other edits still work');
    assert.equal((await send('GET', `/api/library/${wool.id}`, undefined, key)).body.effectiveShelf, 'grownups');
  }
  assert.equal((await send('GET', `/api/library/${wool.id}`)).body.shelf, null);
});

test('library shelves: MCP list_library shows and filters by shelf; update_library_book sets one', async () => {
  const { send } = setup();
  await send('POST', '/api/library', { title: 'Cavecat Pete', pages: 24 });
  await send('POST', '/api/library', { title: 'Wool', pages: 552 });
  const call = async (name: string, args: Record<string, unknown>) => (await send('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).body.result;
  const kids = await call('list_library', { shelf: 'kids' });
  assert.deepEqual(kids.structuredContent.books.map((b: any) => [b.title, b.shelf, b.effectiveShelf]), [['Cavecat Pete', null, 'kids']]);
  const set = await call('update_library_book', { book: 'Wool', shelf: 'kids' });
  assert.equal(set.structuredContent.book.shelf, 'kids');
  assert.deepEqual((await call('list_library', { shelf: 'kids' })).structuredContent.books.map((b: any) => b.title), ['Cavecat Pete', 'Wool']);
});
