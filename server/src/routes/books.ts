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

type Doc = { title?: string; author_name?: string[]; first_publish_year?: number; number_of_pages_median?: number; cover_i?: number };

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
      const params = new URLSearchParams({ q, limit: '8', fields: 'title,author_name,first_publish_year,number_of_pages_median,cover_i' });
      const res = await fetch(`https://openlibrary.org/search.json?${params}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Open Library answered ${res.status}`);
      const { docs = [] } = (await res.json()) as { docs?: Doc[] };
      return c.json(
        docs.filter((d) => d.title).map((d) => ({
          title: d.title!,
          ...(d.author_name?.[0] && { author: d.author_name[0] }),
          ...(d.first_publish_year && { year: d.first_publish_year }),
          ...(d.number_of_pages_median && { pages: d.number_of_pages_median }),
          ...(d.cover_i && { coverId: d.cover_i, coverUrl: coverUrl(d.cover_i) }),
        })),
        200,
      );
    } catch (err) {
      console.error('book search failed', err instanceof Error ? err.message : err);
      return c.json({ error: 'Book search is unavailable right now' }, 502);
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
