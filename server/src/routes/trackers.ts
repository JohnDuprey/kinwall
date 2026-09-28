// Trackers (migration 0031): a family's logs - books read, daily memories, doctor/dentist visits.
// One table; each kind's fields live in `data`, validated by its zod schema (schemas.ts TRACKER_DATA).
//
// Privacy: health entries never reach a wall display. The display allow-list (auth.ts) lets a
// display key read and write /api/trackers like chores, but these paths are shared by every kind,
// so the handlers check the kind: a display key gets 403 for anything health, and a list without
// a kind leaves health out. Displays can't delete (not in the allow-list).
//
// Photos: only a memory has one (at most one). A photo uploaded for the memory (POST /api/photos?family=0)
// is the memory's own (photo_own): it stays out of the family photos unless photoFamily is set, and
// it's deleted with the memory, or when the memory drops it, while it isn't a family photo. A photo
// picked from the family photos is only referenced.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { resolveKey } from '../auth.ts';
import { todayIn } from './lists.ts';
import { isAudiobook, minutesOf, pagesOf, readingPercent, type ReadingProgress } from '../reading.ts';
import {
  ErrorSchema, ReadingSummarySchema, TRACKER_DATA, TrackerEntrySchema, TrackerInputSchema, TrackerKindSchema, TrackerPatchSchema,
} from '../schemas.ts';

export const trackersRoutes = createRouter();

type Kind = z.infer<typeof TrackerKindSchema>;
export type TrackerRow = {
  id: string; kind: Kind; member_id: string | null; former_member: string | null; date: string; title: string | null
  photo_id: string | null; photo_own: number; data: string; created_at: string; updated_at: string
  photo_family?: number | null; // from the photos join (SELECT_ENTRY)
};
const SELECT_ENTRY = 'SELECT t.*, p.family AS photo_family FROM tracker_entries t LEFT JOIN photos p ON p.id = t.photo_id';
type Row = TrackerRow;
type C = Context<{ Bindings: Env }>;

export function toTrackerApi(r: Row) {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(r.data); } catch { /* unreadable: show the entry without its fields */ }
  return {
    id: r.id, kind: r.kind, memberId: r.member_id, formerMember: r.former_member, date: r.date, title: r.title,
    photoId: r.photo_id, photoOwned: !!r.photo_id && !!r.photo_own, photoFamily: r.photo_id ? r.photo_family !== 0 : null,
    data, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const HEALTH_OFF_WALL = { error: 'Health entries stay on phones and computers, never on a wall display' };
const isDisplay = async (c: C) => (await resolveKey(c))?.scope === 'display';

async function householdToday(c: C) {
  return todayIn((await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>())?.value);
}

/** The kind's fields, validated; or an error message. Null values drop out (a PATCH clears a field with null). */
function parseData(kind: Kind, raw: Record<string, unknown>): { data: Record<string, unknown> } | { error: string } {
  const clean = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined));
  const parsed = TRACKER_DATA[kind].safeParse(clean);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: `data${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}` };
  }
  return { data: parsed.data };
}

/** Checks shared by create and edit: an error message, or whether the entry owns its photo. */
async function check(
  c: C, e: { id: string; kind: Kind; memberId: string | null; title: string | null; photoId: string | null; data: Record<string, unknown> }, prev?: Row,
): Promise<{ error: string } | { own: number }> {
  if (e.kind === 'reading' && !e.title) return { error: 'title: a book needs a title' };
  if (e.kind === 'memory' && !(e.data.text as string)?.trim() && !e.photoId) return { error: 'data.text: write something or add a photo' };
  if (e.photoId && e.kind !== 'memory') return { error: 'photoId: only a memory has a photo' };
  const db = c.env.DB;
  if (e.memberId && !(await db.prepare('SELECT id FROM members WHERE id = ?').bind(e.memberId).first())) return { error: 'member not found' };
  if (!e.photoId) return { own: 0 };
  if (e.photoId === prev?.photo_id) return { own: prev.photo_own };
  const photo = await db.prepare('SELECT family FROM photos WHERE id = ?').bind(e.photoId).first<{ family: number }>();
  if (!photo) return { error: 'photoId: photo not found' };
  if (photo.family) return { own: 0 }; // a family photo, only referenced
  if (await db.prepare('SELECT id FROM tracker_entries WHERE photo_id = ? AND id != ?').bind(e.photoId, e.id).first()) return { error: 'photoId: that photo belongs to another memory' };
  return { own: 1 };
}

