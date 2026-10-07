// The family's library (migrations 0089-0093): books the family owns, has borrowed (a due date; returned ones stay as history) or wants (the wishlist), apart from who is reading what. A
// reading entry started from a book carries data.bookId, so each book lists its readers (newest
// first). Adding a book by ISBN alone looks it up in Open Library (books.ts); details are copied in
// then, so browsing never calls out. Covers come through the server (GET .../cover), like reading
// entries' covers. Wall screens and kids' devices browse, add and edit (auth.ts display allow-list);
// removing a book is for parent devices.
import { libraryFormat, sameBook } from '../shelve.ts';
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { actorOf } from '../auth.ts';
import { checkRate } from '../ratelimit.ts';
import { fetchRecipeImage } from '../outbound.ts';
import { ErrorSchema, LibraryBookInputSchema, LibraryBookPatchSchema, LibraryBookSchema } from '../schemas.ts';
import { actorApi } from './lists.ts';
import { cleanDescription, searchOpenLibrary, workDescription } from './books.ts';
import { lookUpBook, lookUpInBackground } from '../book-details.ts';
import { todayIn } from './lists.ts';

export const libraryRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

export type LibraryRow = {
  id: string; title: string; author: string | null; isbn: string | null; pages: number | null; cover_url: string | null
  year: number | null; series: string | null; series_number: string | null; lexile: number | null; description: string | null; genres: string | null
  location: string | null; lent_to: string | null; lent_on: string | null
  work_key?: string | null; looked_up_at?: string | null; ratings_average?: number | null; ratings_count?: number | null
  borrowed_from: string | null; due_on: string | null; returned_on: string | null; wanted?: number; format?: string
  added_by: string | null; added_by_label: string | null; created_at: string; updated_at: string;
};
const parseGenres = (v: string | null): string[] => { try { const g = JSON.parse(v ?? '[]'); return Array.isArray(g) ? g.filter((x) => typeof x === 'string') : []; } catch { return []; } };
type Reader = { entryId: string; memberId: string | null; status: 'want' | 'reading' | 'finished'; readAt: string | null; narrator?: string | null; minutesListened?: number | null; totalMinutes?: number | null };

export function toLibraryApi(r: LibraryRow, readers: Reader[] = []) {
  return {
    id: r.id, format: libraryFormat(r.format), title: r.title, author: r.author, isbn: r.isbn, pages: r.pages, coverUrl: r.cover_url, year: r.year,
    series: r.series, seriesNumber: r.series_number, lexile: r.lexile, description: r.description && cleanDescription(r.description), genres: parseGenres(r.genres),
    workKey: r.work_key ?? null, ratingsAverage: r.ratings_average ?? null, ratingsCount: r.ratings_count ?? null, lookedUpAt: r.looked_up_at ?? null,
    location: r.location ?? null, lentTo: r.lent_to ?? null, lentOn: r.lent_on ?? null,
    borrowedFrom: r.borrowed_from ?? null, dueOn: r.due_on ?? null, returnedOn: r.returned_on ?? null, wanted: !!r.wanted,
    addedBy: actorApi(r.added_by, r.added_by_label), readers, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** Reading entries started from library books, by book id (reading data is plain JSON; health is sealed and never matches). */
async function readersByBook(c: C): Promise<Map<string, Reader[]>> {
  const { results } = await c.env.DB.prepare(
    `SELECT id, member_id, json_extract(data, '$.bookId') AS book_id, coalesce(json_extract(data, '$.status'), 'reading') AS status, json_extract(data, '$.format') AS format,
       json_extract(data, '$.narrator') AS narrator, json_extract(data, '$.minutesListened') AS listened, json_extract(data, '$.totalMinutes') AS total,
       json_extract(data, '$.finishedOn') AS finished_on, json_extract(data, '$.log[#-1].date') AS last_log, updated_at
       FROM tracker_entries WHERE kind = 'reading' AND json_extract(data, '$.bookId') IS NOT NULL ORDER BY created_at DESC`,
  ).all<{ id: string; member_id: string | null; book_id: string; status: Reader['status']; format: string | null; narrator: unknown; listened: unknown; total: unknown; finished_on: unknown; last_log: unknown; updated_at: string }>();
  const out = new Map<string, Reader[]>();
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  for (const r of results) {
    // An audiobook's listening, for the sheet and the spinning record (minutes; narrator).
    const audio = r.format === 'audiobook' ? { narrator: typeof r.narrator === 'string' ? r.narrator : null, minutesListened: num(r.listened), totalMinutes: num(r.total) } : {};
    // The latest reading (the library's Recently read sort): the day it was finished, else the last
    // day logged, else when a started entry last changed; want to read with nothing logged is none.
    const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
    const readAt = (r.status === 'finished' && day(r.finished_on)) || day(r.last_log) || (r.status !== 'want' ? day(r.updated_at) : null);
    out.set(r.book_id, [...(out.get(r.book_id) ?? []), { entryId: r.id, memberId: r.member_id, status: r.status, readAt, ...audio }]);
  }
  return out;
}

const householdDay = async (c: C) => todayIn((await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>())?.value);

const one = async (c: C, id: string) => {
  const row = await c.env.DB.prepare('SELECT * FROM library_books WHERE id = ?').bind(id).first<LibraryRow>();
  return row ? toLibraryApi(row, (await readersByBook(c)).get(id)) : null;
};
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });
const idParam = z.object({ id: z.string() });

libraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/library',
    tags: ['Trackers'],
    summary: "The family's library, A-Z (a series under its name, in order), each book with its readers. q searches titles, authors, series, genres, where it lives and who has it; format=book or audiobook keeps that format, unread=1 keeps books nobody has started, lent=1 books on loan, borrowed=1 borrowed books still out (soonest due first), returned=1 borrowed books that went back, wanted=1 the wishlist (both are left out otherwise), location one place.",
    security: [{ Bearer: [] }],
    request: { query: z.object({ q: z.string().max(100).optional(), format: z.enum(['book', 'audiobook']).optional(), unread: z.enum(['1', 'true']).optional(), lent: z.enum(['1', 'true']).optional(), borrowed: z.enum(['1', 'true']).optional(), returned: z.enum(['1', 'true']).optional(), wanted: z.enum(['1', 'true']).optional(), location: z.string().max(80).optional() }) },
    responses: { 200: { description: 'ok', content: json(z.array(LibraryBookSchema)) } },
  }),
  async (c) => {
    const { q, format, unread, lent, borrowed, returned, wanted, location } = c.req.valid('query');
    const like = q?.trim() ? `%${q.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM library_books ${like ? "WHERE title LIKE ?1 ESCAPE '\\' OR author LIKE ?1 ESCAPE '\\' OR series LIKE ?1 ESCAPE '\\' OR genres LIKE ?1 ESCAPE '\\' OR location LIKE ?1 ESCAPE '\\' OR lent_to LIKE ?1 ESCAPE '\\' OR borrowed_from LIKE ?1 ESCAPE '\\'" : ''} ORDER BY coalesce(series, title) COLLATE NOCASE, CAST(series_number AS REAL), title COLLATE NOCASE, created_at`, // a series together, in order
    ).bind(...(like ? [like] : [])).all<LibraryRow>();
    const readers = await readersByBook(c);
    const books = results.map((r) => toLibraryApi(r, readers.get(r.id)))
      .filter((b) => (!format || b.format === format) && (!unread || !b.readers.length) && (!lent || b.lentTo) && (!location || b.location === location)
        && (returned ? !!b.returnedOn : !b.returnedOn) && (wanted ? b.wanted : !b.wanted) && (!borrowed || !!b.borrowedFrom));
    if (borrowed) books.sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
    return c.json(books, 200);
  },
);

libraryRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/library/{id}', tags: ['Trackers'], summary: 'One library book, with its readers', security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: { 200: { description: 'ok', content: json(LibraryBookSchema) }, 404: { description: 'not found', content: json(ErrorSchema) } },
  }),
  async (c) => {
    const book = await one(c, c.req.valid('param').id);
    return book ? c.json(book, 200) : c.json({ error: 'not found' }, 404);
  },
);

libraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/library',
    tags: ['Trackers'],
    summary: "Add a book to the family's library. With only an isbn it's looked up (Open Library, through the server): title, author, pages, cover, year, series, reading level and description. A workKey (from GET /api/books/search) fetches the description. format: book (the default) or audiobook, each its own item. An ISBN already in the library is a 409 with that book.",
    security: [{ Bearer: [] }],
    request: { body: { content: json(LibraryBookInputSchema) } },
    responses: {
      201: { description: 'added', content: json(LibraryBookSchema) },
      400: { description: 'neither a title nor an isbn', content: json(ErrorSchema) },
      404: { description: 'nobody knows that ISBN', content: json(ErrorSchema) },
      409: { description: 'already in the library', content: json(z.object({ error: z.string(), book: LibraryBookSchema })) },
      429: { description: 'too many lookups', content: json(ErrorSchema) },
      502: { description: 'Open Library is unavailable', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    let input = c.req.valid('json');
    if (!input.title && !input.isbn) return c.json({ error: 'A title or an ISBN' }, 400);
    if (input.isbn) {
      const have = await c.env.DB.prepare('SELECT id FROM library_books WHERE isbn = ?').bind(input.isbn).first<{ id: string }>();
      if (have) { const book = (await one(c, have.id))!; return c.json({ error: `Already in the library: ${book.title}`, book }, 409); }
      // The same book saved without its ISBN (made from a reading entry, which has none): it's this one,
      // so it gets the ISBN rather than a twin. A sync that adds books by ISBN (Libro.fm) relies on it.
      // Only the same format: a paper copy's ISBN isn't the audiobook's.
      if (input.title) {
        const { results } = await c.env.DB.prepare('SELECT id, title, author FROM library_books WHERE isbn IS NULL AND format = ?').bind(input.format ?? 'book').all<{ id: string; title: string; author: string | null }>();
        const twin = results.find((b) => sameBook(b, { title: input.title!, author: input.author ?? null }));
        if (twin) {
          await c.env.DB.prepare('UPDATE library_books SET isbn = ?, looked_up_at = NULL, updated_at = ? WHERE id = ?').bind(input.isbn, new Date().toISOString(), twin.id).run();
          lookUpInBackground(c, twin.id); // an ISBN finds what its title alone may not have
          const book = (await one(c, twin.id))!;
          return c.json({ error: `Already in the library: ${book.title}`, book }, 409);
        }
      }
    }
    if (!input.title || input.workKey) {
      if (!(await checkRate(c.env.DB, 'books', 30, 60_000))) return c.json({ error: 'Too many lookups - try again in a minute' }, 429);
    }
    let lookedUp = !!input.workKey; // its details came from Open Library already
    let ratings: { average: number | null; count: number | null } = { average: null, count: null };
    if (!input.title) {
      let found;
      try { found = (await searchOpenLibrary(input.isbn!, 1))[0]; }
      catch (err) { console.error('library lookup failed', err instanceof Error ? err.message : err); return c.json({ error: 'Book lookup is unavailable right now' }, 502); }
      if (!found) return c.json({ error: "Couldn't find that book" }, 404);
      lookedUp = true;
      ratings = { average: found.ratingsAverage ?? null, count: found.ratingsCount ?? null };
      input = { title: found.title, author: found.author, pages: found.pages, coverUrl: found.coverUrl, year: found.year, series: found.series, seriesNumber: found.seriesNumber, lexile: found.lexile, genres: found.genres, workKey: found.workKey, ...input };
    }
    const description = input.description ?? (input.workKey ? await workDescription(input.workKey) : null);
    const by = await actorOf(c);
    const now = new Date().toISOString();
    const row: LibraryRow = {
      id: crypto.randomUUID(), title: input.title!.trim(), author: input.author?.trim() || null, isbn: input.isbn ?? null, pages: input.pages ?? null,
      cover_url: input.coverUrl ?? null, year: input.year ?? null, series: input.series?.trim() || null, series_number: input.seriesNumber?.trim() || null,
      lexile: input.lexile ?? null, description, genres: input.genres?.length ? JSON.stringify(input.genres) : null,
      location: input.location || null, lent_to: input.lentTo || null, lent_on: input.lentTo ? input.lentOn ?? (await householdDay(c)) : null,
      borrowed_from: input.borrowedFrom || null, due_on: input.borrowedFrom ? input.dueOn ?? null : null, returned_on: input.borrowedFrom ? input.returnedOn ?? null : null,
      wanted: input.wanted && !input.borrowedFrom ? 1 : 0, format: input.format ?? 'book', added_by: by.memberId, added_by_label: by.label, created_at: now, updated_at: now,
      work_key: input.workKey ?? null, looked_up_at: lookedUp ? now : null, ratings_average: ratings.average, ratings_count: ratings.count,
    };
    await c.env.DB.prepare(
      'INSERT INTO library_books (id, title, author, isbn, pages, cover_url, year, series, series_number, lexile, description, genres, location, lent_to, lent_on, borrowed_from, due_on, returned_on, wanted, format, added_by, added_by_label, created_at, updated_at, work_key, looked_up_at, ratings_average, ratings_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ).bind(row.id, row.title, row.author, row.isbn, row.pages, row.cover_url, row.year, row.series, row.series_number, row.lexile, row.description, row.genres, row.location, row.lent_to, row.lent_on, row.borrowed_from, row.due_on, row.returned_on, row.wanted, row.format, row.added_by, row.added_by_label, row.created_at, row.updated_at, row.work_key, row.looked_up_at, row.ratings_average, row.ratings_count).run();
    emit(c, 'tracker.changed', { library: row.id });
    if (!lookedUp) lookUpInBackground(c, row.id); // details it came without (book-details.ts)
    return c.json(toLibraryApi(row), 201);
  },
);

libraryRoutes.openapi(
  createRoute({
    method: 'patch', path: '/api/library/{id}', tags: ['Trackers'], summary: 'Edit a library book. Only given fields change; null clears one.', security: [{ Bearer: [] }],
    request: { params: idParam, body: { content: json(LibraryBookPatchSchema) } },
    responses: {
      200: { description: 'ok', content: json(LibraryBookSchema) }, 404: { description: 'not found', content: json(ErrorSchema) },
      409: { description: 'another book has that ISBN', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const p = c.req.valid('json');
    const r = await c.env.DB.prepare('SELECT * FROM library_books WHERE id = ?').bind(id).first<LibraryRow>();
    if (!r) return c.json({ error: 'not found' }, 404);
    if (p.isbn && p.isbn !== r.isbn && (await c.env.DB.prepare('SELECT 1 FROM library_books WHERE isbn = ? AND id != ?').bind(p.isbn, id).first())) return c.json({ error: 'Another book in the library has that ISBN' }, 409);
    const v = <K extends keyof typeof p>(k: K, old: unknown) => (p[k] !== undefined ? p[k] : old);
    const next: LibraryRow = {
      ...r, title: p.title?.trim() || r.title, author: v('author', r.author) as string | null, isbn: v('isbn', r.isbn) as string | null,
      pages: v('pages', r.pages) as number | null, cover_url: v('coverUrl', r.cover_url) as string | null, year: v('year', r.year) as number | null,
      series: v('series', r.series) as string | null, series_number: v('seriesNumber', r.series_number) as string | null,
      lexile: v('lexile', r.lexile) as number | null, description: v('description', r.description) as string | null,
      genres: p.genres !== undefined ? (p.genres.length ? JSON.stringify(p.genres) : null) : r.genres,
      location: p.location !== undefined ? p.location || null : r.location,
      // Lent: dated today unless told otherwise (a new borrower is a new loan); back home clears both.
      lent_to: p.lentTo !== undefined ? p.lentTo || null : r.lent_to,
      lent_on: p.lentTo === null || p.lentTo === '' ? null : p.lentOn !== undefined ? p.lentOn : p.lentTo && p.lentTo !== r.lent_to ? await householdDay(c) : r.lent_on,
      // Borrowed: due and returned dates go with it; made the family's own, both clear.
      borrowed_from: p.borrowedFrom !== undefined ? p.borrowedFrom || null : r.borrowed_from,
      due_on: p.borrowedFrom === null || p.borrowedFrom === '' ? null : v('dueOn', r.due_on) as string | null,
      returned_on: p.borrowedFrom === null || p.borrowedFrom === '' ? null : v('returnedOn', r.returned_on) as string | null,
      format: p.format ?? r.format,
      wanted: p.borrowedFrom ? 0 : p.wanted !== undefined ? (p.wanted ? 1 : 0) : r.wanted ?? 0, // borrowing it: had, for now
      updated_at: new Date().toISOString(),
    };
    await c.env.DB.prepare('UPDATE library_books SET title=?, author=?, isbn=?, pages=?, cover_url=?, year=?, series=?, series_number=?, lexile=?, description=?, genres=?, location=?, lent_to=?, lent_on=?, borrowed_from=?, due_on=?, returned_on=?, wanted=?, format=?, updated_at=? WHERE id=?')
      .bind(next.title, next.author, next.isbn, next.pages, next.cover_url, next.year, next.series, next.series_number, next.lexile, next.description, next.genres, next.location, next.lent_to, next.lent_on, next.borrowed_from, next.due_on, next.returned_on, next.wanted, next.format, next.updated_at, id).run();
    emit(c, 'tracker.changed', { library: id });
    return c.json((await one(c, id))!, 200);
  },
);

libraryRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/library/{id}/details', tags: ['Trackers'], security: [{ Bearer: [] }],
    summary: "Look a book's details up on Open Library now (parent devices): by its ISBN, else its title and author. Fills only what's empty (description, year, series, genres, reading level, pages, cover, ISBN) and its Open Library ratings; a 404 when Open Library has no confident match.",
    request: { params: idParam },
    responses: {
      200: { description: 'looked up', content: json(LibraryBookSchema) },
      404: { description: 'no such book, or Open Library has no match', content: json(ErrorSchema) },
      429: { description: 'too many lookups', content: json(ErrorSchema) },
      502: { description: 'Open Library is unavailable', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    let result;
    try { result = await lookUpBook(c.env.DB, id); }
    catch (err) { console.error('library details lookup failed', err instanceof Error ? err.message : err); return c.json({ error: 'Book lookup is unavailable right now' }, 502); }
    if (result === 'busy') return c.json({ error: 'Too many lookups - try again in a minute' }, 429);
    if (result === 'gone') return c.json({ error: 'not found' }, 404);
    if (result === 'none') return c.json({ error: "Open Library doesn't know this book" }, 404);
    emit(c, 'tracker.changed', { library: id });
    return c.json((await one(c, id))!, 200);
  },
);

libraryRoutes.openapi(
  createRoute({
    method: 'delete', path: '/api/library/{id}', tags: ['Trackers'], summary: 'Remove a book from the library (parent devices). Reading entries started from it stay.', security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: { 200: { description: 'ok', content: json(z.object({ ok: z.boolean() })) } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await c.env.DB.prepare('DELETE FROM library_books WHERE id = ?').bind(id).run();
    emit(c, 'tracker.changed', { library: id });
    return c.json({ ok: true }, 200);
  },
);

// The book's cover, fetched by the server from its own coverUrl (never a URL from the request); ?key= for <img>.
libraryRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/library/{id}/cover', tags: ['Trackers'], summary: "A library book's cover (its coverUrl, fetched by the server)", security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: {
      200: { description: 'the image', content: { 'image/*': { schema: z.string().openapi({ format: 'binary' }) } } },
      400: { description: 'the stored address is not allowed', content: json(ErrorSchema) },
      404: { description: 'not found, or no cover', content: json(ErrorSchema) },
      502: { description: 'the image could not be fetched', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const row = await c.env.DB.prepare('SELECT cover_url FROM library_books WHERE id = ?').bind(c.req.valid('param').id).first<{ cover_url: string | null }>();
    if (!row?.cover_url) return c.json({ error: 'no cover' }, 404);
    const result = await fetchRecipeImage(c.env, row.cover_url, 'book cover');
    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.body(result.image, 200, { 'Content-Type': result.type, 'Cache-Control': 'private, max-age=604800', ...(result.etag && { ETag: result.etag }) });
  },
);
