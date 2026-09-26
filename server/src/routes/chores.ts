import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { todayInTz } from './members.ts';
import { emit } from '../bus.ts';
import { expand, isValidRrule } from '../recurrence.ts';
import { ChoreDaySchema, ChoreInputSchema, ChoreSchema, ErrorSchema } from '../schemas.ts';
import { resetListItems } from './lists.ts';

export const choresRoutes = createRouter();

export type ChoreRow = {
  id: string;
  title: string;
  emoji: string | null;
  member_id: string | null;
  points: number;
  rrule: string | null;
  due_date: string | null;
  due_time: string | null;
  active: number;
  sort: number;
  created_at: string;
  list_id?: string | null; // checklist; optional so older row literals (tests) still type-check
};

export function toApi(row: ChoreRow) {
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    memberId: row.member_id,
    points: row.points,
    rrule: row.rrule,
    dueDate: row.due_date,
    dueTime: row.due_time,
    active: !!row.active,
    sort: row.sort,
    listId: row.list_id ?? null,
  };
}

// A checklist must be a real, unarchived list. Returns an error message or null.
async function checkList(c: { env: Env }, listId: string | null | undefined): Promise<string | null> {
  if (!listId) return null;
  const row = await c.env.DB.prepare('SELECT id FROM lists WHERE id = ? AND archived = 0').bind(listId).first();
  return row ? null : 'unknown list';
}

choresRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/chores',
    tags: ['Chores'],
    summary: 'List chores',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ChoreSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM chores ORDER BY sort, created_at').all<ChoreRow>();
    return c.json(results.map(toApi), 200);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chores',
    tags: ['Chores'],
    summary: 'Create a chore',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: ChoreInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: ChoreSchema } } },
      400: { description: 'invalid rrule or unknown list', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if (body.rrule && !isValidRrule(body.rrule)) return c.json({ error: 'invalid rrule' }, 400);
    const listError = await checkList(c, body.listId);
    if (listError) return c.json({ error: listError }, 400);
    const row: ChoreRow = {
      id: crypto.randomUUID(),
      title: body.title,
      emoji: body.emoji ?? null,
      member_id: body.memberId ?? null,
      points: body.points ?? 0,
      rrule: body.rrule ?? null,
      due_date: body.dueDate ?? null,
      due_time: body.dueTime ?? null,
      active: body.active === false ? 0 : 1,
      sort: body.sort ?? 0,
      created_at: new Date().toISOString(),
      list_id: body.listId ?? null,
    };
    await c.env.DB.prepare(
      'INSERT INTO chores (id, title, emoji, member_id, points, rrule, due_date, due_time, active, sort, created_at, list_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.title, row.emoji, row.member_id, row.points, row.rrule, row.due_date, row.due_time, row.active, row.sort, row.created_at, row.list_id)
      .run();
    emit(c, 'chore.changed', { id: row.id });
    return c.json(toApi(row), 201);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/chores/{id}',
    tags: ['Chores'],
    summary: 'Update a chore',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ChoreInputSchema.partial() } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ChoreSchema } } },
      400: { description: 'invalid rrule or unknown list', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (body.rrule && !isValidRrule(body.rrule)) return c.json({ error: 'invalid rrule' }, 400);
    const listError = await checkList(c, body.listId);
    if (listError) return c.json({ error: listError }, 400);
    const existing = await c.env.DB.prepare('SELECT * FROM chores WHERE id = ?').bind(id).first<ChoreRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const updated: ChoreRow = {
      ...existing,
      title: body.title ?? existing.title,
      emoji: body.emoji !== undefined ? body.emoji : existing.emoji,
      member_id: body.memberId !== undefined ? body.memberId : existing.member_id,
      points: body.points ?? existing.points,
      rrule: body.rrule !== undefined ? body.rrule : existing.rrule,
      due_date: body.dueDate !== undefined ? body.dueDate : existing.due_date,
      due_time: body.dueTime !== undefined ? body.dueTime : existing.due_time,
      active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
      sort: body.sort ?? existing.sort,
      list_id: body.listId !== undefined ? body.listId : existing.list_id ?? null,
    };
    await c.env.DB.prepare(
      'UPDATE chores SET title=?, emoji=?, member_id=?, points=?, rrule=?, due_date=?, due_time=?, active=?, sort=?, list_id=? WHERE id=?',
    )
      .bind(updated.title, updated.emoji, updated.member_id, updated.points, updated.rrule, updated.due_date, updated.due_time, updated.active, updated.sort, updated.list_id, id)
      .run();
    emit(c, 'chore.changed', { id });
    return c.json(toApi(updated), 200);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/chores/{id}',
    tags: ['Chores'],
    summary: 'Delete a chore',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await c.env.DB.prepare('DELETE FROM chores WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'chore.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

// A chore is due on `date` (household tz) if: one-off matching due_date, or its rrule
// occurs that day (anchored at due_date if set, else its creation date).
// Exported for reuse by routes/leaderboard.ts (streak calculation) - single source of truth
// for "which chores are due on date X".
export function dueOnDate(row: ChoreRow, date: string, tz: string): boolean {
  if (!row.rrule) return row.due_date === date;
  // The creation *day* in the household tz: created_at is UTC, so an evening chore west of UTC
  // would otherwise anchor on tomorrow and not show up until then.
  const anchor = row.due_date ?? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(row.created_at));
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  try {
    return expand(row.rrule, anchor, anchor, true, tz, dayStart, dayEnd).length > 0;
  } catch {
    return false; // a bad stored rrule (pre-validation rows) hides that chore, not the whole day
  }
}

choresRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/chores/day',
    tags: ['Chores'],
    summary: 'Chores due on a date (household timezone), with completion state',
    security: [{ Bearer: [] }],
    request: { query: z.object({ date: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ChoreDaySchema) } } } },
  }),
  async (c) => {
    const { date } = c.req.valid('query');

    // tz, chores and completions are all independent reads - one batch, one round trip.
    const [tzRes, choresRes, completionsRes, checklistRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
      c.env.DB.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY sort, created_at'),
      c.env.DB.prepare('SELECT * FROM chore_completions WHERE date = ?').bind(date),
      // Checklist progress per chore: the linked list's items owned by the chore's member plus
      // unassigned ones (an "anyone" chore sees the whole list), so one list can back a routine
      // for several members.
      c.env.DB.prepare(
        'SELECT ch.id AS chore_id, l.id AS list_id, l.name, COUNT(i.id) AS total, COALESCE(SUM(i.done), 0) AS done FROM chores ch JOIN lists l ON l.id = ch.list_id LEFT JOIN list_items i ON i.list_id = l.id AND (ch.member_id IS NULL OR i.member_id IS NULL OR i.member_id = ch.member_id) WHERE ch.active = 1 GROUP BY ch.id',
      ),
    ]);
    const checklists = new Map((checklistRes.results as { chore_id: string; list_id: string; name: string; total: number; done: number }[]).map((r) => [r.chore_id, r]));
    const tz = (tzRes.results[0] as { value: string } | undefined)?.value ?? hostTimezone();
    const chores = choresRes.results as unknown as ChoreRow[];
    const completions = completionsRes.results as unknown as { chore_id: string; member_id: string | null; completed_at: string }[];

    const due = chores.filter((row) => dueOnDate(row, date, tz));
    const byChore = new Map(completions.map((row) => [row.chore_id, row]));

    return c.json(
      due.map((row) => {
        const completion = byChore.get(row.id);
        const cl = row.list_id ? checklists.get(row.id) : undefined;
        return {
          ...toApi(row),
          completed: !!completion,
          completedAt: completion?.completed_at ?? null,
          completedBy: completion?.member_id ?? null,
          checklist: cl ? { listId: cl.list_id, name: cl.name, total: Number(cl.total), done: Number(cl.done) } : null,
        };
      }),
      200,
    );
  },
);

