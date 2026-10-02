// Chore library: saved chores that aren't on a schedule (clean out the car, wash the windows), for a
// parent to hand out in a couple of taps. Assigning one makes a normal chore with library_id set, so
// "last done" and "last person" are read from those chores, never stored. Parent devices only: not
// in auth.ts's display allow-list, so wall screens and kids' devices get 403 here (they still do the
// chores made from it as usual).
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { KinwallDb } from '../db.ts';
import { emit } from '../bus.ts';
import { isValidRrule } from '../recurrence.ts';
import { ChoreSchema, EmojiSchema, ErrorSchema } from '../schemas.ts';
import { choreRepeatError, insertChore, toApi as choreToApi, type ChoreRow } from './chores.ts';

export const choreLibraryRoutes = createRouter();

export type LibraryRow = {
  id: string;
  title: string;
  emoji: string | null;
  points: number;
  list_id: string | null;
  member_id: string | null;
  every_n: number | null;
  every_unit: 'day' | 'week' | 'month' | null;
  needs_approval: number | null;
  notes: string | null;
  created_at: string;
};
type ListedRow = LibraryRow & { last_done: string | null; last_done_by: string | null; last_member_id: string | null; times_assigned: number };
type OpenRow = { id: string; library_id: string; due_date: string | null; member_id: string | null; rrule: string | null };

const UnitSchema = z.enum(['day', 'week', 'month']);

export const LibraryChoreSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    emoji: z.string().nullable(),
    points: z.number(),
    listId: z.string().nullable().openapi({ description: 'Checklist carried to the chores made from it.' }),
    memberId: z.string().nullable().openapi({ description: 'Suggested person: who it goes to when assign names no one.' }),
    everyN: z.number().nullable().openapi({ description: 'About every everyN everyUnit: a soft interval for nudges, not a schedule.' }),
    everyUnit: UnitSchema.nullable(),
    needsApproval: z.boolean().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
    lastDone: z.object({ date: z.string(), memberId: z.string().nullable() }).nullable().openapi({ description: 'The latest approved completion of a chore made from it.' }),
    lastMemberId: z.string().nullable().openapi({ description: 'Who the most recent chore made from it went to (null = Anyone). "Again" uses it when timesAssigned > 0.' }),
    timesAssigned: z.number(),
    open: z
      .object({ choreId: z.string(), dueDate: z.string().nullable(), memberId: z.string().nullable(), repeats: z.boolean() })
      .nullable()
      .openapi({ description: 'A chore made from it that is still to do (a one-off not ticked yet, or a repeating one), soonest first.' }),
  })
  .openapi('LibraryChore');

const LibraryFields = {
  title: z.string().trim().min(1).max(200),
  emoji: EmojiSchema.nullable().optional(),
  points: z.number().int().min(0).max(10000).optional(),
  listId: z.string().nullable().optional(),
  memberId: z.string().nullable().optional(),
  everyN: z.number().int().min(1).max(365).nullable().optional(),
  everyUnit: UnitSchema.nullable().optional(),
  needsApproval: z.boolean().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
};
const LibraryInputSchema = z
  .object({ ...LibraryFields, title: LibraryFields.title.optional(), fromChoreId: z.string().optional().openapi({ description: '"Save to library": copy this chore (title, emoji, points, checklist, person, approval) and link it, so its history counts. Fields given here win.' }) })
  .openapi('LibraryChoreInput');
const LibraryPatchSchema = z.object(LibraryFields).partial().openapi('LibraryChorePatch');
const AssignSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ description: 'YYYY-MM-DD: the day it is due (a repeating one starts then).' }),
    memberId: z.string().nullable().optional().openapi({ description: "Who does it; null = Anyone. Omit for the item's suggested person." }),
    dueTime: z.string().nullable().optional(),
    rrule: z.string().nullable().optional().openapi({ description: '"Make it repeat": a recurrence such as FREQ=WEEKLY;INTERVAL=4. Omit for a one-off.' }),
  })
  .openapi('LibraryAssign');

