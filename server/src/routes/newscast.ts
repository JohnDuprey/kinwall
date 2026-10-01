// Newscast (docs/using/newscast.md): a calm digest of what the family did and shared. Most of it is
// read from the family's own tables when it's asked for (approved chores, rewards given, family
// photos and Paint drawings, finished books, memories' headlines, birthdays), so a deletion or a
// privacy change shows at once and nothing is stored twice. Only announcements and reactions are
// stored (migration 0081), for 30 days (pruneNewscast, from notify.ts's tick).
//
// Never featured, because it's never read here: health, medications, journals, Temp check goals
// and answers, check-ins, battery, insights, Security activity, chore rejections, pending chores,
// reward requests and declines, points and balances. A memory shows its headline, never its words.
//
// Who sees what: everything is family news except grown-ups-only announcements, which only parents'
// devices (admin keys) see; never kids' devices or wall screens. A post a parent removed shows as
// "Removed by a parent" on the author's own devices and parents' devices, and to nobody else.
// Members a parent set "Not featured" (settings.newscastNotFeatured) have no derived items.
//
// Rows read: one range read per source over the window (7 days, Earlier up to 30), through indexes
// (test/query-plans.test.ts). The app asks only while the tab is showing and /api/rev moved.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import type { KinwallDb, KinwallStatement } from '../db.ts';
import { emit } from '../bus.ts';
import { ownDevice, requestKey } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import { isSingleEmoji } from '../emoji.ts';
import { todayInTz } from './members.ts';
import { parseFeatures, parseIds, readFeatures } from './settings.ts';

export const newscastRoutes = createRouter();

export const NEWSCAST_DAYS = 30; // the feed reaches back this far; posts and reactions are kept this long
const REACTIONS = ['👏', '❤️', '🎉'] as const;
const KINDS = ['post', 'chores', 'reward', 'photos', 'drawings', 'book', 'memory', 'birthday'] as const;
type Kind = (typeof KINDS)[number];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A post, or a derived item's stable key (what reactions hang off).
const ITEM_KEY = /^(post|reward|book|memory):[\w-]{1,64}$|^(chores|photos|drawings|birthday):[\w-]{1,64}:\d{4}-\d{2}-\d{2}$/;
const LINK = /https?:\/\/|www\./i; // no links in announcements (v1)

const PhotoRefSchema = z.object({ id: z.string(), url: z.string() });
const ReactionSchema = z.object({ emoji: z.enum(REACTIONS), memberIds: z.array(z.string()).openapi({ description: 'Who reacted, oldest first. Shown as faces, never a count.' }) });
const NewscastItemSchema = z
  .object({
    key: z.string().openapi({ description: 'Stable id: post:<id>, chores:<member>:<date>, photos:<member|family>:<date>, drawings:<member|family>:<date>, reward:<id>, book:<id>, memory:<id>, birthday:<member>:<date>.' }),
    kind: z.enum(KINDS),
    date: z.string().openapi({ description: 'The household day (YYYY-MM-DD).' }),
    at: z.string().nullable().openapi({ description: 'When (ISO), or null for a day-long item.' }),
    memberId: z.string().nullable().openapi({ description: 'Who it is about or who posted it; null = the family.' }),
    emoji: z.string(),
    title: z.string().openapi({ description: 'One plain sentence, e.g. "Leo finished 4 chores". A post: its text.' }),
    detail: z.string().nullable(),
    count: z.number().openapi({ description: 'How many things it groups (chores, photos, drawings); 1 otherwise. For family totals, never ranking.' }),
    photos: z.array(PhotoRefSchema),
    post: z
      .object({ id: z.string(), text: z.string().nullable(), emoji: z.string().nullable(), audience: z.enum(['everyone', 'grownups']), removed: z.boolean() })
      .nullable()
      .openapi({ description: 'Announcements only. removed: a parent took it down (only the author and parents see it, without its text).' }),
    reactions: z.array(ReactionSchema),
  })
  .openapi('NewscastItem');
export const NewscastSchema = z
  .object({
    today: z.string(),
    from: z.string(),
    to: z.string(),
    earlier: z.boolean().openapi({ description: 'Older days within 30 are there: ask again with before=<from>.' }),
    items: z.array(NewscastItemSchema),
  })
  .openapi('Newscast');
