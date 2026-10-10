// Community calendars for Outings (docs/using/outings.md#community-calendars, migration 0112): a town,
// library or recreation department's iCal (.ics) link, read once a day (entry.ts scheduled, node.ts)
// 90 days ahead through the safe outbound fetch. Its items land in a pile ("New from <name>", outings
// with inbox = 1) on grown-ups' devices to Keep or mark Not for us, so hundreds of town listings stay
// off the family calendar and out of the list until someone wants one.
//
// One outing per feed item (its UID; a repeating one is one outing at its next date), so a refetch
// updates instead of adding again (unique feed_id + external_id). Pile items follow the feed: moved,
// gone or past, they move or disappear; called off, they disappear. Kept ones keep the family's
// edits but follow the feed's date, time and place, and are marked canceled when it calls them off.
// Skip words ("meeting, committee, board, hearing") keep public meetings out of the pile.
//
// Parents only: none of these routes are in auth.ts's display allow-list. Outings off: 404, no fetching.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env, WaitCtx } from '../env.ts';
import { hostTimezone } from '../env.ts';
import type { KinwallDb, KinwallStatement } from '../db.ts';
import { emit, publish } from '../bus.ts';
import { ErrorSchema } from '../schemas.ts';
import { isSafeFeedUrl, FEED_URL_ERROR } from '../outbound.ts';
import { expandICS, fetchIcsConditional, icsFingerprint, prefilterIcs } from '../providers/ics.ts';
import type { NormalizedEvent } from '../providers/types.ts';
import { readFeatures, readSettings } from './settings.ts';
import { todayInTz } from './members.ts';
import { OutingSchema, readOutings } from './outings.ts';

export const outingFeedsRoutes = createRouter();

export const DEFAULT_SKIP_WORDS = 'meeting, committee, board, hearing';
const AHEAD_DAYS = 90;
const DAY_MS = 86_400_000;

export const OutingFeedSchema = z.object({
  id: z.string(), name: z.string(), url: z.string(),
  categoryId: z.string().nullable().openapi({ description: "New items' category." }),
  audience: z.array(z.enum(['kids', 'family', 'grownups'])).openapi({ description: "New items' \"who it's for\"." }),
  skipWords: z.string().openapi({ description: 'Comma-separated: items whose name has one of these words never reach the pile.' }),
  lastFetchedAt: z.string().nullable(), lastError: z.string().nullable().openapi({ description: 'Why the last read failed, in plain words; null when it worked.' }),
  waiting: z.number().int().openapi({ description: 'Items in its pile, waiting for Keep or Not for us.' }),
}).openapi('OutingFeed');
type OutingFeed = z.infer<typeof OutingFeedSchema>;
const FeedInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().trim().min(1).max(2000).regex(/^(https?|webcal):\/\//i, 'a link starting with https://, http:// or webcal://'),
  categoryId: z.string().nullable().optional(),
  audience: z.array(z.enum(['kids', 'family', 'grownups'])).max(3).optional(),
  skipWords: z.string().max(500).optional(),
}).openapi('OutingFeedInput');
export const PileSchema = z.array(z.object({ feed: z.object({ id: z.string(), name: z.string() }), outings: z.array(OutingSchema) })).openapi('OutingPile');

type FeedRow = { id: string; name: string; url: string; category_id: string | null; audience: string; skip_words: string; etag: string | null; fingerprint: string | null; last_fetched_at: string | null; last_error: string | null };
const json = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

// --- Reading a feed (pure, test/outing-feeds.test.ts) ------------------------------------------------

/** One outing a feed item makes. */
export type FeedItem = { key: string; title: string; startsOn: string; endsOn: string | null; startTime: string | null; endTime: string | null; placeName: string | null; address: string | null; notes: string | null; canceled: boolean };

