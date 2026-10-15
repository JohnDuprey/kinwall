// Rewards (migration 0039): things a parent sets up ("🍿 Movie night, 100 points") that a member
// spends chore points on. Redeeming takes the points at once (a point_entries row, like a sticker
// pack); a reward that needs a parent's OK waits as 'pending' with the points held, and declining
// gives them back. Parents (admin keys) manage rewards and decide; wall screens and kids' devices
// (display keys, see auth.ts) list, redeem and pick a goal, a member's own device only for them.
// Several people can split one reward (shares, migration 0115): each share is its own point_entries
// row. On a parent's device everyone pays at once; elsewhere the asker pays now and the request
// always waits for a parent, whose OK takes the others' shares (nobody's points go without their
// own tap or a parent's).
import { stored, words } from '../i18n.ts';
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { deviceOwner, ownerBlock, requestKey } from '../auth.ts';
import { notifyChoreApproval } from '../notify.ts';
import { BALANCE_EXPR, balanceOf, pointTotalsStmt, type PointTotals } from '../stickers.ts';
import { household, todayInTz, weekStartDate } from './members.ts';
import { readSettings, rewardsOn } from './settings.ts';
import { parseMemberIds } from '../calendar-members.ts';
import { ErrorSchema, RedemptionSchema, RewardInputSchema, RewardSchema, RewardShareSchema, REDEMPTION_STATUSES } from '../schemas.ts';

export const rewardsRoutes = createRouter();

export type RewardRow = {
  id: string; title: string; emoji: string | null; cost: number; member_ids: string; needs_approval: number;
  limit_period: string | null; limit_count: number | null; active: number; sort: number; created_at: string;
};
export type RedemptionRow = {
  id: string; reward_id: string | null; member_id: string; title: string; emoji: string | null; cost: number; status: string;
  note: string | null; date: string; requested_at: string; decided_at: string | null; given_at: string | null; shares?: string | null;
};
type Share = z.infer<typeof RewardShareSchema>;
type Status = z.infer<typeof RedemptionSchema>['status'];

export const toRewardApi = (r: RewardRow): z.infer<typeof RewardSchema> => ({
  id: r.id, title: r.title, emoji: r.emoji, cost: r.cost, memberIds: parseMemberIds(r.member_ids), needsApproval: !!r.needs_approval,
  limit: r.limit_period === 'day' || r.limit_period === 'week' ? { count: r.limit_count ?? 1, period: r.limit_period } : null,
  active: !!r.active, sort: r.sort, createdAt: r.created_at,
});
export const toRedemptionApi = (r: RedemptionRow): z.infer<typeof RedemptionSchema> => ({
  id: r.id, rewardId: r.reward_id, memberId: r.member_id, title: r.title, emoji: r.emoji, cost: r.cost, shares: r.shares ? (JSON.parse(r.shares) as Share[]) : null, status: r.status as Status,
  note: r.note, date: r.date, requestedAt: r.requested_at, decidedAt: r.decided_at, givenAt: r.given_at,
});

const json = <T extends z.ZodTypeAny>(schema: T, description = 'ok') => ({ description, content: { 'application/json': { schema } } });
const err = (description: string) => json(ErrorSchema, description);
const label = (r: { emoji: string | null; title: string }) => (r.emoji ? `${r.emoji} ${r.title}` : r.title);
const pts = (n: number) => `${n} point${n === 1 ? '' : 's'}`;

function execCtx(c: Context<{ Bindings: Env }>) {
  try {
    return c.executionCtx;
  } catch {
    return undefined; // Node: no ExecutionContext
  }
}

const memberName = async (c: { env: Env }, id: string) =>
  (await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(id).first<{ name: string }>())?.name ?? null;

