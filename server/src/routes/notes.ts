// Notes threads on events and list items (migration 0024): short, color-coded messages from
// family members. Event notes hang off the Kinwall event id (the series row for a recurring local
// event); a thread goes when its target is deleted (routes/events.ts, routes/lists.ts).
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { ErrorSchema, NoteInputSchema, NotePatchSchema, NoteSchema, NoteTargetSchema } from '../schemas.ts';

export const notesRoutes = createRouter();

export type NoteRow = { id: string; target_type: 'event' | 'list_item'; target_id: string; member_id: string | null; body: string; created_at: string; updated_at: string };

export function toNoteApi(r: NoteRow) {
  return { id: r.id, targetType: r.target_type, targetId: r.target_id, memberId: r.member_id, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at };
}

function parseTarget(target: string): { type: NoteRow['target_type']; id: string } {
  const i = target.indexOf(':');
  return { type: target.slice(0, i) as NoteRow['target_type'], id: target.slice(i + 1) };
}

// A note changes what its target shows (the thread, its noteCount), so it rides the target's own bus event.
function emitFor(c: Context<{ Bindings: Env }>, type: NoteRow['target_type'], id: string, listId: string | null) {
  if (type === 'event') emit(c, 'events.changed', { eventId: id });
  else emit(c, 'list.item.changed', { listId, id });
}

const idParam = z.object({ id: z.string() });

notesRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/notes',
    tags: ['Notes'],
    summary: 'The notes thread on an event or list item, oldest first',
    security: [{ Bearer: [] }],
    request: { query: z.object({ target: NoteTargetSchema }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(NoteSchema) } } } },
  }),
  async (c) => {
    const { type, id } = parseTarget(c.req.valid('query').target);
    const { results } = await c.env.DB.prepare('SELECT * FROM notes WHERE target_type = ? AND target_id = ? ORDER BY created_at, rowid').bind(type, id).all<NoteRow>();
    return c.json(results.map(toNoteApi), 200);
  },
);

notesRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/notes',
    tags: ['Notes'],
    summary: 'Add a note to an event or list item. memberId = who posted (omit/null for "Someone").',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: NoteInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: NoteSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'target not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const { type, id } = parseTarget(body.target);
    const db = c.env.DB;
    const [targetRes, memberRes] = await db.batch<unknown>([
      type === 'event' ? db.prepare('SELECT NULL AS list_id FROM events WHERE id = ?').bind(id) : db.prepare('SELECT list_id FROM list_items WHERE id = ?').bind(id),
      db.prepare('SELECT id FROM members WHERE id = ?').bind(body.memberId ?? ''),
    ]);
    const target = (targetRes.results as { list_id: string | null }[])[0];
    if (!target) return c.json({ error: `${type === 'event' ? 'event' : 'list item'} not found` }, 404);
    if (body.memberId && memberRes.results.length === 0) return c.json({ error: 'member not found' }, 400);
    const now = new Date().toISOString();
    const row: NoteRow = { id: crypto.randomUUID(), target_type: type, target_id: id, member_id: body.memberId ?? null, body: body.body.trim(), created_at: now, updated_at: now };
    await db
      .prepare('INSERT INTO notes (id, target_type, target_id, member_id, body, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(row.id, row.target_type, row.target_id, row.member_id, row.body, row.created_at, row.updated_at)
      .run();
    emitFor(c, type, id, target.list_id);
    return c.json(toNoteApi(row), 201);
  },
);

// The note plus its list item's list (for the bus event), in one query.
function loadNote(c: Context<{ Bindings: Env }>, id: string) {
  return c.env.DB
    .prepare("SELECT n.*, li.list_id FROM notes n LEFT JOIN list_items li ON n.target_type = 'list_item' AND li.id = n.target_id WHERE n.id = ?")
    .bind(id)
    .first<NoteRow & { list_id: string | null }>();
}

notesRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/notes/{id}',
    tags: ['Notes'],
    summary: "Edit a note's text",
    security: [{ Bearer: [] }],
    request: { params: idParam, body: { content: { 'application/json': { schema: NotePatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: NoteSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const existing = await loadNote(c, id);
    if (!existing) return c.json({ error: 'not found' }, 404);
    const updated: NoteRow = { ...existing, body: c.req.valid('json').body.trim(), updated_at: new Date().toISOString() };
    await c.env.DB.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').bind(updated.body, updated.updated_at, id).run();
    emitFor(c, existing.target_type, existing.target_id, existing.list_id);
    return c.json(toNoteApi(updated), 200);
  },
);

notesRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/notes/{id}',
    tags: ['Notes'],
    summary: 'Delete a note',
    security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const existing = await loadNote(c, id);
    if (!existing) return c.json({ error: 'not found' }, 404);
    await c.env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();
    emitFor(c, existing.target_type, existing.target_id, existing.list_id);
    return c.json({ ok: true }, 200);
  },
);