const CANCELED = /^\s*\[?\s*(?:cancell?ed|postponed)\s*\]?\s*[:\-–—!]*\s*/i;
/** The words to skip, from "meeting, committee": whole words, case ignored. */
export const skipList = (words: string) => words.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const skipped = (title: string, words: string[]) => words.some((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(w)}($|[^\\p{L}\\p{N}])`, 'iu').test(title));

/** A feed's events as outings: one per item (UID), at its next day from `today` on (a repeating one:
 * its next time; a canceled time is skipped, and an item with only canceled times left is canceled),
 * minus those with a skip word in the name. */
export function feedItems(events: NormalizedEvent[], tz: string, today: string, skipWords: string[]): FeedItem[] {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const local = (iso: string) => { const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }; };
  const best = new Map<string, FeedItem>();
  for (const e of events) {
    const key = e.seriesId ?? e.externalId.slice(0, Math.max(e.externalId.lastIndexOf('::'), 0) || undefined);
    let startsOn: string, lastDay: string, startTime: string | null = null, endTime: string | null = null;
    if (e.allDay) {
      startsOn = e.start.slice(0, 10);
      lastDay = new Date(Date.parse(`${e.end.slice(0, 10)}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
      if (lastDay < startsOn) lastDay = startsOn;
    } else {
      const a = local(e.start), b = local(e.end);
      startsOn = a.day; startTime = a.time;
      lastDay = b.time === '00:00' && b.day > a.day ? new Date(Date.parse(`${b.day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10) : b.day;
      endTime = b.time === '00:00' && b.day > a.day ? null : b.time;
    }
    if (lastDay < today) continue;
    const raw = e.title.trim();
    const canceled = !!e.cancelled || CANCELED.test(raw);
    const title = raw.replace(CANCELED, '').trim().slice(0, 200) || raw.slice(0, 200);
    if (skipped(title, skipWords)) continue;
    const place = e.location?.trim() || null;
    const street = !!place && /\d/.test(place);
    const item: FeedItem = {
      key, title, startsOn, endsOn: lastDay > startsOn ? lastDay : null, startTime, endTime: endTime && (lastDay > startsOn || !startTime || endTime > startTime) ? endTime : null,
      placeName: place && !street ? place.slice(0, 200) : null, address: street ? place!.slice(0, 500) : null, notes: e.description?.trim().slice(0, 1000) || null, canceled,
    };
    const was = best.get(key);
    // The next time that's on beats a canceled one; otherwise the sooner one.
    if (!was || (was.canceled && !canceled) || (was.canceled === canceled && startsOn < was.startsOn)) best.set(key, item);
  }
  return [...best.values()];
}

/** What went wrong reading a feed, in plain words (shown in Settings). */
function plainError(err: unknown): string {
  const m = err instanceof Error ? err.message : '';
  const http = /HTTP (\d{3})/.exec(m);
  if (http) return `The calendar link didn't work (error ${http[1]}). Check the link.`;
  if (m === FEED_URL_ERROR) return 'Kinwall can only read calendar links on the public internet.';
  return "Couldn't reach the calendar link. Kinwall will try again tomorrow.";
}

// --- Refreshing --------------------------------------------------------------------------------------

/** Reads one feed now and brings its outings up to date (see the top of the file). Failures are
 * recorded on the feed (last_error), never thrown. */
export async function refreshFeed(env: Env, feedId: string, now = new Date()): Promise<void> {
  const db = env.DB;
  const feed = await db.prepare('SELECT * FROM outing_feeds WHERE id = ?').bind(feedId).first<FeedRow>();
  if (!feed) return;
  const tz = (await readSettings(db)).timezone || hostTimezone();
  const today = todayInTz(tz, now);
  const done = (error: string | null, extra: { etag?: string | null; fingerprint?: string } = {}) =>
    db.prepare('UPDATE outing_feeds SET last_fetched_at = ?, last_error = ?, etag = coalesce(?, etag), fingerprint = coalesce(?, fingerprint) WHERE id = ?')
      .bind(now.toISOString(), error, extra.etag ?? null, extra.fingerprint ?? null, feedId).run();
  try {
    if (!isSafeFeedUrl(env, feed.url.replace(/^webcal:\/\//i, 'https://'))) throw new Error(FEED_URL_ERROR);
    // Unchanged since last time and nothing of its has passed: the one cheap round trip. Something
    // past (a repeating item's next time to find, a pile item to drop) reads it all again.
    const past = await db.prepare('SELECT 1 FROM outings WHERE feed_id = ? AND coalesce(ends_on, starts_on) < ? LIMIT 1').bind(feedId, today).first();
    const cheap = !past && !!feed.fingerprint;
    const res = await fetchIcsConditional(env, feed.url, cheap ? feed.etag : null, null);
    if (res.notModified) { await done(null); return; }
    if (!/BEGIN:VCALENDAR/i.test(res.text)) { await done("This link isn't an iCal (.ics) calendar. Look for a link ending in .ics or starting with webcal://."); return; }
    const fingerprint = await icsFingerprint(`${res.text}\n${feed.skip_words}`);
    if (cheap && fingerprint === feed.fingerprint) { await done(null, { etag: res.etag }); return; }
    const from = new Date(Date.parse(`${today}T00:00:00Z`) - DAY_MS), to = new Date(from.getTime() + (AHEAD_DAYS + 2) * DAY_MS);
    const items = feedItems(await expandICS(prefilterIcs(res.text, from), from, to, tz, { keepCancelled: true }), tz, today, skipList(feed.skip_words));
    await applyItems(db, feed, items, now.toISOString());
    await done(null, { etag: res.etag, fingerprint });
  } catch (err) {
    await done(plainError(err));
  }
}

async function applyItems(db: KinwallDb, feed: FeedRow, items: FeedItem[], at: string): Promise<void> {
  type Have = { id: string; external_id: string | null; title: string; starts_on: string | null; inbox: number };
  const have = (await db.prepare('SELECT id, external_id, title, starts_on, inbox FROM outings WHERE feed_id = ?').bind(feed.id).all<Have>()).results;
  const byKey = new Map(have.map((h) => [h.external_id, h]));
  // Feeds that make up a new UID on every read: the same name on the same day is the same item.
  const byName = new Map(have.map((h) => [`${h.title.toLowerCase()}|${h.starts_on}`, h]));
  const seen = new Set<string>();
  const stmts: KinwallStatement[] = [];
  for (const it of items) {
    const old = byKey.get(it.key) ?? byName.get(`${it.title.toLowerCase()}|${it.startsOn}`);
    if (old && seen.has(old.id)) continue;
    if (old) seen.add(old.id);
    const when = [it.startsOn, it.endsOn, it.startTime, it.endTime, it.placeName, it.address] as const;
    if (!old) {
      if (it.canceled) continue;
      stmts.push(db.prepare(`INSERT INTO outings (id, title, kind, category_id, starts_on, ends_on, start_time, end_time, place_name, address, audience, notes, source, inbox, feed_id, external_id, created_at, updated_at)
        VALUES (?, ?, 'upcoming', (SELECT id FROM outing_categories WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, 'feed', 1, ?, ?, ?, ?) ON CONFLICT(feed_id, external_id) DO NOTHING`)
        .bind(crypto.randomUUID(), it.title, feed.category_id, ...when, feed.audience, it.notes, feed.id, it.key, at, at));
    } else if (old.inbox) {
      // In the pile: called off, it goes; otherwise it follows the feed.
      stmts.push(it.canceled ? db.prepare('DELETE FROM outings WHERE id = ?').bind(old.id)
        : db.prepare('UPDATE outings SET title = ?, starts_on = ?, ends_on = ?, start_time = ?, end_time = ?, place_name = ?, address = ?, notes = ?, external_id = ?, updated_at = ? WHERE id = ?').bind(it.title, ...when, it.notes, it.key, at, old.id));
    } else {
      // Kept: the family's name, notes and marks stay; the day, time and place follow the feed.
      stmts.push(db.prepare(`UPDATE outings SET starts_on = ?1, ends_on = ?2, start_time = ?3, end_time = ?4, place_name = coalesce(?5, place_name), address = coalesce(?6, address), canceled = ?7, external_id = ?8,
        updated_at = CASE WHEN starts_on IS ?1 AND ends_on IS ?2 AND start_time IS ?3 AND end_time IS ?4 AND canceled = ?7 THEN updated_at ELSE ?9 END WHERE id = ?10`)
        .bind(...when, it.canceled ? 1 : 0, it.key, at, old.id));
    }
  }
  // Pile items the feed no longer has (gone, past, or now skipped) disappear; kept ones stay.
  for (const h of have) if (h.inbox && !seen.has(h.id)) stmts.push(db.prepare('DELETE FROM outings WHERE id = ? AND inbox = 1').bind(h.id));
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

/** The scheduled tick (entry.ts, node.ts): each feed not read in the last day, read now. */
export async function refreshDueFeeds(env: Env, now = new Date(), ctx?: WaitCtx): Promise<void> {
  if (!(await readFeatures(env.DB)).outings) return;
  const cutoff = new Date(now.getTime() - DAY_MS + 10 * 60_000).toISOString(); // a few minutes' slack for the tick's own timing
  const { results } = await env.DB.prepare('SELECT id FROM outing_feeds WHERE last_fetched_at IS NULL OR last_fetched_at < ? ORDER BY last_fetched_at IS NOT NULL, last_fetched_at LIMIT 5').bind(cutoff).all<{ id: string }>();
  for (const { id } of results) await refreshFeed(env, id, now);
  if (results.length) publish(env, ctx, 'outing.changed', { feeds: results.map((r) => r.id) });
}

// --- Routes --------------------------------------------------------------------------------------

async function readFeeds(db: KinwallDb): Promise<OutingFeed[]> {
  const { results } = await db.prepare(`SELECT f.*, (SELECT count(*) FROM outings o WHERE o.feed_id = f.id AND o.inbox = 1 AND o.archived = 0) AS waiting
    FROM outing_feeds f ORDER BY f.name COLLATE NOCASE, f.created_at`).all<FeedRow & { waiting: number }>();
  return results.map((f) => ({ id: f.id, name: f.name, url: f.url, categoryId: f.category_id, audience: json(f.audience, []), skipWords: f.skip_words, lastFetchedAt: f.last_fetched_at, lastError: f.last_error, waiting: f.waiting }));
}

const OFF = { error: 'Outings are turned off in Settings → General → Features' };
const off = async (db: KinwallDb) => !(await readFeatures(db)).outings;
const params = z.object({ id: z.string() });
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: "parents only (not a wall screen or a kid's device)", content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found, or outings are turned off (settings.features.outings)', content: { 'application/json': { schema: ErrorSchema } } },
};
const feedOut = { description: 'the calendar', content: { 'application/json': { schema: OutingFeedSchema } } };
const ok = { description: 'done', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } };
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });

/** The input's problem, in plain words, or null. */
async function invalid(env: Env, f: Partial<z.infer<typeof FeedInputSchema>>): Promise<string | null> {
  if (f.url && !isSafeFeedUrl(env, f.url.replace(/^webcal:\/\//i, 'https://'))) return 'Kinwall can only read calendar links on the public internet.';
  if (f.categoryId && !(await env.DB.prepare('SELECT id FROM outing_categories WHERE id = ?').bind(f.categoryId).first())) return 'category not found';
  return null;
}

outingFeedsRoutes.openapi(
  createRoute({ method: 'get', path: '/api/outing-feeds', tags: ['Outings'], security: [{ Bearer: [] }], summary: "The family's community calendars (parents)", responses: { 200: { description: 'calendars', content: { 'application/json': { schema: z.array(OutingFeedSchema) } } }, 403: errors[403], 404: errors[404] } }),
  async (c) => (await off(c.env.DB) ? c.json(OFF, 404) : c.json(await readFeeds(c.env.DB), 200)),
);

outingFeedsRoutes.openapi(
  createRoute({ method: 'get', path: '/api/outing-feeds/pile', tags: ['Outings'], security: [{ Bearer: [] }], summary: 'New items from the community calendars, waiting for Keep or Not for us, by calendar (parents)', responses: { 200: { description: 'piles', content: { 'application/json': { schema: PileSchema } } }, 403: errors[403], 404: errors[404] } }),
  async (c) => {
    if (await off(c.env.DB)) return c.json(OFF, 404);
    const [feeds, items] = await Promise.all([readFeeds(c.env.DB), readOutings(c.env.DB, { inbox: true })]);
    return c.json(feeds.map((f) => ({ feed: { id: f.id, name: f.name }, outings: items.filter((o) => o.feedId === f.id) })).filter((p) => p.outings.length), 200);
  },
);

outingFeedsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/outing-feeds/pile/{id}', tags: ['Outings'], security: [{ Bearer: [] }], summary: 'Keep a new item (it joins Outings) or mark it Not for us (hidden, and stays hidden when the calendar is read again) (parents)',
    request: { params, body: body(z.object({ keep: z.boolean() })) }, responses: { 200: { description: 'the outing', content: { 'application/json': { schema: OutingSchema } } }, ...errors },
  }),
  async (c) => {
    if (await off(c.env.DB)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { keep } = c.req.valid('json');
    const res = await c.env.DB.prepare(`UPDATE outings SET ${keep ? 'inbox = 0, archived = 0' : 'archived = 1'}, updated_at = ? WHERE id = ? AND inbox = 1`).bind(new Date().toISOString(), id).run();
    if (!res.meta.changes) return c.json({ error: 'That item is no longer waiting.' }, 404);
    emit(c, 'outing.changed', { id });
    return c.json((await readOutings(c.env.DB, { id }))[0], 200);
  },
);

outingFeedsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/outing-feeds', tags: ['Outings'], security: [{ Bearer: [] }], summary: 'Add a community calendar (an iCal .ics link) and read it now (parents). skipWords defaults to "meeting, committee, board, hearing"',
    request: { body: body(FeedInputSchema) }, responses: { 201: feedOut, ...errors },
  }),
  async (c) => {
    if (await off(c.env.DB)) return c.json(OFF, 404);
    const input = c.req.valid('json');
    const bad = await invalid(c.env, input);
    if (bad) return c.json({ error: bad }, 400);
    const id = crypto.randomUUID();
    await c.env.DB.prepare('INSERT INTO outing_feeds (id, name, url, category_id, audience, skip_words, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.name, input.url, input.categoryId ?? null, JSON.stringify([...new Set(input.audience ?? [])]), input.skipWords?.trim() ?? DEFAULT_SKIP_WORDS, new Date().toISOString()).run();
    await refreshFeed(c.env, id);
    emit(c, 'outing.changed', { feedId: id });
    return c.json((await readFeeds(c.env.DB)).find((f) => f.id === id)!, 201);
  },
);

outingFeedsRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/outing-feeds/{id}', tags: ['Outings'], security: [{ Bearer: [] }], summary: 'Change a community calendar (parents). A new link or skip words read it again now', request: { params, body: body(FeedInputSchema.partial()) }, responses: { 200: feedOut, ...errors } }),
  async (c) => {
    if (await off(c.env.DB)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const bad = await invalid(c.env, input);
    if (bad) return c.json({ error: bad }, 400);
    const res = await c.env.DB.prepare(`UPDATE outing_feeds SET name = coalesce(?, name), url = coalesce(?, url), category_id = CASE WHEN ? THEN ? ELSE category_id END,
      audience = coalesce(?, audience), skip_words = coalesce(?, skip_words), fingerprint = CASE WHEN ? THEN NULL ELSE fingerprint END WHERE id = ?`)
      .bind(input.name ?? null, input.url ?? null, input.categoryId !== undefined ? 1 : 0, input.categoryId ?? null, input.audience ? JSON.stringify([...new Set(input.audience)]) : null, input.skipWords?.trim() ?? null, input.url || input.skipWords !== undefined ? 1 : 0, id).run();
    if (!res.meta.changes) return c.json({ error: 'calendar not found' }, 404);
    if (input.url || input.skipWords !== undefined) await refreshFeed(c.env, id);
    emit(c, 'outing.changed', { feedId: id });
    return c.json((await readFeeds(c.env.DB)).find((f) => f.id === id)!, 200);
  },
);

outingFeedsRoutes.openapi(
  createRoute({ method: 'post', path: '/api/outing-feeds/{id}/refresh', tags: ['Outings'], security: [{ Bearer: [] }], summary: 'Read a community calendar again now (parents)', request: { params }, responses: { 200: feedOut, ...errors } }),
  async (c) => {
    if (await off(c.env.DB)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    if (!(await c.env.DB.prepare('SELECT id FROM outing_feeds WHERE id = ?').bind(id).first())) return c.json({ error: 'calendar not found' }, 404);
    await c.env.DB.prepare('UPDATE outing_feeds SET fingerprint = NULL WHERE id = ?').bind(id).run();
    await refreshFeed(c.env, id);
    emit(c, 'outing.changed', { feedId: id });
    return c.json((await readFeeds(c.env.DB)).find((f) => f.id === id)!, 200);
  },
);

outingFeedsRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/outing-feeds/{id}', tags: ['Outings'], security: [{ Bearer: [] }], summary: "Remove a community calendar (parents): its pile goes; outings you kept stay", request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c.env.DB)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    if (!(await db.prepare('SELECT id FROM outing_feeds WHERE id = ?').bind(id).first())) return c.json({ error: 'calendar not found' }, 404);
    await db.batch([
      db.prepare('DELETE FROM outings WHERE feed_id = ? AND inbox = 1').bind(id),
      db.prepare('UPDATE outings SET feed_id = NULL WHERE feed_id = ?').bind(id),
      db.prepare('DELETE FROM outing_feeds WHERE id = ?').bind(id),
    ]);
    emit(c, 'outing.changed', { feedId: id });
    return c.json({ ok: true }, 200);
  },
);
