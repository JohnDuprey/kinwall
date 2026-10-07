import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { deviceOwner, ownDevice, requestKey, resolveKey } from '../auth.ts';
import { parseMemberIds, resolveMemberIds } from '../calendar-members.ts';
import { getVapidPublicKey, sendWebPush } from '../webpush.ts';
import { encrypt } from '../crypto.ts';
import { readFeatures } from './settings.ts';
import { DEFAULT_PUSH_PREFS, MED_LATE, openNote, pushToMembers, recordNotification } from '../notify.ts';
import { medicationFeedFilter } from './medications.ts';
import { ErrorSchema, NotificationSchema, NotifyInputSchema, PushSubscriptionInputSchema, PushSubscriptionPatchSchema, PushSubscriptionSchema } from '../schemas.ts';

export const pushRoutes = createRouter();

const MAX_SUBS_PER_KEY = 10;

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
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: PushSubscriptionSchema } } },
      400: { description: 'not an https endpoint on a browser push service', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const resolved = await resolveKey(c);
    // A kid's own device follows only them (notify.ts loadSubs holds to that on every send).
    const kid = await deviceOwner(c);
    const memberIds = kid ? [kid] : await resolveMemberIds(c.env.DB, body.memberIds ?? []);
    const prefs = { ...DEFAULT_PUSH_PREFS, ...(body.prefs ?? {}) };
    // Keys are encrypted with the row id as AAD, so a re-subscribe (same endpoint) must reuse the
    // existing id - ON CONFLICT keeps the old id, not the fresh one in VALUES.
    const existing = await c.env.DB.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').bind(body.subscription.endpoint).first<{ id: string }>();
    const id = existing?.id ?? crypto.randomUUID();
    // At most MAX_SUBS_PER_KEY per device key: a new one replaces that key's oldest.
    if (!existing) {
      await c.env.DB.prepare(
        'DELETE FROM push_subscriptions WHERE id IN (SELECT id FROM push_subscriptions WHERE api_key_id IS ? ORDER BY created_at DESC, id LIMIT -1 OFFSET ?)',
      ).bind(resolved?.id ?? null, MAX_SUBS_PER_KEY - 1).run();
    }
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

    const kid = await deviceOwner(c);
    const memberIds = kid ? [kid] : body.memberIds !== undefined ? await resolveMemberIds(c.env.DB, body.memberIds) : parseMemberIds(row.member_ids);
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
    const sent = await pushToMembers(c.env, body.memberIds, { title: body.title, body: body.body, url: body.url });
    return c.json({ ok: true, sent }, 200);
  },
);

// Who sees which feed rows, on top of medicationFeedFilter. Parents' devices and keys: everything
// but other people's privacy notes. A kid's own device (deviceOwner): rows for the whole family or
// for them, never the household "Today" summary (it lists grown-ups' plans too; their own comes by
// push) and never a parent-facing "hasn't been marked yet" medicine note, even about them. A wall
// screen (shared or legacy display): the family feed, minus those medicine notes and messages meant
// only for grown-ups. Privacy notes (kind 'privacy': a device now belongs to someone, their private
// journal changed) show only on that person's own devices (ownDevice): they're how that person
// finds out. Everyone else's record of them is Settings → Access → Security activity.
// The medicine notes' text is sealed (notify.ts openNote), so "hasn't been marked yet" is told apart
// after opening (hideLate), not in SQL.
const PRIVACY_MINE = " AND (kind != 'privacy' OR EXISTS (SELECT 1 FROM json_each(member_ids) WHERE value = ?))";
async function feedFilter(c: Parameters<typeof deviceOwner>[0]): Promise<{ sql: string; binds: string[]; hideLate: boolean }> {
  const key = await requestKey(c);
  const mine = (await ownDevice(c)) ?? '';
  if (key?.scope !== 'display') return { sql: PRIVACY_MINE, binds: [mine], hideLate: false };
  const kid = await deviceOwner(c);
  if (kid) return { sql: ` AND (json_array_length(member_ids) = 0 OR EXISTS (SELECT 1 FROM json_each(member_ids) WHERE value = ?)) AND kind != 'summary'${PRIVACY_MINE}`, binds: [kid, mine], hideLate: true };
  const grownUpsOnly = "kind = 'message' AND json_array_length(member_ids) > 0 AND NOT EXISTS (SELECT 1 FROM json_each(member_ids) j JOIN members m ON m.id = j.value WHERE m.grown_up = 0)";
  return { sql: ` AND NOT (${grownUpsOnly})${PRIVACY_MINE}`, binds: [mine], hideLate: true };
}

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
    // Medicine rows only for parents, shared walls and that person's own devices (routes/medications.ts).
    const meds = await medicationFeedFilter(c);
    const who = await feedFilter(c);
    if (!(await readFeatures(c.env.DB)).polls) who.sql += " AND kind != 'poll'"; // polls off: their notes go with them
    // Newest first by day, then by insertion order: a medicine note's stored `at` is only its day.
    // Rows hidden after opening (hideLate) are made up from the next batch, so a page stays full.
    // ponytail: `before` compares stored times, so paging can repeat a medicine note at a day's edge; cursor by rowid if that matters.
    const results: NotificationRow[] = [];
    for (let offset = 0; results.length < limit; offset += limit) {
      const batch = (await c.env.DB.prepare(`SELECT * FROM notifications WHERE at < ?${meds.sql}${who.sql} ORDER BY substr(at, 1, 10) DESC, rowid DESC LIMIT ? OFFSET ?`)
        .bind(before ?? '9999', ...meds.binds, ...who.binds, limit, offset)
        .all<NotificationRow>()).results;
      for (const r of batch) {
        const n = await openNote(c.env, r);
        if (!(who.hideLate && n.kind === 'medication' && n.title.endsWith(MED_LATE))) results.push(n);
      }
      if (batch.length < limit) break;
    }
    results.splice(limit);
    const rm = await remover(c);
    return c.json(
      results.map((r) => ({ id: r.id, at: r.at, kind: r.kind as z.infer<typeof NotificationSchema>['kind'], title: r.title, body: r.body, url: r.url, memberIds: parseMemberIds(r.member_ids), source: r.source, removable: mayRemove(rm, r.kind, parseMemberIds(r.member_ids), r.at) })),
      200,
    );
  },
);

