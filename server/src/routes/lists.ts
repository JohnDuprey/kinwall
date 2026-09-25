import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { hostTimezone } from '../env.ts';
import { emit } from '../bus.ts';
import { notifyListUpdate } from '../notify.ts';
import { parseMemberIds, resolveMemberIds } from '../calendar-members.ts';
import {
  ErrorSchema,
  ListDetailSchema,
  ListGroupSchema,
  ListGroupsInputSchema,
  ListInputSchema,
  ListItemInputBodySchema,
  ListItemPatchSchema,
  ListItemSchema,
  ListItemStepInputSchema,
  ListItemStepPatchSchema,
  ListItemStepReorderSchema,
  ListPatchSchema,
  ListReorderSchema,
  ListSchema,
} from '../schemas.ts';

export const listsRoutes = createRouter();

export type ListRow = {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  kind: 'todo' | 'shopping' | 'reusable';
  member_ids: string;
  group_by: 'store' | 'category' | 'none';
  sort_by: 'manual' | 'added' | 'due' | 'priority' | 'alpha';
  sort: number;
  archived: number;
  created_at: string;
};

export type ListItemRow = {
  id: string;
  list_id: string;
  title: string;
  notes: string | null;
  quantity: string | null;
  store: string | null;
  category: string | null;
  member_id: string | null;
  due_date: string | null;
  event_id: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  done: number;
  done_at: string | null;
  done_by: string | null;
  sort: number;
  created_at: string;
  updated_at: string;
};

export type ListItemStepRow = { id: string; item_id: string; title: string; done: number; done_at: string | null; sort: number; created_at: string };

export type ListGroupRow = { list_id: string; kind: 'store' | 'category'; name: string; sort: number };

export function toApi(row: ListRow, itemCount: number, openCount: number) {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    color: row.color,
    kind: row.kind,
    memberIds: parseMemberIds(row.member_ids),
    groupBy: row.group_by,
    sortBy: row.sort_by ?? 'manual',
    sort: row.sort,
    archived: !!row.archived,
    createdAt: row.created_at,
    itemCount,
    openCount,
  };
}

export function toItemApi(row: ListItemRow, steps: ListItemStepRow[] = []) {
  return {
    id: row.id,
    listId: row.list_id,
    title: row.title,
    notes: row.notes,
    quantity: row.quantity,
    store: row.store,
    category: row.category,
    memberId: row.member_id,
    dueDate: row.due_date,
    eventId: row.event_id,
    priority: row.priority,
    done: !!row.done,
    doneAt: row.done_at,
    doneBy: row.done_by,
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: steps.map((st) => ({ id: st.id, title: st.title, done: !!st.done, sort: st.sort })),
    stepsDone: steps.filter((st) => st.done).length,
    stepsTotal: steps.length,
  };
}

type Priority = ListItemRow['priority'];
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/** Same ranking in SQL, for queries that order items themselves (event items, the morning summary). */
export const priorityRankSql = (col = 'priority') => `CASE ${col} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END`;

type Orderable = { priority: Priority; done: boolean; dueDate: string | null; title: string; sort: number; createdAt: string };

/** The list's item order (see ListSortBySchema), so API consumers see the same order as the UI -
 * web/src/types.ts keeps a copy for the client. `today` (YYYY-MM-DD, household) decides overdue.
 * A done item gets no priority/overdue boost. */
export function compareItems(sortBy: ListRow['sort_by'], today: string) {
  const rank = (i: Orderable) => (i.done ? 2 : PRIORITY_RANK[i.priority] ?? 2);
  const overdue = (i: Orderable) => (!i.done && i.dueDate && i.dueDate < today ? 0 : 1);
  const due = (a: Orderable, b: Orderable) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'); // undated last
  const manual = (a: Orderable, b: Orderable) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt);
  return (a: Orderable, b: Orderable): number => {
    if (sortBy === 'added') return b.createdAt.localeCompare(a.createdAt) || b.sort - a.sort;
    if (sortBy === 'due') return due(a, b) || manual(a, b);
    if (sortBy === 'alpha') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || manual(a, b);
    return rank(a) - rank(b) || overdue(a) - overdue(b) || (sortBy === 'priority' ? due(a, b) : 0) || manual(a, b);
  };
}

