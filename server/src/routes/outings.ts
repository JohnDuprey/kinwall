// Outings (docs/using/outings.md, migration 0111): things to do and places to go that the family
// keeps, apart from the calendar. Upcoming outings have a date (or one still to come); places are any
// time. Everyone marks interest (👀 interested, ⭐ really want to go); "Add to our calendar" makes a
// real event in the "🎟 Outing" calendar category and links it both ways (like a meal's event).
// The "Is this for me?" rule and the filters live in outing-rules.ts (shared with the app).
//
// Who does what: parents (full access) do everything. A kid's own device adds outings and edits the
// ones it added, and marks interest only for that kid; grown-ups-only outings aren't listed there.
// A shared wall screen reads and marks interest for whoever picks themselves (DISPLAY_ALLOWED).
// Adding to the calendar and deleting are for parents; categories are edited by parents.
//
// Its own feature switch (settings.features.outings): off, every route here answers 404 (so MCP
// tools refuse). Nothing is deleted.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { emit } from '../bus.ts';
import { actorOf, ownerBlock, requestKey } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import { readFeatures, readSettings } from './settings.ts';
import { todayInTz } from './members.ts';
import { createEvent, eventInstances } from './events.ts';
import { getWeather } from './weather.ts';
import { dateAnnounced } from '../outing-reminders.ts';
import { sendOutingReminder } from '../notify.ts';
import { waitUntil } from '../env.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { addDays, hiddenFromKid, isForPerson, matchesFilter, openStretches, outingIdeas, rainy, weekendOf, type BusyStretch, type OutingFilter, type PersonFacts } from '../outing-rules.ts';

export const outingsRoutes = createRouter();

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const LINK = z.string().trim().max(2000).regex(/^https?:\/\//i, 'a link starting with http:// or https://');
const AudienceSchema = z.enum(['kids', 'family', 'grownups']);
const LevelSchema = z.enum(['interested', 'really']);

export const OutingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    kind: z.enum(['upcoming', 'place']).openapi({ description: "'upcoming': has a date, or will. 'place': go any time." }),
    categoryId: z.string().nullable(),
    startsOn: z.string().nullable().openapi({ description: 'YYYY-MM-DD. Empty on an upcoming outing: the date is not announced yet.' }),
    endsOn: z.string().nullable().openapi({ description: "YYYY-MM-DD, a run's last day (open all month, a fair's two weekends)." }),
    startTime: z.string().nullable().openapi({ description: 'HH:MM household time; none = all day.' }),
    endTime: z.string().nullable(),
    hours: z.string().nullable().openapi({ description: 'A run\'s days and hours as a note, like "Fri–Sun, 9 AM to 5 PM".' }),
    placeName: z.string().nullable(),
    address: z.string().nullable(),
    priceCents: z.number().int().nullable().openapi({ description: 'Lowest price per person in cents. 0 = free, null = not known.' }),
    priceNote: z.string().nullable(),
    audience: z.array(AudienceSchema).openapi({ description: 'Who it is for: kids (with ageMin/ageMax), family, grownups.' }),
    memberIds: z.array(z.string()).openapi({ description: 'Specific people it is for (not who is interested).' }),
    ageMin: z.number().int().nullable(),
    ageMax: z.number().int().nullable(),
    url: z.string().nullable(),
    ticketsUrl: z.string().nullable(),
    ticketsOnSaleAt: z.string().nullable().openapi({ description: 'ISO time tickets go on sale.' }),
    buyBy: z.string().nullable().openapi({ description: 'YYYY-MM-DD, the last day to get tickets or sign up.' }),
    gotTickets: z.boolean(),
    visitStatus: z.enum(['want', 'been']).nullable().openapi({ description: "Places: 'want' (want to go) or 'been'." }),
    lastVisitedOn: z.string().nullable(),
    notes: z.string().nullable(),
    calendarEventId: z.string().nullable().openapi({ description: 'The family event made by "Add to our calendar".' }),
    calendarEventStart: z.string().nullable().openapi({ description: "That event's start." }),
    source: z.string(),
    addedBy: z.string().nullable(),
    archived: z.boolean().openapi({ description: '"Not for us": hidden from the list, kept.' }),
    createdAt: z.string(),
    updatedAt: z.string(),
    interest: z.array(z.object({ memberId: z.string(), level: LevelSchema })).openapi({ description: "Who marked it: 'interested' (👀) or 'really' (⭐ really want to go)." }),
  })
  .openapi('Outing');