// Points a completion earns: full on the day (or ahead of it), `creditPercent` of them when it's
// ticked off for a past day (never below 0).
export function lateCompletionPoints(points: number, late: boolean, creditPercent: number): number {
  return late ? Math.max(0, Math.round((points * creditPercent) / 100)) : points;
}

choresRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chores/{id}/complete',
    tags: ['Chores'],
    summary: 'Mark a chore complete for a date',
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: z.object({ date: z.string(), memberId: z.string().optional() }) } } },
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'checklist not finished', content: { 'application/json': { schema: ErrorSchema.extend({ remaining: z.number() }) } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { date, memberId } = c.req.valid('json');
    const [choreRes, settingsRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare('SELECT id, member_id, points, list_id FROM chores WHERE id = ?').bind(id),
      c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('timezone', 'lateCompletionCredit')"),
    ]);
    const chore = choreRes.results[0] as { id: string; member_id: string | null; points: number; list_id: string | null } | undefined;
    if (!chore) return c.json({ error: 'not found' }, 404);
    // The checklist gates completion: the list's items for this chore's member (or whoever is
    // completing an "anyone" chore) plus unassigned ones. An empty set doesn't gate.
    const forMember = chore.member_id ?? memberId ?? null;
    let checklistKind: string | null = null;
    if (chore.list_id) {
      const list = await c.env.DB.prepare(
        'SELECT kind, (SELECT COUNT(*) FROM list_items WHERE list_id = lists.id AND done = 0 AND (? IS NULL OR member_id IS NULL OR member_id = ?)) AS remaining FROM lists WHERE id = ?',
      )
        .bind(forMember, forMember, chore.list_id)
        .first<{ kind: string; remaining: number }>();
      if (list && Number(list.remaining) > 0) return c.json({ error: `Checklist not finished (${list.remaining} left)`, remaining: Number(list.remaining) }, 409);
      checklistKind = list?.kind ?? null;
    }
    const settings = new Map((settingsRes.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const today = todayInTz(settings.get('timezone') ?? hostTimezone());
    const pointsAwarded = lateCompletionPoints(chore.points, date < today, Number(settings.get('lateCompletionCredit') ?? 50));
    // Re-ticking an existing completion (e.g. to change who did it) keeps the points it already earned.
    await c.env.DB.prepare(
      'INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, points_awarded) VALUES (?,?,?,?,?,?) ON CONFLICT(chore_id, date) DO UPDATE SET member_id = excluded.member_id, completed_at = excluded.completed_at',
    )
      .bind(crypto.randomUUID(), id, date, memberId ?? chore.member_id, new Date().toISOString(), pointsAwarded)
      .run();
    emit(c, 'chore.completed', { id, date });
    // A reusable checklist starts fresh for the next time the chore comes round - just this
    // member's items and the shared ones, so a sibling's ticks on the same list survive.
    if (chore.list_id && checklistKind === 'reusable') {
      await resetListItems(c.env.DB, chore.list_id, forMember);
      emit(c, 'list.changed', { id: chore.list_id });
    }
    return c.json({ ok: true }, 200);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/chores/{id}/complete',
    tags: ['Chores'],
    summary: 'Undo a chore completion for a date',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), query: z.object({ date: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { date } = c.req.valid('query');
    await c.env.DB.prepare('DELETE FROM chore_completions WHERE chore_id = ? AND date = ?').bind(id, date).run();
    emit(c, 'chore.uncompleted', { id, date });
    return c.json({ ok: true }, 200);
  },
);
