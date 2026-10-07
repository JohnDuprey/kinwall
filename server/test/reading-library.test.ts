// Every book on someone's Reading shelf is in the family's library (shelve.ts): a new or edited
// reading entry without a bookId is linked to the library book with the same title and author, or
// a new one is made from it (one the family has, even if only "want to read"); reading a wishlist
// book takes it off the wishlist. shelveReadingEntries does the same once for entries from before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { sameBook, shelveReadingEntries } from '../src/shelve.ts';

const ADMIN = 'fc_test_admin_key';
function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  const library = async (q = '') => [...(await send('GET', `/api/library${q}`)).body, ...(await send('GET', `/api/library?wanted=1${q ? `&${q.slice(1)}` : ''}`)).body]
  const read = (title: string, data: Record<string, unknown> = {}) => send('POST', '/api/trackers', { kind: 'reading', title, data: { status: 'reading', ...data } });
  return { env, db, send, library, read };
}

test('sameBook: case, punctuation, subtitles and author order don\'t matter', () => {
  assert.ok(sameBook({ title: 'Project Hail Mary: A Novel', author: 'Andy Weir' }, { title: 'project hail mary', author: 'Weir, Andy' }));
  assert.ok(sameBook({ title: "Charlotte's Web", author: 'E.B. White' }, { title: 'Charlottes Web', author: 'E. B. White' }));
  assert.ok(sameBook({ title: 'Holes', author: null }, { title: 'Holes', author: 'Louis Sachar' }), 'no author on one side: the title decides');
  assert.ok(!sameBook({ title: 'Holes', author: 'Someone Else' }, { title: 'Holes', author: 'Louis Sachar' }));
  assert.ok(!sameBook({ title: 'Holes 2', author: null }, { title: 'Holes', author: null }));
})

test('a new reading entry joins the library: linked to the same book, or a new one made from it', async () => {
  const { send, library, read } = setup();
  const have = (await send('POST', '/api/library', { title: 'Holes', author: 'Louis Sachar', location: 'Shelf' })).body;
  const linked = await read('HOLES', { author: 'louis sachar' });
  assert.equal(linked.status, 201);
  assert.equal(linked.body.data.bookId, have.id, 'linked to the book already there');

  const made = await read('Project Hail Mary: A Novel', { author: 'Andy Weir', format: 'audiobook', totalMinutes: 970, coverUrl: 'https://covers.example.com/phm.jpg' });
  const books = await library();
  assert.equal(books.length, 2);
  const phm = books.find((b: any) => b.id === made.body.data.bookId);
  assert.equal(phm.title, 'Project Hail Mary: A Novel');
  assert.equal(phm.author, 'Andy Weir');
  assert.equal(phm.coverUrl, 'https://covers.example.com/phm.jpg');
  assert.equal(phm.pages, null, "an audiobook's minutes aren't pages");
  assert.equal(phm.wanted, false);
  assert.deepEqual(phm.readers.map((r: any) => r.status), ['reading']);

  const book = await read('Wonder', { author: 'R. J. Palacio', totalPages: 310 });
  assert.equal((await library()).find((b: any) => b.id === book.body.data.bookId).pages, 310);

  // Retried, or someone else reading it: the same book, never a second one.
  await read('Project Hail Mary', { author: 'Andy Weir' });
  assert.equal((await library()).length, 3);
});

test("want to read is a book the family has, not the wishlist; reading a wishlist book takes it off; an owned book stays owned", async () => {
  const { send, library, read } = setup();
  const want = await read('The Wild Robot', { author: 'Peter Brown', status: 'want' });
  const robot = (await library()).find((b: any) => b.id === want.body.data.bookId);
  assert.equal(robot.wanted, false, 'an audiobook bought but not started is ours');

  // A wishlist book someone starts: off the wishlist.
  const wish = (await send('POST', '/api/library', { title: 'Wings of Fire', author: 'Tui T. Sutherland', wanted: true })).body;
  const r = await read('Wings of Fire', { author: 'Tui T. Sutherland', status: 'want' });
  assert.equal(r.body.data.bookId, wish.id);
  assert.equal((await library()).find((b: any) => b.id === wish.id).wanted, true, 'wanting it keeps it on the wishlist');
  await send('PATCH', `/api/trackers/${r.body.id}`, { data: { status: 'reading' } });
  assert.equal((await library()).find((b: any) => b.id === wish.id).wanted, false);

  const owned = (await send('POST', '/api/library', { title: 'Holes', author: 'Louis Sachar' })).body;
  const w = await read('Holes', { status: 'want' });
  assert.equal(w.body.data.bookId, owned.id);
  assert.equal((await library()).find((b: any) => b.id === owned.id).wanted, false, 'wanting a book you have keeps it yours');
});

test('an edited entry without a book is linked; removing the entry keeps the book; other kinds are left alone', async () => {
  const { send, db, library, read } = setup();
  const e = await read('Matilda', { author: 'Roald Dahl' });
  // An entry from before (no bookId), then patched by a sync.
  db.prepare("UPDATE tracker_entries SET data = json_remove(data, '$.bookId') WHERE id = ?").bind(e.body.id).run();
  const patched = await send('PATCH', `/api/trackers/${e.body.id}`, { data: { pagesRead: 20 } });
  assert.equal(patched.body.data.bookId, (await library())[0].id);
  assert.equal((await library()).length, 1);

  await send('DELETE', `/api/trackers/${e.body.id}`);
  assert.equal((await library()).length, 1, 'the book stays');

  await send('POST', '/api/trackers', { kind: 'memory', title: 'Holes', data: { text: 'Read Holes' } });
  assert.equal((await library()).length, 1);
});

test('shelveReadingEntries: entries from before join the library once, deduped, nothing removed', async () => {
  const { env, db, send, library } = setup();
  const owned = (await send('POST', '/api/library', { title: "Charlotte's Web", author: 'E. B. White', isbn: '9780064400558' })).body;
  const insert = (id: string, member: string | null, title: string, data: Record<string, unknown>) =>
    db.prepare("INSERT INTO tracker_entries (id, kind, member_id, date, title, photo_own, data, created_at, updated_at) VALUES (?, 'reading', ?, '2026-09-01', ?, 0, ?, ?, ?)")
      .bind(id, member, title, JSON.stringify(data), `2026-09-0${id.length}T00:00:00Z`, '2026-09-01T00:00:00Z').run();
  insert('a', null, 'Charlottes Web', { status: 'finished', author: 'EB White' });
  insert('bb', null, 'Dog Man', { status: 'want', author: 'Dav Pilkey' });
  insert('ccc', null, 'Dog Man', { status: 'want', author: 'Dav Pilkey' });
  insert('dddd', null, 'Holes', { status: 'reading' });
  insert('eeeee', null, 'Gone', { status: 'reading', bookId: 'deleted-book' }); // its book was removed: not made again

  assert.equal(await shelveReadingEntries(env), 4);
  const books = await library();
  assert.deepEqual(books.map((b: any) => b.title).sort(), ["Charlotte's Web", 'Dog Man', 'Holes']);
  assert.equal(books.find((b: any) => b.title === 'Dog Man').wanted, false);
  const data = (id: string) => JSON.parse((db.prepare('SELECT data FROM tracker_entries WHERE id = ?').bind(id).first() as any).data);
  assert.equal(data('a').bookId, owned.id);
  assert.equal(data('bb').bookId, data('ccc').bookId);
  assert.equal(data('eeeee').bookId, 'deleted-book');

  assert.equal(await shelveReadingEntries(env), 0, 'idempotent');
  assert.equal((await library()).length, 3);
});
