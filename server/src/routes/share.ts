// POST /api/share: the one "Add to Kinwall" iPhone Shortcut (docs/using/share-to-kinwall.md). Whatever
// is shared goes where it belongs, through what each area already does:
// - a link with no kind is read once and sent by its JSON-LD: Recipe → the recipe import (saved),
//   Restaurant/FoodEstablishment/LocalBusiness → the restaurant import; an Apple Maps place → restaurant
// - a photo or text comes with kind from the Shortcut's "What is this?" menu (Kinwall never guesses):
//   restaurant (menu text) → the restaurant import; book → an ISBN in it is added like add-by-ISBN,
//   else its title and author, only when Open Library has one clear match; event → a link that opens
//   the event sheet filled in, to check first, with what was read (event), or with save and calendarId
//   added to that calendar through POST /api/events's createEvent (the app's share sheets, once the
//   person has checked the fields there; event carries what they changed).
// The answer is always { kind, summary, link, review }: summary is the notification line, link opens the
// result (or the thing to check, review: true). Errors carry summary too. Parent devices only (not in
// auth.ts's display allow-list).
// preview (the phones' share sheets): a recipe, restaurant or book comes back as what would be saved
// (preview, review: true) and nothing is saved; the same share again without preview saves it. A
// link's preview has a token: sent with the save, the page read for the preview is used, not read again.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { fetchRecipePage } from '../outbound.ts';
import { parseRecipeHtml } from '../recipe-web.ts';
import { mapsPlace, nameKey, normalizeLink, parseRestaurantHtml } from '../restaurant-import.ts';
import { bookQuery, findIsbn, parseEventText } from '../share-text.ts';
import { autoShelf, sameBook } from '../shelve.ts';
import { checkRate } from '../ratelimit.ts';
import { formatTime, hour12For } from '../timeFormat.ts';
import { andList, importRestaurant, LABEL, planRestaurant, RestaurantImportSchema } from './restaurants.ts';
import { saveWebRecipe } from './meals.ts';
import { readSettings } from './settings.ts';
import { searchOpenLibrary, why } from './books.ts';
import { todayInTz } from './members.ts';
import { createEvent } from './events.ts';
import { zonedTimeToUtc } from '../recurrence.ts';

type C = Context<{ Bindings: Env }>;
/** The app, to add a book through POST /api/library itself (as the MCP tools do). */
type App = { request: (path: string, init: RequestInit, env: Env) => Response | Promise<Response> };

