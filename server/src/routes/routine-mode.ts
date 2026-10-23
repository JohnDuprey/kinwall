import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { deviceOwner, requestKey } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import { dueOnDate, type ChoreRow } from './chores.ts';
import { todayInTz } from './members.ts';
import { householdTz } from '../sync.ts';
import { readFeatures } from './settings.ts';
import { evaluateRoutine, schoolDomain } from '../routine-mode.ts';
import { stored } from '../i18n.ts';
export const routineModeRoutes = createRouter();
const Domains = z.array(z.preprocess(value => typeof value === 'string' ? schoolDomain(value) : value, z.string())).max(40).transform(values => [...new Set(values)]);
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const DaySchedule = z.object({ start: Time, cutoff: Time }).refine(value => value.start < value.cutoff, { message: stored('error', 'Routine mode must start before free time ends.') });
const Policy = z.object({ enabled: z.boolean(), appMode: z.enum(['selected', 'all']).default('selected'), cutoff: Time, start: Time.default('00:00'), daySchedules: z.array(DaySchedule.nullable()).length(7).optional(),
  requiredChoreIds: z.array(z.string().min(1).max(100)).max(200).nullable().default(null).transform(ids => ids === null ? null : [...new Set(ids)]),
  allowedWebsitesOnly: z.boolean().default(false),
  allowedWebDomains: Domains.default([]),
  schoolLinkDomains: Domains.optional(),
});
const PolicyInput = Policy.refine(p => p.start < p.cutoff, { message: stored('error', 'Routine mode must start before free time ends.') }).refine(p => !p.schoolLinkDomains || p.schoolLinkDomains.every(domain => p.allowedWebDomains.includes(domain)), { message: stored('error', 'Website links must also be allowed websites.') }).refine(p => !p.allowedWebsitesOnly || p.allowedWebDomains.length > 0, { message: stored('error', 'Add at least one allowed website before limiting browsing.') });
const Params = z.object({ memberId: z.string() });
const State = Policy.extend({ availableChores: z.array(z.object({ id: z.string(), title: z.string() })), effectiveStart: z.string(), effectiveCutoff: z.string(), date: z.string(), timezone: z.string(), locked: z.boolean(), reason: z.string(), total: z.number(),
  remaining: z.array(z.object({ id: z.string(), title: z.string(), completed: z.boolean(), pending: z.boolean() })), validUntil: z.string(), checkedAt: z.string() });
