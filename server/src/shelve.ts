// Every book on someone's Reading shelf is in the family's library (routes/library.ts). A reading
// entry saved without data.bookId (the web, REST, MCP add_tracker_entry, a sync like Libro.fm) is
// linked to the library item with the same title and author and the same format (an audiobook entry
// to an audiobook, anything else to a book), or a new library item is made from it.
// A book on a shelf is one the family has, even if it's only "want to read" (an audiobook bought but
// not started): the wishlist is for books they don't have yet. Reading or finishing a wishlist book
// takes it off the wishlist. Removing an entry never removes its book, and an entry whose book was removed keeps
// its (dangling) bookId, so the book isn't made again. shelveReadingEntries does this once for
// entries from before (createKinwall runs it per server instance; done entries have a bookId, so
// it's a no-op after). Reading entries are plain JSON (only health is sealed).
import type { Env } from './env.ts';

type Db = Env['DB'];
type Book = { title: string; author: string | null };
export type LibraryFormat = 'book' | 'audiobook';
/** A reading entry's library format: an audiobook, or a book (paper, or anything else for now). */
export const libraryFormat = (format: string | null | undefined): LibraryFormat => (format === 'audiobook' ? 'audiobook' : 'book');
/** Who a library book is for: a parent's pick (library_books.shelf), or Auto (null), autoShelf's. Everyone is on both shelves. */
export const SHELVES = ['kids', 'grownups', 'everyone'] as const;
export type Shelf = (typeof SHELVES)[number];
const KIDS_GENRES = /children|juvenile|picture book|middle grade|young adult/i; // books.ts genresFrom's Children's, Young adult, Picture book
/** Auto: Kids when its genres say so (Open Library's juvenile, children's, picture book or young adult
 * subjects), its reading level is under 1000L, it's picture-book short (48 pages or fewer), or only
 * kids have read it or are reading it (`kids`: kids' member ids); otherwise Grown-ups. Never Everyone. */
export function autoShelf(b: { genres: string[]; lexile: number | null; pages: number | null; format?: string | null; readers: { memberId: string | null; status: string }[] }, kids: Set<string>): 'kids' | 'grownups' {
  if (b.genres.some((g) => KIDS_GENRES.test(g))) return 'kids';
  // ponytail: a lexile alone puts an easy-reading grown-up novel (some are 700-900L) on Kids; a parent picks Grown-ups for those.
  if (b.lexile !== null && b.lexile < 1000) return 'kids';
  if (libraryFormat(b.format) === 'book' && b.pages !== null && b.pages <= 48) return 'kids';
  const read = b.readers.filter((r) => r.status !== 'want' && r.memberId);
  return read.length && read.every((r) => kids.has(r.memberId!)) ? 'kids' : 'grownups';
}
type ReadingLike = { status?: string; format?: string; author?: string | null; totalPages?: number | null; coverUrl?: string | null; bookId?: string | null };

const words = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
/** A title for matching: no subtitle (after ':') or trailing "(Series, #1)", case and punctuation aside. */
const titleKey = (t: string) => words(t.split(':')[0].replace(/\([^)]*\)\s*$/, ''));
/** An author's names, initials run together ("E. B. White" and "EB White" are both eb, white). */
const authorWords = (a: string | null | undefined) => new Set(words(a ?? '').replace(/\b([a-z]) (?=[a-z]\b)/g, '$1').split(' ').filter(Boolean));

/** The same book: the same title (titleKey), and the same author in any order ("Weir, Andy"), or
 * one author's names among the other's (co-authors), or no author on one side. */
export function sameBook(a: Book, b: Book): boolean {
  if (titleKey(a.title) !== titleKey(b.title)) return false;
  const [x, y] = [authorWords(a.author), authorWords(b.author)];
  if (!x.size || !y.size) return true;
  const within = (p: Set<string>, q: Set<string>) => [...p].every((w) => q.has(w));
  return within(x, y) || within(y, x);
}

/** A reading entry's data with its library book: linked (or made) when it has none; reading or
 * finishing a wishlist book takes it off the wishlist. Returns the data to store. onMade: a new book's
 * id (routes look its details up, book-details.ts). */
export async function shelveReading<D extends ReadingLike>(db: Db, title: string, memberId: string | null, data: D, onMade?: (id: string) => void): Promise<D> {
  const wanting = (data.status ?? 'reading') === 'want';
  let bookId = data.bookId ?? null;
  if (!bookId) {
    // ponytail: every book's title and author per unlinked save; a title index if libraries get big.
    const format = libraryFormat(data.format);
    const { results } = await db.prepare('SELECT id, title, author FROM library_books WHERE format = ? ORDER BY created_at').bind(format).all<Book & { id: string }>();
    bookId = results.find((b) => sameBook(b, { title, author: data.author ?? null }))?.id ?? null;
    if (!bookId) {
      bookId = crypto.randomUUID();
      const now = new Date().toISOString();
      const pages = format === 'audiobook' ? null : data.totalPages ?? null; // an audiobook's length is minutes
      await db.prepare(
        'INSERT INTO library_books (id, title, author, pages, cover_url, genres, wanted, format, added_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      ).bind(bookId, title.trim(), data.author?.trim() || null, pages, data.coverUrl ?? null, null, 0, format, memberId, now, now).run(); // had, not wished for
      onMade?.(bookId);
      return { ...data, bookId };
    }
  }
  if (!wanting) await db.prepare('UPDATE library_books SET wanted = 0, updated_at = ? WHERE id = ? AND wanted = 1').bind(new Date().toISOString(), bookId).run();
  return data.bookId === bookId ? data : { ...data, bookId };
}

/** Puts every reading entry without a bookId in the library, oldest first (so two people's entries
 * for one book share it). Only adds books and sets bookId; never removes or edits anything else. */
export async function shelveReadingEntries(env: { DB: Db }): Promise<number> {
  let after = '';
  let done = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT id, member_id, title, data, created_at FROM tracker_entries WHERE kind = 'reading' AND json_extract(data, '$.bookId') IS NULL
         AND title IS NOT NULL AND (created_at || id) > ? ORDER BY created_at, id LIMIT 50`,
    ).bind(after).all<{ id: string; member_id: string | null; title: string; data: string; created_at: string }>();
    if (!results.length) return done;
    for (const r of results) {
      after = r.created_at + r.id;
      let data: ReadingLike;
      try { data = JSON.parse(r.data); } catch { continue; }
      const next = await shelveReading(env.DB, r.title, r.member_id, data);
      // Only if the entry is still what was read (a save in between links it itself).
      const { meta } = await env.DB.prepare('UPDATE tracker_entries SET data = ? WHERE id = ? AND data = ?').bind(JSON.stringify(next), r.id, r.data).run();
      done += meta.changes;
    }
  }
}