export function todayIn(tz: string | null | undefined) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || hostTimezone() }).format(new Date());
}

/** Steps of the items matching `where` (a condition on list_items), grouped by item id, in order. */
export function stepsQuery(db: KinwallDb, where: string, ...binds: unknown[]) {
  return db.prepare(`SELECT * FROM list_item_steps WHERE item_id IN (SELECT id FROM list_items WHERE ${where}) ORDER BY sort, created_at`).bind(...binds);
}

export function groupSteps(rows: ListItemStepRow[]): Map<string, ListItemStepRow[]> {
  const out = new Map<string, ListItemStepRow[]>();
  for (const r of rows) out.set(r.item_id, [...(out.get(r.item_id) ?? []), r]);
  return out;
}

async function loadItem(db: KinwallDb, listId: string, itemId: string) {
  const [itemRes, stepsRes] = await db.batch<unknown>([
    db.prepare('SELECT * FROM list_items WHERE id = ? AND list_id = ?').bind(itemId, listId),
    stepsQuery(db, 'id = ?', itemId),
  ]);
  const row = (itemRes.results as ListItemRow[])[0];
  return row ? toItemApi(row, stepsRes.results as ListItemStepRow[]) : null;
}

// An item with steps is done exactly when every step is: flip it when a step change broke that
// (last open step ticked -> done; a step unticked or added on a done item -> open again).
function syncItemFromSteps(db: KinwallDb, itemId: string, now: string) {
  return db
    .prepare(
      `UPDATE list_items SET done = 1 - done, done_at = CASE WHEN done = 0 THEN ?1 ELSE NULL END, done_by = NULL, updated_at = ?1
       WHERE id = ?2 AND EXISTS (SELECT 1 FROM list_item_steps WHERE item_id = ?2)
         AND done = EXISTS (SELECT 1 FROM list_item_steps WHERE item_id = ?2 AND done = 0)`,
    )
    .bind(now, itemId);
}

export function toGroupApi(row: ListGroupRow) {
  return { kind: row.kind, name: row.name, sort: row.sort };
}

// Links are checked on write only (no FK - see migration 0018): unknown ids are rejected.
async function missingEventIds(db: KinwallDb, ids: (string | null | undefined)[]): Promise<boolean> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return false;
  const { results } = await db.prepare(`SELECT id FROM events WHERE id IN (${wanted.map(() => '?').join(',')})`).bind(...wanted).all<{ id: string }>();
  return results.length !== wanted.length;
}

// Notes on list items (routes/notes.ts): no FK, so every path that deletes items deletes their notes.
const ITEM_NOTES = "target_type = 'list_item' AND target_id";

// shopping defaults to grouping by category; todo/reusable default to no grouping.
function defaultGroupBy(kind: ListRow['kind']): ListRow['group_by'] {
  return kind === 'shopping' ? 'category' : 'none';
}

listsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/lists',
    tags: ['Lists'],
    summary: 'List lists (with computed item/open counts). Archived excluded unless archived=true.',
    security: [{ Bearer: [] }],
    request: { query: z.object({ archived: z.enum(['true', 'false']).optional() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ListSchema) } } } },
  }),
  async (c) => {
    const { archived } = c.req.valid('query');
    // Single round trip: counts computed via LEFT JOIN + GROUP BY rather than a per-list query.
    const { results } = await c.env.DB.prepare(
      `SELECT l.*, COUNT(li.id) AS item_count, COALESCE(SUM(CASE WHEN li.done = 0 THEN 1 ELSE 0 END), 0) AS open_count
       FROM lists l LEFT JOIN list_items li ON li.list_id = l.id
       WHERE (? = 1 OR l.archived = 0)
       GROUP BY l.id
       ORDER BY l.sort, l.created_at`,
    )
      .bind(archived === 'true' ? 1 : 0)
      .all<ListRow & { item_count: number; open_count: number }>();
    return c.json(results.map((row) => toApi(row, row.item_count, row.open_count)), 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists',
    tags: ['Lists'],
    summary: 'Create a list',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: ListInputSchema } } } },
    responses: { 201: { description: 'created', content: { 'application/json': { schema: ListSchema } } } },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const memberIds = await resolveMemberIds(c.env.DB, body.memberIds ?? []);
    const row: ListRow = {
      id: crypto.randomUUID(),
      name: body.name,
      emoji: body.emoji ?? null,
      color: body.color ?? null,
      kind: body.kind,
      member_ids: JSON.stringify(memberIds),
      group_by: body.groupBy ?? defaultGroupBy(body.kind),
      sort_by: body.sortBy ?? 'manual',
      sort: 0,
      archived: 0,
      created_at: new Date().toISOString(),
    };
    await c.env.DB.prepare(
      'INSERT INTO lists (id, name, emoji, color, kind, member_ids, group_by, sort_by, sort, archived, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.name, row.emoji, row.color, row.kind, row.member_ids, row.group_by, row.sort_by, row.sort, row.archived, row.created_at)
      .run();
    emit(c, 'list.changed', { id: row.id });
    return c.json(toApi(row, 0, 0), 201);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/lists/{id}',
    tags: ['Lists'],
    summary: 'List detail: the list, its items, its group ordering, and store/category suggestions (household-wide)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ListDetailSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    // One round trip: list + items + groups + both suggestion lists, all independent reads.
    const [listRes, itemsRes, groupsRes, stepsRes, storesRes, categoriesRes, tzRes, notesRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(id),
      c.env.DB.prepare('SELECT * FROM list_items WHERE list_id = ?').bind(id), // ordered below, by the list's sortBy
      c.env.DB.prepare('SELECT * FROM list_groups WHERE list_id = ? ORDER BY kind, sort').bind(id),
      stepsQuery(c.env.DB, 'list_id = ?', id),
      c.env.DB.prepare('SELECT DISTINCT store FROM list_items WHERE store IS NOT NULL ORDER BY store'),
      c.env.DB.prepare('SELECT DISTINCT category FROM list_items WHERE category IS NOT NULL ORDER BY category'),
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
      c.env.DB.prepare(`SELECT target_id, COUNT(*) AS n FROM notes WHERE ${ITEM_NOTES} IN (SELECT id FROM list_items WHERE list_id = ?) GROUP BY target_id`).bind(id),
    ]);
    const noteCounts = new Map((notesRes.results as { target_id: string; n: number }[]).map((r) => [r.target_id, r.n]));
    const list = (listRes.results as ListRow[])[0];
    if (!list) return c.json({ error: 'not found' }, 404);
    const items = itemsRes.results as unknown as ListItemRow[];
    const groups = groupsRes.results as unknown as ListGroupRow[];
    const steps = groupSteps(stepsRes.results as ListItemStepRow[]);
    const stores = (storesRes.results as { store: string }[]).map((r) => r.store);
    const categories = (categoriesRes.results as { category: string }[]).map((r) => r.category);
    const openCount = items.filter((i) => !i.done).length;
    return c.json(
      {
        list: toApi(list, items.length, openCount),
        items: items.map((i) => ({ ...toItemApi(i, steps.get(i.id)), noteCount: noteCounts.get(i.id) ?? 0 })).sort(compareItems(list.sort_by, todayIn((tzRes.results as { value: string }[])[0]?.value))),
        groups: groups.map(toGroupApi),
        suggestions: { stores, categories },
      },
      200,
    );
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/lists/{id}',
    tags: ['Lists'],
    summary: 'Update a list',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ListPatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ListSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(id).first<ListRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const memberIds = body.memberIds !== undefined ? await resolveMemberIds(c.env.DB, body.memberIds) : parseMemberIds(existing.member_ids);
    const updated: ListRow = {
      ...existing,
      name: body.name ?? existing.name,
      emoji: body.emoji !== undefined ? body.emoji : existing.emoji,
      color: body.color !== undefined ? body.color : existing.color,
      kind: body.kind ?? existing.kind,
      member_ids: JSON.stringify(memberIds),
      group_by: body.groupBy ?? existing.group_by,
      sort_by: body.sortBy ?? existing.sort_by,
      sort: body.sort ?? existing.sort,
      archived: body.archived !== undefined ? (body.archived ? 1 : 0) : existing.archived,
    };
    await c.env.DB.prepare('UPDATE lists SET name=?, emoji=?, color=?, kind=?, member_ids=?, group_by=?, sort_by=?, sort=?, archived=? WHERE id=?')
      .bind(updated.name, updated.emoji, updated.color, updated.kind, updated.member_ids, updated.group_by, updated.sort_by, updated.sort, updated.archived, id)
      .run();
    emit(c, 'list.changed', { id });
    const counts = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END), 0) AS open FROM list_items WHERE list_id = ?',
    )
      .bind(id)
      .first<{ n: number; open: number }>();
    return c.json(toApi(updated, counts?.n ?? 0, counts?.open ?? 0), 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/lists/{id}',
    tags: ['Lists'],
    summary: 'Delete a list (cascades items + groups)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await c.env.DB.prepare(`DELETE FROM notes WHERE ${ITEM_NOTES} IN (SELECT id FROM list_items WHERE list_id = ?)`).bind(id).run();
    const result = await c.env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'list.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/items',
    tags: ['Lists'],
    summary: 'Add one or more items to a list (always returns an array). "Remembers" store/category from the most recently updated item of the same title (any list) when they\'re omitted.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ListItemInputBodySchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: z.array(ListItemSchema) } } },
      400: { description: 'event not found', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const inputs = Array.isArray(body) ? body : [body];

    const list = await c.env.DB.prepare('SELECT id, name FROM lists WHERE id = ?').bind(id).first<{ id: string; name: string }>();
    if (!list) return c.json({ error: 'not found' }, 404);
    if (await missingEventIds(c.env.DB, inputs.map((i) => i.eventId))) return c.json({ error: 'event not found' }, 400);

    // memberId validated against members up front, like calendars' resolveMemberIds - unknown ids drop to null.
    const requestedMemberIds = [...new Set(inputs.map((i) => i.memberId).filter((v): v is string => !!v))];
    const validMemberIds = new Set(await resolveMemberIds(c.env.DB, requestedMemberIds));

    const maxSort = await c.env.DB.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM list_items WHERE list_id = ?').bind(id).first<{ m: number }>();
    let nextSort = (maxSort?.m ?? -1) + 1;

    const now = new Date().toISOString();
    const rows: ListItemRow[] = [];
    for (const input of inputs) {
      let store = input.store !== undefined ? input.store : null;
      let category = input.category !== undefined ? input.category : null;
      // "Remembers where things go": only when store and/or category is OMITTED (undefined) -
      // explicit null means "none" and must not be overwritten by memory.
      if (input.store === undefined || input.category === undefined) {
        const remembered = await c.env.DB.prepare(
          'SELECT store, category FROM list_items WHERE lower(trim(title)) = lower(trim(?)) ORDER BY updated_at DESC LIMIT 1',
        )
          .bind(input.title)
          .first<{ store: string | null; category: string | null }>();
        if (remembered) {
          if (input.store === undefined) store = remembered.store;
          if (input.category === undefined) category = remembered.category;
        }
      }
      rows.push({
        id: crypto.randomUUID(),
        list_id: id,
        title: input.title.trim(),
        notes: input.notes ?? null,
        quantity: input.quantity ?? null,
        store,
        category,
        member_id: input.memberId && validMemberIds.has(input.memberId) ? input.memberId : null,
        due_date: input.dueDate ?? null,
        event_id: input.eventId ?? null,
        priority: input.priority ?? 'normal',
        done: 0,
        done_at: null,
        done_by: null,
        sort: nextSort++,
        created_at: now,
        updated_at: now,
      });
    }

    const steps: ListItemStepRow[] = rows.flatMap((r, i) =>
      (inputs[i].steps ?? []).map((title, sort) => ({ id: crypto.randomUUID(), item_id: r.id, title: title.trim(), done: 0, done_at: null, sort, created_at: now })),
    );
    await c.env.DB.batch([
      ...rows.map((r) =>
        c.env.DB.prepare(
          'INSERT INTO list_items (id, list_id, title, notes, quantity, store, category, member_id, due_date, event_id, priority, done, done_at, done_by, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        ).bind(
          r.id,
          r.list_id,
          r.title,
          r.notes,
          r.quantity,
          r.store,
          r.category,
          r.member_id,
          r.due_date,
          r.event_id,
          r.priority,
          r.done,
          r.done_at,
          r.done_by,
          r.sort,
          r.created_at,
          r.updated_at,
        ),
      ),
      ...steps.map((st) =>
        c.env.DB.prepare('INSERT INTO list_item_steps (id, item_id, title, done, done_at, sort, created_at) VALUES (?,?,?,?,?,?,?)').bind(
          st.id, st.item_id, st.title, st.done, st.done_at, st.sort, st.created_at,
        ),
      ),
    ]);
    emit(c, 'list.item.changed', { listId: id, ids: rows.map((r) => r.id) });
    let execCtx: Parameters<typeof notifyListUpdate>[1];
    try {
      execCtx = c.executionCtx;
    } catch {
      execCtx = undefined; // Node: no ExecutionContext
    }
    notifyListUpdate(c.env, execCtx, id, list.name);
    const stepsByItem = groupSteps(steps);
    return c.json(rows.map((r) => toItemApi(r, stepsByItem.get(r.id))), 201);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/lists/{id}/items/{itemId}',
    tags: ['Lists'],
    summary: 'Update a list item. done:true sets doneAt/doneBy and ticks every step; done:false clears both and unticks every step. Always bumps updatedAt.',
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string(), itemId: z.string() }),
      body: { content: { 'application/json': { schema: ListItemPatchSchema } } },
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ListItemSchema } } },
      400: { description: 'event not found', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM list_items WHERE id = ? AND list_id = ?').bind(itemId, id).first<ListItemRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    if (await missingEventIds(c.env.DB, [body.eventId])) return c.json({ error: 'event not found' }, 400);

    let memberId = body.memberId !== undefined ? body.memberId : existing.member_id;
    if (body.memberId) {
      const resolved = await resolveMemberIds(c.env.DB, [body.memberId]);
      memberId = resolved[0] ?? null;
    }

    const now = new Date().toISOString();
    const done = body.done !== undefined ? body.done : !!existing.done;
    const updated: ListItemRow = {
      ...existing,
      title: body.title !== undefined ? body.title.trim() : existing.title,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      quantity: body.quantity !== undefined ? body.quantity : existing.quantity,
      store: body.store !== undefined ? body.store : existing.store,
      category: body.category !== undefined ? body.category : existing.category,
      member_id: memberId,
      due_date: body.dueDate !== undefined ? body.dueDate : existing.due_date,
      event_id: body.eventId !== undefined ? body.eventId : existing.event_id,
      priority: body.priority ?? existing.priority,
      done: done ? 1 : 0,
      done_at: body.done === undefined ? existing.done_at : done ? now : null,
      done_by: body.done === undefined ? existing.done_by : done ? (body.doneBy ?? null) : null,
      updated_at: now,
    };
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE list_items SET title=?, notes=?, quantity=?, store=?, category=?, member_id=?, due_date=?, event_id=?, priority=?, done=?, done_at=?, done_by=?, updated_at=? WHERE id=?',
      ).bind(
        updated.title,
        updated.notes,
        updated.quantity,
        updated.store,
        updated.category,
        updated.member_id,
        updated.due_date,
        updated.event_id,
        updated.priority,
        updated.done,
        updated.done_at,
        updated.done_by,
        updated.updated_at,
        itemId,
      ),
      // Ticking the item ticks every step (and unticking unticks them), keeping "done = all steps done".
      ...(body.done !== undefined
        ? [c.env.DB.prepare('UPDATE list_item_steps SET done = ?, done_at = ? WHERE item_id = ? AND done != ?').bind(updated.done, updated.done ? now : null, itemId, updated.done)]
        : []),
    ]);
    emit(c, 'list.item.changed', { listId: id, id: itemId, done: !!updated.done });
    return c.json((await loadItem(c.env.DB, id, itemId))!, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/lists/{id}/items/{itemId}',
    tags: ['Lists'],
    summary: 'Delete a list item',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string(), itemId: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    await c.env.DB.prepare(`DELETE FROM notes WHERE ${ITEM_NOTES} IN (SELECT id FROM list_items WHERE id = ? AND list_id = ?)`).bind(itemId, id).run();
    const result = await c.env.DB.prepare('DELETE FROM list_items WHERE id = ? AND list_id = ?').bind(itemId, id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'list.item.changed', { listId: id, id: itemId });
    return c.json({ ok: true }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/clear-completed',
    tags: ['Lists'],
    summary: 'Delete every done item in a list',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ deleted: z.number() }) } } } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    await c.env.DB.prepare(`DELETE FROM notes WHERE ${ITEM_NOTES} IN (SELECT id FROM list_items WHERE list_id = ? AND done = 1)`).bind(id).run();
    const result = await c.env.DB.prepare('DELETE FROM list_items WHERE list_id = ? AND done = 1').bind(id).run();
    emit(c, 'list.changed', { id });
    return c.json({ deleted: result.meta.changes }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/reset',
    tags: ['Lists'],
    summary: 'Uncheck every item (and every step) in a list (for reusable lists)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ reset: z.number() }) } } } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await c.env.DB.prepare('UPDATE list_items SET done = 0, done_at = NULL, done_by = NULL, updated_at = ? WHERE list_id = ? AND done = 1')
      .bind(new Date().toISOString(), id)
      .run();
    await c.env.DB.prepare('UPDATE list_item_steps SET done = 0, done_at = NULL WHERE done = 1 AND item_id IN (SELECT id FROM list_items WHERE list_id = ?)').bind(id).run();
    emit(c, 'list.changed', { id });
    return c.json({ reset: result.meta.changes }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/reorder',
    tags: ['Lists'],
    summary: 'Reorder items (sort = index in the given order)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ListReorderSchema } } } },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { itemIds } = c.req.valid('json');
    await c.env.DB.batch(
      itemIds.map((itemId, index) =>
        c.env.DB.prepare('UPDATE list_items SET sort = ? WHERE id = ? AND list_id = ?').bind(index, itemId, id),
      ),
    );
    emit(c, 'list.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/lists/{id}/groups',
    tags: ['Lists'],
    summary: 'Replace the store/category group ordering for a list (sort = index within kind)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ListGroupsInputSchema } } } },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ListGroupSchema) } } } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { groups } = c.req.valid('json');
    const counters: Record<string, number> = {};
    const rows: ListGroupRow[] = groups.map((g) => {
      const sort = counters[g.kind] ?? 0;
      counters[g.kind] = sort + 1;
      return { list_id: id, kind: g.kind, name: g.name, sort };
    });
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM list_groups WHERE list_id = ?').bind(id),
      ...rows.map((r) => c.env.DB.prepare('INSERT INTO list_groups (list_id, kind, name, sort) VALUES (?,?,?,?)').bind(r.list_id, r.kind, r.name, r.sort)),
    ]);
    emit(c, 'list.changed', { id });
    return c.json(rows.map(toGroupApi), 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/events/{id}/items',
    tags: ['Lists'],
    summary: 'List items linked to an event, across all lists (open first). Each carries its list name.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.array(ListItemSchema.extend({ listName: z.string() })) } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const [itemsRes, stepsRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare(`SELECT li.*, l.name AS list_name FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.event_id = ? ORDER BY li.done, ${priorityRankSql('li.priority')}, li.sort, li.created_at`).bind(id),
      stepsQuery(c.env.DB, 'event_id = ?', id),
    ]);
    const steps = groupSteps(stepsRes.results as ListItemStepRow[]);
    return c.json((itemsRes.results as (ListItemRow & { list_name: string })[]).map((r) => ({ ...toItemApi(r, steps.get(r.id)), listName: r.list_name })), 200);
  },
);