const KINDS = ['recipe', 'restaurant', 'book', 'event'] as const;
/** A link to show on a card: its host and path, shortened ("cornerslice.example/order…"). */
export const shortLink = (u: string) => { const l = u.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, ''); return l.length > 40 ? `${l.slice(0, 39)}…` : l; };
// Shortcuts sends an unset variable as "" and a switch as text.
const blankOff = (v: unknown) => (v === '' || v === null ? undefined : v === 'true' ? true : v === 'false' ? false : v);
const EventDraftSchema = z.object({
  title: z.string().max(200).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe('YYYY-MM-DD'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().describe('Start, HH:MM in the household timezone; none is all day'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().describe('End, HH:MM; one before the start is the next day; none: the family\'s new event length (settings.defaultEventMinutes)'),
  place: z.string().max(500).nullable(),
  notes: z.string().max(5000).nullable().describe('Anything else worth knowing (what to bring, costs, how to RSVP); saved as the event\'s notes'),
}).openapi('ShareEvent');
export const ShareInputSchema = RestaurantImportSchema.extend({
  // Shortcuts sends an unset variable as "" and a menu item as typed ("Book"): both are fine.
  kind: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() || undefined : v), z.enum(KINDS).optional()).describe('What it is. Leave it out for a link: Kinwall reads the page. Photos and text need it (the Shortcut\'s "What is this?" menu).'),
  url: z.string().max(5000).nullable().optional().describe('A shared link: a recipe or restaurant page, or an Apple Maps place.'),
  text: z.string().max(100000).nullable().optional().describe('Text from a photo or a share: a menu (restaurant), an ISBN or a title and author (book), or a flyer or invite (event). "Title:", "Date:", "Time:", "Place:" and "Notes:" lines help an event; "Title:" and "Author:" a book. The first of each line wins, so a model\'s lines can go first, then a "---" line, then the words as read: a Place with no street takes the street from them, a bare street the "at" venue line above it, and a Time with no am/pm or end the words\' fuller time. Leftover lines worth knowing become notes.'),
  event: EventDraftSchema.partial().nullable().optional().describe('An event as the person checked it (from a previous answer\'s event); used instead of text.'),
  save: z.preprocess(blankOff, z.boolean().optional()).describe('kind event only: add it to calendarId now instead of answering with a link to check it.'),
  calendarId: z.preprocess(blankOff, z.string().optional()).describe('With save: the calendar to add the event to (GET /api/calendars, one that is writable). Left out: the default calendar (default: true).'),
  preview: z.preprocess(blankOff, z.boolean().optional()).describe('A recipe, restaurant or book: answer with what would be saved (preview, review: true) and save nothing. Share it again without preview to save it. An event or a book to pick answers as it does without it.'),
  token: z.preprocess(blankOff, z.string().max(100).optional()).describe("With the save after a link's preview: its preview.token, so the page it read is used instead of reading it again (for 10 minutes, once)."),
}).openapi('ShareInput');
const ShareResultSchema = z.object({
  kind: z.enum(KINDS),
  summary: z.string().describe('One line for a notification, e.g. "Added Wool to the library" or "Check the event: Spring fair, Sat May 9".'),
  link: z.string().describe('A Kinwall address that opens what was added, or the thing to check.'),
  review: z.boolean().describe('True when nothing was saved yet: open link to check it (an event, or a book with no clear match).'),
  event: EventDraftSchema.optional().describe('An event to check: what was read, for a form to show before saving it.'),
  preview: z.object({
    title: z.string(), imageUrl: z.string().nullable().describe("The recipe's photo or the book's cover."),
    exists: z.boolean().describe('Already in Kinwall: saving updates it (a recipe), adds what\'s new (a restaurant) or adds nothing (a book).'),
    lines: z.array(z.string()).describe('The key facts as short lines to show, e.g. "Serves 4", "12 ingredients, 6 steps".'),
    already: z.string().nullable().describe('When it exists, one line saying so, e.g. "Already in Kinwall: 12 new items will be added."'),
    token: z.string().nullable().describe('A link\'s preview: send it back with the save.'),
    recipe: z.object({ servings: z.number().nullable(), ingredients: z.number().int(), steps: z.number().int(), totalMinutes: z.number().nullable(), site: z.string().nullable() }).optional(),
    restaurant: z.object({ cuisine: z.string().nullable(), phone: z.string().nullable(), address: z.string().nullable(), items: z.number().int(), sections: z.number().int(),
      added: z.number().int().describe('Menu items saving adds.'), alreadyThere: z.number().int().describe('Menu items already on its menu.') }).optional(),
    book: z.object({ author: z.string().nullable(), format: z.enum(['book', 'audiobook']), shelf: z.enum(['kids', 'grownups', 'everyone']).describe('The shelf it lands on (Auto, unless a parent picked one for a book already there).') }).optional(),
  }).optional().describe('With preview: what would be saved. Nothing is saved yet (review is true).'),
}).openapi('ShareResult');
const ShareErrorSchema = z.object({ error: z.string(), summary: z.string().describe('The same as error, for the notification.') });
const err = { content: { 'application/json': { schema: ShareErrorSchema } } };