/** Puts an owned photo in or out of the family photos; drops the photo a memory let go of (if it was only the memory's). */
async function settlePhotos(c: C, row: Row, photoFamily: boolean | undefined, dropped: string | null) {
  const db = c.env.DB;
  let changed = false;
  if (row.photo_id && row.photo_own && photoFamily !== undefined) changed = (await db.prepare('UPDATE photos SET family = ? WHERE id = ? AND family != ?').bind(photoFamily ? 1 : 0, row.photo_id, photoFamily ? 1 : 0).run()).meta.changes > 0;
  if (dropped) changed = (await db.prepare('DELETE FROM photos WHERE id = ? AND family = 0').bind(dropped).run()).meta.changes > 0 || changed;
  if (changed) emit(c, 'photo.changed', { id: row.photo_id ?? dropped });
}
const photoFamilyOf = async (c: C, id: string | null) => id ? (await c.env.DB.prepare('SELECT family FROM photos WHERE id = ?').bind(id).first<{ family: number }>())?.family ?? null : null;

// A book marked finished gets today's date if none was given (and its last page, or an audiobook's last minute).
function finishBook(data: Record<string, unknown>, today: string) {
  if (data.status !== 'finished') return data;
  return { ...data, finishedOn: data.finishedOn ?? today, ...(data.totalPages ? { pagesRead: data.totalPages } : {}), ...(data.totalMinutes ? { minutesListened: data.totalMinutes } : {}) };
}

const idParam = z.object({ id: z.string() });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

trackersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/trackers',
    tags: ['Trackers'],
    summary: 'Tracker entries, newest first. A display key never sees health entries (kind=health answers 403).',
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        kind: TrackerKindSchema.optional(),
        memberId: z.string().optional(),
        from: z.string().optional().openapi({ description: 'YYYY-MM-DD, inclusive' }),
        to: z.string().optional().openapi({ description: 'YYYY-MM-DD, inclusive' }),
        q: z.string().max(100).optional().openapi({ description: 'Search titles and fields' }),
        limit: z.coerce.number().int().min(1).max(1000).default(500),
      }),
    },
    responses: {
      200: { description: 'ok', content: json(z.array(TrackerEntrySchema)) },
      403: { description: 'health, from a display key', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { kind, memberId, from, to, q, limit } = c.req.valid('query');
    const display = await isDisplay(c);
    if (display && kind === 'health') return c.json(HEALTH_OFF_WALL, 403);
    const where: string[] = [];
    const binds: unknown[] = [];
    if (kind) { where.push('t.kind = ?'); binds.push(kind); }
    if (display) where.push("t.kind != 'health'");
    if (memberId) { where.push('t.member_id = ?'); binds.push(memberId); }
    if (from) { where.push('t.date >= ?'); binds.push(from); }
    if (to) { where.push('t.date <= ?'); binds.push(to); }
    if (q?.trim()) {
      where.push("(t.title LIKE ? ESCAPE '\\' OR t.data LIKE ? ESCAPE '\\' OR t.former_member LIKE ? ESCAPE '\\')");
      const like = `%${q.trim().replace(/[\\%_]/g, '\\$&')}%`;
      binds.push(like, like, like);
    }
    const { results } = await c.env.DB
      .prepare(`${SELECT_ENTRY} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.date DESC, t.created_at DESC LIMIT ?`)
      .bind(...binds, limit)
      .all<Row>();
    return c.json(results.map(toTrackerApi), 200);
  },
);

