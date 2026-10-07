// Details for library books that came in with little (a Reading entry's title and author, a sync's
// title and ISBN): looked up on Open Library (routes/books.ts) by ISBN, else by title and author, and
// only a confident match (shelve.ts sameBook) is used. It fills only what's empty, never what a
// person set. Each book is looked up once: a match keeps its work_key and isn't looked up on its own
// again; no match is tried again after RETRY_MS. lookUpNew runs right after a book is added (in the
// background), lookUpSome a few per tick for books from before (entry.ts scheduled, node.ts), and
// POST /api/library/{id}/details on a parent's "Look up details". All share the 'books' rate limit.
import type { Context } from 'hono';
import { waitUntil, type Env, type WaitCtx } from './env.ts';
import { checkRate } from './ratelimit.ts';
import { sameBook } from './shelve.ts';
import { searchOpenLibrary, workDescription, type BookResult } from './routes/books.ts';
import { publish } from './bus.ts';

type Db = Env['DB'];
type Row = { id: string; title: string; author: string | null; isbn: string | null; description: string | null }

export const RETRY_MS = 30 * 86_400_000;
/** Books per scheduled tick (every 5 minutes hosted, node.ts likewise): about 2 Open Library calls each. */
export const BATCH = 5;
/** Missing something Open Library may know. */
const MISSING = "work_key IS NULL AND (description IS NULL OR year IS NULL OR genres IS NULL OR cover_url IS NULL OR (isbn IS NULL AND format = 'book'))";

/** The search result that is this book: by ISBN, Open Library's answer; by title, the same title
 * (sameBook) and an author on both sides, or, for a book with no author, only the top result. */
export function pickMatch(book: { title: string; author: string | null }, results: BookResult[], byIsbn: boolean): BookResult | undefined {
  if (byIsbn) return results[0];
  return results.find((r, i) => sameBook(book, { title: r.title, author: r.author ?? null }) && (book.author ? !!r.author : i === 0));
}

/** Looks a book up and fills its empty details. 'found', 'none' (recorded, so it waits RETRY_MS),
 * 'busy' (the rate limit) or 'gone'; throws when Open Library is unreachable (nothing recorded). */
export async function lookUpBook(db: Db, id: string): Promise<'found' | 'none' | 'busy' | 'gone'> {
  const book = await db.prepare('SELECT id, title, author, isbn, description FROM library_books WHERE id = ?').bind(id).first<Row>();
  if (!book) return 'gone';
  if (!(await checkRate(db, 'books', 30, 60_000))) return 'busy';
  let found = book.isbn ? pickMatch(book, await searchOpenLibrary(book.isbn, 1), true) : undefined;
  if (!found) {
    const q = `${book.title.split(':')[0]} ${book.author ?? ''}`.trim();
    found = pickMatch(book, await searchOpenLibrary(q, 5), false);
  }
  const now = new Date().toISOString();
  if (!found) {
    await db.prepare('UPDATE library_books SET looked_up_at = ? WHERE id = ?').bind(now, id).run();
    return 'none';
  }
  const description = !book.description && found.workKey ? await workDescription(found.workKey) : null;
  // Only empty fields; a series number only with the series it belongs to. The ISBN only if no other book has it (unique).
  // An audiobook (0098) gets neither the print ISBN nor a page count: its length is minutes.
  await db.prepare(
    `UPDATE library_books SET author = coalesce(author, ?), isbn = CASE WHEN format = 'audiobook' THEN isbn ELSE coalesce(isbn, (SELECT ? WHERE NOT EXISTS (SELECT 1 FROM library_books WHERE isbn = ?))) END,
       pages = CASE WHEN format = 'audiobook' THEN pages ELSE coalesce(pages, ?) END, cover_url = coalesce(cover_url, ?), year = coalesce(year, ?),
       series_number = CASE WHEN series IS NULL THEN ? ELSE series_number END, series = coalesce(series, ?),
       lexile = coalesce(lexile, ?), description = coalesce(description, ?), genres = coalesce(genres, ?),
       work_key = ?, ratings_average = ?, ratings_count = ?, looked_up_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(found.author ?? null, found.isbn ?? null, found.isbn ?? null, found.pages ?? null, found.coverUrl ?? null, found.year ?? null,
    found.series ? found.seriesNumber ?? null : null, found.series ?? null, found.lexile ?? null, description,
    found.genres?.length ? JSON.stringify(found.genres) : null, found.workKey ?? null, found.ratingsAverage ?? null, found.ratingsCount ?? null, now, now, id).run();
  return 'found';
}

/** A just-added book, in the background: looked up when it's missing details; never throws. */
export async function lookUpNew(env: Env, id: string): Promise<void> {
  try {
    if (!(await env.DB.prepare(`SELECT 1 FROM library_books WHERE id = ? AND looked_up_at IS NULL AND ${MISSING}`).bind(id).first())) return;
    if ((await lookUpBook(env.DB, id)) === 'found') publish(env, undefined, 'tracker.changed', { library: id });
  } catch (err) {
    console.error('book details lookup failed', err instanceof Error ? err.name : 'error');
  }
}

/** lookUpNew for a book a request just added, kept alive past the response (Workers' waitUntil;
 * Node and a Durable Object keep running on their own). */
export function lookUpInBackground(c: Context<{ Bindings: Env }>, id: string): void {
  let ctx: WaitCtx | undefined;
  try { ctx = c.executionCtx; } catch { /* Node: no ExecutionContext */ }
  waitUntil(ctx, lookUpNew(c.env, id));
}

/** Up to `n` books missing details that weren't looked up (or not for RETRY_MS), newest first.
 * Stops at the rate limit or when Open Library is unreachable; the next tick carries on. */
export async function lookUpSome(env: Env, n = BATCH, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id FROM library_books WHERE ${MISSING} AND (looked_up_at IS NULL OR looked_up_at < ?) ORDER BY looked_up_at IS NOT NULL, created_at DESC LIMIT ?`,
  ).bind(new Date(now - RETRY_MS).toISOString(), n).all<{ id: string }>();
  let found = 0;
  for (const { id } of results) {
    const r = await lookUpBook(env.DB, id);
    if (r === 'busy') break;
    if (r === 'found') found++;
  }
  if (found) publish(env, undefined, 'tracker.changed', { library: 'details' });
  return results.length;
}
