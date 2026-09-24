import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { hostTimezone } from '../env.ts';
import { ErrorSchema, MemberInputSchema, MemberSchema } from '../schemas.ts';
import { parseMemberIds } from '../calendar-members.ts';

export const membersRoutes = createRouter();

type MemberRow = { id: string; name: string; color: string; avatar: string | null; sort: number; created_at: string };

// Exported for reuse by routes/leaderboard.ts (period boundaries use the same household tz/weekStart).
export function todayInTz(tz: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at); // en-CA -> YYYY-MM-DD
}

export function weekStartDate(tz: string, weekStart: 0 | 1, at = new Date()): string {
  const todayStr = todayInTz(tz, at);
  const [y, m, d] = todayStr.split('-').map(Number);
  const asUtcNoon = new Date(Date.UTC(y, m - 1, d, 12)); // noon avoids DST-edge date-shift
  const dow = asUtcNoon.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow - weekStart + 7) % 7;
  asUtcNoon.setUTCDate(asUtcNoon.getUTCDate() - diff);
  return asUtcNoon.toISOString().slice(0, 10);
}

export async function household(db: D1Database): Promise<{ tz: string; weekStart: 0 | 1 }> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('timezone','weekStart')")
    .all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return { tz: map.get('timezone') ?? hostTimezone(), weekStart: (Number(map.get('weekStart') ?? 0) as 0 | 1) };
}

async function pointsFor(db: D1Database, memberId: string, tz: string, weekStart: 0 | 1) {
  const today = todayInTz(tz);
  const weekFrom = weekStartDate(tz, weekStart);
  const todayRow = await db
    .prepare(
      `SELECT COALESCE(SUM(c.points), 0) AS total FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id WHERE cc.member_id = ? AND cc.date = ?`,
    )
    .bind(memberId, today)
    .first<{ total: number }>();
  const weekRow = await db
    .prepare(
      `SELECT COALESCE(SUM(c.points), 0) AS total FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id WHERE cc.member_id = ? AND cc.date >= ? AND cc.date <= ?`,
    )
    .bind(memberId, weekFrom, today)
    .first<{ total: number }>();
  return { pointsToday: todayRow?.total ?? 0, pointsWeek: weekRow?.total ?? 0 };
}

// All members' today/week points in one query (grouped + conditional SUM) instead of two
// queries per member - what GET /api/members uses instead of pointsFor() in a loop.
async function pointsByMember(db: D1Database, tz: string, weekStart: 0 | 1): Promise<Map<string, { pointsToday: number; pointsWeek: number }>> {
  const today = todayInTz(tz);
  const weekFrom = weekStartDate(tz, weekStart);
  const { results } = await db
    .prepare(
      `SELECT cc.member_id AS member_id,
              COALESCE(SUM(CASE WHEN cc.date = ? THEN c.points ELSE 0 END), 0) AS today,
              COALESCE(SUM(CASE WHEN cc.date >= ? AND cc.date <= ? THEN c.points ELSE 0 END), 0) AS week
       FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id
       WHERE cc.member_id IS NOT NULL
       GROUP BY cc.member_id`,
    )
    .bind(today, weekFrom, today)
    .all<{ member_id: string; today: number; week: number }>();
  return new Map(results.map((r) => [r.member_id, { pointsToday: r.today, pointsWeek: r.week }]));
}

function toApi(row: MemberRow, points: { pointsToday: number; pointsWeek: number }) {
  return { id: row.id, name: row.name, color: row.color, avatar: row.avatar, sort: row.sort, ...points };
}

membersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members',
    tags: ['Members'],
    summary: 'List family members',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(MemberSchema) } } } },
  }),
  async (c) => {
    // household settings + the member list are independent reads - one batch, one round trip.
    const [settingsRes, membersRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('timezone','weekStart')"),
      c.env.DB.prepare('SELECT * FROM members ORDER BY sort, created_at'),
    ]);
    const settingsMap = new Map((settingsRes.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const tz = settingsMap.get('timezone') ?? hostTimezone();
    const weekStart = (Number(settingsMap.get('weekStart') ?? 0) as 0 | 1);
    const results = membersRes.results as unknown as MemberRow[];

    const points = await pointsByMember(c.env.DB, tz, weekStart);
    return c.json(results.map((row) => toApi(row, points.get(row.id) ?? { pointsToday: 0, pointsWeek: 0 })), 200);
  },
);

membersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/members',
    tags: ['Members'],
    summary: 'Create a family member',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: MemberInputSchema } } } },
    responses: { 201: { description: 'created', content: { 'application/json': { schema: MemberSchema } } } },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const row: MemberRow = {
      id: crypto.randomUUID(),
      name: body.name,
      color: body.color,
      avatar: body.avatar ?? null,
      sort: body.sort ?? 0,
      created_at: new Date().toISOString(),
    };
    await c.env.DB.prepare('INSERT INTO members (id, name, color, avatar, sort, created_at) VALUES (?,?,?,?,?,?)')
      .bind(row.id, row.name, row.color, row.avatar, row.sort, row.created_at)
      .run();
    emit(c, 'member.changed', { id: row.id });
    return c.json(toApi(row, { pointsToday: 0, pointsWeek: 0 }), 201);
  },
);

membersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/members/{id}',
    tags: ['Members'],
    summary: 'Update a family member',
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: MemberInputSchema.partial() } } },
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: MemberSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<MemberRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const updated: MemberRow = {
      ...existing,
      name: body.name ?? existing.name,
      color: body.color ?? existing.color,
      avatar: body.avatar !== undefined ? body.avatar : existing.avatar,
      sort: body.sort ?? existing.sort,
    };
    await c.env.DB.prepare('UPDATE members SET name = ?, color = ?, avatar = ?, sort = ? WHERE id = ?')
      .bind(updated.name, updated.color, updated.avatar, updated.sort, id)
      .run();
    emit(c, 'member.changed', { id });
    const { tz, weekStart } = await household(c.env.DB);
    return c.json(toApi(updated, await pointsFor(c.env.DB, id, tz, weekStart)), 200);
  },
);

membersRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/members/{id}',
    tags: ['Members'],
    summary: 'Delete a family member',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const exists = await c.env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(id).first<{ id: string }>();
    if (!exists) return c.json({ error: 'not found' }, 404);
    // Which calendars have this member assigned - needs its own read since member_ids is JSON,
    // not something a DELETE/UPDATE WHERE clause can filter on. Batched together with the member
    // delete itself so the member row and its calendar assignments disappear atomically (the
    // adapter's batch() doesn't report per-statement changes, hence the exists check above).
    const { results: cals } = await c.env.DB.prepare('SELECT id, member_ids FROM calendars WHERE member_ids LIKE ?')
      .bind(`%${id}%`)
      .all<{ id: string; member_ids: string }>();
    const updates = cals
      .map((cal) => {
        const before = parseMemberIds(cal.member_ids);
        const after = before.filter((m) => m !== id);
        return { id: cal.id, before, after };
      })
      .filter((cal) => cal.after.length !== cal.before.length) // the LIKE above can false-positive on a substring match
      .map((cal) => c.env.DB.prepare('UPDATE calendars SET member_ids = ? WHERE id = ?').bind(JSON.stringify(cal.after), cal.id));
    await c.env.DB.batch<unknown>([c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id), ...updates]);
    emit(c, 'member.changed', { id });
    return c.json({ ok: true }, 200);
  },
);