async function unknownMembers(c: { env: Env }, ids: string[]): Promise<boolean> {
  if (!ids.length) return false;
  const { results } = await c.env.DB.prepare('SELECT id FROM members WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ id: string }>();
  return results.length !== new Set(ids).size;
}

const forMember = (r: RewardRow, memberId: string) => {
  const ids = parseMemberIds(r.member_ids);
  return ids.length === 0 || ids.includes(memberId);
};

rewardsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/rewards',
    tags: ['Rewards'],
    summary: 'Rewards, in order. ?memberId= only the ones for that member; ?archived=true includes archived ones.',
    security: [{ Bearer: [] }],
    request: { query: z.object({ memberId: z.string().optional(), archived: z.enum(['true', 'false']).optional() }) },
    responses: { 200: json(z.array(RewardSchema)) },
  }),
  async (c) => {
    const { memberId, archived } = c.req.valid('query');
    const { results } = await c.env.DB.prepare(`SELECT * FROM rewards ${archived === 'true' ? '' : 'WHERE active = 1'} ORDER BY sort, created_at`).all<RewardRow>();
    if (!memberId) return c.json(results.map(toRewardApi), 200);
    // For one member: how much of each limit they've used this day / week (for "2 of 3 today").
    const h = await household(c.env.DB);
    const [day, week] = [periodStart('day', h)!, periodStart('week', h)!];
    const { results: counts } = await c.env.DB.prepare(
      "SELECT reward_id, SUM(date >= ?) AS day, SUM(date >= ?) AS week FROM reward_redemptions WHERE member_id = ? AND status <> 'declined' AND date >= ? GROUP BY reward_id",
    ).bind(day, week, memberId, day < week ? day : week).all<{ reward_id: string; day: number; week: number }>();
    const used = new Map(counts.map((r) => [r.reward_id, r]));
    return c.json(
      results.filter((r) => forMember(r, memberId)).map((r) => ({ ...toRewardApi(r), used: r.limit_period === 'day' || r.limit_period === 'week' ? Number(used.get(r.id)?.[r.limit_period] ?? 0) : 0 })),
      200,
    );
  },
);

rewardsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/rewards',
    tags: ['Rewards'],
    summary: 'Add a reward (parent devices only)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: RewardInputSchema } } } },
    responses: { 201: json(RewardSchema, 'created'), 400: err('unknown member') },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const memberIds = body.memberIds ?? [];
    if (await unknownMembers(c, memberIds)) return c.json({ error: 'unknown member' }, 400);
    const row: RewardRow = {
      id: crypto.randomUUID(),
      title: body.title,
      emoji: body.emoji ?? null,
      cost: body.cost,
      member_ids: JSON.stringify(memberIds),
      needs_approval: body.needsApproval === false ? 0 : 1,
      limit_period: body.limit?.period ?? null,
      limit_count: body.limit?.count ?? null,
      active: body.active === false ? 0 : 1,
      // New ones go last.
      sort: body.sort ?? ((await c.env.DB.prepare('SELECT MAX(sort) AS m FROM rewards').first<{ m: number | null }>())?.m ?? -1) + 1,
      created_at: new Date().toISOString(),
    };
    await c.env.DB.prepare('INSERT INTO rewards (id, title, emoji, cost, member_ids, needs_approval, limit_period, limit_count, active, sort, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(row.id, row.title, row.emoji, row.cost, row.member_ids, row.needs_approval, row.limit_period, row.limit_count, row.active, row.sort, row.created_at)
      .run();
    emit(c, 'reward.changed', { id: row.id });
    return c.json(toRewardApi(row), 201);
  },
);

rewardsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/rewards/{id}',
    tags: ['Rewards'],
    summary: 'Change a reward; active: false archives it (parent devices only). Past redemptions keep what they were.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: RewardInputSchema.partial() } } } },
    responses: { 200: json(RewardSchema), 400: err('unknown member'), 404: err('not found') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (body.memberIds && (await unknownMembers(c, body.memberIds))) return c.json({ error: 'unknown member' }, 400);
    const existing = await c.env.DB.prepare('SELECT * FROM rewards WHERE id = ?').bind(id).first<RewardRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const row: RewardRow = {
      ...existing,
      title: body.title ?? existing.title,
      emoji: body.emoji !== undefined ? body.emoji : existing.emoji,
      cost: body.cost ?? existing.cost,
      member_ids: body.memberIds ? JSON.stringify(body.memberIds) : existing.member_ids,
      needs_approval: body.needsApproval !== undefined ? (body.needsApproval ? 1 : 0) : existing.needs_approval,
      limit_period: body.limit !== undefined ? body.limit?.period ?? null : existing.limit_period,
      limit_count: body.limit !== undefined ? body.limit?.count ?? null : existing.limit_count,
      active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
      sort: body.sort ?? existing.sort,
    };
    await c.env.DB.prepare('UPDATE rewards SET title=?, emoji=?, cost=?, member_ids=?, needs_approval=?, limit_period=?, limit_count=?, active=?, sort=? WHERE id=?')
      .bind(row.title, row.emoji, row.cost, row.member_ids, row.needs_approval, row.limit_period, row.limit_count, row.active, row.sort, id)
      .run();
    emit(c, 'reward.changed', { id });
    return c.json(toRewardApi(row), 200);
  },
);

rewardsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/rewards/{id}',
    tags: ['Rewards'],
    summary: 'Delete a reward (parent devices only). Its redemptions stay in history; anyone saving for it has no goal.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: json(z.object({ ok: z.boolean() })), 404: err('not found') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM rewards WHERE id = ?').bind(id).run();
    if (res.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    await c.env.DB.prepare('UPDATE members SET reward_goal = NULL WHERE reward_goal = ?').bind(id).run();
    emit(c, 'reward.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

// ---- Redeeming

/** The first household day of the reward's current limit period, or null when it has no limit. */
const periodStart = (period: string | null, h: { tz: string; weekStart: 0 | 1 }): string | null =>
  period === 'day' ? todayInTz(h.tz) : period === 'week' ? weekStartDate(h.tz, h.weekStart) : null;

// Redemptions of this reward by this member since `from` that still count toward its limit.
const USED_SQL = "SELECT COUNT(*) AS n FROM reward_redemptions WHERE reward_id = ? AND member_id = ? AND status <> 'declined' AND date >= ?";

// Charging shares: `s` is the shares to take (member_id, points); the INSERT takes all of them as
// 'reward' entries for one redemption, or none when anyone in `s` is short.
const SHARES_JSON = "SELECT json_extract(value, '$.memberId') AS member_id, json_extract(value, '$.points') AS points FROM json_each(?)";
// A split request's shares not paid yet (the others', until a parent approves).
const UNPAID = `SELECT json_extract(value, '$.memberId') AS member_id, json_extract(value, '$.points') AS points FROM reward_redemptions r, json_each(r.shares)
  WHERE r.id = ? AND r.status = 'pending' AND NOT EXISTS (SELECT 1 FROM point_entries p WHERE p.reason = 'reward' AND p.ref = r.id AND p.member_id = json_extract(value, '$.memberId'))`;
const CHARGE = `INSERT INTO point_entries (id, member_id, amount, reason, ref, at) SELECT lower(hex(randomblob(16))), member_id, -points, 'reward', ?, ? FROM s
  WHERE NOT EXISTS (SELECT 1 FROM s WHERE ${BALANCE_EXPR.replaceAll('?', 's.member_id')} < s.points)`;

/** What's wrong with a split, or null: the asker chips in, each person once, adding up to the cost. */
export function splitProblem(shares: Share[], askerId: string, cost: number): string | null {
  if (!shares.some((x) => x.memberId === askerId)) return stored('error', 'The person asking chips in too');
  if (new Set(shares.map((x) => x.memberId)).size !== shares.length) return stored('error', 'Each person chips in once');
  const sum = shares.reduce((n, x) => n + x.points, 0);
  if (sum === cost) return null;
  return sum === 1 ? stored('error', 'The shares add up to 1 point, not {cost}', { cost }) : stored('error', 'The shares add up to {sum} points, not {cost}', { sum, cost });
}

rewardsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/rewards/{id}/redeem',
    tags: ['Rewards'],
    summary:
      "Spend a member's points on a reward. The points come off at once; it waits as pending for a parent's OK when the reward needs one (a parent's own device approves at once). A member's own device can only redeem for them.",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              memberId: z.string().openapi({ description: 'Who asks (and, without shares, pays it all).' }),
              shares: z.array(RewardShareSchema).min(2).max(20).optional().openapi({
                description:
                  "Split it: who chips in how many points (memberId included), adding up to the cost. From a parent's device everyone pays at once; anywhere else memberId pays now, the request waits for a parent, and the others pay when a parent approves.",
              }),
            }),
          },
        },
      },
    },
    responses: {
      201: json(z.object({ redemption: RedemptionSchema, balance: z.number() }), 'redeemed'),
      400: err("the shares don't add up to the cost, or someone is in twice"),
      402: json(z.object({ error: z.string(), balance: z.number(), cost: z.number() }), "not enough points (for a split, cost is that person's share)"),
      403: err("chores or rewards are turned off, the reward isn't for this member (or someone chipping in), or this device belongs to someone else"),
      404: err('reward or member not found'),
      409: err("the reward's limit for today / this week is used up"),
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { memberId, shares: asked } = c.req.valid('json');
    const db = c.env.DB;
    const blocked = await ownerBlock(c, memberId);
    if (blocked) return c.json({ error: blocked }, 403);
    const settings = await readSettings(db);
    if (!settings.features.chores) return c.json({ error: 'Chores and points are turned off' }, 403);
    if (!rewardsOn(settings)) return c.json({ error: 'Rewards are turned off' }, 403);
    const reward = await db.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').bind(id).first<RewardRow>();
    if (!reward) return c.json({ error: 'reward not found' }, 404);
    const totals = await pointTotalsStmt(db, memberId).first<PointTotals>();
    if (!totals) return c.json({ error: 'member not found' }, 404);
    if (!forMember(reward, memberId)) return c.json({ error: "This reward isn't for them" }, 403);
    const h = await household(db);
    const from = periodStart(reward.limit_period, h);
    const max = reward.limit_count ?? 1;
    const usedMsg = reward.limit_period === 'day' ? stored('error', "That's all for today") : stored('error', "That's all for this week");
    const used = async () => !!from && Number((await db.prepare(USED_SQL).bind(id, memberId, from).first<{ n: number }>())?.n) >= max;
    if (await used()) return c.json({ error: usedMsg }, 409);
    // The asker's share first.
    const shares = asked ? [...asked].sort((a, b) => Number(b.memberId === memberId) - Number(a.memberId === memberId)) : null;
    if (shares) {
      const bad = splitProblem(shares, memberId, reward.cost);
      if (bad) return c.json({ error: bad }, 400);
      for (const x of shares.slice(1)) {
        const t = await pointTotalsStmt(db, x.memberId).first<PointTotals>();
        if (!t) return c.json({ error: 'member not found' }, 404);
        const name = (await memberName(c, x.memberId)) ?? 'Someone';
        if (!forMember(reward, x.memberId)) return c.json({ error: `This reward isn't for ${name}` }, 403);
        if (t.earned - t.spent < x.points) return c.json({ error: x.points === 1 ? stored('error', "{name} doesn't have 1 point", { name }) : stored('error', "{name} doesn't have {n} points", { name, n: x.points }), balance: t.earned - t.spent, cost: x.points }, 402);
      }
    }
    const mine = shares ? shares[0].points : reward.cost;
    const balance = totals.earned - totals.spent;
    if (balance < mine) return c.json({ error: 'Not enough points', balance, cost: mine }, 402);

    const parent = (await requestKey(c))?.scope !== 'display';
    // A split asked for anywhere but a parent's device always waits: the others haven't agreed yet.
    const status: Status = (reward.needs_approval || shares) && !parent ? 'pending' : 'approved';
    const now = new Date().toISOString();
    const row: RedemptionRow = {
      id: crypto.randomUUID(), reward_id: id, member_id: memberId, title: reward.title, emoji: reward.emoji, cost: reward.cost, status,
      note: null, date: todayInTz(h.tz), requested_at: now, decided_at: status === 'approved' ? now : null, given_at: null,
      shares: shares ? JSON.stringify(shares) : null,
    };
    // Charge + record in one batch. The charge re-checks the balances and the limit in SQL, and the
    // redemption only lands if the charge did, so two quick taps can't overspend or double up.
    const charge = shares ? (parent ? shares : shares.slice(0, 1)) : [{ memberId, points: reward.cost }];
    await db.batch([
      db.prepare(`WITH s AS (${SHARES_JSON}) ${CHARGE} AND (? IS NULL OR (${USED_SQL}) < ?)`).bind(JSON.stringify(charge), row.id, now, from, id, memberId, from, max),
      db
        .prepare(
          "INSERT INTO reward_redemptions (id, reward_id, member_id, title, emoji, cost, status, note, date, requested_at, decided_at, given_at, shares) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM point_entries WHERE reason = 'reward' AND ref = ?)",
        )
        .bind(row.id, row.reward_id, row.member_id, row.title, row.emoji, row.cost, row.status, row.note, row.date, row.requested_at, row.decided_at, row.given_at, row.shares, row.id),
    ]);
    const after = (await pointTotalsStmt(db, memberId).first<PointTotals>())!;
    const left = after.earned - after.spent;
    if (!(await db.prepare('SELECT 1 FROM reward_redemptions WHERE id = ?').bind(row.id).first())) {
      // Lost a race: say which check it failed now.
      return (await used()) ? c.json({ error: usedMsg }, 409) : c.json({ error: 'Not enough points', balance: left, cost: mine }, 402);
    }
    emit(c, 'reward.redeemed', { id: row.id, rewardId: id, memberId, title: row.title, emoji: row.emoji, cost: row.cost, ...(shares ? { shares } : {}), status });
    if (status === 'pending') {
      const name = await memberName(c, memberId);
      const others = shares ? await Promise.all(shares.slice(1).map((x) => memberName(c, x.memberId))) : [];
      notifyChoreApproval(c.env, execCtx(c), 'parents', `reward:${row.id}`, {
        text: (lang) => {
          const { t, tn, list } = words(lang);
          const vars = { name: name ?? t('Someone'), reward: label(row), points: tn(row.cost, '{n} point', '{n} points') };
          return {
            title: others.length ? t('{name} wants {reward} ({points}), split with {others}. Approve?', { ...vars, others: list(others.map((o) => o ?? t('someone'))) }) : t('{name} wants {reward} ({points}). Approve?', vars),
            body: others.length ? t("Approving takes everyone's share. Open Rewards to approve it or say not this time.") : t('Open Rewards to approve it or say not this time.'),
          };
        },
        url: '/#/rewards',
        memberIds: shares ? shares.map((x) => x.memberId) : [memberId],
      });
    }
    return c.json({ redemption: toRedemptionApi(row), balance: left }, 201);
  },
);

rewardsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/rewards/redemptions',
    tags: ['Rewards'],
    summary: "Redemptions, newest first. ?memberId= one member (theirs and splits they chip in to); ?status=pending,approved only those (oldest first when filtered by status, for the To approve queue). A member's own device gets only their requests (403 when it asks for someone else's). A shared wall screen never gets declined ones (a decline and its note are for that member's own device and parents).",
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        memberId: z.string().optional(),
        status: z.string().optional().openapi({ description: `Comma-separated: ${REDEMPTION_STATUSES.join(', ')}` }),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      }),
    },
    responses: { 200: json(z.array(RedemptionSchema)), 403: err("a member's own device asked for someone else's requests") },
  }),
  async (c) => {
    const { memberId: asked, status, limit } = c.req.valid('query');
    // A member's own device sees its own requests (and their decline notes), never a sibling's.
    const blocked = await ownerBlock(c, asked);
    if (blocked) return c.json({ error: blocked }, 403);
    const memberId = asked ?? (await deviceOwner(c)) ?? undefined;
    const statuses = status ? status.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const where: string[] = [];
    const binds: unknown[] = [];
    if (memberId) {
      where.push("(member_id = ? OR EXISTS (SELECT 1 FROM json_each(shares) WHERE json_extract(value, '$.memberId') = ?))");
      binds.push(memberId, memberId);
    }
    // A decline (and its note) is the kid's own business: a shared wall never gets declined requests.
    if ((await requestKey(c))?.scope === 'display' && !(await deviceOwner(c))) where.push("status <> 'declined'");
    if (statuses.length) {
      where.push('status IN (SELECT value FROM json_each(?))');
      binds.push(JSON.stringify(statuses));
    }
    const order = statuses.length ? 'requested_at' : 'requested_at DESC';
    const { results } = await c.env.DB.prepare(`SELECT * FROM reward_redemptions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}, rowid LIMIT ?`)
      .bind(...binds, limit)
      .all<RedemptionRow>();
    return c.json(results.map(toRedemptionApi), 200);
  },
);