export type Outing = z.infer<typeof OutingSchema>;

const fields = {
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['upcoming', 'place']),
  categoryId: z.string().nullable(),
  startsOn: DAY.nullable(),
  endsOn: DAY.nullable(),
  startTime: TIME.nullable(),
  endTime: TIME.nullable(),
  hours: z.string().trim().max(200).nullable(),
  placeName: z.string().trim().max(200).nullable(),
  address: z.string().trim().max(500).nullable(),
  priceCents: z.number().int().min(0).max(10_000_000).nullable(),
  priceNote: z.string().trim().max(200).nullable(),
  audience: z.array(AudienceSchema).max(3),
  memberIds: z.array(z.string()).max(50),
  ageMin: z.number().int().min(0).max(120).nullable(),
  ageMax: z.number().int().min(0).max(120).nullable(),
  url: LINK.nullable(),
  ticketsUrl: LINK.nullable(),
  ticketsOnSaleAt: z.string().datetime({ offset: true }).nullable(),
  buyBy: DAY.nullable(),
  gotTickets: z.boolean(),
  visitStatus: z.enum(['want', 'been']).nullable(),
  lastVisitedOn: DAY.nullable(),
  notes: z.string().max(10_000).nullable(),
  archived: z.boolean(),
};
export const OutingInputSchema = z.object(fields).partial().required({ title: true }).openapi('OutingInput');
export const OutingPatchSchema = z.object(fields).partial().openapi('OutingPatch');
type OutingInput = z.infer<typeof OutingPatchSchema>;

export const OutingCategorySchema = z.object({ id: z.string(), name: z.string(), emoji: z.string().nullable(), sort: z.number().int() }).openapi('OutingCategory');
const CategoryInputSchema = z.object({ name: z.string().trim().min(1).max(60), emoji: z.string().trim().max(16).nullable().optional(), sort: z.number().int().optional() });

export const OutingCalendarInputSchema = z
  .object({
    date: DAY.optional().openapi({ description: "Which day. Left out: the outing's day (a run or an undated one needs it)." }),
    startTime: TIME.nullable().optional().openapi({ description: "Left out: the outing's. null: all day." }),
    endTime: TIME.nullable().optional(),
    calendarId: z.string().optional().openapi({ description: 'Left out: the default calendar.' }),
    memberIds: z.array(z.string()).optional().openapi({ description: "Who's going. Left out: everyone who ⭐ it and the people it's for." }),
  })
  .openapi('OutingCalendarInput');

const params = z.object({ id: z.string() });
const OFF = { error: 'Outings are turned off in Settings → General → Features' };
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: "parents only, or a kid's device acting for someone else or on an outing it didn't add", content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found, or outings are turned off (settings.features.outings)', content: { 'application/json': { schema: ErrorSchema } } },
};
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const one = { description: 'outing', content: { 'application/json': { schema: OutingSchema } } };
const ok = { description: 'done', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } };

type Row = {
  id: string; title: string; kind: Outing['kind']; category_id: string | null; starts_on: string | null; ends_on: string | null; start_time: string | null; end_time: string | null; hours: string | null;
  place_name: string | null; address: string | null; price_cents: number | null; price_note: string | null; audience: string; member_ids: string; age_min: number | null; age_max: number | null;
  url: string | null; tickets_url: string | null; tickets_on_sale_at: string | null; buy_by: string | null; got_tickets: number; visit_status: Outing['visitStatus']; last_visited_on: string | null;
  notes: string | null; calendar_event_id: string | null; event_start: string | null; source: string; added_by: string | null; archived: number; created_at: string; updated_at: string;
};
const json = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

/** Outings with who marked them, soonest first (undated and places after). Inbox items (imports
 * waiting to be kept) are left out. */
