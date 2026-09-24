import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { syncCalendar } from '../sync.ts';
import { encryptConfig } from '../crypto.ts';
import { errorMessage } from '../redact.ts';
import { CalendarInputSchema, CalendarSchema, ErrorSchema } from '../schemas.ts';

export const calendarsRoutes = createRouter();

type CalendarRow = {
  id: string;
  kind: 'local' | 'ics' | 'google' | 'microsoft' | 'caldav';
  account_id: string | null;
  remote_id: string | null;
  name: string;
  color: string | null;
  member_id: string | null;
  config: string;
  writable: number;
  enabled: number;
  last_synced_at: string | null;
  last_error: string | null;
};

function toApi(row: CalendarRow) {
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id,
    remoteId: row.remote_id,
    name: row.name,
    color: row.color,
    memberId: row.member_id,
    writable: !!row.writable,
    enabled: !!row.enabled,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

calendarsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/calendars',
    tags: ['Calendars'],
    summary: 'List calendars (config never returned)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(CalendarSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM calendars ORDER BY name').all<CalendarRow>();
    return c.json(results.map(toApi), 200);
  },
);

calendarsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/calendars',
    tags: ['Calendars'],
    summary: 'Create a calendar (local, or attached to an ics url / provider account+remoteId)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CalendarInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: CalendarSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'server misconfigured', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if (body.kind === 'ics' && !body.url) return c.json({ error: 'ics calendars require url' }, 400);
    if (['google', 'microsoft', 'caldav'].includes(body.kind) && (!body.accountId || !body.remoteId)) {
      return c.json({ error: `${body.kind} calendars require accountId and remoteId` }, 400);
    }
    const id = crypto.randomUUID();
    const rawConfig = body.kind === 'ics' ? { url: body.url } : {};
    let config: string;
    try {
      config = await encryptConfig(c.env, id, rawConfig);
    } catch (err) {
      return c.json({ error: errorMessage(err, 'encryption not configured') }, 500);
    }
    const writable = body.kind === 'local' || body.kind === 'google' || body.kind === 'microsoft' || body.kind === 'caldav' ? 1 : 0;
    const row: CalendarRow = {
      id,
      kind: body.kind,
      account_id: body.accountId ?? null,
      remote_id: body.remoteId ?? null,
      name: body.name,
      color: body.color ?? null,
      member_id: body.memberId ?? null,
      config,
      writable,
      enabled: 1,
      last_synced_at: null,
      last_error: null,
    };
    await c.env.DB.prepare(
      'INSERT INTO calendars (id, kind, account_id, remote_id, name, color, member_id, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.kind, row.account_id, row.remote_id, row.name, row.color, row.member_id, row.config, row.writable, row.enabled)
      .run();
    emit(c, 'calendar.changed', { id: row.id });
    return c.json(toApi(row), 201);
  },
);

const CalendarPatchSchema = z
  .object({ name: z.string().min(1).optional(), color: z.string().nullable().optional(), memberId: z.string().nullable().optional(), enabled: z.boolean().optional() })
  .openapi('CalendarPatch');

calendarsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/calendars/{id}',
    tags: ['Calendars'],
    summary: 'Update a calendar',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: CalendarPatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: CalendarSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(id).first<CalendarRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const updated: CalendarRow = {
      ...existing,
      name: body.name ?? existing.name,
      color: body.color !== undefined ? body.color : existing.color,
      member_id: body.memberId !== undefined ? body.memberId : existing.member_id,
      enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
    };
    await c.env.DB.prepare('UPDATE calendars SET name = ?, color = ?, member_id = ?, enabled = ? WHERE id = ?')
      .bind(updated.name, updated.color, updated.member_id, updated.enabled, id)
      .run();
    emit(c, 'calendar.changed', { id });
    return c.json(toApi(updated), 200);
  },
);

calendarsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/calendars/{id}',
    tags: ['Calendars'],
    summary: 'Delete a calendar (and its cached events)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await c.env.DB.prepare('DELETE FROM calendars WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'calendar.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

calendarsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/calendars/{id}/sync',
    tags: ['Calendars'],
    summary: 'Sync a calendar now (full window replace - on Workers this can exceed the free-tier CPU budget for large feeds; the cron tick uses chunked slices instead)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true), count: z.number() }) } } },
      502: { description: 'sync failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    let execCtx;
    try {
      execCtx = c.executionCtx;
    } catch {
      execCtx = undefined;
    }
    const result = await syncCalendar(c.env, id, execCtx);
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json(result, 200);
  },
);
