import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { stored } from '../i18n.ts';
import { ErrorSchema } from '../schemas.ts';
import type { Env } from '../env.ts';
import { readFeatures } from './settings.ts';
import { InboxInputSchema, InboxItemSchema, InboxPatchSchema, InboxSchema, InboxSortSchema, inboxApi, readInbox, type InboxItem, type InboxRow } from '../inbox.ts';

type App = OpenAPIHono<{ Bindings: Env }>;
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  403: { description: 'Parents only', ...json(ErrorSchema) },
  404: { description: 'Not found, or the inbox is turned off', ...json(ErrorSchema) },
};
const ID = z.object({ id: z.string() });

/** The quick-capture inbox. Parents only: a wall screen or kid's device key isn't in auth.ts's
 * display allow-list. Sorting re-enters the family's own routes (POST /api/lists/{id}/items,
 * /api/events, /api/announcements) with the caller's key, so each keeps its own rules, calendar
 * write-through and notifications. */
export function inboxRoutes(app: App) {
  const r = createRouter();
  r.use('/api/inbox*', async (c, next) => {
    if (!(await readFeatures(c.env.DB)).inbox) return c.json({ error: 'The inbox is turned off in Settings → General → Features.' }, 404);
    await next();
  });
  const load = async (db: Env['DB'], id: string) => {
    const row = await db.prepare('SELECT * FROM inbox_items WHERE id = ?').bind(id).first<InboxRow>();
    return row ? inboxApi(row) : null;
  };

  r.openapi(createRoute({
    method: 'get', path: '/api/inbox', tags: ['Inbox'], summary: 'Every open thought in the inbox, newest first, then the 20 most recently sorted or cleared (parents)', security: [{ Bearer: [] }],
    responses: { 200: { description: 'The inbox', ...json(InboxSchema) }, ...errors },
  }), async c => c.json(await readInbox(c.env.DB), 200));

  r.openapi(createRoute({
    method: 'post', path: '/api/inbox', tags: ['Inbox'], summary: 'Jot a thought down (parents). With a client-made id, a retry adds it once.', security: [{ Bearer: [] }],
    request: { body: json(InboxInputSchema) }, responses: { 201: { description: 'Saved', ...json(InboxItemSchema) }, 400: { description: 'Empty or too long', ...json(ErrorSchema) }, ...errors },
  }), async c => {
    const { id = crypto.randomUUID(), text } = c.req.valid('json');
    const now = new Date().toISOString();
    await c.env.DB.prepare('INSERT INTO inbox_items (id, text, status, created_at, updated_at) VALUES (?, ?, \'open\', ?, ?) ON CONFLICT(id) DO NOTHING').bind(id, text, now, now).run();
    emit(c, 'inbox.changed', { id });
    return c.json((await load(c.env.DB, id))!, 201);
  });

  r.openapi(createRoute({
    method: 'patch', path: '/api/inbox/{id}', tags: ['Inbox'], summary: 'Clear a thought that isn\'t needed, or put a cleared one back (parents). Nothing is deleted.', security: [{ Bearer: [] }],
    request: { params: ID, body: json(InboxPatchSchema) }, responses: { 200: { description: 'Updated', ...json(InboxItemSchema) }, 409: { description: 'Not in a state that can change that way', ...json(ErrorSchema) }, ...errors },
  }), async c => {
    const { id } = c.req.valid('param'), { status } = c.req.valid('json');
    if (!(await load(c.env.DB, id))) return c.json({ error: 'That isn’t in the inbox.' }, 404);
    const now = new Date().toISOString();
    // Put back: a cleared thought, or one whose saving was interrupted (sorted with nothing made).
    const res = status === 'cleared'
      ? await c.env.DB.prepare("UPDATE inbox_items SET status = 'cleared', done_at = ?, updated_at = ? WHERE id = ? AND status = 'open'").bind(now, now, id).run()
      : await c.env.DB.prepare("UPDATE inbox_items SET status = 'open', target = NULL, done_at = NULL, updated_at = ? WHERE id = ? AND (status = 'cleared' OR (status = 'sorted' AND target->>'id' IS NULL))").bind(now, id).run();
    if (!res.meta.changes) return c.json({ error: status === 'cleared' ? 'That’s already been sorted.' : 'That’s already in the inbox, or it went somewhere.' }, 409);
    emit(c, 'inbox.changed', { id });
    return c.json((await load(c.env.DB, id))!, 200);
  });

  r.openapi(createRoute({
    method: 'post', path: '/api/inbox/{id}/sort', tags: ['Inbox'],
    summary: 'Make an open thought into a task on a list, an event or a note on the family board (parents). It leaves the inbox only once that was made; a second call makes nothing (409).',
    security: [{ Bearer: [] }],
    request: { params: ID, body: json(InboxSortSchema) },
    responses: {
      200: { description: 'Sorted, with where it went', ...json(InboxItemSchema) },
      400: { description: 'The task, event or note was refused', ...json(ErrorSchema) },
      409: { description: 'Already sorted or cleared', ...json(ErrorSchema) },
      502: { description: 'A synced calendar refused the event', ...json(ErrorSchema) },
      ...errors,
    },
  }), async c => {
    const { id } = c.req.valid('param'), input = c.req.valid('json');
    const item = await load(c.env.DB, id);
    if (!item) return c.json({ error: 'That isn’t in the inbox.' }, 404);
    const now = new Date().toISOString();
    // Claim it first, in one statement, so two taps or two devices make it once. A crash before it's
    // made leaves it sorted with no target: still listed, and PATCH status=open puts it back.
    const claim = await c.env.DB.prepare("UPDATE inbox_items SET status = 'sorted', target = ?, done_at = ?, updated_at = ? WHERE id = ? AND status = 'open'")
      .bind(JSON.stringify({ kind: input.kind, id: null }), now, now, id).run();
    if (!claim.meta.changes) return c.json({ error: 'That’s already been sorted.' }, 409);
    const release = () => c.env.DB.prepare("UPDATE inbox_items SET status = 'open', target = NULL, done_at = NULL, updated_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();

    const send = (path: string, body: unknown) => app.request(path, {
      method: 'POST', body: JSON.stringify(body),
      headers: { Authorization: c.req.header('Authorization') ?? '', 'Accept-Language': c.req.header('Accept-Language') ?? '', 'Content-Type': 'application/json', 'X-Kinwall-Source': c.req.header('X-Kinwall-Source') ?? 'inbox' },
    }, c.env);
    let res: Response;
    try {
      res = input.kind === 'task' ? await send(`/api/lists/${encodeURIComponent(input.listId)}/items`, [{ id: item.id, title: input.title, dueDate: input.dueDate ?? null }]) // the thought's id: a retry after a crash adds it once
        : input.kind === 'event' ? await send('/api/events', input.event)
        : await send('/api/announcements', { title: input.title, details: input.details, startsAt: now, expiresAt: input.expiresAt, priority: 'normal' });
    } catch (e) {
      await release();
      throw e;
    }
    const body = await res.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
    if (res.status >= 400) {
      await release();
      return c.json({ error: body.error ?? stored('error', 'That couldn’t be saved.') }, (res.status === 403 || res.status === 404 || res.status === 502 ? res.status : 400) as 400 | 403 | 404 | 502);
    }
    const made = (Array.isArray(body) ? body[0] : body) as { id: string; start?: string };
    const list = input.kind === 'task' ? await c.env.DB.prepare('SELECT name FROM lists WHERE id = ?').bind(input.listId).first<{ name: string }>() : null;
    const target: NonNullable<InboxItem['target']> = input.kind === 'task' ? { kind: 'task', id: made.id, listId: input.listId, label: list?.name ?? '' }
      : input.kind === 'event' ? { kind: 'event', id: made.id, at: made.start }
      : { kind: 'note', id: made.id };
    await c.env.DB.prepare('UPDATE inbox_items SET target = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(target), new Date().toISOString(), id).run();
    emit(c, 'inbox.changed', { id });
    return c.json((await load(c.env.DB, id))!, 200);
  });
  return r;
}