export async function readOutings(db: KinwallDb, opts: { id?: string } = {}): Promise<Outing[]> {
  const where = opts.id ? 'WHERE o.id = ?1' : 'WHERE o.inbox = 0';
  const [rows, marks] = await db.batch<unknown>([
    db.prepare(`SELECT o.*, e.start AS event_start FROM outings o LEFT JOIN events e ON e.id = o.calendar_event_id ${where} ORDER BY o.starts_on IS NULL, o.starts_on, o.start_time, o.title COLLATE NOCASE`).bind(...(opts.id ? [opts.id] : [])),
    db.prepare(`SELECT i.outing_id, i.member_id, i.level FROM outing_interest i JOIN members m ON m.id = i.member_id ${opts.id ? 'WHERE i.outing_id = ?1' : ''} ORDER BY m.sort, m.created_at`).bind(...(opts.id ? [opts.id] : [])),
  ]);
  const byOuting = new Map<string, Outing['interest']>();
  for (const m of marks.results as { outing_id: string; member_id: string; level: Outing['interest'][number]['level'] }[]) byOuting.set(m.outing_id, [...(byOuting.get(m.outing_id) ?? []), { memberId: m.member_id, level: m.level }]);
  return (rows.results as Row[]).map((r) => ({
    id: r.id, title: r.title, kind: r.kind, categoryId: r.category_id, startsOn: r.starts_on, endsOn: r.ends_on, startTime: r.start_time, endTime: r.end_time, hours: r.hours,
    placeName: r.place_name, address: r.address, priceCents: r.price_cents, priceNote: r.price_note, audience: json(r.audience, []), memberIds: json(r.member_ids, []), ageMin: r.age_min, ageMax: r.age_max,
    url: r.url, ticketsUrl: r.tickets_url, ticketsOnSaleAt: r.tickets_on_sale_at, buyBy: r.buy_by, gotTickets: !!r.got_tickets, visitStatus: r.visit_status, lastVisitedOn: r.last_visited_on,
    notes: r.notes, calendarEventId: r.event_start ? r.calendar_event_id : null, calendarEventStart: r.event_start, source: r.source, addedBy: r.added_by, archived: !!r.archived,
    createdAt: r.created_at, updatedAt: r.updated_at, interest: byOuting.get(r.id) ?? [],
  }));
}

export const readOutingCategories = async (db: KinwallDb) =>
  (await db.prepare('SELECT id, name, emoji, sort FROM outing_categories ORDER BY sort, name COLLATE NOCASE').all<z.infer<typeof OutingCategorySchema>>()).results;

type Ctx = Context<{ Bindings: Env }>;
/** Who's asking: a parent (full access), a kid's own device (its kid), or a shared wall screen. */
async function viewer(c: Ctx): Promise<{ parent: boolean; kid: string | null }> {
  const key = await requestKey(c);
  if (key?.scope !== 'display') return { parent: true, kid: null };
  const owner = key.owner && key.owner !== 'shared' ? key.owner : null;
  if (!owner) return { parent: false, kid: null };
  const m = await c.env.DB.prepare('SELECT grown_up FROM members WHERE id = ?').bind(owner).first<{ grown_up: number }>();
  return { parent: false, kid: m && !m.grown_up ? owner : null };
}
function execCtx(c: Ctx) {
  try { return c.executionCtx; } catch { return undefined; } // Node: no ExecutionContext
}
const off = async (c: Ctx) => !(await readFeatures(c.env.DB)).outings;
const todayOf = async (db: KinwallDb) => todayInTz((await readSettings(db)).timezone || hostTimezone());
async function people(db: KinwallDb): Promise<PersonFacts[]> {
  return (await db.prepare('SELECT id, grown_up, birthday FROM members ORDER BY sort, created_at').all<{ id: string; grown_up: number; birthday: string | null }>()).results.map((m) => ({ id: m.id, grownUp: !!m.grown_up, birthday: m.birthday }));
}

