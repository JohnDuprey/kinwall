// Audiobooks are their own library items (library_books.format, migration 0098): a reading entry
// links to or makes a library item of its own format, so a paper copy and an audiobook of one title
// are two items. 0098 sorts the books made before by their readers' formats, splitting a book that
// has both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runMigrations } from '../src/migrate.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'fc_test_admin_key';
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  const read = (title: string, data: Record<string, unknown> = {}) => send('POST', '/api/trackers', { kind: 'reading', title, data: { status: 'reading', ...data } });
  return { db, send, read };
}

test('a reading entry links to a library item of its own format; paper and audio are two items', async () => {
  const { send, read } = setup();
  const paper = (await send('POST', '/api/library', { title: 'Holes', author: 'Louis Sachar' })).body;
  assert.equal(paper.format, 'book', 'a book unless told otherwise');
  const listen = await read('Holes', { author: 'Louis Sachar', format: 'audiobook', narrator: 'Kerry Beyer', minutesListened: 60, totalMinutes: 270 });
  assert.notEqual(listen.body.data.bookId, paper.id, "an audiobook doesn't land on the paper copy");
  const audio = (await send('GET', `/api/library/${listen.body.data.bookId}`)).body;
  assert.equal(audio.format, 'audiobook');
  assert.deepEqual(audio.readers.map((r: any) => [r.narrator, r.minutesListened, r.totalMinutes]), [['Kerry Beyer', 60, 270]], 'readers carry their listening progress');
  assert.equal((await read('Holes', { format: 'audiobook' })).body.data.bookId, audio.id, 'another listener: the same audiobook');
  assert.equal((await read('Holes', {})).body.data.bookId, paper.id, 'a reader: the paper copy');

  assert.deepEqual((await send('GET', '/api/library?format=audiobook')).body.map((b: any) => b.id), [audio.id]);
  assert.deepEqual((await send('GET', '/api/library?format=book')).body.map((b: any) => b.id), [paper.id]);
  assert.equal((await send('GET', '/api/library')).body.length, 2);

  const made = await send('POST', '/api/library', { title: 'Wonder', format: 'audiobook' });
  assert.equal(made.body.format, 'audiobook');
  assert.equal((await send('PATCH', `/api/library/${made.body.id}`, { format: 'book' })).body.format, 'book', 'fixable');
});

test('migration 0098: books only listened to become audiobooks; a book with both is split, nothing removed', async () => {
  const all = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((name) => ({ name, sql: readFileSync(path.join(DIR, name), 'utf8') }));
  const db = openDb(':memory:') as unknown as D1Database;
  await runMigrations(db, all.filter((m) => m.name < '0098'));
  const book = (id: string, title: string, isbn: string | null = null, cover: string | null = null) => db.prepare("INSERT INTO library_books (id, title, author, isbn, pages, cover_url, location, created_at, updated_at) VALUES (?, ?, 'A. Writer', ?, 300, ?, 'Den', '2026-09-01', '2026-09-01')").bind(id, title, isbn, cover).run();
  const entry = (id: string, bookId: string | null, format?: string, cover?: string) => db.prepare("INSERT INTO tracker_entries (id, kind, member_id, date, title, photo_own, data, created_at, updated_at) VALUES (?, 'reading', NULL, '2026-09-01', 't', 0, ?, '2026-09-01', '2026-09-01')")
    .bind(id, JSON.stringify({ status: 'reading', ...(bookId ? { bookId } : {}), ...(format ? { format } : {}), ...(cover ? { coverUrl: cover } : {}) })).run();
  await book('fight', 'Fight Club');
  await entry('e1', 'fight', 'audiobook');
  await entry('e2', 'fight', 'audiobook');
  await book('holes', 'Holes', '9780440414803', 'https://covers.example.com/holes.jpg');
  await entry('e3', 'holes', 'book');
  await entry('e4', 'holes', 'audiobook', 'https://covers.example.com/holes-audio.jpg');
  await entry('e5', 'holes'); // no format: a book
  await book('wonder', 'Wonder'); // nobody's reading it
  await entry('e6', 'gone', 'audiobook'); // its book was removed

  await runMigrations(db, all);
  const rows = (await db.prepare('SELECT id, title, format, isbn, pages, cover_url, location FROM library_books ORDER BY id').all<any>()).results;
  assert.deepEqual(rows.map((r: any) => [r.id, r.format]), [['fight', 'audiobook'], ['holes', 'book'], ['holes-audiobook', 'audiobook'], ['wonder', 'book']]);
  const split = rows.find((r: any) => r.id === 'holes-audiobook');
  assert.equal(split.title, 'Holes');
  assert.equal(split.isbn, null, "the paper copy's ISBN stays with it");
  assert.equal(split.pages, null);
  assert.equal(split.location, null);
  assert.equal(split.cover_url, 'https://covers.example.com/holes-audio.jpg', "the audiobook entry's cover");
  const bookIds = Object.fromEntries((await db.prepare("SELECT id, json_extract(data, '$.bookId') AS b FROM tracker_entries ORDER BY id").all<any>()).results.map((r: any) => [r.id, r.b]));
  assert.deepEqual(bookIds, { e1: 'fight', e2: 'fight', e3: 'holes', e4: 'holes-audiobook', e5: 'holes', e6: 'gone' });
});