const errors = { 400: { description: 'Invalid routine settings', content: { 'application/json': { schema: ErrorSchema } } }, 403: { description: 'Parent or own child device required', content: { 'application/json': { schema: ErrorSchema } } }, 404: { description: 'Child not found', content: { 'application/json': { schema: ErrorSchema } } } };
routineModeRoutes.openapi(createRoute({ method: 'get', path: '/api/routine-mode/{memberId}', tags: ['Chores'], summary: 'Routine mode decision for a child, using approved chores due today', security: [{ Bearer: [] }], request: { params: Params }, responses: { 200: { description: 'Current decision', content: { 'application/json': { schema: State } } }, ...errors } }), async c => {
  const { memberId } = c.req.valid('param');
  if ((await requestKey(c))?.scope !== 'admin' && await deviceOwner(c) !== memberId) return c.json({ error: stored('error', 'This device can only read its own routine.') }, 403);
  if (!await c.env.DB.prepare('SELECT id FROM members WHERE id = ? AND grown_up = 0').bind(memberId).first()) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  const timezone = await householdTz(c.env.DB), date = todayInTz(timezone);
  const policy = await c.env.DB.prepare('SELECT enabled, app_mode, cutoff, allowed_websites_only, allowed_web_domains, school_link_domains, start, day_schedules, required_chore_ids FROM routine_mode WHERE member_id = ?').bind(memberId).first<{ enabled: number; app_mode: 'selected' | 'all'; cutoff: string; allowed_websites_only: number; allowed_web_domains: string; school_link_domains: string | null; start: string; day_schedules: string | null; required_chore_ids: string | null }>();
  const { results } = await c.env.DB.prepare("SELECT c.*, cc.status AS completion_status FROM chores c LEFT JOIN chore_completions cc ON cc.chore_id = c.id AND cc.date = ? WHERE c.member_id = ? AND c.active = 1 AND c.archived = 0 ORDER BY c.sort, c.created_at").bind(date, memberId).all<ChoreRow & { completion_status: string | null }>();
  const chores = results.filter(row => dueOnDate(row, date, timezone)).map(row => ({ id: row.id, title: row.title, completed: row.completion_status === 'approved', pending: row.completion_status === 'pending' }));
  c.header('Cache-Control', 'no-store');
  const decision = evaluateRoutine({ enabled: !!policy?.enabled && (await readFeatures(c.env.DB)).chores, requiredChoreIds: policy?.required_chore_ids == null ? null : JSON.parse(policy.required_chore_ids), appMode: policy?.app_mode ?? 'selected', cutoff: policy?.cutoff ?? '19:30', start: policy?.start ?? '00:00', daySchedules: policy?.day_schedules ? JSON.parse(policy.day_schedules) : undefined, allowedWebsitesOnly: !!policy?.allowed_websites_only, allowedWebDomains: JSON.parse(policy?.allowed_web_domains ?? '[]') as string[], schoolLinkDomains: policy?.school_link_domains == null ? undefined : JSON.parse(policy.school_link_domains) as string[] }, chores, timezone);
  return c.json({ ...decision, availableChores: results.map(chore => ({ id: chore.id, title: chore.title })) }, 200);
});
routineModeRoutes.openapi(createRoute({ method: 'put', path: '/api/routine-mode/{memberId}', tags: ['Chores'], summary: 'Parent: enable routine mode and set its household-time cutoff', security: [{ Bearer: [] }], request: { params: Params, body: { content: { 'application/json': { schema: PolicyInput } } } }, responses: { 200: { description: 'Saved policy', content: { 'application/json': { schema: Policy } } }, ...errors } }), async c => {
  if ((await requestKey(c))?.scope !== 'admin') return c.json({ error: stored('error', 'A grown-up must change routine mode.') }, 403);
  const { memberId } = c.req.valid('param');
  if (!await c.env.DB.prepare('SELECT id FROM members WHERE id = ? AND grown_up = 0').bind(memberId).first()) return c.json({ error: stored('error', 'Choose a child in your family.') }, 404);
  const policy = c.req.valid('json');
  if (policy.requiredChoreIds?.length) {
    const { results } = await c.env.DB.prepare(`SELECT id FROM chores WHERE member_id = ? AND active = 1 AND archived = 0 AND id IN (${policy.requiredChoreIds.map(() => '?').join(',')})`).bind(memberId, ...policy.requiredChoreIds).all<{ id: string }>();
    if (results.length !== policy.requiredChoreIds.length) return c.json({ error: stored('error', 'Choose active chores assigned to this child.') }, 400);
  }
  await c.env.DB.prepare('INSERT INTO routine_mode (member_id, enabled, app_mode, cutoff, allowed_websites_only, allowed_web_domains, school_link_domains, start, day_schedules, required_chore_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET enabled = excluded.enabled, app_mode = excluded.app_mode, cutoff = excluded.cutoff, allowed_websites_only = excluded.allowed_websites_only, allowed_web_domains = excluded.allowed_web_domains, school_link_domains = excluded.school_link_domains, start = excluded.start, day_schedules = excluded.day_schedules, required_chore_ids = excluded.required_chore_ids').bind(memberId, Number(policy.enabled), policy.appMode, policy.cutoff, Number(policy.allowedWebsitesOnly), JSON.stringify(policy.allowedWebDomains), policy.schoolLinkDomains === undefined ? null : JSON.stringify(policy.schoolLinkDomains), policy.start, policy.daySchedules ? JSON.stringify(policy.daySchedules) : null, policy.requiredChoreIds === null ? null : JSON.stringify(policy.requiredChoreIds)).run();
  return c.json(policy, 200);
});
