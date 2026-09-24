import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { emit } from '../bus.ts';
import { expand } from '../recurrence.ts';
import { ChoreDaySchema, ChoreInputSchema, ChoreSchema, ErrorSchema } from '../schemas.ts';

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
};

function toApi(row: ChoreRow) {
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
  };
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
    responses: { 201: { description: 'created', content: { 'application/json': { schema: ChoreSchema } } } },
  }),
  async (c) => {
    const body = c.req.valid('json');
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
    };
    await c.env.DB.prepare(
      'INSERT INTO chores (id, title, emoji, member_id, points, rrule, due_date, due_time, active, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.title, row.emoji, row.member_id, row.points, row.rrule, row.due_date, row.due_time, row.active, row.sort, row.created_at)
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
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
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
    };
    await c.env.DB.prepare(
      'UPDATE chores SET title=?, emoji=?, member_id=?, points=?, rrule=?, due_date=?, due_time=?, active=?, sort=? WHERE id=?',
    )
      .bind(updated.title, updated.emoji, updated.member_id, updated.points, updated.rrule, updated.due_date, updated.due_time, updated.active, updated.sort, id)
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
  const anchor = row.due_date ?? row.created_at.slice(0, 10);
  const dayStart = new Date(`${date}T00:00:00Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const instances = expand(row.rrule, anchor, anchor, true, tz, dayStart, dayEnd);
  return instances.length > 0;
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
    const [tzRes, choresRes, completionsRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
      c.env.DB.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY sort, created_at'),
      c.env.DB.prepare('SELECT * FROM chore_completions WHERE date = ?').bind(date),
    ]);
    const tz = (tzRes.results[0] as { value: string } | undefined)?.value ?? hostTimezone();
    const chores = choresRes.results as unknown as ChoreRow[];
    const completions = completionsRes.results as unknown as { chore_id: string; member_id: string | null; completed_at: string }[];

    const due = chores.filter((row) => dueOnDate(row, date, tz));
    const byChore = new Map(completions.map((row) => [row.chore_id, row]));

    return c.json(
      due.map((row) => {
        const completion = byChore.get(row.id);
        return { ...toApi(row), completed: !!completion, completedAt: completion?.completed_at ?? null, completedBy: completion?.member_id ?? null };
      }),
      200,
    );
  },
);

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
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { date, memberId } = c.req.valid('json');
    const chore = await c.env.DB.prepare('SELECT id, member_id FROM chores WHERE id = ?').bind(id).first<{ id: string; member_id: string | null }>();
    if (!chore) return c.json({ error: 'not found' }, 404);
    await c.env.DB.prepare(
      'INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at) VALUES (?,?,?,?,?) ON CONFLICT(chore_id, date) DO UPDATE SET member_id = excluded.member_id, completed_at = excluded.completed_at',
    )
      .bind(crypto.randomUUID(), id, date, memberId ?? chore.member_id, new Date().toISOString())
      .run();
    emit(c, 'chore.completed', { id, date });
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
