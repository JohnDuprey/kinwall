import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { resolveKey } from '../auth.ts';
import { parseMemberIds, resolveMemberIds } from '../calendar-members.ts';
import { getVapidPublicKey, sendWebPush } from '../webpush.ts';
import { encrypt } from '../crypto.ts';
import { readFeatures } from './settings.ts';
import { DEFAULT_PUSH_PREFS, memberMatch, recordNotification } from '../notify.ts';
import { ErrorSchema, NotificationSchema, NotifyInputSchema, PushSubscriptionInputSchema, PushSubscriptionPatchSchema, PushSubscriptionSchema } from '../schemas.ts';

export const pushRoutes = createRouter();

type PushSubRow = {
  id: string;
  api_key_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_name: string;
  member_ids: string;
  prefs: string;
  created_at: string;
  last_success_at: string | null;
};

function toApi(row: PushSubRow) {
  let prefs = {};
  try {
    prefs = JSON.parse(row.prefs || '{}');
  } catch {
    // ignore malformed row
  }
  return {
    id: row.id,
    deviceName: row.device_name,
    memberIds: parseMemberIds(row.member_ids),
    prefs: { ...DEFAULT_PUSH_PREFS, ...prefs },
    createdAt: row.created_at,
    lastSuccessAt: row.last_success_at,
  };
}

// A key may only see/touch subscriptions it created, unless it's admin-scoped.
function ownsOrAdmin(resolved: Awaited<ReturnType<typeof resolveKey>>, row: PushSubRow): boolean {
  return resolved?.scope === 'admin' || row.api_key_id === resolved?.id;
}

pushRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/push/vapid-public-key',
    tags: ['Push'],
    summary: 'Public VAPID key, for pushManager.subscribe()',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ publicKey: z.string() }) } } } },
  }),
  async (c) => c.json({ publicKey: await getVapidPublicKey(c.env, c.env.DB) }, 200),
);

pushRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/push/subscriptions',
    tags: ['Push'],
    summary: 'List push subscriptions (admin: all; display: its own)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(PushSubscriptionSchema) } } } },
  }),
  async (c) => {
    const resolved = await resolveKey(c);
    const { results } = await c.env.DB.prepare('SELECT * FROM push_subscriptions ORDER BY created_at').all<PushSubRow>();
    const rows = resolved?.scope === 'admin' ? results : results.filter((r) => r.api_key_id === resolved?.id);
    return c.json(rows.map(toApi), 200);
  },
);

pushRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/push/subscriptions',
    tags: ['Push'],
    summary: 'Register (or update, by endpoint) this device for push notifications',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PushSubscriptionInputSchema } } } },
    responses: { 201: { description: 'created', content: { 'application/json': { schema: PushSubscriptionSchema } } } },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const resolved = await resolveKey(c);
    const memberIds = await resolveMemberIds(c.env.DB, body.memberIds ?? []);
    const prefs = { ...DEFAULT_PUSH_PREFS, ...(body.prefs ?? {}) };
    // Keys are encrypted with the row id as AAD, so a re-subscribe (same endpoint) must reuse the
    // existing id - ON CONFLICT keeps the old id, not the fresh one in VALUES.
    const existing = await c.env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').bind(body.subscription.endpoint).first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    const [p256dh, auth] = await Promise.all([encrypt(c.env, body.subscription.keys.p256dh, id), encrypt(c.env, body.subscription.keys.auth, id)]);
    await c.env.DB.prepare(
      'INSERT INTO push_subscriptions (id, api_key_id, endpoint, p256dh, auth, device_name, member_ids, prefs, created_at) VALUES (?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(endpoint) DO UPDATE SET api_key_id = excluded.api_key_id, p256dh = excluded.p256dh, auth = excluded.auth, ' +
        'device_name = excluded.device_name, member_ids = excluded.member_ids, prefs = excluded.prefs',
    )
      .bind(
        id,
        resolved?.id ?? null,
        body.subscription.endpoint,
        p256dh,
        auth,
        body.deviceName,
        JSON.stringify(memberIds),
        JSON.stringify(prefs),
        new Date().toISOString(),
      )
      .run();
    const row = await c.env.DB.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').bind(body.subscription.endpoint).first<PushSubRow>();
    return c.json(toApi(row!), 201);
  },
);

pushRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/push/subscriptions/{id}',
    tags: ['Push'],
    summary: 'Update this device\'s notification preferences',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: PushSubscriptionPatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: PushSubscriptionSchema } } },
      403: { description: 'forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const row = await c.env.DB.prepare('SELECT * FROM push_subscriptions WHERE id = ?').bind(id).first<PushSubRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    if (!ownsOrAdmin(await resolveKey(c), row)) return c.json({ error: 'forbidden' }, 403);

    const memberIds = body.memberIds !== undefined ? await resolveMemberIds(c.env.DB, body.memberIds) : parseMemberIds(row.member_ids);
    const existingPrefs = { ...DEFAULT_PUSH_PREFS, ...JSON.parse(row.prefs || '{}') };
    const prefs = body.prefs !== undefined ? { ...existingPrefs, ...body.prefs } : existingPrefs;
    const deviceName = body.deviceName ?? row.device_name;

    await c.env.DB.prepare('UPDATE push_subscriptions SET device_name = ?, member_ids = ?, prefs = ? WHERE id = ?')
      .bind(deviceName, JSON.stringify(memberIds), JSON.stringify(prefs), id)
      .run();
    const updated = await c.env.DB.prepare('SELECT * FROM push_subscriptions WHERE id = ?').bind(id).first<PushSubRow>();
    return c.json(toApi(updated!), 200);
  },
);

pushRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/push/subscriptions/{id}',
    tags: ['Push'],
    summary: 'Turn off push notifications for this device',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      403: { description: 'forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await c.env.DB.prepare('SELECT * FROM push_subscriptions WHERE id = ?').bind(id).first<PushSubRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    if (!ownsOrAdmin(await resolveKey(c), row)) return c.json({ error: 'forbidden' }, 403);
    await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id).run();
    return c.json({ ok: true }, 200);
  },
);

pushRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/push/test/{id}',
    tags: ['Push'],
    summary: 'Send a test notification to this device',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      403: { description: 'forbidden', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await c.env.DB.prepare('SELECT * FROM push_subscriptions WHERE id = ?').bind(id).first<PushSubRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    if (!ownsOrAdmin(await resolveKey(c), row)) return c.json({ error: 'forbidden' }, 403);
    const result = await sendWebPush(c.env, c.env.DB, row, { title: 'Notifications are on 🎉', body: 'This device will get the reminders you picked in Settings.', url: '/' });
    if (result.ok) await c.env.DB.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
    else if (result.gone) await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(id).run();
    return c.json({ ok: result.ok }, 200);
  },
);

pushRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/notify',
    tags: ['Push'],
    summary: 'Send a custom message to devices following the given members (or all devices)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: NotifyInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean(), sent: z.number() }) } } },
      403: { description: 'family messages are turned off (settings.features.messages)', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if (!(await readFeatures(c.env.DB)).messages) return c.json({ error: 'Family messages are turned off in Settings → Features' }, 403);
    // The MCP server calls this route in-process and tags itself; anything else is the REST API.
    const source = c.req.header('X-Kinwall-Source') === 'mcp' ? 'mcp' : 'api';
    await recordNotification(c.env.DB, { kind: 'message', title: body.title, body: body.body, url: body.url, memberIds: body.memberIds, source });
    const { results } = await c.env.DB.prepare('SELECT * FROM push_subscriptions').all<PushSubRow>();
    let sent = 0;
    for (const row of results) {
      if (!memberMatch(parseMemberIds(row.member_ids), body.memberIds)) continue;
      const result = await sendWebPush(c.env, c.env.DB, row, { title: body.title, body: body.body, url: body.url });
      if (result.ok) {
        sent++;
        await c.env.DB.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
      } else if (result.gone) {
        await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
      }
    }
    return c.json({ ok: true, sent }, 200);
  },
);

type NotificationRow = { id: string; at: string; kind: string; title: string; body: string | null; url: string | null; member_ids: string; source: string | null };

pushRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/notifications',
    tags: ['Push'],
    summary: 'The in-app notification feed, newest first: every reminder, summary, nudge, list update and message sent (kept 90 days)',
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(200).optional().openapi({ description: 'Default 50.' }),
        before: z.string().optional().openapi({ description: 'ISO time: only notifications older than this (paging).' }),
      }),
    },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(NotificationSchema) } } } },
  }),
  async (c) => {
    const { limit = 50, before } = c.req.valid('query');
    const { results } = await c.env.DB.prepare('SELECT * FROM notifications WHERE at < ? ORDER BY at DESC, id DESC LIMIT ?')
      .bind(before ?? '9999', limit)
      .all<NotificationRow>();
    return c.json(
      results.map((r) => ({ id: r.id, at: r.at, kind: r.kind as z.infer<typeof NotificationSchema>['kind'], title: r.title, body: r.body, url: r.url, memberIds: parseMemberIds(r.member_ids), source: r.source })),
      200,
    );
  },
);

// Clearing the feed is household-wide (there's one copy), so admin-only; displays keep their
// per-device read state and can't remove anything.
pushRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/notifications',
    tags: ['Push'],
    summary: 'Clear the whole in-app notification feed (admin only)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true), deleted: z.number() }) } } }, 403: { description: 'not admin', content: { 'application/json': { schema: ErrorSchema } } } },
  }),
  async (c) => {
    const resolved = await resolveKey(c);
    if (resolved?.scope !== 'admin') return c.json({ error: 'Admin key required' }, 403);
    const r = await c.env.DB.prepare('DELETE FROM notifications').run();
    return c.json({ ok: true as const, deleted: r.meta?.changes ?? 0 }, 200);
  },
);

pushRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/notifications/{id}',
    tags: ['Push'],
    summary: 'Remove one notification from the feed (admin only)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } }, 403: { description: 'not admin', content: { 'application/json': { schema: ErrorSchema } } }, 404: { description: 'no such notification', content: { 'application/json': { schema: ErrorSchema } } } },
  }),
  async (c) => {
    const resolved = await resolveKey(c);
    if (resolved?.scope !== 'admin') return c.json({ error: 'Admin key required' }, 403);
    const r = await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(c.req.valid('param').id).run();
    if (!r.meta?.changes) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true as const }, 200);
  },
);
