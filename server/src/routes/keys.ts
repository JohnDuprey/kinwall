import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { actorOf, createApiKey, DEVICE_KINDS, deviceKindOwner, resolveKey, type KeyDeviceKind } from '../auth.ts';
import { deviceOwnerEvent, recordSecurityEvent, securityEventStmts } from './security-events.ts';
import { emit } from '../bus.ts';
import { recordDeviceOwner } from '../notify.ts';
import { ApiKeyCreatedSchema, ApiKeySchema, ErrorSchema } from '../schemas.ts';

export const keysRoutes = createRouter();

type KeyRow = { id: string; name: string; scope: string; created_at: string; last_used_at: string | null; owner: string | null; device_kind: KeyDeviceKind | null; parent_key_id: string | null; parent_grant_id: string | null };
const KEY_COLUMNS = 'id, name, scope, created_at, last_used_at, owner, device_kind, parent_key_id, parent_grant_id';

function toApi(row: KeyRow) {
  return { id: row.id, name: row.name, scope: (row.scope === 'display' ? 'display' : 'admin') as 'admin' | 'display', createdAt: row.created_at, lastUsedAt: row.last_used_at, owner: row.owner, kind: row.device_kind, parentKeyId: row.parent_key_id, parentGrantId: row.parent_grant_id };
}

keysRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/keys',
    tags: ['API Keys'],
    summary: 'List API keys (hash never returned)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ApiKeySchema) } } } },
  }),
  async (c) => {
    // Passkey-login sessions (kind='session') are a separate concept (see Settings → Passkeys),
    // not automation keys - keep them out of this listing.
    const { results } = await c.env.DB.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE kind = 'api' ORDER BY created_at`).all<KeyRow>();
    return c.json(results.map(toApi), 200);
  },
);

keysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/keys',
    tags: ['API Keys'],
    summary: 'Create an API key (plaintext key returned once)',
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: {
          'application/json': { schema: z.object({ name: z.string().min(1), scope: z.enum(['admin', 'display']).optional() }) },
        },
      },
    },
    responses: { 201: { description: 'created', content: { 'application/json': { schema: ApiKeyCreatedSchema } } } },
  }),
  async (c) => {
    const { name, scope } = c.req.valid('json');
    const keyScope = scope ?? 'display'; // least privilege by default
    const { id, key } = await createApiKey(c.env.DB, name, keyScope);
    await recordSecurityEvent(c.env.DB, { kind: 'key.created', summary: `${keyScope === 'admin' ? 'Full-access' : 'Everyday-access'} API key "${name}" created`, by: await actorOf(c), device: name, detail: { scope: keyScope } });
    emit(c, 'settings.changed', { keyId: id });
    return c.json({ id, name, scope: keyScope, key }, 201);
  },
);

// What a device is and who it belongs to. Admin only (not in auth.ts DISPLAY_ALLOWED), so a device
// can never re-assign itself; the device reads both from GET /api/me. The kind and owner must fit
// (auth.ts deviceKindOwner); older clients send only an owner and the kind follows it. A
// full-access key (a parent's phone or browser) belongs only to a grown-up: it then reads their
// private journal. A device that now belongs to someone leaves a line in the family's feed.
keysRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/keys/{id}',
    tags: ['API Keys'],
    summary: "Set what a device is (kind: 'wall', 'kid', 'grownup') and who it belongs to (owner: 'shared' or a member id). They must fit; a full-access key only belongs to a grown-up (it opens their private journal).",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: z.object({ kind: z.enum(DEVICE_KINDS).optional(), owner: z.string().min(1).optional() }) } } },
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ApiKeySchema } } },
      400: { description: "unknown owner, or an owner that doesn't fit the kind", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const before = await c.env.DB.prepare(`SELECT ${KEY_COLUMNS} FROM api_keys WHERE id = ? AND kind = 'api'`).bind(id).first<KeyRow>();
    if (!before) return c.json({ error: 'not found' }, 404);
    const body = c.req.valid('json');
    if (!body.kind && !body.owner) return c.json({ error: 'Say what the device is or who it belongs to' }, 400);
    if (before.device_kind === 'widgets') return c.json({ error: 'Widgets and a Watch follow the phone that made them. Remove them here, or change the phone.' }, 400);
    const checked = await deviceKindOwner(c.env.DB, before.scope === 'display' ? 'display' : 'admin', body.kind, body.owner);
    if ('error' in checked) return c.json({ error: checked.error }, 400);
    const { owner, kind } = checked;
    const db = c.env.DB;
    const changed = owner !== before.owner || kind !== before.device_kind;
    await db.batch([
      db.prepare('UPDATE api_keys SET owner = ?, device_kind = ? WHERE id = ?').bind(owner, kind, id),
      ...(changed ? securityEventStmts(db, await deviceOwnerEvent(db, before.name, owner, kind, await actorOf(c))) : []),
    ]);
    const row = { ...before, owner, device_kind: kind };
    if (owner !== before.owner) await recordDeviceOwner(db, before.name, owner, kind);
    emit(c, 'settings.changed', { keyId: id });
    return c.json(toApi(row!), 200);
  },
);

keysRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/keys/{id}',
    tags: ['API Keys'],
    summary: 'Revoke an API key',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    const gone = await db.prepare('SELECT name, scope, kind, device_kind FROM api_keys WHERE id = ?').bind(id).first<{ name: string; scope: string; kind: string; device_kind: KeyDeviceKind | null }>();
    if (!gone) return c.json({ error: 'not found' }, 404);
    const what = gone.device_kind === 'widgets' ? 'Widgets key' : gone.kind !== 'api' ? 'Sign-in' : gone.scope === 'display' ? 'Device' : 'API key';
    await db.batch([
      db.prepare('DELETE FROM api_keys WHERE id = ?').bind(id),
      ...securityEventStmts(db, { kind: gone.device_kind === 'widgets' ? 'widgets.removed' : 'key.removed', summary: `${what} "${gone.name}" removed and signed out`, by: await actorOf(c), device: gone.name }),
    ]);
    emit(c, 'settings.changed', { keyId: id });
    return c.json({ ok: true }, 200);
  },
);

// Device keys: an app's widgets or watch get their own everyday-access key, so they never share
// the app's own sign-in (an OAuth key rotates, and two refreshers would end the grant). Any
// signed-in key may create one (it can't grant more than everyday access) and a key may revoke
// itself - never another. Each is marked 'widgets' and linked to what made it: the calling key, or
// for the Kinwall app's sign-in its grant (its access keys rotate). Removing that removes them too
// (migration 0067's cascade); Settings → Access lists them under it, revocable there too.
const MAX_KEYS = 200;

keysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/device-keys',
    tags: ['API Keys'],
    summary: "Create an everyday-access key for this app's widgets or watch (plaintext key returned once)",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: z.object({ name: z.string().trim().min(1).max(60) }) } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: ApiKeyCreatedSchema } } },
      429: { description: 'too many keys', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { name } = c.req.valid('json');
    const me = await resolveKey(c);
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE kind = 'api'").first<{ n: number }>();
    if (Number(count?.n ?? 0) >= MAX_KEYS) return c.json({ error: 'This household has too many keys. Remove some under Settings → Access.' }, 429);
    // Widgets follow the device only when the device itself is pinned (a kid's phone signed in
    // with everyday access). They're everyday-access keys, and an owner pins those, so a parent's
    // phone (full access, never locked) gets shared widgets that show the whole family.
    const grant = me?.kind === 'oauth' ? await c.env.DB.prepare('SELECT oauth_grant_id FROM api_keys WHERE id = ?').bind(me.id).first<{ oauth_grant_id: string | null }>() : null;
    const { id, key } = await createApiKey(c.env.DB, name, 'display', {
      owner: me?.scope === 'display' ? me.owner ?? null : 'shared', deviceKind: 'widgets',
      ...(grant ? { parentGrantId: grant.oauth_grant_id } : { parentKeyId: me?.id ?? null }),
    });
    await recordSecurityEvent(c.env.DB, { kind: 'widgets.added', summary: `Widgets key "${name}" added`, by: await actorOf(c), device: name });
    emit(c, 'settings.changed', { keyId: id });
    return c.json({ id, name, scope: 'display' as const, key }, 201);
  },
);

keysRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/device-keys/self',
    tags: ['API Keys'],
    summary: 'Revoke the key making this request (an app signing its widgets or watch out)',
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: 'not a revocable key', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const me = await resolveKey(c);
    if (!me?.id || me.kind !== 'api' || me.scope !== 'display') return c.json({ error: 'only an everyday-access key can revoke itself here' }, 400);
    const db = c.env.DB;
    await db.batch([
      db.prepare('DELETE FROM api_keys WHERE id = ?').bind(me.id),
      ...securityEventStmts(db, { kind: 'widgets.removed', summary: `Widgets key "${me.name}" signed out`, device: me.name }),
    ]);
    emit(c, 'settings.changed', { keyId: me.id });
    return c.json({ ok: true }, 200);
  },
);
