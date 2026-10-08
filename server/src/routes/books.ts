// Book lookup for the reading tracker: Open Library (free and keyless) through the server, so the
// browser never talks to a third party and the CSP stays 'self'. Only the typed search is sent.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { checkRate } from '../ratelimit.ts';
import { fetchRecipeImage } from '../outbound.ts';
import { BookResultSchema, ErrorSchema } from '../schemas.ts';

export const booksRoutes = createRouter();

const TIMEOUT_MS = 8000;
const USER_AGENT = 'Kinwall/1.0 (https://kinwall.family; self-hosted family calendar)'; // Open Library asks apps to name themselves
const coverUrl = (id: number) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
const json = <T extends z.ZodType>(schema: T) => ({ 'application/json': { schema } });

type Doc = {
  key?: string; title?: string; author_name?: string[]; first_publish_year?: number; number_of_pages_median?: number; cover_i?: number
  isbn?: string[]; series_name?: string[]; series_position?: string[]; lexile?: number[]; subject?: string[]; ratings_average?: number; ratings_count?: number
};
export type BookResult = z.infer<typeof BookResultSchema>;
const FIELDS = 'key,title,author_name,first_publish_year,number_of_pages_median,cover_i,isbn,series_name,series_position,lexile,subject,ratings_average,ratings_count';

// Open Library has no genre, only free-form subjects in many languages ("Katzen", "Fantasy Fiction",
// "nyt:hardcover-fiction=2021-05-23"). These pick a few clean genres out, in this order of priority.
const GENRES: [string, RegExp][] = [
  ['Fantasy', /\bfantasy\b|\bmagic\b|\bdragons?\b|\bwizards?\b/i],
  ['Science fiction', /science[ -]?fiction|\bsci-?fi\b/i],
  ['Mystery', /\bmyster(y|ies)\b|\bdetective\b/i],
  ['Adventure', /\badventure/i],
  ['Animals', /\banimals?\b|\bcats?\b|\bdogs?\b|\bhorses?\b/i],
  ['Historical fiction', /historical fiction/i],
  ['Humor', /\bhumou?r|\bfunny\b/i],
  ['Graphic novel', /graphic novels?|\bcomics?\b/i],
  ['Picture book', /picture books?/i],
  ['Poetry', /\bpoetry\b|\bpoems\b/i],
  ['Biography', /\b(auto)?biograph|\bmemoir/i],
  ['Romance', /\bromance\b|love stories/i],
  ['Horror', /\bhorror\b|\bghost stories\b/i],
  ['Sports', /\bsports?\b|\bsoccer\b|\bbaseball\b|\bfootball\b|\bbasketball\b/i],
  // Who it's for, which the library's Kids shelf goes by (shelve.ts autoShelf).
  ['Young adult', /young adult/i],
  ["Children's", /\bjuvenile (fiction|literature|works|nonfiction)|children'?s (fiction|books?|stories|literature)|\bmiddle[ -]grade\b/i],
];
/** Up to five genres from a book's subjects, in GENRES order. */
export function genresFrom(subjects: string[] | undefined): string[] {
  const text = (subjects ?? []).slice(0, 60).join(' | ');
  return GENRES.filter(([, re]) => re.test(text)).map(([g]) => g).slice(0, 5);
}

/** Open Library's books for a search (title, author or ISBN), shaped for Kinwall; throws when unreachable. */
/** " (Open Library answered 503)" or " (Open Library didn't answer)" for an error message, else "". */
export function why(err: unknown): string {
  const m = err instanceof Error ? err.message : ''
  if (/answered \d{3}/.test(m)) return ` (${m})`
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return " (Open Library didn't answer)"
  return ''
}

export async function searchOpenLibrary(q: string, limit = 8): Promise<BookResult[]> {
  const params = new URLSearchParams({ q, limit: String(limit), fields: FIELDS });
  const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
  const { docs = [] } = (await res.json()) as { docs?: Doc[] };
  return docs.filter((d) => d.title).map((d) => {
    const isbn = d.isbn?.find((i) => i.length === 13) ?? d.isbn?.[0];
    return {
      title: d.title!,
      ...(d.author_name?.[0] && { author: d.author_name[0] }),
      ...(d.first_publish_year && { year: d.first_publish_year }),
      ...(d.number_of_pages_median && { pages: d.number_of_pages_median }),
      ...(d.cover_i && { coverId: d.cover_i, coverUrl: coverUrl(d.cover_i) }),
      ...(isbn && { isbn }),
      ...(d.series_name?.[0] && { series: d.series_name[0], ...(d.series_position?.[0] && { seriesNumber: d.series_position[0] }) }),
      ...(d.lexile?.[0] !== undefined && { lexile: d.lexile[0] }),
      ...(genresFrom(d.subject).length && { genres: genresFrom(d.subject) }),
      ...(d.key?.startsWith('/works/') && { workKey: d.key }),
      ...(d.ratings_count && d.ratings_average && { ratingsAverage: Math.round(d.ratings_average * 10) / 10, ratingsCount: d.ratings_count }),
    };
  });
}

/** Open Library writes descriptions in Markdown: links as [text][1] or [text](url) with "[1]: url"
 * footnotes, "([source][2])" credits, ---- rules, **bold** and _italics_. Plain text out, or null. */
export function cleanDescription(raw: string): string | null {
  const t = raw.replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*\[[^\]]+\]:[ \t]*\S.*$/gm, '') // [1]: https://… footnotes
    .replace(/\(\s*\[source\]\[[^\]]*\]\s*\)/gi, '') // ([source][2])
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1') // [text][1]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // [text](url)
    .replace(/^[ \t]*[-_*]{3,}[ \t]*$/gm, '') // ---- rules
    .replace(/(\*\*|__)(.+?)\1/g, '$2') // **bold**
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?=[^\w*]|$)/gm, '$1$2') // *italics*, _italics_
    .replace(/[ \t]+([.,;:!?])/g, '$1') // "King ." where a credit came out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t || null;
}

