import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { deviceOwner } from '../auth.ts';
import { emit } from '../bus.ts';
import { listMilestones, MILESTONE_PROGRESS, MILESTONE_SOURCES } from '../milestones.ts';
import { readSettings, rewardsOn } from './settings.ts';
import { ErrorSchema, MilestoneSchema, MilestoneInputSchema } from '../schemas.ts';

export const milestoneRoutes = createRouter();
const json = <T extends z.ZodTypeAny>(schema: T) => ({ description: 'ok', content: { 'application/json': { schema } } });
const errors = { 400: json(ErrorSchema), 403: json(ErrorSchema), 404: json(ErrorSchema), 409: json(ErrorSchema) };
const params = z.object({ id: z.string() });

milestoneRoutes.openapi(createRoute({
  method: 'get', path: '/api/reward-milestones', tags: ['Rewards'], security: [{ Bearer: [] }],
  summary: 'Milestones and per-person progress. Own devices see only their member. Refused when Rewards is off.',
  request: { query: z.object({ memberId: z.string().optional(), archived: z.enum(['true', 'false']).optional() }) },
  responses: { 200: json(z.array(MilestoneSchema)), ...errors },
}), async c => {
  if (!rewardsOn(await readSettings(c.env.DB))) return c.json({ error: 'Rewards are turned off' }, 403);
  const { memberId, archived } = c.req.valid('query');
  const owner = await deviceOwner(c);
  if (owner && memberId && owner !== memberId) return c.json({ error: 'This device belongs to someone else' }, 403);
  return c.json(await listMilestones(c.env.DB, owner ?? memberId, archived === 'true'), 200);
});

milestoneRoutes.openapi(createRoute({
  method: 'post', path: '/api/reward-milestones', tags: ['Rewards'], security: [{ Bearer: [] }],
  summary: 'Parent: create a one-time points or approved-chore milestone. Explicit memberIds enroll each person now; earlier work is excluded. Target and membership are fixed.',
  request: { body: { content: { 'application/json': { schema: MilestoneInputSchema } } } },
  responses: { 201: json(MilestoneSchema), ...errors },
}), async c => {
  const db = c.env.DB;
  if (!rewardsOn(await readSettings(db))) return c.json({ error: 'Rewards are turned off' }, 403);
  const body = c.req.valid('json');
  const ids = [...new Set(body.memberIds)];
  const known = await db.prepare('SELECT id FROM members WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all();
  if (known.results.length !== ids.length) return c.json({ error: 'Unknown family member' }, 400);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO reward_milestones (id,title,emoji,reward,metric,target,created_at) VALUES (?,?,?,?,?,?,?)').bind(id, body.title, body.emoji ?? null, body.reward, body.metric, body.target, now),
    ...ids.map(memberId => db.prepare(`INSERT INTO reward_milestone_members (milestone_id,member_id,started_at,baseline)
      SELECT ?,?,?,COALESCE(json_group_array(source), '[]') FROM (${MILESTONE_SOURCES}) WHERE member_id = ?`).bind(id, memberId, now, memberId)),
  ]);
  emit(c, 'reward.milestone.changed', { id });
  return c.json((await listMilestones(db)).find(m => m.id === id)!, 201);
});

milestoneRoutes.openapi(createRoute({
  method: 'patch', path: '/api/reward-milestones/{id}', tags: ['Rewards'], security: [{ Bearer: [] }],
  summary: 'Parent: archive or restore a milestone. Restoring reconciles progress; existing earned and given records are preserved.',
  request: { params, body: { content: { 'application/json': { schema: z.object({ active: z.boolean() }).strict() } } } },
  responses: { 200: json(z.object({ ok: z.boolean() })), ...errors },
}), async c => {
  if (!rewardsOn(await readSettings(c.env.DB))) return c.json({ error: 'Rewards are turned off' }, 403);
  const { id } = c.req.valid('param');
  const db = c.env.DB;
  const active = c.req.valid('json').active;
  if (!await db.prepare('SELECT 1 FROM reward_milestones WHERE id = ?').bind(id).first()) return c.json({ error: 'Milestone not found' }, 404);
  await db.batch([
    active
      ? db.prepare(`UPDATE reward_milestone_members AS e SET baseline = (SELECT json_group_array(value) FROM (
          SELECT value FROM json_each(e.baseline) UNION SELECT source AS value FROM (${MILESTONE_SOURCES}) s
          WHERE s.member_id = e.member_id AND s.source NOT IN (SELECT value FROM json_each(e.paused_sources)))), paused_sources = NULL, paused_progress = NULL
          WHERE milestone_id = ? AND paused_sources IS NOT NULL`).bind(id)
      : db.prepare(`UPDATE reward_milestone_members AS e SET paused_progress = (SELECT ${MILESTONE_PROGRESS} FROM reward_milestones m WHERE m.id = e.milestone_id),
          paused_sources = (SELECT json_group_array(source) FROM (${MILESTONE_SOURCES}) WHERE member_id = e.member_id)
          WHERE milestone_id = ? AND paused_sources IS NULL`).bind(id),
    db.prepare('UPDATE reward_milestones SET active = ? WHERE id = ?').bind(active ? 1 : 0, id),
  ]);
  emit(c, 'reward.milestone.changed', { id });
  return c.json({ ok: true }, 200);
});

milestoneRoutes.openapi(createRoute({
  method: 'post', path: '/api/reward-milestones/{id}/given', tags: ['Rewards'], security: [{ Bearer: [] }],
  summary: 'Parent: mark an earned milestone reward given, once. Also works for an archived milestone.',
  request: { params, body: { content: { 'application/json': { schema: z.object({ memberId: z.string() }) } } } },
  responses: { 200: json(z.object({ ok: z.boolean() })), ...errors },
}), async c => {
  if (!rewardsOn(await readSettings(c.env.DB))) return c.json({ error: 'Rewards are turned off' }, 403);
  const { id } = c.req.valid('param'), { memberId } = c.req.valid('json');
  const result = await c.env.DB.prepare('UPDATE reward_milestone_members SET given_at = ? WHERE milestone_id = ? AND member_id = ? AND earned_at IS NOT NULL AND given_at IS NULL').bind(new Date().toISOString(), id, memberId).run();
  if (!result.meta.changes) return c.json({ error: 'Only an earned reward that has not been given can be marked given' }, 409);
  emit(c, 'reward.milestone.given', { id, memberId });
  return c.json({ ok: true }, 200);
});
