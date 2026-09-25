import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { getProvider } from '../providers/index.ts';
import { verifyAccount } from '../providers/caldav.ts';
import { FEED_URL_ERROR, isSafeFeedUrl } from '../outbound.ts';
import { revokeToken } from '../providers/google.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { providerEnv } from '../providers/config.ts';
import { errorMessage } from '../redact.ts';
import { AccountSchema, ErrorSchema } from '../schemas.ts';

export const accountsRoutes = createRouter();

type AccountRow = { id: string; kind: 'google' | 'microsoft' | 'caldav'; name: string; config: string; created_at: string };

function toApi(row: AccountRow) {
  return { id: row.id, kind: row.kind, name: row.name, createdAt: row.created_at };
}

accountsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/accounts',
    tags: ['Accounts'],
    summary: 'List connected provider accounts (config never returned)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(AccountSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, kind, name, created_at FROM accounts ORDER BY created_at').all<AccountRow>();
    return c.json(results.map(toApi), 200);
  },
);

accountsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/accounts/{id}',
    tags: ['Accounts'],
    summary: 'Disconnect a provider account (revokes the Google token best-effort, deletes it and its calendars)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const account = await c.env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
    if (!account) return c.json({ error: 'not found' }, 404);
    if (account.kind === 'google') {
      const config = await decryptConfig(c.env, account.id, account.config).catch(() => undefined);
      await revokeToken(config);
    }
    // calendars(account_id) and events(calendar_id) both cascade on delete (see migrations/0001_init.sql).
    await c.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
    emit(c, 'calendar.changed', { accountId: id });
    return c.json({ ok: true }, 200);
  },
);

const CaldavInputSchema = z
  .object({ name: z.string().min(1), serverUrl: z.string().url(), username: z.string().min(1), password: z.string().min(1) })
  .openapi('CaldavAccountInput');

accountsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/accounts/caldav',
    tags: ['Accounts'],
    summary: 'Connect a CalDAV account (iCloud / Fastmail / Nextcloud app-specific password)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: CaldavInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: AccountSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'server misconfigured', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'verification failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if (!isSafeFeedUrl(c.env, body.serverUrl)) return c.json({ error: FEED_URL_ERROR }, 400);
    let verified: { name: string; config: unknown };
    try {
      verified = await verifyAccount(c.env, body.serverUrl, body.username, body.password);
    } catch (err) {
      return c.json({ error: errorMessage(err, 'caldav verification failed') }, 502);
    }
    const id = crypto.randomUUID();
    let config: string;
    try {
      config = await encryptConfig(c.env, id, verified.config);
    } catch (err) {
      return c.json({ error: errorMessage(err, 'encryption not configured') }, 500);
    }
    const row: AccountRow = {
      id,
      kind: 'caldav',
      name: body.name || verified.name,
      config,
      created_at: new Date().toISOString(),
    };
    await c.env.DB.prepare('INSERT INTO accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)')
      .bind(row.id, row.kind, row.name, row.config, row.created_at)
      .run();
    emit(c, 'calendar.changed', { accountId: row.id });
    return c.json(toApi(row), 201);
  },
);

accountsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/accounts/{id}/remote-calendars',
    tags: ['Accounts'],
    summary: 'List calendars available on a connected provider account',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: 'ok',
        content: {
          'application/json': {
            schema: z.array(z.object({ remoteId: z.string(), name: z.string(), color: z.string().optional(), writable: z.boolean() })),
          },
        },
      },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'provider error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const account = await c.env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();
    if (!account) return c.json({ error: 'not found' }, 404);
    const provider = getProvider(account.kind as 'google' | 'microsoft' | 'caldav');
    if (!provider.listCalendars) return c.json({ error: 'provider does not support listing calendars' }, 502);
    try {
      const config = await decryptConfig(c.env, account.id, account.config);
      const calendars = await provider.listCalendars({
        env: await providerEnv(c.env, c.env.DB),
        account: { id: account.id, config },
        saveAccountConfig: async (nextConfig: unknown) => {
          const encrypted = await encryptConfig(c.env, account.id, nextConfig);
          await c.env.DB.prepare('UPDATE accounts SET config = ? WHERE id = ?').bind(encrypted, account.id).run();
        },
      });
      return c.json(calendars, 200);
    } catch (err) {
      return c.json({ error: errorMessage(err, 'provider error') }, 502);
    }
  },
);