/** What's wrong with an outing's fields as they'd be saved, or null. */
async function invalid(db: KinwallDb, o: OutingInput): Promise<string | null> {
  if (o.startsOn && o.endsOn && o.endsOn < o.startsOn) return 'The last day comes before the first day.';
  if (o.endsOn && !o.startsOn) return 'A run needs its first day too.';
  if (o.ageMin != null && o.ageMax != null && o.ageMax < o.ageMin) return 'The oldest age is below the youngest.';
  if (o.categoryId && !(await db.prepare('SELECT id FROM outing_categories WHERE id = ?').bind(o.categoryId).first())) return 'category not found';
  if (o.memberIds?.length) {
    const found = (await db.prepare('SELECT count(*) AS n FROM members WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(o.memberIds)])).first<{ n: number }>())?.n ?? 0;
    if (found !== new Set(o.memberIds).size) return 'member not found';
  }
  return null;
}

const COLUMNS: [keyof OutingInput, string, (v: never) => unknown][] = [
  ['title', 'title', (v) => v], ['kind', 'kind', (v) => v], ['categoryId', 'category_id', (v) => v], ['startsOn', 'starts_on', (v) => v], ['endsOn', 'ends_on', (v) => v],
  ['startTime', 'start_time', (v) => v], ['endTime', 'end_time', (v) => v], ['hours', 'hours', (v) => v || null], ['placeName', 'place_name', (v) => v || null], ['address', 'address', (v) => v || null],
  ['priceCents', 'price_cents', (v) => v], ['priceNote', 'price_note', (v) => v || null], ['audience', 'audience', (v: string[]) => JSON.stringify([...new Set(v)])], ['memberIds', 'member_ids', (v: string[]) => JSON.stringify([...new Set(v)])],
  ['ageMin', 'age_min', (v) => v], ['ageMax', 'age_max', (v) => v], ['url', 'url', (v) => v || null], ['ticketsUrl', 'tickets_url', (v) => v || null], ['ticketsOnSaleAt', 'tickets_on_sale_at', (v) => v],
  ['buyBy', 'buy_by', (v) => v], ['gotTickets', 'got_tickets', (v: boolean) => (v ? 1 : 0)], ['visitStatus', 'visit_status', (v) => v], ['lastVisitedOn', 'last_visited_on', (v) => v],
  ['notes', 'notes', (v: string | null) => v?.trim() || null], ['archived', 'archived', (v: boolean) => (v ? 1 : 0)],
];
const toRow = (o: OutingInput) => COLUMNS.filter(([k]) => o[k] !== undefined).map(([k, col, f]) => [col, f(o[k] as never)] as const);

outingsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/outings', tags: ['Outings'], security: [{ Bearer: [] }],
    summary: "The family's outings and places, soonest first. Past ones only with past=true; \"Not for us\" ones only with archived=true. A kid's own device doesn't get grown-ups-only outings",
    request: {
      query: z.object({
        kind: z.enum(['upcoming', 'place']).optional(),
        from: DAY.optional(), to: DAY.optional().openapi({ description: 'On at some point in this window (places always are; undated ones drop out).' }),
        category: z.string().optional().openapi({ description: 'Category ids, comma-separated.' }),
        for: z.string().optional().openapi({ description: 'Comma-separated member ids (the "Is this for me?" rule: named, kids by age, family, grown-ups) and/or kids, family, grownups.' }),
        interestedBy: z.string().optional().openapi({ description: 'Comma-separated member ids: any of them marked it. "any" for anyone.' }),
        reallyOnly: z.enum(['true', 'false']).optional().openapi({ description: 'Only ⭐ (really want to go) marks count.' }),
        free: z.enum(['true', 'false']).optional(),
        maxPrice: z.coerce.number().int().min(0).optional().openapi({ description: 'In cents; outings with no known price drop out.' }),
        past: z.enum(['true', 'false', 'all']).optional().openapi({ description: "true: only past ones. all: past and coming. Default false." }),
        archived: z.enum(['true', 'false', 'all']).optional().openapi({ description: "true: only \"Not for us\" ones. all: both. Default false." }),
      }),
    },
    responses: { 200: { description: 'outings', content: { 'application/json': { schema: z.array(OutingSchema) } } }, 400: errors[400], 404: errors[404] },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const q = c.req.valid('query');
    const db = c.env.DB;
    const [all, who, today, everyone] = await Promise.all([readOutings(db), viewer(c), todayOf(db), people(db)]);
    const list = (s?: string) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const forList = list(q.for);
    const audiences = forList.filter((x): x is 'kids' | 'family' | 'grownups' => ['kids', 'family', 'grownups'].includes(x));
    const forPeople = everyone.filter((p) => forList.includes(p.id));
    if (forList.length > audiences.length + forPeople.length) return c.json({ error: 'for: unknown member' }, 400);
    const interested = list(q.interestedBy);
    const filter: OutingFilter = {
      kind: q.kind, from: q.from, to: q.to, categoryIds: list(q.category), for: { people: forPeople, audiences },
      markedBy: interested.includes('any') ? 'any' : interested.length ? interested : undefined, reallyOnly: q.reallyOnly === 'true',
      free: q.free === 'true', maxPriceCents: q.maxPrice,
    };
    const shown = all.filter((o) => {
      if (who.kid && hiddenFromKid(o, who.kid)) return false;
      if ((q.archived ?? 'false') !== 'all' && o.archived !== (q.archived === 'true')) return false;
      return q.past === 'all' ? matchesFilter(o, { ...filter, past: false }, today) || matchesFilter(o, { ...filter, past: true }, today) : matchesFilter(o, { ...filter, past: q.past === 'true' }, today);
    });
    return c.json(shown, 200);
  },
);