/** Gives back every share a redemption took while it's in `status`, once each (guarded on the ref).
 * Batched with the status change, so the two land together or not at all. */
const refund = (c: { env: Env }, id: string, status: Status, now: string) =>
  c.env.DB.prepare(
    `INSERT INTO point_entries (id, member_id, amount, reason, ref, at) SELECT lower(hex(randomblob(16))), p.member_id, -p.amount, 'reward_refund', p.ref, ? FROM point_entries p
     WHERE p.reason = 'reward' AND p.ref = ? AND EXISTS (SELECT 1 FROM reward_redemptions WHERE id = ? AND status = ?)
       AND NOT EXISTS (SELECT 1 FROM point_entries q WHERE q.reason = 'reward_refund' AND q.ref = p.ref AND q.member_id = p.member_id)`,
  ).bind(now, id, id, status);

rewardsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/rewards/redemptions/{id}/cancel',
    tags: ['Rewards'],
    summary:
      "Take back a request still waiting for a parent's OK: the points come back and the request is removed (it never happened, so it doesn't count toward the reward's limit). The member's own device, or a parent's; not a wall screen or another member's device.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: json(z.object({ ok: z.boolean(), balance: z.number() })),
      403: err("not this member's own device"),
      404: err('not found'),
      409: err('not waiting any more (approved, given or declined)'),
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    const found = await db.prepare('SELECT member_id FROM reward_redemptions WHERE id = ?').bind(id).first<{ member_id: string }>();
    if (!found) return c.json({ error: 'not found' }, 404);
    const key = await requestKey(c);
    if (key?.scope === 'display' && (await deviceOwner(c)) !== found.member_id) {
      return c.json({ error: "Only their own device or a parent's can take back this request." }, 403);
    }
    // Refund + remove in one batch, both only while it's still pending, so it can't race a parent's decision.
    const [, del] = await db.batch<RedemptionRow>([
      refund(c, id, 'pending', new Date().toISOString()),
      db.prepare("DELETE FROM reward_redemptions WHERE id = ? AND status = 'pending' RETURNING *").bind(id),
    ]);
    const row = del.results[0];
    if (!row) return c.json({ error: 'Not waiting any more' }, 409);
    emit(c, 'reward.changed', { id: row.reward_id, redemptionId: id, memberId: row.member_id, canceled: true });
    const after = (await pointTotalsStmt(db, row.member_id).first<PointTotals>())!;
    return c.json({ ok: true, balance: after.earned - after.spent }, 200);
  },
);

// ---- Parents decide. Not in auth.ts's display allow-list, so only parent devices reach these.