// Registered before /api/trackers/{id} so "summary" isn't taken for an id.
trackersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/trackers/summary',
    tags: ['Trackers'],
    summary: 'Reading stats per member (member null = the family, or a removed member named in formerMember): books and audiobooks finished this year, pages, minutes listened, and the books in progress',
    security: [{ Bearer: [] }],
    request: { query: z.object({ year: z.coerce.number().int().min(1900).max(2200).optional() }) },
    responses: { 200: { description: 'ok', content: json(ReadingSummarySchema) } },
  }),
  async (c) => {
    const year = c.req.valid('query').year ?? Number((await householdToday(c)).slice(0, 4));
    const { results } = await c.env.DB.prepare("SELECT * FROM tracker_entries WHERE kind = 'reading' ORDER BY date DESC").all<Row>();
    const byMember = new Map<string, z.infer<typeof ReadingSummarySchema>['members'][number]>();
    for (const e of results.map(toTrackerApi)) {
      const d = e.data as ReadingProgress & { status?: string; finishedOn?: string };
      const key = e.memberId ?? `former:${e.formerMember ?? ''}`;
      const m = byMember.get(key) ?? { memberId: e.memberId, formerMember: e.formerMember, finished: 0, pages: 0, minutes: 0, reading: [] };
      byMember.set(key, m);
      if (d.status === 'finished' && d.finishedOn?.startsWith(String(year))) { m.finished++; m.pages += pagesOf(d) ?? 0; m.minutes += minutesOf(d) ?? 0; }
      if (d.status === 'reading') {
        if (isAudiobook(d)) m.minutes += d.minutesListened ?? 0;
        else m.pages += d.pagesRead ?? 0;
        m.reading.push({ id: e.id, title: e.title, percent: readingPercent(d) });
      }
    }
    return c.json({ year, members: [...byMember.values()] }, 200);
  },
);

trackersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/trackers',
    tags: ['Trackers'],
    summary: 'Add an entry. data holds the kind\'s fields (ReadingData, MemoryData or HealthData). A display key can add reading and memories, not health.',
    security: [{ Bearer: [] }],
    request: { body: { content: json(TrackerInputSchema) } },
    responses: {
      201: { description: 'created', content: json(TrackerEntrySchema) },
      400: { description: 'invalid', content: json(ErrorSchema) },
      403: { description: 'health, from a display key', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if (body.kind === 'health' && (await isDisplay(c))) return c.json(HEALTH_OFF_WALL, 403);
    const today = await householdToday(c);
    const parsed = parseData(body.kind, body.data);
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const entry = {
      id: crypto.randomUUID(), kind: body.kind, memberId: body.memberId ?? null, title: body.title?.trim() || null, photoId: body.photoId ?? null,
      data: body.kind === 'reading' ? finishBook(parsed.data, today) : parsed.data,
    };
    const ok = await check(c, entry);
    if ('error' in ok) return c.json(ok, 400);
    const now = new Date().toISOString();
    const row: Row = {
      id: entry.id, kind: entry.kind, member_id: entry.memberId, former_member: null, date: body.date ?? today, title: entry.title,
      photo_id: entry.photoId, photo_own: ok.own, data: JSON.stringify(entry.data), created_at: now, updated_at: now,
    };
    await c.env.DB
      .prepare('INSERT INTO tracker_entries (id, kind, member_id, date, title, photo_id, photo_own, data, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(row.id, row.kind, row.member_id, row.date, row.title, row.photo_id, row.photo_own, row.data, row.created_at, row.updated_at)
      .run();
    await settlePhotos(c, row, body.photoFamily, null);
    emit(c, 'tracker.changed', { id: row.id, kind: row.kind }); // never the fields: webhooks see only that something changed
    return c.json(toTrackerApi({ ...row, photo_family: await photoFamilyOf(c, row.photo_id) }), 201);
  },
);

async function load(c: C, id: string): Promise<{ row: Row } | { res: Response }> {
  const row = await c.env.DB.prepare(`${SELECT_ENTRY} WHERE t.id = ?`).bind(id).first<Row>();
  if (!row) return { res: c.json({ error: 'not found' }, 404) };
  if (row.kind === 'health' && (await isDisplay(c))) return { res: c.json(HEALTH_OFF_WALL, 403) };
  return { row };
}

trackersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/trackers/{id}',
    tags: ['Trackers'],
    summary: 'One entry',
    security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: {
      200: { description: 'ok', content: json(TrackerEntrySchema) },
      403: { description: 'health, from a display key', content: json(ErrorSchema) },
      404: { description: 'not found', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const got = await load(c, c.req.valid('param').id);
    if ('res' in got) return got.res as never;
    return c.json(toTrackerApi(got.row), 200);
  },
);

trackersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/trackers/{id}',
    tags: ['Trackers'],
    summary: 'Edit an entry. data is merged over the entry\'s fields (null clears one). The kind never changes.',
    security: [{ Bearer: [] }],
    request: { params: idParam, body: { content: json(TrackerPatchSchema) } },
    responses: {
      200: { description: 'ok', content: json(TrackerEntrySchema) },
      400: { description: 'invalid', content: json(ErrorSchema) },
      403: { description: 'health, from a display key', content: json(ErrorSchema) },
      404: { description: 'not found', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const got = await load(c, c.req.valid('param').id);
    if ('res' in got) return got.res as never;
    const { row } = got;
    const body = c.req.valid('json');
    const old = toTrackerApi(row);
    const parsed = parseData(row.kind, { ...old.data, ...body.data });
    if ('error' in parsed) return c.json({ error: parsed.error }, 400);
    const today = await householdToday(c);
    const entry = {
      id: row.id,
      kind: row.kind,
      memberId: body.memberId !== undefined ? body.memberId : row.member_id,
      title: body.title !== undefined ? body.title?.trim() || null : row.title,
      photoId: body.photoId !== undefined ? body.photoId : row.photo_id,
      data: row.kind === 'reading' ? finishBook(parsed.data, today) : parsed.data,
    };
    const ok = await check(c, entry, row);
    if ('error' in ok) return c.json(ok, 400);
    const updated: Row = {
      ...row, member_id: entry.memberId, former_member: body.memberId !== undefined ? null : row.former_member, // picking someone (or the family) settles a removed member's entry
      date: body.date ?? row.date, title: entry.title, photo_id: entry.photoId, photo_own: ok.own, data: JSON.stringify(entry.data), updated_at: new Date().toISOString(),
    };
    await c.env.DB
      .prepare('UPDATE tracker_entries SET member_id = ?, former_member = ?, date = ?, title = ?, photo_id = ?, photo_own = ?, data = ?, updated_at = ? WHERE id = ?')
      .bind(updated.member_id, updated.former_member, updated.date, updated.title, updated.photo_id, updated.photo_own, updated.data, updated.updated_at, row.id)
      .run();
    await settlePhotos(c, updated, body.photoFamily, row.photo_own && row.photo_id !== updated.photo_id ? row.photo_id : null);
    emit(c, 'tracker.changed', { id: row.id, kind: row.kind });
    return c.json(toTrackerApi({ ...updated, photo_family: await photoFamilyOf(c, updated.photo_id) }), 200);
  },
);

trackersRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/trackers/{id}',
    tags: ['Trackers'],
    summary: "Delete an entry (admin keys only). A memory's own photo goes with it, unless it's also a family photo.",
    security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: {
      200: { description: 'ok', content: json(z.object({ ok: z.boolean() })) },
      404: { description: 'not found', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const got = await load(c, c.req.valid('param').id);
    if ('res' in got) return got.res as never;
    await c.env.DB.prepare('DELETE FROM tracker_entries WHERE id = ?').bind(got.row.id).run();
    await settlePhotos(c, got.row, undefined, got.row.photo_own ? got.row.photo_id : null);
    emit(c, 'tracker.changed', { id: got.row.id, kind: got.row.kind, deleted: true });
    return c.json({ ok: true }, 200);
  },
);