/** The starter set a new family gets (fixed ids, so an export imported into a new family merges). */
export const STARTER_LIBRARY: { id: string; title: string; emoji: string; points: number; everyN: number | null; everyUnit: LibraryRow['every_unit'] }[] = [
  { id: 'starter-car', title: 'Clean out the car', emoji: '🚗', points: 10, everyN: 1, everyUnit: 'month' },
  { id: 'starter-windows', title: 'Wash the windows', emoji: '🪟', points: 15, everyN: 3, everyUnit: 'month' },
  { id: 'starter-fridge', title: 'Deep-clean the fridge', emoji: '🧊', points: 10, everyN: 2, everyUnit: 'month' },
  { id: 'starter-mattress', title: 'Flip the mattress', emoji: '🛏️', points: 5, everyN: 6, everyUnit: 'month' },
  { id: 'starter-garage', title: 'Organize the garage', emoji: '🧰', points: 20, everyN: 6, everyUnit: 'month' },
  { id: 'starter-baseboards', title: 'Wipe the baseboards', emoji: '🧽', points: 10, everyN: 2, everyUnit: 'month' },
  { id: 'starter-leaves', title: 'Rake leaves', emoji: '🍂', points: 15, everyN: null, everyUnit: null },
  { id: 'starter-closet', title: 'Sort out the closet', emoji: '👕', points: 10, everyN: 6, everyUnit: 'month' },
];

/** Gives a new family the starter set, once ever (the family can delete them; they don't come back). */
export async function seedChoreLibrary(db: KinwallDb): Promise<void> {
  const done = await db.prepare("SELECT 1 FROM settings WHERE key = 'choreLibrarySeeded'").first();
  if (done) return;
  const now = new Date().toISOString();
  await db.batch([
    ...STARTER_LIBRARY.map((s) =>
      db.prepare('INSERT OR IGNORE INTO chore_library (id, title, emoji, points, every_n, every_unit, created_at) VALUES (?,?,?,?,?,?,?)').bind(s.id, s.title, s.emoji, s.points, s.everyN, s.everyUnit, now),
    ),
    db.prepare("INSERT INTO settings (key, value) VALUES ('choreLibrarySeeded', '1') ON CONFLICT(key) DO NOTHING"),
  ]);
}

// Last done / last person / times assigned, from the chores made from each item. Approved ticks
// only: one waiting for a parent's OK isn't done yet.
const LIST_SQL = `SELECT l.*,
  (SELECT cc.date FROM chore_completions cc JOIN chores ch ON ch.id = cc.chore_id WHERE ch.library_id = l.id AND cc.status = 'approved' ORDER BY cc.date DESC, cc.completed_at DESC LIMIT 1) AS last_done,
  (SELECT cc.member_id FROM chore_completions cc JOIN chores ch ON ch.id = cc.chore_id WHERE ch.library_id = l.id AND cc.status = 'approved' ORDER BY cc.date DESC, cc.completed_at DESC LIMIT 1) AS last_done_by,
  (SELECT ch.member_id FROM chores ch WHERE ch.library_id = l.id ORDER BY ch.created_at DESC, ch.rowid DESC LIMIT 1) AS last_member_id,
  (SELECT COUNT(*) FROM chores ch WHERE ch.library_id = l.id) AS times_assigned
  FROM chore_library l`;
const OPEN_SQL = `SELECT id, library_id, due_date, member_id, rrule FROM chores ch WHERE library_id IS NOT NULL AND active = 1 AND archived = 0
  AND (rrule IS NOT NULL OR NOT EXISTS (SELECT 1 FROM chore_completions WHERE chore_id = ch.id)) ORDER BY due_date IS NULL, due_date, created_at`;

function toApi(r: ListedRow, open: OpenRow | undefined): z.infer<typeof LibraryChoreSchema> {
  return {
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    points: r.points,
    listId: r.list_id,
    memberId: r.member_id,
    everyN: r.every_n,
    everyUnit: r.every_unit,
    needsApproval: r.needs_approval == null ? null : !!r.needs_approval,
    notes: r.notes,
    createdAt: r.created_at,
    lastDone: r.last_done ? { date: r.last_done, memberId: r.last_done_by } : null,
    lastMemberId: r.last_member_id,
    timesAssigned: Number(r.times_assigned),
    open: open ? { choreId: open.id, dueDate: open.due_date, memberId: open.member_id, repeats: !!open.rrule } : null,
  };
}