// Steps: every route answers with the whole updated item (steps, counts and - after an automatic
// complete/re-open - its done state), so a client never has to refetch to see the knock-on effect.
const stepParams = z.object({ id: z.string(), itemId: z.string() });
const stepResponses = {
  200: { description: 'the updated item', content: { 'application/json': { schema: ListItemSchema } } },
  404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
};

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/items/{itemId}/steps',
    tags: ['Lists'],
    summary: 'Add a step to the end of an item. A new (open) step re-opens a done item.',
    security: [{ Bearer: [] }],
    request: { params: stepParams, body: { content: { 'application/json': { schema: ListItemStepInputSchema } } } },
    responses: stepResponses,
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    const { title } = c.req.valid('json');
    const db = c.env.DB;
    const item = await db.prepare('SELECT id FROM list_items WHERE id = ? AND list_id = ?').bind(itemId, id).first();
    if (!item) return c.json({ error: 'not found' }, 404);
    const now = new Date().toISOString();
    await db.batch([
      db
        .prepare('INSERT INTO list_item_steps (id, item_id, title, done, done_at, sort, created_at) SELECT ?, ?, ?, 0, NULL, COALESCE(MAX(sort), -1) + 1, ? FROM list_item_steps WHERE item_id = ?')
        .bind(crypto.randomUUID(), itemId, title.trim(), now, itemId),
      syncItemFromSteps(db, itemId, now),
    ]);
    emit(c, 'list.item.changed', { listId: id, id: itemId });
    return c.json((await loadItem(db, id, itemId))!, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/lists/{id}/items/{itemId}/steps/{stepId}',
    tags: ['Lists'],
    summary: 'Edit a step (title, done, sort). Ticking the last open step completes the item; unticking a step on a done item re-opens it.',
    security: [{ Bearer: [] }],
    request: { params: stepParams.extend({ stepId: z.string() }), body: { content: { 'application/json': { schema: ListItemStepPatchSchema } } } },
    responses: stepResponses,
  }),
  async (c) => {
    const { id, itemId, stepId } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.env.DB;
    const step = await db
      .prepare('SELECT s.* FROM list_item_steps s JOIN list_items li ON li.id = s.item_id WHERE s.id = ? AND s.item_id = ? AND li.list_id = ?')
      .bind(stepId, itemId, id)
      .first<ListItemStepRow>();
    if (!step) return c.json({ error: 'not found' }, 404);
    const now = new Date().toISOString();
    const done = body.done !== undefined ? (body.done ? 1 : 0) : step.done;
    await db.batch([
      db
        .prepare('UPDATE list_item_steps SET title = ?, done = ?, done_at = ?, sort = ? WHERE id = ?')
        .bind(body.title !== undefined ? body.title.trim() : step.title, done, done === step.done ? step.done_at : done ? now : null, body.sort ?? step.sort, stepId),
      syncItemFromSteps(db, itemId, now),
    ]);
    const updated = (await loadItem(db, id, itemId))!;
    emit(c, 'list.item.changed', { listId: id, id: itemId, done: updated.done });
    return c.json(updated, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/lists/{id}/items/{itemId}/steps/{stepId}',
    tags: ['Lists'],
    summary: 'Delete a step. If every remaining step is done, the item is done.',
    security: [{ Bearer: [] }],
    request: { params: stepParams.extend({ stepId: z.string() }) },
    responses: stepResponses,
  }),
  async (c) => {
    const { id, itemId, stepId } = c.req.valid('param');
    const db = c.env.DB;
    const deleted = await db
      .prepare('DELETE FROM list_item_steps WHERE id = ? AND item_id IN (SELECT id FROM list_items WHERE id = ? AND list_id = ?)')
      .bind(stepId, itemId, id)
      .run();
    if (deleted.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    await syncItemFromSteps(db, itemId, new Date().toISOString()).run();
    emit(c, 'list.item.changed', { listId: id, id: itemId });
    return c.json((await loadItem(db, id, itemId))!, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/items/{itemId}/steps/reorder',
    tags: ['Lists'],
    summary: "Reorder an item's steps (sort = index in the given order)",
    security: [{ Bearer: [] }],
    request: { params: stepParams, body: { content: { 'application/json': { schema: ListItemStepReorderSchema } } } },
    responses: stepResponses,
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    const { stepIds } = c.req.valid('json');
    const db = c.env.DB;
    const item = await db.prepare('SELECT id FROM list_items WHERE id = ? AND list_id = ?').bind(itemId, id).first();
    if (!item) return c.json({ error: 'not found' }, 404);
    if (stepIds.length) await db.batch(stepIds.map((stepId, index) => db.prepare('UPDATE list_item_steps SET sort = ? WHERE id = ? AND item_id = ?').bind(index, stepId, itemId)));
    emit(c, 'list.item.changed', { listId: id, id: itemId });
    return c.json((await loadItem(db, id, itemId))!, 200);
  },
);