export const IdeaSchema = z.object({ key: z.string(), emoji: z.string(), title: z.string(), note: z.string().nullable(), outingIds: z.array(z.string()) }).openapi('OutingIdea');
export const OutingIdeasSchema = z
  .object({
    ideas: z.array(IdeaSchema).openapi({ description: 'Ready-made cards, in order: this weekend, an open stretch on the weekend, rain (indoor ideas), nothing planned next weekend, free things, next month, date night (grown-ups\' devices), haven\'t been in a while, surprise me (the same pick all day). Cards with nothing in them are left out.' }),
    outings: z.array(OutingSchema).openapi({ description: 'The outings the cards name.' }),
    openTime: z.array(z.object({ day: z.string(), from: z.string(), to: z.string() })).openapi({ description: "This weekend's open stretches of 3 hours or more between 9 AM and 8 PM (HH:MM), around busy events." }),
    forecast: z.array(z.object({ date: z.string(), text: z.string(), rainy: z.boolean() })).openapi({ description: 'The next days of the forecast, when a location is set.' }),
  })
  .openapi('OutingIdeas');

/** Busy events as stretches of household days, for the open-time rules (free events don't count). */
function busyStretches(instances: { start: string; end: string; allDay: boolean; busy?: boolean }[], tz: string): BusyStretch[] {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const local = (iso: string) => { const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, m: Number(p.hour) * 60 + Number(p.minute) }; };
  const out: BusyStretch[] = [];
  for (const e of instances) {
    if (e.busy === false) continue;
    if (e.allDay) { for (let d = e.start.slice(0, 10); d < e.end.slice(0, 10); d = addDays(d, 1)) out.push({ day: d, from: 0, to: 1440 }); continue; }
    const a = local(e.start), b = local(e.end);
    for (let d = a.day; d <= b.day; d = addDays(d, 1)) out.push({ day: d, from: d === a.day ? a.m : 0, to: d === b.day ? b.m : 1440 });
  }
  return out;
}
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

outingsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/outings/ideas', tags: ['Outings'], security: [{ Bearer: [] }],
    summary: "Ideas: ready-made picks from what's saved, the family calendar's busy events and the forecast (no AI). for narrows to what's for those people; free to free ones",
    request: { query: z.object({ for: z.string().optional().openapi({ description: 'Comma-separated member ids (the "for me" rule).' }), free: z.enum(['true', 'false']).optional() }) },
    responses: { 200: { description: 'ideas', content: { 'application/json': { schema: OutingIdeasSchema } } }, 404: errors[404] },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const db = c.env.DB;
    const q = c.req.valid('query');
    const [all, who, settings, everyone] = await Promise.all([readOutings(db), viewer(c), readSettings(db), people(db)]);
    const tz = settings.timezone || hostTimezone();
    const today = todayInTz(tz);
    const forIds = (q.for ?? '').split(',').filter(Boolean);
    const forPeople = everyone.filter((p) => forIds.includes(p.id));
    const mine = all.filter((o) => !(who.kid && hiddenFromKid(o, who.kid)) && (!forPeople.length || forPeople.some((p) => isForPerson(o, p, today))) && (q.free !== 'true' || o.priceCents === 0));
    const from = new Date(`${addDays(today, -1)}T00:00:00Z`), to = new Date(`${addDays(today, 16)}T00:00:00Z`);
    const [instances, weather] = await Promise.all([eventInstances(db, from, to), getWeather(db).catch(() => null)]);
    const busy = busyStretches(instances, tz);
    const forecast = (weather?.days ?? []).map((d) => ({ date: d.date, rainChance: d.rainChance, code: d.code, text: d.text }));
    const grownUp = who.parent;
    const ideas = outingIdeas(mine, today, busy, forecast, { grownUp });
    const named = new Set(ideas.flatMap((i) => i.outingIds));
    const openTime = weekendOf(today).filter((d) => d >= today).flatMap((day) => openStretches(day, busy).map((s) => ({ day, from: clock(s.from), to: clock(s.to) })));
    return c.json({ ideas, outings: mine.filter((o) => named.has(o.id)), openTime, forecast: forecast.slice(0, 7).map((d) => ({ date: d.date, text: d.text, rainy: rainy(d) })) }, 200);
  },
);

