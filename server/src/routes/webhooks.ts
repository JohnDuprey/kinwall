import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { encrypt } from '../crypto.ts';
import { errorMessage } from '../redact.ts';
import { ErrorSchema, WebhookInputSchema, WebhookSchema } from '../schemas.ts';

export const webhooksRoutes = createRouter();

type WebhookRow = { id: string; url: string; events: string; secret: string; enabled: number; created_at: string };

function toApi(row: WebhookRow) {
  let events: string[] = [];
  try {
    events = JSON.parse(row.events);
  } catch {
    events = [];
  }
  return { id: row.id, url: row.url, events, enabled: !!row.enabled, createdAt: row.created_at };
}

webhooksRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/webhooks',
    tags: ['Webhooks'],
    summary: 'List webhooks (secret never returned)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(WebhookSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM webhooks ORDER BY created_at').all<WebhookRow>();
    return c.json(results.map(toApi), 200);
  },
);

webhooksRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/webhooks',
    tags: ['Webhooks'],
    summary: 'Create a webhook (HMAC-signed)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: WebhookInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: WebhookSchema } } },
      500: { description: 'server misconfigured', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const id = crypto.randomUUID();
    const plainSecret = body.secret ?? crypto.randomUUID();
    let secret: string;
    try {
      secret = await encrypt(c.env, plainSecret, id);
    } catch (err) {
      return c.json({ error: errorMessage(err, 'encryption not configured') }, 500);
    }
    const row: WebhookRow = {
      id,
      url: body.url,
      events: JSON.stringify(body.events),
      secret,
      enabled: body.enabled === false ? 0 : 1,
      created_at: new Date().toISOString(),
    };
    await c.env.DB.prepare('INSERT INTO webhooks (id, url, events, secret, enabled, created_at) VALUES (?,?,?,?,?,?)')
      .bind(row.id, row.url, row.events, row.secret, row.enabled, row.created_at)
      .run();
    return c.json(toApi(row), 201);
  },
);

webhooksRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/webhooks/{id}',
    tags: ['Webhooks'],
    summary: 'Update a webhook',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: WebhookInputSchema.partial() } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: WebhookSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'server misconfigured', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM webhooks WHERE id = ?').bind(id).first<WebhookRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    let secret = existing.secret;
    if (body.secret !== undefined) {
      try {
        secret = await encrypt(c.env, body.secret, id);
      } catch (err) {
        return c.json({ error: errorMessage(err, 'encryption not configured') }, 500);
      }
    }
    const updated: WebhookRow = {
      ...existing,
      url: body.url ?? existing.url,
      events: body.events !== undefined ? JSON.stringify(body.events) : existing.events,
      secret,
      enabled: body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
    };
    await c.env.DB.prepare('UPDATE webhooks SET url=?, events=?, secret=?, enabled=? WHERE id=?')
      .bind(updated.url, updated.events, updated.secret, updated.enabled, id)
      .run();
    return c.json(toApi(updated), 200);
  },
);

webhooksRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/webhooks/{id}',
    tags: ['Webhooks'],
    summary: 'Delete a webhook',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await c.env.DB.prepare('DELETE FROM webhooks WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true }, 200);
  },
);