/** A work's description (its blurb), or null; never throws. */
export async function workDescription(workKey: string): Promise<string | null> {
  try {
    const res = await fetch(`https://openlibrary.org${workKey}.json`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const { description } = (await res.json()) as { description?: string | { value?: string } };
    const text = cleanDescription((typeof description === 'string' ? description : description?.value) ?? '');
    return text ? text.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

booksRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/books/search',
    tags: ['Trackers'],
    summary: 'Look up a book by title, author or ISBN (Open Library, server-side).',
    security: [{ Bearer: [] }],
    request: { query: z.object({ q: z.string().trim().min(2).max(200) }) },
    responses: {
      200: { description: 'ok', content: json(z.array(BookResultSchema)) },
      429: { description: 'too many lookups', content: json(ErrorSchema) },
      502: { description: 'lookup failed', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { q } = c.req.valid('query');
    if (!(await checkRate(c.env.DB, 'books', 30, 60_000))) return c.json({ error: 'Too many searches - try again in a minute' }, 429);
    try {
      return c.json(await searchOpenLibrary(q), 200);
    } catch (err) {
      console.error('book search failed', err instanceof Error ? err.message : err);
      return c.json({ error: `Book search is unavailable right now${why(err)}` }, 502);
    }
  },
);

// A search result's thumbnail. The address is built from the numeric id, never taken from the request.
booksRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/books/covers/{coverId}',
    tags: ['Trackers'],
    summary: "An Open Library cover thumbnail, by a search result's coverId.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ coverId: z.coerce.number().int().positive() }) },
    responses: {
      200: { description: 'the image', content: { 'image/*': { schema: z.string().openapi({ format: 'binary' }) } } },
      400: { description: 'invalid id', content: json(ErrorSchema) },
      502: { description: 'the image could not be fetched', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const result = await fetchRecipeImage(c.env, coverUrl(c.req.valid('param').coverId), 'book cover');
    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.body(result.image, 200, { 'Content-Type': result.type, 'Cache-Control': 'private, max-age=604800', ...(result.etag && { ETag: result.etag }) });
  },
);
