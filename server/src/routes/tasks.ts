// To-do apps (Todoist, Google Tasks, Microsoft To Do) and the Kinwall to-do lists synced with them
// (tasks/sync.ts). Parent devices only, except reading the links: every screen shows a synced
// list's status (auth.ts DISPLAY_ALLOWED).
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import { waitUntil, type Env, type WaitCtx } from '../env.ts';
import { emit, publish } from '../bus.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { errorMessage, setupMessage } from '../redact.ts';
import { ErrorSchema } from '../schemas.ts';
import { requestLang, stored, translateStored } from '../i18n.ts';
import * as google from '../providers/google.ts';
import * as microsoft from '../providers/microsoft.ts';
import { providerEnv } from '../providers/config.ts';
import type { ProviderEnv } from '../providers/types.ts';
import { MS_TASKS_SCOPE, RateLimited, todoistUser, TokenRefused, type TaskAppKind } from '../tasks/apps.ts';
import { APP_NAME, syncAccountLinks, syncTaskLink, taskApp, type TaskAccountRow, type TaskLinkRow } from '../tasks/sync.ts';
import { taskAppAuthUrl } from './oauth.ts';

export const tasksRoutes = createRouter();

const AppSchema = z.enum(['todoist', 'google', 'microsoft']).openapi({ description: "'todoist': Todoist; 'google': Google Tasks; 'microsoft': Microsoft To Do" });

const TaskAccountSchema = z
  .object({
    id: z.string(),
    kind: AppSchema,
    name: z.string().openapi({ description: "The account's email (Todoist: its email or name)" }),
    createdAt: z.string(),
    alsoCalendar: z.boolean().openapi({ description: 'The same Google or Microsoft account is connected for calendars too: removing this one keeps that sign-in (Google is not asked to revoke it)' }),
  })
  .openapi('TaskAccount');

const TaskLinkSchema = z
  .object({
    listId: z.string(),
    accountId: z.string(),
    app: AppSchema,
    accountName: z.string(),
    remoteId: z.string().openapi({ description: 'The Todoist project, Google Tasks list or Microsoft To Do list id' }),
    remoteName: z.string(),
    lastSyncedAt: z.string().nullable(),
    lastError: z.string().nullable(),
    lastErrorCode: z.string().nullable().openapi({ description: "'revoked': the app turned down the token or sign-in; only connecting the account again fixes it. null otherwise." }),
    syncFailures: z.number().int().openapi({ description: 'Failed syncs in a row; 0 after a good one.' }),
    retryAfter: z.string().nullable().openapi({ description: 'The app asked Kinwall to slow down (HTTP 429): no sync before this time' }),
  })
  .openapi('TaskLink');

const RemoteListSchema = z.object({ remoteId: z.string(), name: z.string() }).openapi('TaskAppList');

function execCtxOf(c: Context): WaitCtx | undefined {
  try {
    return c.executionCtx;
  } catch {
    return undefined; // Node: no ExecutionContext
  }
}

const sameCalendarAccount = (c: Context<{ Bindings: Env }>, kind: TaskAppKind, name: string) =>
  kind === 'todoist' ? Promise.resolve(null) : c.env.DB.prepare('SELECT id FROM accounts WHERE kind = ? AND lower(name) = lower(?)').bind(kind, name).first<{ id: string }>();

async function accountApi(c: Context<{ Bindings: Env }>, row: TaskAccountRow) {
  return { id: row.id, kind: row.kind, name: row.name, createdAt: row.created_at, alsoCalendar: !!(await sameCalendarAccount(c, row.kind, row.name)) };
}

type LinkJoin = TaskLinkRow & { kind: TaskAppKind; account_name: string };
const LINKS = 'SELECT l.*, a.kind, a.name AS account_name FROM task_links l JOIN task_accounts a ON a.id = l.account_id';

function linkApi(row: LinkJoin, lang: Parameters<typeof translateStored>[0]) {
  return {
    listId: row.list_id,
    accountId: row.account_id,
    app: row.kind,
    accountName: row.account_name,
    remoteId: row.remote_id,
    remoteName: row.remote_name,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error && translateStored(lang, 'error', row.last_error), // stored in English
    lastErrorCode: row.last_error_code,
    syncFailures: row.sync_failures,
    retryAfter: row.retry_after,
  };
}