export async function readLibrary(db: KinwallDb, id?: string) {
  const [rows, open] = await db.batch<unknown>([
    id ? db.prepare(`${LIST_SQL} WHERE l.id = ?`).bind(id) : db.prepare(`${LIST_SQL} ORDER BY l.title COLLATE NOCASE, l.created_at`),
    id ? db.prepare(OPEN_SQL.replace('library_id IS NOT NULL', 'library_id = ?')).bind(id) : db.prepare(OPEN_SQL),
  ]);
  const firstOpen = new Map<string, OpenRow>();
  for (const o of open.results as OpenRow[]) if (!firstOpen.has(o.library_id)) firstOpen.set(o.library_id, o);
  return (rows.results as ListedRow[]).map((r) => toApi(r, firstOpen.get(r.id)));
}

// A checklist must be a live list and a suggested person a member. Returns an error or null.
async function checkRefs(db: KinwallDb, b: { listId?: string | null; memberId?: string | null }): Promise<string | null> {
  if (b.listId && !(await db.prepare('SELECT id FROM lists WHERE id = ? AND archived = 0').bind(b.listId).first())) return 'unknown list';
  if (b.memberId && !(await db.prepare('SELECT id FROM members WHERE id = ?').bind(b.memberId).first())) return 'unknown member';
  return null;
}
const intervalError = (n: number | null | undefined, unit: string | null | undefined) => ((n == null) !== (unit == null) ? 'everyN and everyUnit go together' : null);

const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const err = (description: string) => ({ description, ...json(ErrorSchema) });

choreLibraryRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/chore-library',
    tags: ['Chores'],
    summary: 'The chore library: saved chores to hand out, A-Z, each with when it was last done (parent devices only)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', ...json(z.array(LibraryChoreSchema)) } },
  }),
  async (c) => c.json(await readLibrary(c.env.DB), 200),
);

choreLibraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chore-library',
    tags: ['Chores'],
    summary: 'Save a chore to the library, from scratch or from an existing chore (fromChoreId) (parent devices only)',
    security: [{ Bearer: [] }],
    request: { body: json(LibraryInputSchema) },
    responses: { 201: { description: 'created', ...json(LibraryChoreSchema) }, 400: err('missing title, unknown list or member, or an interval without its unit'), 404: err('fromChoreId not found') },
  }),
  async (c) => {
    const { fromChoreId, ...body } = c.req.valid('json');
    let from: ChoreRow | null = null;
    if (fromChoreId) {
      from = await c.env.DB.prepare('SELECT * FROM chores WHERE id = ? AND archived = 0').bind(fromChoreId).first<ChoreRow>();
      if (!from) return c.json({ error: 'chore not found' }, 404);
    }
    const title = body.title ?? from?.title;
    if (!title) return c.json({ error: 'title: required' }, 400);
    const row: LibraryRow = {
      id: crypto.randomUUID(),
      title,
      emoji: body.emoji !== undefined ? body.emoji : (from?.emoji ?? null),
      points: body.points ?? from?.points ?? 0,
      list_id: body.listId !== undefined ? body.listId : (from?.list_id ?? null),
      member_id: body.memberId !== undefined ? body.memberId : (from?.member_id ?? null),
      every_n: body.everyN ?? null,
      every_unit: body.everyUnit ?? null,
      needs_approval: body.needsApproval !== undefined ? (body.needsApproval == null ? null : body.needsApproval ? 1 : 0) : (from?.needs_approval ?? null),
      notes: body.notes?.trim() || null,
      created_at: new Date().toISOString(),
    };
    const error = intervalError(row.every_n, row.every_unit) ?? (await checkRefs(c.env.DB, { listId: body.listId, memberId: body.memberId }));
    if (error) return c.json({ error }, 400);
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO chore_library (id, title, emoji, points, list_id, member_id, every_n, every_unit, needs_approval, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(
        row.id, row.title, row.emoji, row.points, row.list_id, row.member_id, row.every_n, row.every_unit, row.needs_approval, row.notes, row.created_at,
      ),
      // The chore it was saved from counts toward it (its history, and "last done").
      ...(from ? [c.env.DB.prepare('UPDATE chores SET library_id = ? WHERE id = ?').bind(row.id, from.id)] : []),
    ]);
    emit(c, 'chore.library.changed', { id: row.id });
    if (from) emit(c, 'chore.changed', { id: from.id });
    return c.json((await readLibrary(c.env.DB, row.id))[0], 201);
  },
);

choreLibraryRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/chore-library/{id}',
    tags: ['Chores'],
    summary: 'Change a library chore; only the fields given change (parent devices only). Chores already made from it stay as they are.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: json(LibraryPatchSchema) },
    responses: { 200: { description: 'ok', ...json(LibraryChoreSchema) }, 400: err('unknown list or member, or an interval without its unit'), 404: err('not found') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const old = await c.env.DB.prepare('SELECT * FROM chore_library WHERE id = ?').bind(id).first<LibraryRow>();
    if (!old) return c.json({ error: 'not found' }, 404);
    const pick = <K extends keyof typeof b, V>(k: K, cur: V, map: (v: NonNullable<(typeof b)[K]> | null) => V = (v) => v as V) => (b[k] === undefined ? cur : map(b[k] ?? null));
    const row: LibraryRow = {
      ...old,
      title: pick('title', old.title),
      emoji: pick('emoji', old.emoji),
      points: pick('points', old.points, (v) => v ?? 0),
      list_id: pick('listId', old.list_id),
      member_id: pick('memberId', old.member_id),
      every_n: pick('everyN', old.every_n),
      every_unit: pick('everyUnit', old.every_unit),
      needs_approval: pick('needsApproval', old.needs_approval, (v) => (v == null ? null : v ? 1 : 0)),
      notes: pick('notes', old.notes, (v) => v?.trim() || null),
    };
    const error = intervalError(row.every_n, row.every_unit) ?? (await checkRefs(c.env.DB, { listId: b.listId, memberId: b.memberId }));
    if (error) return c.json({ error }, 400);
    await c.env.DB.prepare('UPDATE chore_library SET title=?, emoji=?, points=?, list_id=?, member_id=?, every_n=?, every_unit=?, needs_approval=?, notes=? WHERE id=?')
      .bind(row.title, row.emoji, row.points, row.list_id, row.member_id, row.every_n, row.every_unit, row.needs_approval, row.notes, id)
      .run();
    emit(c, 'chore.library.changed', { id });
    return c.json((await readLibrary(c.env.DB, id))[0], 200);
  },
);

choreLibraryRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/chore-library/{id}',
    tags: ['Chores'],
    summary: 'Remove a chore from the library (parent devices only). Chores already made from it stay.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: 'ok', ...json(z.object({ ok: z.boolean() })) }, 404: err('not found') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM chore_library WHERE id = ?').bind(id).run();
    if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
    emit(c, 'chore.library.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

choreLibraryRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chore-library/{id}/assign',
    tags: ['Chores'],
    summary:
      'Hand out a library chore: makes a normal chore (title, emoji, points, checklist and approval carried over) due on date, for memberId or the suggested person. With rrule it repeats from that date (parent devices only).',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: json(AssignSchema) },
    responses: { 201: { description: 'the chore it made', ...json(ChoreSchema) }, 400: err('invalid date, rrule or member'), 404: err('not found') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const item = await c.env.DB.prepare('SELECT * FROM chore_library WHERE id = ?').bind(id).first<LibraryRow>();
    if (!item) return c.json({ error: 'not found' }, 404);
    if (b.rrule && !isValidRrule(b.rrule)) return c.json({ error: 'invalid rrule' }, 400);
    const neverError = await choreRepeatError(c.env.DB, b.rrule, b.date);
    if (neverError) return c.json({ error: neverError }, 400);
    const memberId = b.memberId !== undefined ? b.memberId : item.member_id;
    const error = await checkRefs(c.env.DB, { memberId });
    if (error) return c.json({ error }, 400);
    // A checklist archived since it was saved is left off rather than failing the assign.
    const listId = item.list_id && (await c.env.DB.prepare('SELECT id FROM lists WHERE id = ? AND archived = 0').bind(item.list_id).first()) ? item.list_id : null;
    const row: ChoreRow = {
      id: crypto.randomUUID(),
      title: item.title,
      emoji: item.emoji,
      member_id: memberId,
      points: item.points,
      rrule: b.rrule || null,
      due_date: b.date, // a repeating chore anchors on it
      due_time: b.dueTime ?? null,
      active: 1,
      sort: 0,
      created_at: new Date().toISOString(),
      list_id: listId,
      needs_approval: item.needs_approval,
      approve_timed_play: 0,
      library_id: id,
    };
    await insertChore(c.env.DB, row);
    emit(c, 'chore.changed', { id: row.id, libraryId: id });
    return c.json(choreToApi(row), 201);
  },
);