outingsRoutes.openapi(
  createRoute({ method: 'get', path: '/api/outing-categories', tags: ['Outings'], summary: "Outings' categories (Food, Music, Outdoors & nature…), in order", security: [{ Bearer: [] }], responses: { 200: { description: 'categories', content: { 'application/json': { schema: z.array(OutingCategorySchema) } } }, 404: errors[404] } }),
  async (c) => (await off(c) ? c.json(OFF, 404) : c.json(await readOutingCategories(c.env.DB), 200)),
);

outingsRoutes.openapi(
  createRoute({ method: 'post', path: '/api/outing-categories', tags: ['Outings'], summary: 'Add an outing category (parents)', security: [{ Bearer: [] }], request: { body: body(CategoryInputSchema) }, responses: { 201: { description: 'category', content: { 'application/json': { schema: OutingCategorySchema } } }, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { name, emoji, sort } = c.req.valid('json');
    const db = c.env.DB;
    const next = sort ?? ((await db.prepare('SELECT MAX(sort) AS m FROM outing_categories').first<{ m: number | null }>())?.m ?? -1) + 1;
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO outing_categories (id, name, emoji, sort, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, emoji || null, next, new Date().toISOString()).run();
    emit(c, 'outing.changed', { categoryId: id });
    return c.json({ id, name, emoji: emoji || null, sort: next }, 201);
  },
);

outingsRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/outing-categories/{id}', tags: ['Outings'], summary: 'Rename or reorder an outing category (parents)', security: [{ Bearer: [] }], request: { params, body: body(CategoryInputSchema.partial()) }, responses: { 200: { description: 'category', content: { 'application/json': { schema: OutingCategorySchema } } }, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { name, emoji, sort } = c.req.valid('json');
    const res = await c.env.DB.prepare('UPDATE outing_categories SET name = coalesce(?, name), emoji = CASE WHEN ? THEN ? ELSE emoji END, sort = coalesce(?, sort) WHERE id = ?').bind(name ?? null, emoji !== undefined ? 1 : 0, emoji || null, sort ?? null, id).run();
    if (!res.meta.changes) return c.json({ error: 'category not found' }, 404);
    emit(c, 'outing.changed', { categoryId: id });
    return c.json((await readOutingCategories(c.env.DB)).find((x) => x.id === id)!, 200);
  },
);

outingsRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/outing-categories/{id}', tags: ['Outings'], summary: 'Delete an outing category (parents); its outings keep going, with no category', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    await db.prepare('UPDATE outings SET category_id = NULL WHERE category_id = ?').bind(id).run();
    const res = await db.prepare('DELETE FROM outing_categories WHERE id = ?').bind(id).run();
    if (!res.meta.changes) return c.json({ error: 'category not found' }, 404);
    emit(c, 'outing.changed', { categoryId: id });
    return c.json({ ok: true }, 200);
  },
);

/** One outing as this device may see it, or null. */
async function visible(c: Ctx, id: string): Promise<Outing | null> {
  const [o] = await readOutings(c.env.DB, { id });
  if (!o) return null;
  const who = await viewer(c);
  return who.kid && hiddenFromKid(o, who.kid) ? null : o;
}

