import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { syncCalendar } from '../sync.ts';
import { encryptConfig } from '../crypto.ts';
import { errorMessage } from '../redact.ts';
import { CalendarInputSchema, CalendarSchema, ErrorSchema } from '../schemas.ts';
import { parseMemberIds, resolveMemberIds } from '../calendar-members.ts';

export const calendarsRoutes = createRouter();

type CalendarRow = {
  id: string;
  kind: 'local' | 'ics' | 'google' | 'microsoft' | 'caldav';
  account_id: string | null;
  remote_id: string | null;
  name: string;
  color: string | null;
  member_ids: string;
  config: string;
  writable: number;
  enabled: number;
  last_synced_at: string | null;
  last_error: string | null;
};

function toApi(row: CalendarRow) {
  const memberIds = parseMemberIds(row.member_ids);
  return {
    id: row.id,
    kind: row.kind,
    accountId: row.account_id,
    remoteId: row.remote_id,
    name: row.name,
    color: row.color,
    memberId: memberIds[0] ?? null, // legacy - first assigned member, for compat
    memberIds,
    writable: !!row.writable,
    enabled: !!row.enabled,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

// POST body's memberIds wins when present; else legacy memberId (null/undefined -> []).
async function memberIdsFromInput(db: D1Database, body: { memberId?: string | null; memberIds?: string[] }): Promise<string[]> {
  const raw = body.memberIds !== undefined ? body.memberIds : body.memberId ? [body.memberId] : [];
  return resolveMemberIds(db, raw);
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
    // A calendar from an account always uses that account's provider, whatever kind the client sent
    // (the Settings picker used to send 'caldav' for Google/Outlook calendars, which then failed to sync).
    let kind = body.kind;
    if (body.accountId) {
      const account = await c.env.DB.prepare('SELECT kind FROM accounts WHERE id = ?').bind(body.accountId).first<{ kind: CalendarRow['kind'] }>();
      if (!account) return c.json({ error: 'unknown accountId' }, 400);
      kind = account.kind;
    }
    if (kind === 'ics' && !body.url) return c.json({ error: 'ics calendars require url' }, 400);
    if (['google', 'microsoft', 'caldav'].includes(kind) && (!body.accountId || !body.remoteId)) {
      return c.json({ error: `${kind} calendars require accountId and remoteId` }, 400);
    }
    const id = crypto.randomUUID();
    const rawConfig = kind === 'ics' ? { url: body.url } : {};
    let config: string;
    try {
      config = await encryptConfig(c.env, id, rawConfig);
    } catch (err) {
      return c.json({ error: errorMessage(err, 'encryption not configured') }, 500);
    }
    const writable = kind === 'local' || kind === 'google' || kind === 'microsoft' || kind === 'caldav' ? 1 : 0;
    const memberIds = await memberIdsFromInput(c.env.DB, body);
    const row: CalendarRow = {
      id,
      kind: kind,
      account_id: body.accountId ?? null,
      remote_id: body.remoteId ?? null,
      name: body.name,
      color: body.color ?? null,
      member_ids: JSON.stringify(memberIds),
      config,
      writable,
      enabled: 1,
      last_synced_at: null,
      last_error: null,
    };
    await c.env.DB.prepare(
      'INSERT INTO calendars (id, kind, account_id, remote_id, name, color, member_ids, config, writable, enabled) VALUES (?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.kind, row.account_id, row.remote_id, row.name, row.color, row.member_ids, row.config, row.writable, row.enabled)
      .run();
    emit(c, 'calendar.changed', { id: row.id });
    return c.json(toApi(row), 201);
  },
);

const CalendarPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().nullable().optional(),
    memberId: z.string().nullable().optional(), // legacy - use memberIds
    memberIds: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
  })
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
    const memberIds =
      body.memberIds !== undefined || body.memberId !== undefined
        ? await memberIdsFromInput(c.env.DB, body)
        : parseMemberIds(existing.member_ids);
    const updated: CalendarRow = {
      ...existing,
      name: body.name ?? existing.name,
      color: body.color !== undefined ? body.color : existing.color,
      member_ids: JSON.stringify(memberIds),
      enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
    };
    await c.env.DB.prepare('UPDATE calendars SET name = ?, color = ?, member_ids = ?, enabled = ? WHERE id = ?')
      .bind(updated.name, updated.color, updated.member_ids, updated.enabled, id)
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
