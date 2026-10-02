// Pages (or minutes) read each day on a book (ReadingData.log): logged by the server when progress
// changes, never on creation (a book added at page 66 didn't have 66 pages read today).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { logReading } from '../src/reading.ts';

test('logReading: each day gets what was read that day; corrections never go below zero', () => {
  let log = logReading({ pagesRead: 66 }, { pagesRead: 80 }, '2026-10-01');
  assert.deepEqual(log, [{ date: '2026-10-01', amount: 14 }]);
  log = logReading({ pagesRead: 80, log }, { pagesRead: 95 }, '2026-10-01');
  assert.deepEqual(log, [{ date: '2026-10-01', amount: 29 }], 'same day adds up');
  log = logReading({ pagesRead: 95, log }, { pagesRead: 110 }, '2026-10-02');
  assert.deepEqual(log, [{ date: '2026-10-01', amount: 29 }, { date: '2026-10-02', amount: 15 }]);
  log = logReading({ pagesRead: 110, log }, { pagesRead: 101 }, '2026-10-02');
  assert.deepEqual(log?.at(-1), { date: '2026-10-02', amount: 6 }, 'a typo fixed the same day comes off');
  log = logReading({ pagesRead: 101, log }, { pagesRead: 0 }, '2026-10-03');
  assert.deepEqual(log?.at(-1), { date: '2026-10-02', amount: 6 }, 'going back (starting over) logs nothing');
  assert.equal(logReading({ pagesRead: 10, log }, { pagesRead: 10 }, '2026-10-04'), log, 'no change, same log');
});

test('logReading: audiobooks count minutes; switching format starts a fresh log', () => {
  const log = logReading({ format: 'audiobook', minutesListened: 30 }, { format: 'audiobook', minutesListened: 75 }, '2026-10-01');
  assert.deepEqual(log, [{ date: '2026-10-01', amount: 45 }]);
  assert.equal(logReading({ format: 'audiobook', minutesListened: 75, log }, { format: 'book', pagesRead: 10 }, '2026-10-01'), undefined);
  const long = Array.from({ length: 400 }, (_, i) => ({ date: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`, amount: 1 }));
  assert.equal(logReading({ pagesRead: 1, log: long }, { pagesRead: 2 }, '2026-10-01')!.length, 366, 'about a year is kept');
});

test('trackers: logging pages records today; adding a book or editing other fields does not', async () => {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: 'fc_test_admin_key', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown) =>
    (await (await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: 'Bearer fc_test_admin_key', 'Content-Type': 'application/json' } }, env)).json()) as any;

  const book = await send('POST', '/api/trackers', { kind: 'reading', title: 'Holes', data: { pagesRead: 66, totalPages: 233 } });
  assert.equal(book.data.log, undefined, 'the starting page is not reading done today');
  const logged = await send('PATCH', `/api/trackers/${book.id}`, { data: { pagesRead: 80 } });
  assert.equal(logged.data.log.length, 1);
  assert.equal(logged.data.log[0].amount, 14);
  assert.match(logged.data.log[0].date, /^\d{4}-\d{2}-\d{2}$/);
  const rated = await send('PATCH', `/api/trackers/${book.id}`, { data: { notes: 'Funny', log: [{ date: '2020-01-01', amount: 999 }] } });
  assert.deepEqual(rated.data.log, logged.data.log, 'the server keeps the log; a client cannot rewrite it');
  const done = await send('PATCH', `/api/trackers/${book.id}`, { data: { status: 'finished' } });
  assert.equal(done.data.log[0].amount, 14 + (233 - 80), 'finishing counts the pages left as read today');
});