outingsRoutes.openapi(
  createRoute({ method: 'get', path: '/api/outings/{id}', tags: ['Outings'], summary: 'One outing, with who marked it and its calendar event', security: [{ Bearer: [] }], request: { params }, responses: { 200: one, 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const o = await visible(c, c.req.valid('param').id);
    return o ? c.json(o, 200) : c.json({ error: 'outing not found' }, 404);
  },
);

outingsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/outings', tags: ['Outings'], summary: "Add an outing or a place (parents, and kids on their own device). Leave startsOn out on an upcoming outing whose date isn't announced", security: [{ Bearer: [] }],
    request: { body: body(OutingInputSchema) }, responses: { 201: one, ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const who = await viewer(c);
    if (!who.parent && !who.kid) return c.json({ error: "Outings are added from a parent's device or a kid's own device." }, 403);
    const input = c.req.valid('json');
    const db = c.env.DB;
    const bad = await invalid(db, input);
    if (bad) return c.json({ error: bad }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const by = who.kid ?? (await actorOf(c)).memberId;
    const cols = [...toRow({ kind: 'upcoming', audience: [], memberIds: [], ...input }), ['id', id], ['source', c.req.header('X-Kinwall-Source') === 'mcp' ? 'mcp' : 'manual'], ['added_by', by], ['created_at', now], ['updated_at', now]] as const;
    await db.prepare(`INSERT INTO outings (${cols.map(([k]) => k).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map(([, v]) => v)).run();
    emit(c, 'outing.changed', { id });
    return c.json((await readOutings(db, { id }))[0], 201);
  },
);

outingsRoutes.openapi(
  createRoute({
    method: 'patch', path: '/api/outings/{id}', tags: ['Outings'], summary: "Change an outing (parents; a kid's own device only the ones it added). archived: true is \"Not for us\"", security: [{ Bearer: [] }],
    request: { params, body: body(OutingPatchSchema) }, responses: { 200: one, ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const who = await viewer(c);
    const old = await visible(c, id);
    if (!old) return c.json({ error: 'outing not found' }, 404);
    if (!who.parent && (!who.kid || old.addedBy !== who.kid)) return c.json({ error: who.kid ? 'Kids can change the outings they added. Ask a grown-up to change this one.' : "Outings are changed from a parent's device." }, 403);
    const merged = { ...old, ...input };
    const bad = await invalid(c.env.DB, { ...merged, memberIds: input.memberIds, categoryId: input.categoryId });
    if (bad) return c.json({ error: bad }, 400);
    const cols = toRow(input);
    if (cols.length) await c.env.DB.prepare(`UPDATE outings SET ${cols.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map(([, v]) => v), new Date().toISOString(), id).run();
    emit(c, 'outing.changed', { id });
    const saved = (await readOutings(c.env.DB, { id }))[0];
    // A date filled in on an outing others ⭐: they hear about it (once per date).
    if (!old.startsOn && saved.startsOn && (await readFeatures(c.env.DB)).outings) {
      const note = dateAnnounced({ ...saved, emoji: saved.categoryId ? (await c.env.DB.prepare('SELECT emoji FROM outing_categories WHERE id = ?').bind(saved.categoryId).first<{ emoji: string | null }>())?.emoji ?? null : null }, who.kid ?? (await actorOf(c)).memberId);
      if (note) waitUntil(execCtx(c), sendOutingReminder(c.env, c.env.DB, note));
    }
    return c.json(saved, 200);
  },
);

outingsRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/outings/{id}', tags: ['Outings'], summary: 'Delete an outing and its interest marks (parents). Its calendar event stays', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM outings WHERE id = ?').bind(id).run();
    if (!res.meta.changes) return c.json({ error: 'outing not found' }, 404);
    emit(c, 'outing.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

outingsRoutes.openapi(
  createRoute({
    method: 'put', path: '/api/outings/{id}/interest', tags: ['Outings'], summary: "Mark how much someone wants to go: interested (👀), really (⭐) or null to clear. A kid's own device marks only for that kid; a wall for anyone", security: [{ Bearer: [] }],
    request: { params, body: body(z.object({ memberId: z.string(), level: LevelSchema.nullable() })) }, responses: { 200: one, ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { memberId, level } = c.req.valid('json');
    const blocked = await ownerBlock(c, memberId);
    if (blocked) return c.json({ error: blocked }, 403);
    if (!(await visible(c, id))) return c.json({ error: 'outing not found' }, 404);
    if (!(await c.env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(memberId).first())) return c.json({ error: 'member not found' }, 404);
    await (level
      ? c.env.DB.prepare('INSERT INTO outing_interest (outing_id, member_id, level, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(outing_id, member_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at').bind(id, memberId, level, new Date().toISOString())
      : c.env.DB.prepare('DELETE FROM outing_interest WHERE outing_id = ? AND member_id = ?').bind(id, memberId)).run();
    emit(c, 'outing.changed', { id });
    return c.json((await readOutings(c.env.DB, { id }))[0], 200);
  },
);

/** The calendar category events from outings get: made the first time it's needed ("🎟 Outing"),
 * remembered by id so the family can rename or recolor it. */
async function outingCategoryId(db: KinwallDb): Promise<string> {
  const saved = (await db.prepare("SELECT c.id FROM settings s JOIN categories c ON c.id = s.value WHERE s.key = 'outingCalendarCategoryId'").first<{ id: string }>())?.id;
  if (saved) return saved;
  const id = crypto.randomUUID();
  const sort = ((await db.prepare('SELECT MAX(sort) AS m FROM categories').first<{ m: number | null }>())?.m ?? -1) + 1;
  await db.batch([
    db.prepare("INSERT INTO categories (id, name, emoji, color, keywords, sort, created_at) VALUES (?, 'Outing', '🎟', '#7c3aed', '[]', ?, ?)").bind(id, sort, new Date().toISOString()),
    db.prepare("INSERT INTO settings (key, value) VALUES ('outingCalendarCategoryId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(id),
  ]);
  return id;
}

/** The event text for an outing: its notes, price and links, and where it came from. */
export function outingEventDescription(o: Pick<Outing, 'notes' | 'priceCents' | 'priceNote' | 'url' | 'ticketsUrl'>): string {
  const price = o.priceCents === 0 ? 'Free' : o.priceCents != null ? `From $${(o.priceCents / 100).toFixed(o.priceCents % 100 ? 2 : 0)}` : null;
  return [o.notes?.trim(), [price, o.priceNote].filter(Boolean).join(' · '), o.url && `More info: ${o.url}`, o.ticketsUrl && `Tickets: ${o.ticketsUrl}`, 'From Kinwall Outings'].filter(Boolean).join('\n\n');
}

outingsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/outings/{id}/calendar', tags: ['Outings'], security: [{ Bearer: [] }],
    summary: 'Add to our calendar (parents): makes a normal event (in the "🎟 Outing" category, made on first use) with the outing\'s time, place, notes and links, and links it both ways. People: who ⭐ it and who it\'s for, unless given',
    request: { params, body: body(OutingCalendarInputSchema) }, responses: { 200: one, 409: { description: 'already on the calendar', content: { 'application/json': { schema: ErrorSchema } } }, 502: { description: 'a synced calendar refused it', content: { 'application/json': { schema: ErrorSchema } } }, ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = c.env.DB;
    const o = (await readOutings(db, { id }))[0];
    if (!o) return c.json({ error: 'outing not found' }, 404);
    if (o.calendarEventId) return c.json({ error: 'This outing is already on the calendar.' }, 409);
    const date = input.date ?? (o.kind === 'upcoming' && !o.endsOn ? o.startsOn : null);
    if (!date) return c.json({ error: o.endsOn ? 'Pick which day you are going.' : 'Pick a day first.' }, 400);
    if (o.kind === 'upcoming' && o.startsOn && (date < o.startsOn || date > (o.endsOn ?? o.startsOn))) return c.json({ error: "That day isn't one the outing is on." }, 400);
    const startTime = input.startTime === undefined ? o.startTime : input.startTime;
    const endTime = input.endTime === undefined ? (input.startTime === undefined ? o.endTime : null) : input.endTime;
    const settings = await readSettings(db);
    const tz = settings.timezone || hostTimezone();
    let start: string, end: string;
    if (!startTime) { start = date; end = addDays(date, 1); } else {
      const at = (t: string) => { const [y, mo, d] = date.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, tz).getTime(); };
      const from = at(startTime);
      const to = endTime && endTime > startTime ? at(endTime) : from + (settings.defaultEventMinutes || 60) * 60000;
      start = new Date(from).toISOString(); end = new Date(to).toISOString();
    }
    const memberIds = input.memberIds ?? [...new Set([...o.interest.filter((i) => i.level === 'really').map((i) => i.memberId), ...o.memberIds])];
    const created = await createEvent(c, {
      ...(input.calendarId ? { calendarId: input.calendarId } : {}), title: o.title, start, end, allDay: !startTime, memberIds, categoryId: await outingCategoryId(db),
      ...([o.placeName, o.address].some(Boolean) ? { location: [o.placeName, o.address].filter(Boolean).join(', ') } : {}), description: outingEventDescription(o),
    });
    if ('error' in created) return c.json({ error: created.error }, created.status);
    // ponytail: two simultaneous adds both make an event; the loser's stays on the calendar unlinked (like meals).
    await db.prepare('UPDATE outings SET calendar_event_id = ?, updated_at = ? WHERE id = ? AND calendar_event_id IS NULL').bind(created.row.id, new Date().toISOString(), id).run();
    emit(c, 'outing.changed', { id });
    return c.json((await readOutings(db, { id }))[0], 200);
  },
);

outingsRoutes.openapi(
  createRoute({ method: 'get', path: '/api/events/{id}/outing', tags: ['Outings'], summary: 'The outing this calendar event was made from (null when none)', security: [{ Bearer: [] }], request: { params }, responses: { 200: { description: 'the outing, or null', content: { 'application/json': { schema: z.object({ outing: OutingSchema.nullable() }) } } } } }),
  async (c) => {
    if (await off(c)) return c.json({ outing: null }, 200);
    const row = await c.env.DB.prepare('SELECT id FROM outings WHERE calendar_event_id = ? LIMIT 1').bind(c.req.valid('param').id).first<{ id: string }>();
    return c.json({ outing: row ? await visible(c, row.id) : null }, 200);
  },
);