type Page = { db: unknown; url: string; at: number; recipe: ReturnType<typeof parseRecipeHtml>; place: ReturnType<typeof parseRestaurantHtml> };
// Pages read for a preview, by token, for the save that follows: 10 minutes, used once, at most 50.
// db: only the family that read it gets it back (hosted families can share one process).
const pages = new Map<string, Page>();
const PAGE_MS = 10 * 60_000;
function keepPage(page: Omit<Page, 'at'>) {
  for (const [k, p] of pages) if (Date.now() - p.at > PAGE_MS || pages.size >= 50) pages.delete(k); else break;
  const token = crypto.randomUUID();
  pages.set(token, { ...page, at: Date.now() });
  return token;
}
function takePage(token: string | undefined, db: unknown, url: string) {
  const p = token ? pages.get(token) : undefined;
  if (!p || p.db !== db || p.url !== url || Date.now() - p.at > PAGE_MS) return null;
  pages.delete(token!);
  return p;
}
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const minutes = (m: number) => [m >= 60 && `${Math.floor(m / 60)} hr`, m % 60 && `${m % 60} min`].filter(Boolean).join(' ');
const SHELF = { kids: 'Kids', grownups: 'Grown-ups', everyone: 'Everyone' } as const;
type Preview = NonNullable<z.infer<typeof ShareResultSchema>['preview']>;

const origin = (c: C) => (c.env.PUBLIC_URL ? new URL(c.env.PUBLIC_URL).origin : new URL(c.req.url).origin);
const MEALS_OFF = 'Meals is turned off in Settings → General → Features';

