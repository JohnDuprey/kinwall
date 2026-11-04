import { stored } from '../i18n.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { isConnectedApp, ownDevice } from '../auth.ts';
import { emit } from '../bus.ts';
import { eventInstances } from './events.ts';
import { ErrorSchema } from '../schemas.ts';
import { eventActivity, occurrenceOf, resolveFollow, type FollowRule } from '../event-activity-plan.ts';
import type { KinwallDb } from '../db.ts';

export const eventFollowsRoutes = createRouter();
export const EventFollowChoiceSchema = z
  .object({
    enabled: z.boolean(),
    minutes: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(30), z.literal(60)]).default(15),
    scope: z.enum(['occurrence', 'series']).default('occurrence'),
    occurrenceStart: z.string().datetime({ offset: true }).nullable().optional(),
    showNow: z.boolean().default(false),
  })
  .strict();
export const EventFollowSchema = z.object({
  enabled: z.boolean(),
  minutes: z.number(),
  scope: z.enum(['occurrence', 'series']),
});
const Plan = z.object({
  muted: z.boolean().optional(),
  activity: z.string(),
  eventId: z.string(),
  occurrenceStart: z.string().nullable(),
  title: z.string(),
  location: z.string().nullable(),
  showAt: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  eventEndsAt: z.string(),
  leadAt: z.string().nullable(),
  prep: z.boolean(),
});
const errors = {
  400: {
    description: 'Invalid event or occurrence',
    content: { 'application/json': { schema: ErrorSchema } },
  },
  403: { description: 'Use your own device', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'Event not available', content: { 'application/json': { schema: ErrorSchema } } },
};
export const followRules = async (db: KinwallDb, member: string) =>
  (await db.prepare('SELECT * FROM event_follows WHERE member_id=?').bind(member).all<FollowRule>()).results;
export async function eventPlans(db: KinwallDb, member: string, from: Date, to: Date) {
  const [rules, events] = await Promise.all([followRules(db, member), eventInstances(db, from, to)]);
  return events.flatMap((e) => {
    const r = resolveFollow(e, rules),
      a = r && eventActivity(e, { ...r, enabled: 1 });
    return a ? [{ ...a, muted: !r!.enabled }] : [];
  });
}
const path = '/api/events/{id}/follow';
const params = z.object({ id: z.string() });
const query = z.object({ occurrenceStart: z.string().datetime({ offset: true }).optional() });
// Shared wall screens and connected apps cannot subscribe a family member's phones.
async function member(c: Parameters<typeof ownDevice>[0]) {
  return (await isConnectedApp(c)) ? null : ownDevice(c);
}
async function instance(db: KinwallDb, id: string, occurrence?: string | null) {
  const row = await db
    .prepare('SELECT start,rrule FROM events WHERE id=?')
    .bind(id)
    .first<{ start: string; rrule: string | null }>();
  if (!row) return null;
  if (row.rrule && !occurrence) return null;
  const at = Date.parse(occurrence ?? row.start);
  if (!Number.isFinite(at)) return null;
  return (
    (await eventInstances(db, new Date(at), new Date(at + 1))).find(
      (e) => e.id === id && (!occurrence || Date.parse(e.start) === at),
    ) ?? null
  );
}
eventFollowsRoutes.openapi(
  createRoute({
    method: 'get',
    path,
    tags: ['Events'],
    summary: 'Read your personal follow choice for an event',
    security: [{ Bearer: [] }],
    request: { params, query },
    responses: {
      200: {
        description: 'Effective choice; occurrence overrides series',
        content: { 'application/json': { schema: EventFollowSchema } },
      },
      ...errors,
    },
  }),
  async (c) => {
    const who = await member(c);
    if (!who)
      return c.json({ error: stored('error', 'Choose whose device this is before following events.') }, 403);
    const e = await instance(c.env.DB, c.req.valid('param').id, c.req.valid('query').occurrenceStart);
    if (!e) return c.json({ error: stored('error', 'Event not available') }, 404);
    const r = resolveFollow(e, await followRules(c.env.DB, who));
    return c.json({ enabled: !!r?.enabled, minutes: r?.minutes ?? 15, scope: r?.scope ?? 'occurrence' }, 200);
  },
);
eventFollowsRoutes.openapi(
  createRoute({
    method: 'put',
    path,
    tags: ['Events'],
    summary: 'Follow or stop following an event on your own phones; does not edit the calendar provider',
    security: [{ Bearer: [] }],
    request: { params, body: { content: { 'application/json': { schema: EventFollowChoiceSchema } } } },
    responses: {
      200: { description: 'Saved', content: { 'application/json': { schema: EventFollowSchema } } },
      ...errors,
    },
  }),
  async (c) => {
    const who = await member(c);
    if (!who)
      return c.json({ error: stored('error', 'Choose whose device this is before following events.') }, 403);
    const b = c.req.valid('json'),
      e = await instance(c.env.DB, c.req.valid('param').id, b.occurrenceStart);
    if (!e) return c.json({ error: stored('error', 'Event not available') }, 404);
    if (e.allDay || Date.parse(e.end) <= Date.now())
      return c.json({ error: stored('error', 'Follow an upcoming or ongoing timed event.') }, 400);
    if (b.scope === 'series' && !e.rrule && !e.seriesId)
      return c.json({ error: stored('error', 'This event does not repeat.') }, 400);
    if (b.showNow && (b.scope === 'series' || !b.enabled || Date.parse(e.start) > Date.now() + 3600000))
      return c.json(
        { error: stored('error', 'Show now is available for this occurrence within an hour of its start.') },
        400,
      );
    const target = b.scope === 'series' ? (e.seriesId ?? e.id) : e.id;
    await c.env.DB.prepare(
      'INSERT INTO event_follows(member_id,calendar_id,target,scope,occurrence_start,enabled,minutes,show_now) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(member_id,calendar_id,target,scope,occurrence_start) DO UPDATE SET enabled=excluded.enabled,minutes=excluded.minutes,show_now=excluded.show_now,revision=event_follows.revision+1',
    )
      .bind(
        who,
        e.calendarId,
        target,
        b.scope,
        b.scope === 'series' ? '' : occurrenceOf(e),
        b.enabled ? 1 : 0,
        b.minutes,
        b.showNow ? new Date().toISOString() : null,
      )
      .run();
    emit(c, 'events.changed', { calendarId: e.calendarId });
    return c.json({ enabled: b.enabled, minutes: b.minutes, scope: b.scope }, 200);
  },
);
eventFollowsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/event-activities',
    tags: ['Events'],
    summary: 'Your followed-event schedule for the next 48 hours, including ongoing events',
    security: [{ Bearer: [] }],
    responses: {
      200: {
        description: 'Schedule and whether this personal device may schedule them',
        content: { 'application/json': { schema: z.object({ enabled: z.boolean(), plans: z.array(Plan) }) } },
      },
      ...errors,
    },
  }),
  async (c) => {
    const who = await member(c);
    if (!who)
      return c.json({ error: stored('error', 'Choose whose device this is before following events.') }, 403);
    const now = Date.now();
    return c.json(
      {
        enabled: true,
        plans: await eventPlans(c.env.DB, who, new Date(now - 8 * 3600000), new Date(now + 48 * 3600000)),
      },
      200,
    );
  },
);