// Clearing the feed is household-wide (there's one copy), so admin-only; displays keep their
// per-device read state. Privacy notes (kind 'privacy': whose device something is, who is a
// grown-up, private journal changes) are removed only by the person they're about, from a device
// that was already theirs before the note was written (ownDevice, and theirsSince), so another
// parent can't clear one before it's seen: not from their own device, and not by saying a device
// is that person's (any full-access device may: PUT /api/me/owner), which is what the note is
// about. Dismissing loses nothing: the same change is in Security activity
// (routes/security-events.ts), which can't be cleared.
const OWNER_SETTLED_MS = 60_000;
/** The time from which a privacy note may be removed with this request's key: a minute after the
 * sign-in became its owner's (a passkey's sessions and an app sign-in's keys go by the passkey and
 * the grant; without owner_since, since it was made). A claim and its note are written together,
 * whichever comes first, so the minute keeps every note about the claim itself out of reach. */
async function theirsSince(c: Parameters<typeof ownDevice>[0]): Promise<string> {
  const row = await c.env.DB.prepare(
    `SELECT coalesce(p.owner_since, p.created_at, g.owner_since, g.created_at, k.owner_since, k.created_at) AS since
       FROM api_keys k LEFT JOIN passkeys p ON p.id = k.passkey_id LEFT JOIN oauth_grants g ON g.id = k.oauth_grant_id WHERE k.id = ?`,
  ).bind((await requestKey(c))?.id ?? '').first<{ since: string }>();
  return row ? new Date(Date.parse(row.since) + OWNER_SETTLED_MS).toISOString() : '9999';
}
/** What this request's key may remove, worked out once (the feed can have many rows). */
type Remover = { admin: boolean; mine: string | null; since: string };
async function remover(c: Parameters<typeof ownDevice>[0]): Promise<Remover> {
  const mine = await ownDevice(c);
  return { admin: (await resolveKey(c))?.scope === 'admin', mine, since: mine ? await theirsSince(c) : '9999' };
}
/** The one rule for removing a note, shared by the feed's `removable` flag and DELETE /api/notifications/{id}. */
function mayRemove(r: Remover, kind: string, memberIds: string[], at: string): boolean {
  return kind === 'privacy' ? !!r.mine && memberIds.includes(r.mine) && at >= r.since : r.admin;
}

pushRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/notifications',
    tags: ['Push'],
    summary: "Clear the in-app notification feed (admin only); privacy notes only when they're about this device's owner and it was already theirs before the note",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true), deleted: z.number() }) } } }, 403: { description: 'not admin', content: { 'application/json': { schema: ErrorSchema } } } },
  }),
  async (c) => {
    const resolved = await resolveKey(c);
    if (resolved?.scope !== 'admin') return c.json({ error: 'Admin key required' }, 403);
    const r = await c.env.DB.prepare(`DELETE FROM notifications WHERE (kind != 'privacy' OR at >= ?)${PRIVACY_MINE}`).bind(await theirsSince(c), (await ownDevice(c)) ?? '').run();
    return c.json({ ok: true as const, deleted: r.meta?.changes ?? 0 }, 200);
  },
);

pushRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/notifications/{id}',
    tags: ['Push'],
    summary: "Remove one notification from the feed (admin only; a privacy note only from a device of the person it's about that was already theirs before the note)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } }, 403: { description: 'not admin', content: { 'application/json': { schema: ErrorSchema } } }, 404: { description: 'no such notification', content: { 'application/json': { schema: ErrorSchema } } } },
  }),
  async (c) => {
    const rm = await remover(c);
    if (!rm.admin && !rm.mine) return c.json({ error: 'Admin key required' }, 403);
    const id = c.req.valid('param').id;
    const row = await c.env.DB.prepare('SELECT kind, member_ids, at FROM notifications WHERE id = ?').bind(id).first<{ kind: string; member_ids: string; at: string }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (!mayRemove(rm, row.kind, parseMemberIds(row.member_ids), row.at)) {
      return c.json({ error: row.kind === 'privacy' ? 'Only the person this note is about can remove it, from a device that was already theirs.' : 'Admin key required' }, 403);
    }
    await c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id).run();
    return c.json({ ok: true as const }, 200);
  },
);
