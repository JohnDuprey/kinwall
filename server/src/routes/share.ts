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
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { fetchRecipePage } from '../outbound.ts';
import { parseRecipeHtml } from '../recipe-web.ts';
import { mapsPlace, nameKey, normalizeLink, parseRestaurantHtml } from '../restaurant-import.ts';
import { bookQuery, findIsbn, parseEventText } from '../share-text.ts';
import { sameBook } from '../shelve.ts';
import { checkRate } from '../ratelimit.ts';
import { formatTime, hour12For } from '../timeFormat.ts';
import { importRestaurant, RestaurantImportSchema } from './restaurants.ts';
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
// Shortcuts sends an unset variable as "" and a switch as text.
const blankOff = (v: unknown) => (v === '' || v === null ? undefined : v === 'true' ? true : v === 'false' ? false : v);
const EventDraftSchema = z.object({
  title: z.string().max(200).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe('YYYY-MM-DD'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().describe('Start, HH:MM in the household timezone; none is all day'),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().describe('End, HH:MM; one before the start is the next day'),
  place: z.string().max(500).nullable(),
}).openapi('ShareEvent');
export const ShareInputSchema = RestaurantImportSchema.extend({
  // Shortcuts sends an unset variable as "" and a menu item as typed ("Book"): both are fine.
  kind: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() || undefined : v), z.enum(KINDS).optional()).describe('What it is. Leave it out for a link: Kinwall reads the page. Photos and text need it (the Shortcut\'s "What is this?" menu).'),
  url: z.string().max(5000).nullable().optional().describe('A shared link: a recipe or restaurant page, or an Apple Maps place.'),
  text: z.string().max(100000).nullable().optional().describe('Text from a photo or a share: a menu (restaurant), an ISBN or a title and author (book), or a flyer or invite (event). "Title:", "Date:", "Time:" and "Place:" lines help an event; "Title:" and "Author:" a book. The first of each line wins, so a model\'s lines can go first, then a "---" line, then the words as read: a Place with no street takes the street from them.'),
  event: EventDraftSchema.partial().nullable().optional().describe('An event as the person checked it (from a previous answer\'s event); used instead of text.'),
  save: z.preprocess(blankOff, z.boolean().optional()).describe('kind event only: add it to calendarId now instead of answering with a link to check it.'),
  calendarId: z.preprocess(blankOff, z.string().optional()).describe('With save: the calendar to add the event to (GET /api/calendars, one that is writable). Left out: the default calendar (default: true).'),
}).openapi('ShareInput');
const ShareResultSchema = z.object({
  kind: z.enum(KINDS),
  summary: z.string().describe('One line for a notification, e.g. "Added Wool to the library" or "Check the event: Spring fair, Sat May 9".'),
  link: z.string().describe('A Kinwall address that opens what was added, or the thing to check.'),
  review: z.boolean().describe('True when nothing was saved yet: open link to check it (an event, or a book with no clear match).'),
  event: EventDraftSchema.optional().describe('An event to check: what was read, for a form to show before saving it.'),
}).openapi('ShareResult');
const ShareErrorSchema = z.object({ error: z.string(), summary: z.string().describe('The same as error, for the notification.') });
const err = { content: { 'application/json': { schema: ShareErrorSchema } } };

const origin = (c: C) => (c.env.PUBLIC_URL ? new URL(c.env.PUBLIC_URL).origin : new URL(c.req.url).origin);
const MEALS_OFF = 'Meals is turned off in Settings → Features';

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
    const input = c.req.valid('json');
    const settings = await readSettings(c.env.DB);
    const text = input.text?.trim() || '';
    // Shared text that is only a link is a link.
    const url = normalizeLink(input.url ?? (/^https?:\/\/\S+$/i.test(text) ? text : null));
    if (input.url?.trim() && !url) return fail('Kinwall can only read web links (https).', 400);
    let kind = input.kind;

    const restaurant = async (page?: ReturnType<typeof parseRestaurantHtml>) => {
      if (!settings.features.meals) return fail(MEALS_OFF, 403);
      const { kind: _k, text: _t, ...fields } = input;
      const result = await importRestaurant(c, { ...fields, url, menuText: input.menuText ?? (text && text !== url ? text : null) }, page);
      return typeof result === 'string' ? fail(result, 400) : ok('restaurant', result.summary, `meals?restaurant=${encodeURIComponent(result.restaurant.id)}`);
    };

    if (url && (kind === 'recipe' || (!kind && !mapsPlace(url)))) {
      if (kind && !settings.features.meals) return fail(MEALS_OFF, 403);
      // https only (an http:// link is tried as https), unless a self-hoster allows private addresses.
      const page = await fetchRecipePage(c.env, c.env.ALLOW_PRIVATE_FEED_URLS === '1' ? url : url.replace(/^http:/i, 'https:'));
      if ('error' in page) return fail(`${page.error[0].toUpperCase()}${page.error.slice(1)}.`, page.status);
      const recipe = parseRecipeHtml(page.html, page.url);
      const place = recipe ? null : parseRestaurantHtml(page.html, page.url);
      if (kind === 'recipe' && !recipe?.name) return fail('This page has no recipe Kinwall can read.', 422);
      if (recipe?.name) {
        if (!settings.features.meals) return fail(MEALS_OFF, 403);
        const saved = await saveWebRecipe(c, { ...recipe, name: recipe.name });
        return ok('recipe', `${saved.created ? 'Imported' : 'Updated'} ${saved.recipe.name}`, `meals?recipe=${encodeURIComponent(saved.recipe.id)}`);
      }
      if (place) return restaurant(place);
      return fail("Kinwall can't tell what this link is. Pick what it is (Recipe or Restaurant) and share it again.", 400);
    }
    if (url && !kind) kind = 'restaurant'; // an Apple Maps place
    if (kind === 'restaurant') return restaurant();

    if (kind === 'book') {
      if (!settings.features.trackersReading) return fail('Reading is turned off in Settings → Features', 403);
      const add = async (body: object) => {
        const res = await app.request('/api/library', { method: 'POST', headers: { Authorization: c.req.header('Authorization') ?? '', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, c.env);
        const json = (await res.json()) as { id?: string; title?: string; error?: string; book?: { id: string; title: string } };
        const book = res.status === 409 ? json.book : json;
        if (res.status === 201 || (res.status === 409 && book?.id)) {
          return ok('book', res.status === 201 ? `Added ${book!.title} to the library` : `${book!.title} is already in the library`, `trackers/library?book=${encodeURIComponent(book!.id!)}`);
        }
        return fail(json.error ?? "Couldn't add the book", ([400, 404, 429, 502].includes(res.status) ? res.status : 502) as 400 | 404 | 429 | 502);
      };
      const isbn = findIsbn(`${text}\n${url ?? ''}`);
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
        return add(found);
      }
      const pick = new URLSearchParams({ add: q.title, ...(q.author && { author: q.author }) });
      return ok('book', `Pick the right book: ${q.title}`, `trackers/library?${pick}`, true);
    }

    if (kind === 'event') {
      const today = todayInTz(settings.timezone || hostTimezone());
      const given = input.event;
      const e = given ? { title: given.title?.trim() || null, date: given.date ?? null, time: given.time ?? null, end: given.end ?? null, place: given.place?.trim() || null } : text ? parseEventText(text, today) : null;
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
          end = !e.end ? next(start, 1 / 24).toISOString() : e.end > e.time ? at(e.end) : next(at(e.end), 1).toISOString();
        }
        const created = await createEvent(c, { calendarId: input.calendarId, title: e.title, start, end, allDay: !e.time, ...(e.place && { location: e.place }) });
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