type Item = z.infer<typeof NewscastItemSchema>;
type C = Context<{ Bindings: Env }>;

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const photoRef = (id: string) => ({ id, url: `/api/photos/${id}/image` });
const quote = (s: string | null | undefined) => (s ? `“${s}”` : null);
const OFF = { error: 'Newscast is turned off in Settings → Features' };

type PostRow = { id: string; member_id: string | null; text: string; emoji: string | null; photo_id: string | null; audience: 'everyone' | 'grownups'; status: 'live' | 'removed'; created_at: string };

function postItem(r: PostRow, date: string): Item {
  const removed = r.status === 'removed';
  return {
    key: `post:${r.id}`, kind: 'post', date, at: r.created_at, memberId: r.member_id, emoji: '📣',
    title: removed ? 'Removed by a parent' : r.text, detail: null, count: 1, photos: !removed && r.photo_id ? [photoRef(r.photo_id)] : [],
    post: { id: r.id, text: removed ? null : r.text, emoji: removed ? null : r.emoji, audience: r.audience, removed }, reactions: [],
  };
}

// The source reads, one per item type, over [isoFrom, isoTo) or [from, to]. Exported for test/query-plans.test.ts.
export const NEWSCAST_SQL = {
  chores: `SELECT cc.member_id, cc.date, cc.completed_at, c.title FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id
           WHERE cc.date BETWEEN ? AND ? AND cc.status = 'approved' AND cc.member_id IS NOT NULL ORDER BY cc.completed_at`,
  rewards: "SELECT id, member_id, title, emoji, given_at FROM reward_redemptions WHERE status = 'given' AND given_at >= ? AND given_at < ?",
  photos: `SELECT id, caption, created_at, drawing, added_by FROM photos
           WHERE family = 1 AND created_at >= ? AND created_at < ? AND id NOT IN (SELECT photo_id FROM newscast_posts WHERE photo_id IS NOT NULL)
           ORDER BY created_at`,
  books: `SELECT id, member_id, title, json_extract(data, '$.finishedOn') AS finished_on, json_extract(data, '$.rating') AS rating, updated_at FROM tracker_entries
          WHERE kind = 'reading' AND json_extract(data, '$.status') = 'finished' AND json_extract(data, '$.finishedOn') BETWEEN ? AND ?`,
  memories: `SELECT t.id, t.member_id, t.title, t.date, t.created_at, t.photo_id, p.family AS photo_family FROM tracker_entries t LEFT JOIN photos p ON p.id = t.photo_id
             WHERE t.kind = 'memory' AND t.date BETWEEN ? AND ?`,
  posts: 'SELECT * FROM newscast_posts WHERE created_at >= ? AND created_at < ?',
  reactions: 'SELECT item_key, member_id, emoji FROM newscast_reactions ORDER BY created_at, rowid',
};

type Member = { id: string; name: string; grown_up: number; birthday: string | null };

/** Reactions on items, in REACTIONS order, only the ones someone gave. */
function groupReactions(rows: { item_key: string; member_id: string; emoji: string }[], known: Set<string>) {
  const by = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    if (!known.has(r.member_id)) continue;
    const m = by.get(r.item_key) ?? new Map<string, string[]>();
    m.set(r.emoji, [...(m.get(r.emoji) ?? []), r.member_id]);
    by.set(r.item_key, m);
  }
  return (key: string) => REACTIONS.flatMap((emoji) => (by.get(key)?.get(emoji)?.length ? [{ emoji, memberIds: by.get(key)!.get(emoji)! }] : []));
}

newscastRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/newscast',
    tags: ['Newscast'],
    summary: "What the family did and shared, newest first, grouped per person per day: chores finished, rewards given, new photos and drawings, books finished, memories, birthdays and announcements, each with its reactions. Never health, journals, check-ins, goals, battery, insights, security, rejections, declines or points. Kids' devices and wall screens never see grown-ups-only posts.",
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        days: z.coerce.number().int().min(1).max(NEWSCAST_DAYS).optional().openapi({ description: 'How many days, ending the day before `before` (default: 7 ending today). Never older than 30 days.' }),
        before: z.string().regex(DATE).optional().openapi({ description: 'YYYY-MM-DD: only days before this one (for Earlier).' }),
      }),
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: NewscastSchema } } },
      404: { description: 'Newscast is turned off (settings.features.newscast)', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { days = 7, before } = c.req.valid('query');
    const db = c.env.DB;
    const [setRes, memRes] = await db.batch<unknown>([
      db.prepare("SELECT key, value FROM settings WHERE key IN ('timezone', 'features', 'newscastNotFeatured')"),
      db.prepare('SELECT id, name, grown_up, birthday FROM members'),
    ]);
    const settings = new Map((setRes.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const features = parseFeatures(settings.get('features'));
    if (!features.newscast) return c.json(OFF, 404);
    const tz = settings.get('timezone') ?? hostTimezone();
    const hidden = new Set(parseIds(settings.get('newscastNotFeatured')));
    const members = new Map((memRes.results as Member[]).map((m) => [m.id, m]));
    const shown = (id: string | null) => !id || (members.has(id) && !hidden.has(id)); // null = the family
    const name = (id: string | null) => (id && members.get(id)?.name) || null;

    const today = todayInTz(tz);
    const oldest = addDays(today, -(NEWSCAST_DAYS - 1));
    const to = before && before <= today ? addDays(before, -1) : today;
    const from = [addDays(to, -(days - 1)), oldest].sort()[1];
    if (to < from) return c.json({ today, from: to, to, earlier: false, items: [] }, 200);
    // Timestamps are UTC: read a day either side and keep the ones on the household's days.
    const isoFrom = `${addDays(from, -1)}T00:00:00.000Z`;
    const isoTo = `${addDays(to, 2)}T00:00:00.000Z`;
    const dayOf = (iso: string) => todayInTz(tz, new Date(iso));
    const inWindow = (d: string) => d >= from && d <= to;

    const key = await requestKey(c);
    const parent = key?.scope === 'admin';
    const me = await ownDevice(c);
    const S = NEWSCAST_SQL;
    const reads: [string, KinwallStatement][] = [
      ['posts', db.prepare(S.posts).bind(isoFrom, isoTo)],
      ['reactions', db.prepare(S.reactions)],
      ...(features.chores ? ([['chores', db.prepare(S.chores).bind(from, to)], ['rewards', db.prepare(S.rewards).bind(isoFrom, isoTo)]] as [string, KinwallStatement][]) : []),
      ...(features.photos ? ([['photos', db.prepare(S.photos).bind(isoFrom, isoTo)]] as [string, KinwallStatement][]) : []),
      ...(features.trackersReading ? ([['books', db.prepare(S.books).bind(from, to)]] as [string, KinwallStatement][]) : []),
      ...(features.trackersMemories ? ([['memories', db.prepare(S.memories).bind(from, to)]] as [string, KinwallStatement][]) : []),
    ];
    const results = await db.batch<unknown>(reads.map(([, s]) => s));
    const rows = Object.fromEntries(reads.map(([k], i) => [k, results[i].results])) as Record<string, any[]>;
    const items: Item[] = [];
    const add = (i: Omit<Item, 'reactions' | 'post' | 'photos' | 'detail' | 'count'> & Partial<Pick<Item, 'photos' | 'detail' | 'count'>>) => items.push({ detail: null, count: 1, photos: [], post: null, reactions: [], ...i });

    for (const r of (rows.posts ?? []) as PostRow[]) {
      const date = dayOf(r.created_at);
      if (!inWindow(date) || (r.audience === 'grownups' && !parent)) continue;
      if (r.status === 'removed' && !parent && (!me || me !== r.member_id)) continue;
      items.push(postItem(r, date));
    }

    const chores = new Map<string, { memberId: string; date: string; titles: string[]; at: string }>();
    for (const r of (rows.chores ?? []) as { member_id: string; date: string; completed_at: string; title: string }[]) {
      if (!shown(r.member_id)) continue;
      const k = `chores:${r.member_id}:${r.date}`;
      const g = chores.get(k) ?? { memberId: r.member_id, date: r.date, titles: [], at: r.completed_at };
      g.titles.push(r.title);
      g.at = r.completed_at > g.at ? r.completed_at : g.at;
      chores.set(k, g);
    }
    for (const [k, g] of chores) {
      const n = g.titles.length;
      add({ key: k, kind: 'chores', date: g.date, at: g.at, memberId: g.memberId, emoji: '✅', title: `${name(g.memberId)} finished ${n === 1 ? g.titles[0] : `${n} chores`}`, detail: n > 1 ? g.titles.join(' · ') : null, count: n });
    }

    for (const r of (rows.rewards ?? []) as { id: string; member_id: string; title: string; emoji: string | null; given_at: string }[]) {
      const date = dayOf(r.given_at);
      if (!inWindow(date) || !shown(r.member_id)) continue;
      add({ key: `reward:${r.id}`, kind: 'reward', date, at: r.given_at, memberId: r.member_id, emoji: '🎁', title: `${name(r.member_id)} got a reward: ${r.emoji ? `${r.emoji} ` : ''}${r.title}` });
    }

    const pics = new Map<string, { kind: 'photos' | 'drawings'; memberId: string | null; date: string; ids: string[]; captions: (string | null)[]; at: string }>();
    for (const r of (rows.photos ?? []) as { id: string; caption: string | null; created_at: string; drawing: number; added_by: string | null }[]) {
      const date = dayOf(r.created_at);
      const kind = r.drawing ? 'drawings' : 'photos';
      if (!inWindow(date) || (kind === 'drawings' && !features.paint)) continue;
      const by = r.added_by && members.has(r.added_by) ? r.added_by : null;
      if (!shown(by)) continue;
      const k = `${kind}:${by ?? 'family'}:${date}`;
      const g = pics.get(k) ?? { kind, memberId: by, date, ids: [], captions: [], at: r.created_at };
      g.ids.push(r.id);
      // Paint captions a drawing "Rocket by Maya"; the item already says who.
      g.captions.push(r.caption && by && kind === 'drawings' ? r.caption.replace(` by ${name(by)}`, '') : r.caption);
      g.at = r.created_at;
      pics.set(k, g);
    }
    for (const [k, g] of pics) {
      const n = g.ids.length;
      const who = name(g.memberId);
      const caption = g.captions.find(Boolean) ?? null;
      const title = g.kind === 'drawings'
        ? n === 1 ? `${who ? `${who} saved a drawing` : 'A new drawing'}${caption ? `: ${quote(caption)}` : ''}` : who ? `${who} saved ${n} drawings` : `${n} new drawings`
        : n === 1 ? (who ? `${who} added a photo` : 'A new photo') : who ? `${who} added ${n} photos` : `${n} new photos`;
      add({ key: k, kind: g.kind, date: g.date, at: g.at, memberId: g.memberId, emoji: g.kind === 'drawings' ? '🎨' : '📸', title, detail: g.kind === 'photos' || n > 1 ? quote(caption) : null, count: n, photos: g.ids.slice(-4).reverse().map(photoRef) });
    }

    for (const r of (rows.books ?? []) as { id: string; member_id: string | null; title: string | null; finished_on: string; rating: number | null; updated_at: string }[]) {
      if (!shown(r.member_id)) continue;
      add({ key: `book:${r.id}`, kind: 'book', date: r.finished_on, at: dayOf(r.updated_at) === r.finished_on ? r.updated_at : null, memberId: r.member_id, emoji: '📚', title: `${name(r.member_id) ?? 'The family'} finished ${r.title ?? 'a book'}`, detail: r.rating ? '⭐'.repeat(r.rating) : null });
    }

    for (const r of (rows.memories ?? []) as { id: string; member_id: string | null; title: string | null; date: string; created_at: string; photo_id: string | null; photo_family: number | null }[]) {
      if (!shown(r.member_id)) continue;
      add({ key: `memory:${r.id}`, kind: 'memory', date: r.date, at: dayOf(r.created_at) === r.date ? r.created_at : null, memberId: r.member_id, emoji: '📝', title: `${name(r.member_id) ?? 'The family'} added a memory`, detail: quote(r.title), photos: r.photo_id && r.photo_family === 1 ? [photoRef(r.photo_id)] : [] });
    }

    for (const m of members.values()) {
      const md = m.birthday?.slice(-5);
      if (!md || hidden.has(m.id)) continue;
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (d.slice(5) !== md) continue;
        const age = DATE.test(m.birthday!) ? Number(d.slice(0, 4)) - Number(m.birthday!.slice(0, 4)) : null;
        add({ key: `birthday:${m.id}:${d}`, kind: 'birthday', date: d, at: null, memberId: m.id, emoji: '🎂', title: `Happy birthday, ${m.name}!`, detail: age && age > 0 ? `${m.name} turned ${age}` : null });
      }
    }

    const reactionsOf = groupReactions((rows.reactions ?? []) as { item_key: string; member_id: string; emoji: string }[], new Set(members.keys()));
    for (const i of items) i.reactions = reactionsOf(i.key);
    items.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? '').localeCompare(a.at ?? '') || a.key.localeCompare(b.key));
    return c.json({ today, from, to, earlier: from > oldest, items }, 200);
  },
);

