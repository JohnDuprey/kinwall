import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { stored } from '../i18n.ts';
import { ErrorSchema } from '../schemas.ts';
import type { Env } from '../env.ts';
import { readFeatures } from './settings.ts';
import { InboxInputSchema, InboxItemSchema, InboxPatchSchema, InboxSchema, InboxSortSchema, inboxApi, readInbox, type InboxItem, type InboxRow } from '../inbox.ts';
import { createEvent } from './events.ts';
import { createAnnouncement } from './announcements.ts';

type Target = NonNullable<InboxItem['target']>;

type App = OpenAPIHono<{ Bindings: Env }>;
const json = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const errors = {
  403: { description: 'Parents only', ...json(ErrorSchema) },
  404: { description: 'Not found, or the inbox is turned off', ...json(ErrorSchema) },
};
const ID = z.object({ id: z.string() });

/** The quick-capture inbox. Parents only: a wall screen or kid's device key isn't in auth.ts's
 * display allow-list. Sorting makes a task through POST /api/lists/{id}/items with the caller's key,
 * and an event or note through the same code as POST /api/events and /api/announcements (createEvent,
 * createAnnouncement), so each keeps its own rules, calendar write-through and notifications.
 *
 * Each is made with the thought's own id (a synced calendar's event excepted), so a sort interrupted
 * after it was made can find it: the sort itself on the way out, or putting the thought back later,
 * links it instead of making a second one. */
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
  /** Where a sorted thought went: the task, event or note with this id, if it's there. */
  const madeAt = async (db: Env['DB'], kind: Target['kind'], id: string): Promise<Target | null> => {
    if (kind === 'task') {
      const row = await db.prepare('SELECT i.list_id, l.name FROM list_items i LEFT JOIN lists l ON l.id = i.list_id WHERE i.id = ?').bind(id).first<{ list_id: string; name: string | null }>();
      return row && { kind, id, listId: row.list_id, label: row.name ?? '' };
    }
    if (kind === 'event') {
      const row = await db.prepare('SELECT start FROM events WHERE id = ?').bind(id).first<{ start: string }>();
      return row && { kind, id, at: row.start };
    }
    return (await db.prepare('SELECT id FROM announcements WHERE id = ?').bind(id).first()) && { kind, id };
  };
  const unlinked = "status = 'sorted' AND target->>'id' IS NULL";

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
    const item = await load(c.env.DB, id);
    if (!item) return c.json({ error: 'That isn’t in the inbox.' }, 404);
    const now = new Date().toISOString();
    // An interrupted sort: what it made, if anything, is linked rather than made again.
    const made = status === 'open' && item.status === 'sorted' && item.target && !item.target.id ? await madeAt(c.env.DB, item.target.kind, id) : null;
    // ponytail: a sort still saving can't be put back for 5 minutes (longer than a request runs); a synced
    // calendar that takes longer could get the event twice.
    const saving = new Date(Date.now() - 5 * 60_000).toISOString();
    // Put back: a cleared thought, or one whose saving was interrupted (sorted with nothing made).
    const res = made ? await c.env.DB.prepare(`UPDATE inbox_items SET target = ?, updated_at = ? WHERE id = ? AND ${unlinked}`).bind(JSON.stringify(made), now, id).run()
      : status === 'cleared'
      ? await c.env.DB.prepare("UPDATE inbox_items SET status = 'cleared', done_at = ?, updated_at = ? WHERE id = ? AND status = 'open'").bind(now, now, id).run()
      : await c.env.DB.prepare(`UPDATE inbox_items SET status = 'open', target = NULL, done_at = NULL, updated_at = ? WHERE id = ? AND (status = 'cleared' OR (${unlinked} AND updated_at < ?))`).bind(now, id, saving).run();
    if (!res.meta.changes) {
      return c.json({ error: status === 'cleared' ? 'That’s already been sorted.' : item.status === 'sorted' && !item.target?.id ? 'That’s still being saved. Try again in a few minutes.' : 'That’s already in the inbox, or it went somewhere.' }, 409);
    }
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
    // linked leaves it sorted with no target: still listed, and PATCH status=open links what was made
    // or puts it back. `mine`: only while this claim stands, so a sort that outlived a put back and a
    // newer sort changes nothing.
    const claim = await c.env.DB.prepare("UPDATE inbox_items SET status = 'sorted', target = ?, done_at = ?, updated_at = ? WHERE id = ? AND status = 'open'")
      .bind(JSON.stringify({ kind: input.kind, id: null }), now, now, id).run();
    if (!claim.meta.changes) return c.json({ error: 'That’s already been sorted.' }, 409);
    const mine = `id = ? AND ${unlinked} AND updated_at = ?`;
    const link = (target: Target) => c.env.DB.prepare(`UPDATE inbox_items SET target = ?, updated_at = ? WHERE ${mine}`).bind(JSON.stringify(target), new Date().toISOString(), id, now).run();
    /** Not made: back in the inbox. Made after all (an earlier sort's, or this one's before it failed): linked. */
    const release = async () => {
      const made = await madeAt(c.env.DB, input.kind, id);
      await (made ? link(made) : c.env.DB.prepare(`UPDATE inbox_items SET status = 'open', target = NULL, done_at = NULL, updated_at = ? WHERE ${mine}`).bind(new Date().toISOString(), id, now).run());
      return !!made;
    };

    try {
      let made: { id: string } | { error: string; status: number };
      if (input.kind === 'task') {
        const res = await app.request(`/api/lists/${encodeURIComponent(input.listId)}/items`, {
          method: 'POST', body: JSON.stringify([{ id, title: input.title, dueDate: input.dueDate ?? null }]),
          headers: { Authorization: c.req.header('Authorization') ?? '', 'Accept-Language': c.req.header('Accept-Language') ?? '', 'Content-Type': 'application/json', 'X-Kinwall-Source': c.req.header('X-Kinwall-Source') ?? 'inbox' },
        }, c.env);
        const body = await res.json().catch(() => ({})) as { error?: string } & { id: string }[];
        made = res.status >= 400 ? { error: body.error ?? stored('error', 'That couldn’t be saved.'), status: res.status } : body[0];
      } else if (input.kind === 'event') {
        const created = await createEvent(c, input.event, id);
        made = 'error' in created ? created : created.row;
      } else {
        made = !(await readFeatures(c.env.DB)).announcements ? { error: 'Announcements are turned off in Settings → General → Features.', status: 404 }
          : await createAnnouncement(c, { title: input.title, details: input.details, startsAt: now, expiresAt: input.expiresAt, priority: 'normal' }, id).then(a => 'error' in a ? { ...a, status: 400 } : a);
      }
      if ('error' in made) {
        if (!(await release())) return c.json({ error: made.error }, (made.status === 403 || made.status === 404 || made.status === 502 ? made.status : 400) as 400 | 403 | 404 | 502);
      } else await link((await madeAt(c.env.DB, input.kind, made.id)) ?? { kind: input.kind, id: made.id });
    } catch (e) {
      await release().catch(() => {}); // the database may still be down: putting it back later links it
      throw e;
    }
    emit(c, 'inbox.changed', { id });
    return c.json((await load(c.env.DB, id))!, 200);
  });
  return r;
}