async function loadLink(c: Context<{ Bindings: Env }>, listId: string) {
  const row = await c.env.DB.prepare(`${LINKS} WHERE l.list_id = ?`).bind(listId).first<LinkJoin>();
  return row ? linkApi(row, await requestLang(c)) : null;
}

/** Saves a connected account; the same app and email again (connecting it again after a refused
 * token) replaces the credential in place, keeping its lists' links. */
async function saveTaskAccount(env: Env, kind: TaskAppKind, name: string, config: unknown): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM task_accounts WHERE kind = ? AND lower(name) = lower(?)').bind(kind, name).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const sealed = await encryptConfig(env, id, config); // the row id is the AAD
  if (existing) await env.DB.prepare('UPDATE task_accounts SET config = ? WHERE id = ?').bind(sealed, id).run();
  else await env.DB.prepare('INSERT INTO task_accounts (id, kind, name, config, created_at) VALUES (?,?,?,?,?)').bind(id, kind, name, sealed, new Date().toISOString()).run();
  return id;
}

/** routes/oauth.ts's callback for a 'tasks' sign-in: makes (or renews) the account and answers the
 * query Settings reads: taskAccount=<id>, or taskError=<kind>:<reason>. */
export async function finishTaskAppSignIn(
  c: Context<{ Bindings: Env }>,
  kind: 'google' | 'microsoft',
  p: { code?: string; error?: string; stored: { verifier: string } | null; redirectUri: string; penv: ProviderEnv },
): Promise<string> {
  const fail = (reason: string) => new URLSearchParams({ taskError: kind + ':' + reason }).toString();
  if (p.error) return fail(p.error === 'access_denied' || p.error === 'consent_required' ? 'canceled' : p.error);
  if (!p.code || !p.stored) return fail('invalid or expired state');
  let exchanged: { name: string; config: unknown };
  try {
    exchanged = kind === 'google'
      ? await google.exchangeCode(p.penv, p.code, p.redirectUri, p.stored.verifier)
      : await microsoft.exchangeCode(p.penv, p.code, p.redirectUri, p.stored.verifier, MS_TASKS_SCOPE);
  } catch (err) {
    return fail(errorMessage(err, 'sign-in failed'));
  }
  let id: string;
  try {
    id = await saveTaskAccount(c.env, kind, exchanged.name, exchanged.config);
  } catch (err) {
    return fail(setupMessage(err));
  }
  const ctx = execCtxOf(c);
  waitUntil(ctx, syncAccountLinks(c.env, id, ctx)); // connected again: its lists sync now
  return new URLSearchParams({ taskAccount: id }).toString();
}

tasksRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/tasks/accounts',
    tags: ['To-do apps'],
    summary: 'List connected to-do app accounts (Todoist, Google Tasks, Microsoft To Do). Credentials are never returned.',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(TaskAccountSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM task_accounts ORDER BY created_at').all<TaskAccountRow>();
    return c.json(await Promise.all(results.map((r) => accountApi(c, r))), 200);
  },
);

tasksRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/tasks/accounts/todoist',
    tags: ['To-do apps'],
    summary: "Connect Todoist with a personal API token (Todoist → Settings → Integrations → Developer). Kinwall checks it with Todoist, then keeps it encrypted with the family's key.",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: z.object({ token: z.string().trim().min(8).max(200) }).openapi('TodoistAccountInput') } } } },
    responses: {
      201: { description: 'connected (or its token replaced, when the same Todoist account was connected already)', content: { 'application/json': { schema: TaskAccountSchema } } },
      400: { description: "Todoist didn't accept the token", content: { 'application/json': { schema: ErrorSchema } } },
      500: { description: 'server misconfigured', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: "Todoist couldn't be reached", content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { token } = c.req.valid('json');
    let name: string;
    try {
      name = (await todoistUser(token)).name;
    } catch (err) {
      if (err instanceof TokenRefused) return c.json({ error: "Todoist didn't accept that token. Copy it again from Todoist's settings." }, 400);
      if (err instanceof RateLimited) return c.json({ error: 'Todoist asked Kinwall to slow down. Try again in a minute.' }, 502);
      return c.json({ error: "Kinwall couldn't reach Todoist. Try again in a minute." }, 502);
    }
    let id: string;
    try {
      id = await saveTaskAccount(c.env, 'todoist', name, { token });
    } catch (err) {
      return c.json({ error: setupMessage(err) }, 500);
    }
    const ctx = execCtxOf(c);
    waitUntil(ctx, syncAccountLinks(c.env, id, ctx));
    const row = (await c.env.DB.prepare('SELECT * FROM task_accounts WHERE id = ?').bind(id).first<TaskAccountRow>())!;
    return c.json(await accountApi(c, row), 201);
  },
);

tasksRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/tasks/accounts/{kind}/start',
    tags: ['To-do apps'],
    summary: "Start connecting Google Tasks or Microsoft To Do: returns the consent URL, asking for the tasks permission only (incremental: a calendar account's permissions aren't touched), and sets a short-lived cookie. Open it in the browser that made this call; it comes back to Settings with ?taskAccount=<id> or ?taskError=<kind>:<reason>.",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ kind: z.enum(['google', 'microsoft']) }),
      body: { content: { 'application/json': { schema: z.object({ loginHint: z.string().email().optional().openapi({ description: 'The account to suggest, e.g. the calendar account to add tasks to' }) }).openapi('TaskAppStart') } }, required: false },
    },
    responses: {
      200: { description: 'the consent URL', content: { 'application/json': { schema: z.object({ url: z.string() }) } } },
      400: { description: 'the sign-in is not set up on this server', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { kind } = c.req.valid('param');
    const body = await c.req.json().catch(() => ({}));
    const loginHint = typeof body?.loginHint === 'string' && body.loginHint.includes('@') ? body.loginHint : undefined;
    const penv = await providerEnv(c.env, c.env.DB);
    const ready = kind === 'google' ? penv.GOOGLE_CLIENT_ID && penv.GOOGLE_CLIENT_SECRET : penv.MS_CLIENT_ID && penv.MS_CLIENT_SECRET;
    if (!ready) return c.json({ error: kind === 'google' ? 'Set up the Google sign-in first, under Calendar providers.' : 'Set up the Microsoft sign-in first, under Calendar providers.' }, 400);
    return c.json({ url: await taskAppAuthUrl(c, kind, loginHint) }, 200);
  },
);

tasksRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/tasks/accounts/{id}',
    tags: ['To-do apps'],
    summary: "Remove a to-do app account: its stored credential and every list link go; items stay on both sides. Google is asked to revoke the sign-in unless the same Google account syncs calendars (revoking would end that too). Todoist tokens are reset in Todoist; Microsoft access is removed in the Microsoft account's app permissions.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await c.env.DB.prepare('SELECT * FROM task_accounts WHERE id = ?').bind(id).first<TaskAccountRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.kind === 'google' && !(await sameCalendarAccount(c, row.kind, row.name))) {
      await google.revokeToken(await decryptConfig(c.env, row.id, row.config).catch(() => undefined));
    }
    const { results } = await c.env.DB.prepare('SELECT list_id FROM task_links WHERE account_id = ?').bind(id).all<{ list_id: string }>();
    await c.env.DB.prepare('DELETE FROM task_accounts WHERE id = ?').bind(id).run(); // links and their items cascade
    for (const l of results) emit(c, 'list.changed', { id: l.list_id });
    return c.json({ ok: true }, 200);
  },
);

tasksRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/tasks/accounts/{id}/lists',
    tags: ['To-do apps'],
    summary: "The account's lists in its app (Todoist projects, Google Tasks lists, Microsoft To Do lists), to pick one to sync with",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.array(RemoteListSchema) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'the app refused or failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const row = await c.env.DB.prepare('SELECT * FROM task_accounts WHERE id = ?').bind(id).first<TaskAccountRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    try {
      return c.json(await (await taskApp(c.env, row)).lists(), 200);
    } catch (err) {
      return c.json({ error: appError(err, row) }, 502);
    }
  },
);

function appError(err: unknown, row: TaskAccountRow): string {
  if (err instanceof TokenRefused || (err instanceof Error && err.name === 'SignInRevoked')) return stored('error', "{app} turned down Kinwall's sign-in. Connect {account} again.", { app: APP_NAME[row.kind], account: row.name });
  if (err instanceof RateLimited) return stored('error', '{app} asked Kinwall to slow down. Try again in a minute.', { app: APP_NAME[row.kind] });
  return errorMessage(err, 'the app could not be reached');
}

tasksRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/tasks/links',
    tags: ['To-do apps'],
    summary: 'Every to-do list synced with a to-do app, with its sync status',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(TaskLinkSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare(LINKS).all<LinkJoin>();
    const lang = await requestLang(c);
    return c.json(results.map((r) => linkApi(r, lang)), 200);
  },
);

tasksRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/tasks/links/{listId}',
    tags: ['To-do apps'],
    summary: "Sync a to-do list with one list in a to-do app (replacing the list's link, if it had one), then sync it now. Give remoteId to use an existing list there, or newListName to make one. The first sync pairs items with exactly the same title and copies the rest across (open ones only).",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ listId: z.string() }),
      body: { content: { 'application/json': { schema: z.object({ accountId: z.string(), remoteId: z.string().min(1).optional(), newListName: z.string().trim().min(1).max(120).optional() }).openapi('TaskLinkInput') } } },
    },
    responses: {
      200: { description: 'linked (the sync result is in lastError / lastSyncedAt)', content: { 'application/json': { schema: TaskLinkSchema } } },
      400: { description: 'not a to-do list, or neither remoteId nor newListName', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'list, account or remote list not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'that remote list already syncs with another Kinwall list', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'the app refused or failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { listId } = c.req.valid('param');
    const body = c.req.valid('json');
    const list = await c.env.DB.prepare('SELECT kind FROM lists WHERE id = ?').bind(listId).first<{ kind: string }>();
    if (!list) return c.json({ error: 'list not found' }, 404);
    if (list.kind !== 'todo') return c.json({ error: 'Only to-do lists sync with to-do apps.' }, 400);
    if (!body.remoteId && !body.newListName) return c.json({ error: 'Pick a list, or name a new one.' }, 400);
    const account = await c.env.DB.prepare('SELECT * FROM task_accounts WHERE id = ?').bind(body.accountId).first<TaskAccountRow>();
    if (!account) return c.json({ error: 'account not found' }, 404);
    if (body.remoteId) {
      const taken = await c.env.DB.prepare('SELECT 1 AS x FROM task_links WHERE account_id = ? AND remote_id = ? AND list_id != ?').bind(account.id, body.remoteId, listId).first();
      if (taken) return c.json({ error: 'That list already syncs with another Kinwall list.' }, 409);
    }
    let remote: { remoteId: string; name: string } | undefined;
    try {
      const app = await taskApp(c.env, account);
      remote = body.remoteId ? (await app.lists()).find((l) => l.remoteId === body.remoteId) : await app.createList(body.newListName!);
    } catch (err) {
      return c.json({ error: appError(err, account) }, 502);
    }
    if (!remote) return c.json({ error: 'That list is gone from the app. Pick another.' }, 404);
    // A new link starts over: the old one's item pairs go with it (cascade).
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM task_links WHERE list_id = ?').bind(listId),
      c.env.DB.prepare('INSERT INTO task_links (list_id, account_id, remote_id, remote_name, created_at) VALUES (?,?,?,?,?)').bind(listId, account.id, remote.remoteId, remote.name, new Date().toISOString()),
    ]);
    await syncTaskLink(c.env, listId, execCtxOf(c));
    publish(c.env, execCtxOf(c), 'list.changed', { id: listId }); // screens show the link; not emit(), which would queue another sync
    return c.json((await loadLink(c, listId))!, 200);
  },
);

tasksRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/tasks/links/{listId}',
    tags: ['To-do apps'],
    summary: 'Stop syncing a to-do list. Its items stay in Kinwall and in the app.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ listId: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not synced', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { listId } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM task_links WHERE list_id = ?').bind(listId).run();
    if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
    emit(c, 'list.changed', { id: listId });
    return c.json({ ok: true }, 200);
  },
);

tasksRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/tasks/links/{listId}/sync',
    tags: ['To-do apps'],
    summary: "Sync a list with its to-do app now (not while the app's asked Kinwall to wait: see retryAfter)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ listId: z.string() }) },
    responses: {
      200: { description: 'synced, or the failure is in lastError', content: { 'application/json': { schema: TaskLinkSchema } } },
      404: { description: 'not synced', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { listId } = c.req.valid('param');
    if (!(await loadLink(c, listId))) return c.json({ error: 'not found' }, 404);
    await syncTaskLink(c.env, listId, execCtxOf(c));
    return c.json((await loadLink(c, listId))!, 200);
  },
);
