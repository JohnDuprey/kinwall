import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { createApiKey, resolveKey } from '../auth.ts';
import { emit } from '../bus.ts';
import { ApiKeyCreatedSchema, ApiKeySchema, ErrorSchema } from '../schemas.ts';

export const keysRoutes = createRouter();

type KeyRow = { id: string; name: string; scope: string; created_at: string; last_used_at: string | null };

function toApi(row: KeyRow) {
  return { id: row.id, name: row.name, scope: (row.scope === 'display' ? 'display' : 'admin') as 'admin' | 'display', createdAt: row.created_at, lastUsedAt: row.last_used_at };
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
    const { results } = await c.env.DB.prepare("SELECT id, name, scope, created_at, last_used_at FROM api_keys WHERE kind = 'api' ORDER BY created_at").all<KeyRow>();
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
    emit(c, 'settings.changed', { keyId: id });
    return c.json({ id, name, scope: keyScope, key }, 201);
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
    const result = await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'settings.changed', { keyId: id });
    return c.json({ ok: true }, 200);
  },
);

// Device keys: an app's widgets or watch get their own everyday-access key, so they never share
// the app's own sign-in (an OAuth key rotates, and two refreshers would end the grant). Any
// signed-in key may create one (it can't grant more than everyday access) and a key may revoke
// itself - never another. They show under Settings → Access → Displays, revocable there too.
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
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE kind = 'api'").first<{ n: number }>();
    if (Number(count?.n ?? 0) >= MAX_KEYS) return c.json({ error: 'This household has too many keys. Remove some under Settings → Access.' }, 429);
    const { id, key } = await createApiKey(c.env.DB, name, 'display');
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
    await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(me.id).run();
    emit(c, 'settings.changed', { keyId: me.id });
    return c.json({ ok: true }, 200);
  },
);
