// Bonus points (migration 0095): a parent gives a member points outside a chore ("+10 · Helped
// carry groceries"). Each is a point_entries row, reason 'bonus', ref = the household day it counts
// on, so it adds to the balance, today/week, the leaderboard and the profile like chore points; it
// isn't a chore completion, so chore counts and streaks don't move. Not in auth.ts's display
// allow-list: wall screens and kids' devices can't reach these. Award-only: no deductions.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { notifyChoreApproval } from '../notify.ts';
import { balanceOf } from '../stickers.ts';
import { household, todayInTz } from './members.ts';
import { readSettings } from './settings.ts';
import { ErrorSchema, PointAwardInputSchema, PointAwardSchema } from '../schemas.ts';

export const bonusPointsRoutes = createRouter();

type AwardRow = { id: string; member_id: string; amount: number; note: string | null; ref: string; at: string };
const toApi = (r: AwardRow): z.infer<typeof PointAwardSchema> => ({ id: r.id, memberId: r.member_id, points: r.amount, note: r.note, date: r.ref, at: r.at });

const json = <T extends z.ZodTypeAny>(schema: T, description = 'ok') => ({ description, content: { 'application/json': { schema } } });
const err = (description: string) => json(ErrorSchema, description);
const OFF = 'Chores and points are turned off';

function execCtx(c: Context<{ Bindings: Env }>) {
  try {
    return c.executionCtx;
  } catch {
    return undefined; // Node: no ExecutionContext
  }
}

const isDay = (d: string) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);

bonusPointsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/points/awards',
    tags: ['Chores'],
    summary:
      "Give a member bonus points (1-500) with an optional short note, counted on a day (default today). They count like chore points (balance, today, week, leaderboard, profile) but aren't a chore, so streaks and chore counts don't change. The member's own devices are told; emits points.awarded. Parent devices only.",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PointAwardInputSchema } } } },
    responses: {
      201: json(z.object({ award: PointAwardSchema, balance: z.number() }), 'given'),
      400: err('not a real day, or a day still ahead'),
      403: err('chores are turned off'),
      404: err('member not found'),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const db = c.env.DB;
    if (!(await readSettings(db)).features.chores) return c.json({ error: OFF }, 403);
    const member = await db.prepare('SELECT name FROM members WHERE id = ?').bind(body.memberId).first<{ name: string }>();
    if (!member) return c.json({ error: 'member not found' }, 404);
    const today = todayInTz((await household(db)).tz);
    const date = body.date ?? today;
    if (!isDay(date) || date > today) return c.json({ error: 'Pick today or an earlier day' }, 400);
    const row: AwardRow = { id: crypto.randomUUID(), member_id: body.memberId, amount: body.points, note: body.note?.trim() || null, ref: date, at: new Date().toISOString() };
    await db.prepare("INSERT INTO point_entries (id, member_id, amount, reason, ref, at, note) VALUES (?, ?, ?, 'bonus', ?, ?, ?)").bind(row.id, row.member_id, row.amount, row.ref, row.at, row.note).run();
    const award = toApi(row);
    emit(c, 'points.awarded', { id: award.id, memberId: award.memberId, points: award.points, note: award.note, date: award.date });
    notifyChoreApproval(c.env, execCtx(c), { owner: row.member_id }, `bonus:${row.id}`, {
      title: `🎉 You got ${row.amount} bonus point${row.amount === 1 ? '' : 's'}`,
      body: row.note ?? 'From a grown-up. Nice one!',
      url: '/#/chores',
      memberIds: [row.member_id],
    });
    return c.json({ award, balance: await balanceOf(db, row.member_id) }, 201);
  },
);

bonusPointsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/points/awards',
    tags: ['Chores'],
    summary: "Bonus points given, newest first (the last 100; one member's with ?memberId=). Parent devices only.",
    security: [{ Bearer: [] }],
    request: { query: z.object({ memberId: z.string().optional() }) },
    responses: { 200: json(z.array(PointAwardSchema)), 403: err('chores are turned off') },
  }),
  async (c) => {
    const { memberId } = c.req.valid('query');
    const db = c.env.DB;
    if (!(await readSettings(db)).features.chores) return c.json({ error: OFF }, 403);
    const { results } = await db
      .prepare("SELECT id, member_id, amount, note, ref, at FROM point_entries WHERE reason = 'bonus' AND (?1 IS NULL OR member_id = ?1) ORDER BY at DESC, rowid DESC LIMIT 100")
      .bind(memberId ?? null)
      .all<AwardRow>();
    return c.json(results.map(toApi), 200);
  },
);

bonusPointsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/points/awards/{id}',
    tags: ['Chores'],
    summary: 'Take back bonus points given by mistake: the points come off the balance and every total. Emits points.removed. Parent devices only.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean(), balance: z.number() })), 403: err('chores are turned off'), 404: err('no such bonus') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    if (!(await readSettings(db)).features.chores) return c.json({ error: OFF }, 403);
    const row = await db.prepare("DELETE FROM point_entries WHERE id = ? AND reason = 'bonus' RETURNING member_id, amount").bind(id).first<{ member_id: string; amount: number }>();
    if (!row) return c.json({ error: 'no such bonus' }, 404);
    emit(c, 'points.removed', { id, memberId: row.member_id, points: row.amount });
    return c.json({ ok: true, balance: await balanceOf(db, row.member_id) }, 200);
  },
);