/** Who is posting or reacting: a person's own device is always them (asking for anyone else is
 * refused); a wall screen or an unclaimed sign-in says who. */
async function actingMember(c: C, asked: string | undefined, verb: 'posts' | 'reacts'): Promise<Member | { status: 400 | 403; error: string }> {
  const own = await ownDevice(c);
  const db = c.env.DB;
  if (own && asked && asked !== own) {
    const ownName = (await db.prepare('SELECT name FROM members WHERE id = ?').bind(own).first<{ name: string }>())?.name;
    return { status: 403, error: `This device ${verb} as ${ownName ?? 'its owner'}.` };
  }
  const id = asked ?? own;
  if (!id) return { status: 400, error: verb === 'posts' ? "Pick who's posting." : "Pick who's reacting." };
  const m = await db.prepare('SELECT id, name, grown_up, birthday FROM members WHERE id = ?').bind(id).first<Member>();
  return m ?? { status: 400, error: 'memberId: member not found' };
}

const PostInputSchema = z
  .object({
    text: z.string().trim().min(1).max(280).refine((t) => !LINK.test(t), "Links can't go in an announcement yet."),
    emoji: z.string().max(16).refine(isSingleEmoji, 'one emoji').nullable().optional(),
    photoId: z.string().nullable().optional().openapi({ description: 'One family photo (upload it first with POST /api/photos).' }),
    audience: z.enum(['everyone', 'grownups']).default('everyone').openapi({ description: "grownups: only parents' devices see it (a grown-up's post only); no webhook." }),
    memberId: z.string().optional().openapi({ description: "Who's posting. A person's own device always posts as them; a wall screen must say." }),
  })
  .openapi('NewscastPostInput');

newscastRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/newscast/posts',
    tags: ['Newscast'],
    summary: 'Share an announcement: up to 280 characters, no links, an optional emoji and one family photo. Anyone can post as themselves unless a parent paused their posting.',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PostInputSchema } } } },
    responses: {
      201: { description: 'posted', content: { 'application/json': { schema: NewscastItemSchema } } },
      400: { description: 'invalid, or no one picked to post as', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: "posting as someone else from a person's own device, or their posting is paused", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Newscast is turned off', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const db = c.env.DB;
    if (!(await readFeatures(db)).newscast) return c.json(OFF, 404);
    const body = c.req.valid('json');
    const who = await actingMember(c, body.memberId, 'posts');
    if ('error' in who) return c.json({ error: who.error }, who.status);
    const paused = parseIds((await db.prepare("SELECT value FROM settings WHERE key = 'newscastPostingPaused'").first<{ value: string }>())?.value);
    if (paused.includes(who.id)) return c.json({ error: `${who.name} is taking a break from posting for now. A parent can turn it back on in Settings.` }, 403);
    if (body.audience === 'grownups' && !who.grown_up) return c.json({ error: 'Only grown-ups can post to grown-ups only.' }, 400);
    if (body.photoId && !(await db.prepare('SELECT id FROM photos WHERE id = ? AND family = 1').bind(body.photoId).first())) return c.json({ error: 'photoId: photo not found' }, 400);
    const row: PostRow = { id: crypto.randomUUID(), member_id: who.id, text: body.text, emoji: body.emoji ?? null, photo_id: body.photoId ?? null, audience: body.audience, status: 'live', created_at: new Date().toISOString() };
    await db
      .prepare('INSERT INTO newscast_posts (id, member_id, text, emoji, photo_id, audience, status, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(row.id, row.member_id, row.text, row.emoji, row.photo_id, row.audience, row.status, row.created_at)
      .run();
    // Grown-ups-only posts never leave the family's own devices: no webhook with their words.
    if (row.audience === 'everyone') emit(c, 'newscast.posted', { id: row.id, memberId: row.member_id, text: row.text, emoji: row.emoji, photoId: row.photo_id, audience: row.audience });
    else emit(c, 'newscast.changed', {});
    const tz = (await db.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>())?.value ?? hostTimezone();
    return c.json(postItem(row, todayInTz(tz, new Date(row.created_at))), 201);
  },
);

newscastRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/newscast/posts/{id}',
    tags: ['Newscast'],
    summary: "Delete your own announcement (from your own device), or, from a parent's device, remove anyone's: it then shows as \"Removed by a parent\" to its author and parents only. The photo stays in family photos unless a parent sends alsoPhoto=true.",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ alsoPhoto: z.enum(['true', 'false']).optional().openapi({ description: "true: also delete the post's photo from family photos (parents only)." }) }),
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true), removed: z.enum(['deleted', 'hidden']) }) } } },
      403: { description: "not the author's own device or a parent's", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found, or Newscast is turned off', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const db = c.env.DB;
    if (!(await readFeatures(db)).newscast) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const alsoPhoto = c.req.valid('query').alsoPhoto === 'true';
    const row = await db.prepare('SELECT * FROM newscast_posts WHERE id = ?').bind(id).first<PostRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    const parent = (await requestKey(c))?.scope === 'admin';
    const me = await ownDevice(c);
    const author = !!me && me === row.member_id;
    if (!parent && !author) return c.json({ error: 'Only the person who posted this, or a parent, can remove it.' }, 403);
    if (alsoPhoto && !parent) return c.json({ error: 'Only a parent can remove the photo from family photos.' }, 403);
    const writes = author
      ? [db.prepare('DELETE FROM newscast_posts WHERE id = ?').bind(id), db.prepare('DELETE FROM newscast_reactions WHERE item_key = ?').bind(`post:${id}`)]
      : [db.prepare("UPDATE newscast_posts SET status = 'removed' WHERE id = ?").bind(id)];
    if (alsoPhoto && row.photo_id) writes.push(db.prepare('UPDATE newscast_posts SET photo_id = NULL WHERE photo_id = ?').bind(row.photo_id), db.prepare('DELETE FROM photos WHERE id = ?').bind(row.photo_id));
    await db.batch(writes);
    if (alsoPhoto && row.photo_id) emit(c, 'photo.changed', { id: row.photo_id, deleted: true });
    emit(c, 'newscast.changed', {});
    return c.json({ ok: true as const, removed: author ? ('deleted' as const) : ('hidden' as const) }, 200);
  },
);

newscastRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/newscast/reactions',
    tags: ['Newscast'],
    summary: "React to an item (👏 ❤️ 🎉, each once per person), or take it back with on: false. A person's own device reacts as them; a wall screen says who. Reacting never notifies anyone.",
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              itemKey: z.string().regex(ITEM_KEY, 'not a Newscast item'),
              emoji: z.enum(REACTIONS),
              on: z.boolean().default(true),
              memberId: z.string().optional().openapi({ description: "Who's reacting. A person's own device always reacts as them; a wall screen must say." }),
            }),
          },
        },
      },
    },
    responses: {
      200: { description: "the item's reactions now", content: { 'application/json': { schema: z.object({ reactions: z.array(ReactionSchema) }) } } },
      400: { description: 'invalid, or no one picked', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: "reacting as someone else from a person's own device", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Newscast is turned off', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const db = c.env.DB;
    if (!(await readFeatures(db)).newscast) return c.json(OFF, 404);
    const { itemKey, emoji, on, memberId } = c.req.valid('json');
    const who = await actingMember(c, memberId, 'reacts');
    if ('error' in who) return c.json({ error: who.error }, who.status);
    const write = on
      ? db.prepare('INSERT INTO newscast_reactions (item_key, member_id, emoji, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').bind(itemKey, who.id, emoji, new Date().toISOString())
      : db.prepare('DELETE FROM newscast_reactions WHERE item_key = ? AND member_id = ? AND emoji = ?').bind(itemKey, who.id, emoji);
    const [, now, mem] = await db.batch<unknown>([
      write,
      db.prepare('SELECT item_key, member_id, emoji FROM newscast_reactions WHERE item_key = ? ORDER BY created_at, rowid').bind(itemKey),
      db.prepare('SELECT id FROM members'),
    ]);
    emit(c, 'newscast.changed', {});
    const known = new Set((mem.results as { id: string }[]).map((m) => m.id));
    return c.json({ reactions: groupReactions(now.results as { item_key: string; member_id: string; emoji: string }[], known)(itemKey) }, 200);
  },
);

/** Announcements and reactions older than 30 days, for notify.ts's prune (same batch as the bell's). */
export function newscastPrunes(db: KinwallDb, now: Date): KinwallStatement[] {
  const cutoff = new Date(now.getTime() - NEWSCAST_DAYS * 86_400_000).toISOString();
  return [db.prepare('DELETE FROM newscast_posts WHERE created_at < ?').bind(cutoff), db.prepare('DELETE FROM newscast_reactions WHERE created_at < ?').bind(cutoff)];
}
export async function pruneNewscast(db: KinwallDb, now: Date): Promise<void> {
  await db.batch(newscastPrunes(db, now));
}