const decideParams = z.object({ id: z.string() });
const RedemptionOut = json(RedemptionSchema);

/** One guarded status change; 404 when the redemption doesn't exist, 409 when it's in the wrong state. */
async function transition(c: Context<{ Bindings: Env }>, id: string, from: Status[], to: Status, extra: string, binds: unknown[], wrong: string) {
  const [res] = await c.env.DB.batch<RedemptionRow>([
    c.env.DB.prepare(`UPDATE reward_redemptions SET status = ?, ${extra} WHERE id = ? AND status IN (SELECT value FROM json_each(?)) RETURNING *`).bind(to, ...binds, id, JSON.stringify(from)),
  ]);
  const row = res.results[0];
  if (row) return { row };
  const exists = await c.env.DB.prepare('SELECT 1 FROM reward_redemptions WHERE id = ?').bind(id).first();
  return { error: exists ? wrong : 'not found', status: (exists ? 409 : 404) as 409 | 404 };
}

rewardsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/rewards/redemptions/{id}/approve',
    tags: ['Rewards'],
    summary: "Approve a redemption waiting for a parent's OK (parent devices only). For a split, this takes the shares not paid yet; 402 when someone no longer has theirs.",
    security: [{ Bearer: [] }],
    request: { params: decideParams },
    responses: { 200: RedemptionOut, 402: err("someone chipping in doesn't have their share any more"), 404: err('not found'), 409: err('not waiting for approval') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    const now = new Date().toISOString();
    // Take the unpaid shares (all or none), then approve only if nothing is left unpaid.
    const [, res] = await db.batch<RedemptionRow>([
      db.prepare(`WITH s AS (${UNPAID}) ${CHARGE}`).bind(id, id, now),
      db.prepare(`UPDATE reward_redemptions SET status = 'approved', decided_at = ? WHERE id = ? AND status = 'pending' AND NOT EXISTS (${UNPAID}) RETURNING *`).bind(now, id, id),
    ]);
    const row = res.results[0];
    if (!row) {
      const short = (await db.prepare(UNPAID).bind(id).all<{ member_id: string; points: number }>()).results;
      for (const x of short) {
        const have = await balanceOf(db, x.member_id);
        if (have < x.points) {
          const name = (await memberName(c, x.member_id)) ?? 'Someone';
          return c.json({ error: have === 1 ? stored('error', '{name} has only 1 point now, not {points}', { name, points: x.points }) : stored('error', '{name} has only {n} points now, not {points}', { name, n: have, points: x.points }) }, 402);
        }
      }
      const exists = await db.prepare('SELECT 1 FROM reward_redemptions WHERE id = ?').bind(id).first();
      return c.json({ error: exists ? 'Not waiting for approval' : 'not found' }, exists ? 409 : 404);
    }
    emit(c, 'reward.approved', { id, rewardId: row.reward_id, memberId: row.member_id, title: row.title, emoji: row.emoji, cost: row.cost, ...(row.shares ? { shares: toRedemptionApi(row).shares } : {}) });
    return c.json(toRedemptionApi(row), 200);
  },
);

rewardsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/rewards/redemptions/{id}/decline',
    tags: ['Rewards'],
    summary:
      '"Not this time": decline a pending redemption, or cancel an approved one not given yet. The points go back, and the member\'s own devices are told (with the optional note). Parent devices only.',
    security: [{ Bearer: [] }],
    request: { params: decideParams, body: { content: { 'application/json': { schema: z.object({ note: z.string().max(200).optional() }) } } } },
    responses: { 200: RedemptionOut, 404: err('not found'), 409: err('already given or declined') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const note = c.req.valid('json').note?.trim() || null;
    const now = new Date().toISOString();
    // Status change + refund in one batch; the refund is guarded so it can only ever land once.
    const [res] = await c.env.DB.batch<RedemptionRow>([
      c.env.DB.prepare("UPDATE reward_redemptions SET status = 'declined', note = ?, decided_at = ? WHERE id = ? AND status IN ('pending', 'approved') RETURNING *").bind(note, now, id),
      refund(c, id, 'declined', now),
    ]);
    const row = res.results[0];
    if (!row) {
      const exists = await c.env.DB.prepare('SELECT 1 FROM reward_redemptions WHERE id = ?').bind(id).first();
      return exists ? c.json({ error: 'Already given or declined' }, 409) : c.json({ error: 'not found' }, 404);
    }
    const shares = toRedemptionApi(row).shares;
    emit(c, 'reward.declined', { id, rewardId: row.reward_id, memberId: row.member_id, title: row.title, emoji: row.emoji, cost: row.cost, ...(shares ? { shares } : {}), note });
    // Everyone chipping in hears it, with what came back to them (a share not taken yet: nothing).
    const { results: back } = await c.env.DB.prepare("SELECT member_id, SUM(amount) AS n FROM point_entries WHERE reason = 'reward_refund' AND ref = ? GROUP BY member_id").bind(id).all<{ member_id: string; n: number }>();
    for (const x of shares ?? [{ memberId: row.member_id, points: row.cost }]) {
      const n = back.find((b) => b.member_id === x.memberId)?.n ?? 0;
      notifyChoreApproval(c.env, execCtx(c), { owner: x.memberId }, `reward-no:${id}${x.memberId === row.member_id ? '' : `:${x.memberId}`}`, {
        text: (lang) => {
          const { t, tn } = words(lang);
          const got = n ? t('Your {points} are back.', { points: tn(n, '{n} point', '{n} points') }) : t('None of your points were spent.');
          return { title: t('Not this time: {reward}', { reward: label(row) }), body: note ? `${note} ${got}` : got };
        },
        url: `/#/rewards/${x.memberId}`,
        memberIds: [x.memberId],
      });
    }
    return c.json(toRedemptionApi(row), 200);
  },
);

rewardsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/rewards/redemptions/{id}/given',
    tags: ['Rewards'],
    summary: 'Mark an approved redemption as given (delivered). Parent devices only.',
    security: [{ Bearer: [] }],
    request: { params: decideParams },
    responses: { 200: RedemptionOut, 404: err('not found'), 409: err('not approved') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const r = await transition(c, id, ['approved'], 'given', 'given_at = ?', [new Date().toISOString()], stored('error', 'Only an approved reward can be marked given'));
    if (!r.row) return c.json({ error: r.error }, r.status);
    emit(c, 'reward.given', { id, rewardId: r.row.reward_id, memberId: r.row.member_id, title: r.row.title, emoji: r.row.emoji, cost: r.row.cost });
    return c.json(toRedemptionApi(r.row), 200);
  },
);

// ---- Goal

rewardsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/members/{id}/reward-goal',
    tags: ['Rewards'],
    summary: "Pin the reward a member is saving for (shown on the Board), or null to clear it. A member's own device can only set theirs.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ rewardId: z.string().nullable() }) } } } },
    responses: { 200: json(z.object({ rewardId: z.string().nullable() })), 403: err('not their device, or the reward is not for them'), 404: err('member or reward not found') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { rewardId } = c.req.valid('json');
    const blocked = await ownerBlock(c, id);
    if (blocked) return c.json({ error: blocked }, 403);
    if (rewardId) {
      const reward = await c.env.DB.prepare('SELECT * FROM rewards WHERE id = ? AND active = 1').bind(rewardId).first<RewardRow>();
      if (!reward) return c.json({ error: 'reward not found' }, 404);
      if (!forMember(reward, id)) return c.json({ error: "This reward isn't for them" }, 403);
    }
    const res = await c.env.DB.prepare('UPDATE members SET reward_goal = ? WHERE id = ?').bind(rewardId, id).run();
    if (res.meta.changes === 0) return c.json({ error: 'member not found' }, 404);
    emit(c, 'member.changed', { id });
    return c.json({ rewardId }, 200);
  },
);