export function shareRoutes(app: App) {
  const routes = createRouter();
  routes.openapi(createRoute({
    method: 'post', path: '/api/share', tags: ['Share'], security: [{ Bearer: [] }],
    summary: 'Add whatever a phone shares (the "Add to Kinwall" Shortcut): a recipe or restaurant link (read once, sent by its schema.org type), an Apple Maps place, a menu, a book (ISBN, or title and author) or an event to check before it is saved (admin)',
    request: { body: { content: { 'application/json': { schema: ShareInputSchema } } } },
    responses: {
      200: { description: 'added, or a link to check it', content: { 'application/json': { schema: ShareResultSchema } } },
      400: { description: 'nothing to add, or a link Kinwall can\'t place (say what it is with kind)', ...err }, 403: { description: 'parent device required, or that area is turned off', ...err },
      404: { description: 'nobody knows that ISBN', ...err }, 422: { description: 'no recipe on the page', ...err }, 429: { description: 'too many book lookups', ...err }, 502: { description: 'the page or Open Library could not be reached', ...err },
    },
  }), async (c) => {
    const fail = (error: string, status: 400 | 403 | 404 | 422 | 429 | 502) => c.json({ error, summary: error }, status);
    const ok = (kind: (typeof KINDS)[number], summary: string, path: string, review = false) => c.json({ kind, summary, link: `${origin(c)}/#/${path}`, review }, 200);
    const shown = (kind: (typeof KINDS)[number], path: string, preview: Preview) => c.json({ kind, summary: `Ready to add: ${preview.title}`, link: `${origin(c)}/#/${path}`, review: true, preview }, 200);
    const input = c.req.valid('json');
    const settings = await readSettings(c.env.DB);
    const text = input.text?.trim() || '';
    // Shared text that is only a link is a link.
    const url = normalizeLink(input.url ?? (/^https?:\/\/\S+$/i.test(text) ? text : null));
    if (input.url?.trim() && !url) return fail('Kinwall can only read web links (https).', 400);
    let kind = input.kind;

    const restaurant = async (page?: ReturnType<typeof parseRestaurantHtml>, token: string | null = null) => {
      if (!settings.features.meals) return fail(MEALS_OFF, 403);
      const { kind: _k, text: _t, preview: _p, token: _tk, ...fields } = input;
      const body = { ...fields, url, menuText: input.menuText ?? (text && text !== url ? text : null) };
      if (input.preview) {
        const plan = await planRestaurant(c, body, page);
        if (typeof plan === 'string') return fail(plan, 400);
        const { fields: f, name, old, filled, incoming, added, skipped, sections, qr, read } = plan;
        const pick = (k: 'cuisine' | 'phone' | 'address') => old?.[k] || f[k] || null;
        const r = { cuisine: pick('cuisine'), phone: pick('phone'), address: pick('address'), items: incoming.length, sections, added: added.length, alreadyThere: skipped };
        const already = !old ? null
          : added.length ? `Already in Kinwall: ${plural(added.length, 'new item')} will be added${skipped ? `, ${skipped} ${skipped === 1 ? 'is' : 'are'} already there` : ''}.`
          : filled.length ? `Already in Kinwall: its ${andList(filled.map((k) => LABEL[k]))} will be filled in.` : 'Already in Kinwall and up to date.';
        const items = r.items ? `${plural(r.items, 'menu item')}${sections > 1 ? ` in ${sections} sections` : ''}` : null;
        // Links read off a QR code (or given) that saving fills in, each on its own line to check.
        const links = [filled.includes('website') && read.website && `Website: ${shortLink(f.website!)}`, filled.includes('orderUrl') && `Order online: ${shortLink(f.orderUrl!)}`, filled.includes('menuUrl') && `Menu link: ${shortLink(f.menuUrl!)}`,
          qr && qr !== f.orderUrl && qr !== f.menuUrl && qr !== f.website && `Found a QR code: ${shortLink(qr)}, not sure what it's for`];
        return shown('restaurant', old ? `meals?restaurant=${encodeURIComponent(old.id)}` : 'meals', {
          title: old?.name ?? name, imageUrl: null, exists: !!old, lines: [r.cuisine, r.phone, r.address, ...links, items].filter((l): l is string => !!l), already, token, restaurant: r,
        });
      }
      const result = await importRestaurant(c, body, page);
      return typeof result === 'string' ? fail(result, 400) : ok('restaurant', result.summary, `meals?restaurant=${encodeURIComponent(result.restaurant.id)}`);
    };

    // An Apple Maps link is never fetched (it's read off the link itself), whatever it's shared as.
    if (url && kind === 'recipe' && mapsPlace(url)) return fail('This page has no recipe Kinwall can read.', 422);
    if (url && (kind === 'recipe' || (!kind && !mapsPlace(url)))) {
      if (kind && !settings.features.meals) return fail(MEALS_OFF, 403);
      let read = takePage(input.token, c.env.DB, url);
      if (!read) {
        // https only (an http:// link is tried as https), unless a self-hoster allows private addresses.
        const page = await fetchRecipePage(c.env, c.env.ALLOW_PRIVATE_FEED_URLS === '1' ? url : url.replace(/^http:/i, 'https:'));
        if ('error' in page) return fail(`${page.error[0].toUpperCase()}${page.error.slice(1)}.`, page.status);
        const recipe = parseRecipeHtml(page.html, page.url);
        read = { db: c.env.DB, url, at: 0, recipe, place: recipe ? null : parseRestaurantHtml(page.html, page.url) };
      }
      const { recipe, place } = read;
      const token = input.preview ? keepPage(read) : null;
      if (kind === 'recipe' && !recipe?.name) return fail('This page has no recipe Kinwall can read.', 422);
      if (recipe?.name) {
        if (!settings.features.meals) return fail(MEALS_OFF, 403);
        if (input.preview) {
          const have = recipe.sourceUrl ? await c.env.DB.prepare("SELECT id FROM recipes WHERE source = 'web' AND external_id = ?").bind(recipe.sourceUrl).first<{ id: string }>() : null;
          let site: string | null = null;
          try { site = new URL(recipe.sourceUrl ?? url).hostname.replace(/^www\./, ''); } catch { /* no address */ }
          const r = { servings: recipe.servings, ingredients: recipe.ingredients.length, steps: recipe.steps.length, totalMinutes: recipe.totalMinutes, site };
          const lines = [r.servings && `Serves ${r.servings}`, `${plural(r.ingredients, 'ingredient')}, ${plural(r.steps, 'step')}`, r.totalMinutes && `Ready in ${minutes(r.totalMinutes)}`, site && `From ${site}`];
          return shown('recipe', have ? `meals?recipe=${encodeURIComponent(have.id)}` : 'meals', {
            title: recipe.name, imageUrl: recipe.imageUrl, exists: !!have, lines: lines.filter((l): l is string => !!l),
            already: have ? 'Already in Kinwall: adding it again updates it.' : null, token, recipe: r,
          });
        }
        const saved = await saveWebRecipe(c, { ...recipe, name: recipe.name });
        return ok('recipe', `${saved.created ? 'Imported' : 'Updated'} ${saved.recipe.name}`, `meals?recipe=${encodeURIComponent(saved.recipe.id)}`);
      }
      if (place) return restaurant(place, token);
      return fail("Kinwall can't tell what this link is. Pick what it is (Recipe or Restaurant) and share it again.", 400);
    }
    if (url && !kind) kind = 'restaurant'; // an Apple Maps place
    if (kind === 'restaurant') return restaurant();

    if (kind === 'book') {
      if (!settings.features.trackersReading) return fail('Reading is turned off in Settings → General → Features', 403);
      const add = async (body: object) => {
        const res = await app.request('/api/library', { method: 'POST', headers: { Authorization: c.req.header('Authorization') ?? '', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, c.env);
        const json = (await res.json()) as { id?: string; title?: string; error?: string; book?: { id: string; title: string } };
        const book = res.status === 409 ? json.book : json;
        if (res.status === 201 || (res.status === 409 && book?.id)) {
          return ok('book', res.status === 201 ? `Added ${book!.title} to the library` : `${book!.title} is already in the library`, `trackers/library?book=${encodeURIComponent(book!.id!)}`);
        }
        return fail(json.error ?? "Couldn't add the book", ([400, 404, 429, 502].includes(res.status) ? res.status : 502) as 400 | 404 | 429 | 502);
      };
      const get = async (path: string) => {
        const res = await app.request(path, { headers: { Authorization: c.req.header('Authorization') ?? '' } }, c.env);
        return res.ok ? ((await res.json()) as { id: string; title: string; author: string | null; coverUrl: string | null; format: 'book' | 'audiobook'; effectiveShelf: 'kids' | 'grownups' | 'everyone' }) : null;
      };
      // What adding would do: a book already there (by ISBN, or one saved without it, as POST /api/library matches), else what was found.
      const look = async (found: { title: string; author?: string; coverUrl?: string; isbn?: string; genres?: string[]; lexile?: number; pages?: number }) => {
        let have = found.isbn ? await c.env.DB.prepare('SELECT id FROM library_books WHERE isbn = ?').bind(found.isbn).first<{ id: string }>() : null;
        if (!have && found.isbn) {
          const { results } = await c.env.DB.prepare("SELECT id, title, author FROM library_books WHERE isbn IS NULL AND format = 'book'").all<{ id: string; title: string; author: string | null }>();
          have = results.find((b) => sameBook(b, { title: found.title, author: found.author ?? null })) ?? null;
        }
        const old = have ? await get(`/api/library/${encodeURIComponent(have.id)}`) : null;
        const b = old
          ? { author: old.author, format: old.format, shelf: old.effectiveShelf, title: old.title, cover: old.coverUrl }
          : { author: found.author ?? null, format: 'book' as const, shelf: autoShelf({ genres: found.genres ?? [], lexile: found.lexile ?? null, pages: found.pages ?? null, format: 'book', readers: [] }, new Set()), title: found.title, cover: found.coverUrl ?? null };
        return shown('book', old ? `trackers/library?book=${encodeURIComponent(old.id)}` : 'trackers/library', {
          title: b.title, imageUrl: b.cover, exists: !!old, already: old ? 'Already in the library.' : null, token: null,
          lines: [b.author && `By ${b.author}`, b.format === 'audiobook' ? 'Audiobook' : 'Book', `Shelf: ${SHELF[b.shelf]}${old ? '' : ' (Auto)'}`].filter((l): l is string => !!l),
          book: { author: b.author, format: b.format, shelf: b.shelf },
        });
      };
      const isbn = findIsbn(`${text}\n${url ?? ''}`);
      if (isbn && input.preview) {
        const have = await c.env.DB.prepare('SELECT id FROM library_books WHERE isbn = ?').bind(isbn).first<{ id: string }>();
        if (have) return look({ title: '', isbn });
        if (!(await checkRate(c.env.DB, 'books', 30, 60_000))) return fail('Too many lookups - try again in a minute', 429);
        let found;
        try { found = (await searchOpenLibrary(isbn, 1))[0]; }
        catch (e) { return fail(`Book lookup is unavailable right now${why(e)}`, 502); }
        if (!found) return fail("Couldn't find that book", 404);
        return look({ ...found, isbn });
      }
      if (isbn) return add({ isbn });
      const q = bookQuery(text || input.name || '');
      if (!q.title) return fail("Send the book's barcode, ISBN or title.", 400);
      if (!(await checkRate(c.env.DB, 'books', 30, 60_000))) return fail('Too many lookups - try again in a minute', 429);
      let results;
      try { results = await searchOpenLibrary(`${q.title} ${q.author ?? ''}`.trim(), 5); }
      catch (e) { return fail(`Book lookup is unavailable right now${why(e)}`, 502); }
      // One clear match: the same title, one author among those results, and an author if one was given.
      const hits = results.filter((r) => sameBook({ title: q.title!, author: q.author }, { title: r.title, author: r.author ?? null }));
      if (hits.length && new Set(hits.map((r) => nameKey(r.author))).size === 1 && (!q.author || hits[0].author)) {
        const { coverId: _c, ratingsAverage: _a, ratingsCount: _n, ...found } = hits[0];
        return input.preview ? look(found) : add(found);
      }
      const pick = new URLSearchParams({ add: q.title, ...(q.author && { author: q.author }) });
      return ok('book', `Pick the right book: ${q.title}`, `trackers/library?${pick}`, true);
    }

    if (kind === 'event') {
      const today = todayInTz(settings.timezone || hostTimezone());
      const given = input.event;
      const e = given ? { title: given.title?.trim() || null, date: given.date ?? null, time: given.time ?? null, end: given.end ?? null, place: given.place?.trim() || null, notes: given.notes?.trim() || null } : text ? parseEventText(text, today) : null;
      if (!e) return fail("Send the flyer's or invite's text.", 400);
      const day = e.date ? new Date(`${e.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '') : null;
      if (input.save) {
        if (!e.title) return fail("Add the event's title, then try again.", 400);
        if (!e.date) return fail("Add the event's date, then try again.", 400);
        const [y, mo, d] = e.date.split('-').map(Number);
        const next = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86400000);
        let start: string, end: string;
        if (!e.time) {
          start = e.date;
          end = next(`${e.date}T00:00:00Z`, 1).toISOString().slice(0, 10);
        } else {
          // The household's clock, as the event sheet uses (settings.timezone).
          const at = (hm: string) => zonedTimeToUtc({ y, mo: mo - 1, d, h: +hm.slice(0, 2), mi: +hm.slice(3), s: 0 }, settings.timezone || hostTimezone()).toISOString();
          start = at(e.time);
          end = !e.end ? new Date(Date.parse(start) + settings.defaultEventMinutes * 60000).toISOString() : e.end > e.time ? at(e.end) : next(at(e.end), 1).toISOString();
        }
        const created = await createEvent(c, { calendarId: input.calendarId, title: e.title, start, end, allDay: !e.time, ...(e.place && { location: e.place }), ...(e.notes && { description: e.notes }) });
        if ('error' in created) return fail(created.error, created.status);
        return ok('event', `Added ${created.row.title} to ${created.cal.name}, ${day}`, `calendar?${new URLSearchParams({ event: created.row.id, at: created.row.start })}`);
      }
      const h12 = hour12For(settings.timeFormat, settings.location?.countryCode);
      const at = e.time ? ` at ${formatTime(e.time, { h12, hourOnly: h12 && e.time.endsWith(':00') })}` : '';
      const draft = new URLSearchParams({ draft: 'event', ...Object.fromEntries(Object.entries(e).filter(([, v]) => v)) });
      return c.json({ kind: 'event' as const, summary: `Check the event: ${e.title ?? 'New event'}${day ? `, ${day}${at}` : `${at}, no date found`}`, link: `${origin(c)}/#/calendar?${draft}`, review: true, event: e }, 200);
    }
    return fail('Nothing to add. Share a link, or pick what it is and send its text.', 400);
  });
  return routes;
}
