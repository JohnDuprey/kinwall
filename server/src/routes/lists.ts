import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { hostTimezone } from '../env.ts';
import { emit } from '../bus.ts';
import { notifyListUpdate } from '../notify.ts';
import { parseMemberIds, resolveMemberIds } from '../calendar-members.ts';
import { actorOf, deviceOwner, eventWriteBlock, ownerBlock, requestKey, type Actor } from '../auth.ts';
import type { Context } from 'hono';
import { SUGGESTION_CAP, catalog, catalogWrites, filterCatalog, fillPlace, itemKey, listCatalog, nameSuggestions, recall, rememberName, rememberPlace, tagsInput, type Catalog, type CatalogEdit, type CatalogItem } from '../item-memory.ts';
import {
  ErrorSchema,
  ListDetailSchema,
  ListGroupSchema,
  ListGroupsInputSchema,
  ListInputSchema,
  ListItemInputBodySchema,
  ListItemPatchSchema,
  ListItemMoveSchema,
  ListItemSchema,
  ListItemStepInputSchema,
  ListItemStepPatchSchema,
  ListItemStepReorderSchema,
  ListCheckedSchema,
  ListPatchSchema,
  ListValueRenameSchema,
  StoreAislesSchema,
  RememberedItemSchema,
  RememberedItemInputSchema,
  RememberedItemPatchSchema,
  RememberedTagRenameSchema,
  ListReorderSchema,
  ListOrderSchema,
  ListSchema,
  ListCatalogSchema,
} from '../schemas.ts';

export const listsRoutes = createRouter();

export type ListRow = {
  id: string;
  name: string;
  emoji: string | null;
  color: string | null;
  kind: 'todo' | 'shopping' | 'reusable';
  member_ids: string;
  group_by: 'store' | 'category' | 'aisle' | 'none';
  sort_by: 'manual' | 'added' | 'due' | 'priority' | 'alpha' | 'aisle';
  keep_checked: number;
  catalog: Catalog | null; // shopping lists: groceries or shopping (0076); null on others
  sort: number;
  archived: number;
  created_at: string;
  items_rev?: number; // migration 0074's triggers; absent on a row built in code before insert
  last_done_at?: string | null; // 0078: when a reusable list was last reset with something checked, and by whom
  last_done_by?: string | null;
  last_done_by_label?: string | null;
};

export type ListItemRow = {
  id: string;
  list_id: string;
  title: string;
  notes: string | null;
  quantity: string | null;
  store: string | null;
  category: string | null;
  aisle: string | null;
  member_id: string | null;
  due_date: string | null;
  event_id: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  done: number;
  done_at: string | null;
  done_by: string | null; // a member id (0078: or a device / app in done_by_label)
  sort: number;
  created_at: string;
  updated_at: string;
} & ActorCols;

/** Who added and who checked off an item or step (migration 0078; absent on rows from older queries). */
type ActorCols = { added_by?: string | null; added_by_label?: string | null; done_by?: string | null; done_by_label?: string | null };

export type ListItemStepRow = { id: string; item_id: string; title: string; done: number; done_at: string | null; sort: number; created_at: string } & ActorCols;

/** An actor in the API (ActorSchema): { memberId } or { label }, null when nobody is known. */
export const actorApi = (memberId: string | null | undefined, label: string | null | undefined) =>
  memberId ? { memberId } : label ? { label } : null;

export type ListGroupRow = { list_id: string; kind: 'store' | 'category'; name: string; sort: number };

export function toApi(row: ListRow, itemCount: number, openCount: number, overdueCount = 0) {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    color: row.color,
    kind: row.kind,
    memberIds: parseMemberIds(row.member_ids),
    groupBy: row.kind === 'shopping' && row.group_by === 'category' ? 'aisle' : row.group_by, // groceries group by aisle; a department fills it in
    sortBy: row.sort_by ?? 'manual',
    keepChecked: !!row.keep_checked,
    catalog: row.kind === 'shopping' ? (row.catalog ?? 'groceries') : null,
    sort: row.sort,
    archived: !!row.archived,
    createdAt: row.created_at,
    itemCount,
    openCount,
    overdueCount,
    itemsRev: row.items_rev ?? 0,
    lastDoneAt: row.last_done_at ?? null,
    lastDoneBy: actorApi(row.last_done_by, row.last_done_by_label),
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
    aisle: row.aisle ?? null,
    memberId: row.member_id,
    dueDate: row.due_date,
    eventId: row.event_id,
    priority: row.priority,
    done: !!row.done,
    doneAt: row.done_at,
    doneBy: row.done_by,
    addedBy: actorApi(row.added_by, row.added_by_label),
    checkedBy: actorApi(row.done_by, row.done_by_label),
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    steps: steps.map((st) => ({ id: st.id, title: st.title, done: !!st.done, sort: st.sort, addedBy: actorApi(st.added_by, st.added_by_label), checkedBy: actorApi(st.done_by, st.done_by_label) })),
    stepsDone: steps.filter((st) => st.done).length,
    stepsTotal: steps.length,
  };
}

type Priority = ListItemRow['priority'];
const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
/** Same ranking in SQL, for queries that order items themselves (event items, the morning summary). */
export const priorityRankSql = (col = 'priority') => `CASE ${col} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END`;

type Orderable = { priority: Priority; done: boolean; dueDate: string | null; title: string; sort: number; createdAt: string; store?: string | null; aisle?: string | null };

/** Store -> its custom aisle order (store '' = no store), from store_aisles. */
export type AisleOrder = Map<string, string[]>;
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Aisles within one store: the store's custom order first (when set), then natural order
 * ("Aisle 2" before "Aisle 10"); no aisle last. */
export function compareAisles(store: string | null | undefined, a: string | null | undefined, b: string | null | undefined, order: AisleOrder): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const custom = order.get(store ?? '') ?? [];
  const ia = custom.indexOf(a), ib = custom.indexOf(b);
  if (ia >= 0 || ib >= 0) return ia < 0 ? 1 : ib < 0 ? -1 : ia - ib;
  return natural(a, b);
}

type TripItem = {
  id: string; title: string; quantity: string | null; done: boolean; store: string | null; aisle: string | null; category?: string | null; places?: { store: string | null; aisle: string | null }[]
  listId?: string; listName?: string; // an item from the other type's list (alsoAtStore)
};

/** A department (the category field) that names one of the store's aisles (any case) stands in for
 * an aisle not known there: "Produce" lands in the store's Produce aisle. Display only - never
 * saved. Same rule as web/src/trip.ts departmentAisle. */
export function departmentAisle(department: string | null | undefined, storeAisles: string[]): string | null {
  const d = department?.trim().toLowerCase();
  return (d && storeAisles.find((a) => a.toLowerCase() === d)) || null;
}

/** The list as shopped at `store` (ListTripSchema; web/src/trip.ts is the client's copy - keep in
 * step). An item planned for this store or for anywhere shows its aisle here: its own when its
 * store is this one, else the one remembered for this store, else its department's (storeAisles:
 * the aisle names known at this store). */
export function tripView(items: TripItem[], store: string, order: AisleOrder, storeAisles: string[] = []) {
  const title = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const rows = items.map((i) => {
    const other = !!i.store && i.store !== store;
    const aisle = other ? i.aisle : (i.store === store && i.aisle) || i.places?.find((p) => p.store === store)?.aisle || departmentAisle(i.category, storeAisles);
    return {
      id: i.id, title: i.title, quantity: i.quantity, done: i.done, store: i.store, aisle, section: other ? ('other' as const) : aisle ? ('aisle' as const) : ('unknown' as const),
      ...(i.listName ? { listId: i.listId, listName: i.listName } : {}),
    };
  });
  const rank = { aisle: 0, unknown: 1, other: 2 };
  rows.sort((a, b) => rank[a.section] - rank[b.section]
    || (a.section === 'aisle' ? compareAisles(store, a.aisle, b.aisle, order) : a.section === 'other' ? (a.store ?? '').localeCompare(b.store ?? '') : 0)
    || title(a, b));
  return { store, items: rows };
}

/** The list's item order (see ListSortBySchema), so API consumers see the same order as the UI -
 * web/src/types.ts keeps a copy for the client. `today` (YYYY-MM-DD, household) decides overdue.
 * A done item gets no priority/overdue boost - unless `keepChecked` (checked items stay in place). */
export function compareItems(sortBy: ListRow['sort_by'], today: string, opts: { keepChecked?: boolean; aisleOrder?: AisleOrder } = {}) {
  const isDone = (i: Orderable) => i.done && !opts.keepChecked;
  const rank = (i: Orderable) => (isDone(i) ? 2 : PRIORITY_RANK[i.priority] ?? 2);
  const overdue = (i: Orderable) => (!isDone(i) && i.dueDate && i.dueDate < today ? 0 : 1);
  const due = (a: Orderable, b: Orderable) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'); // undated last
  const manual = (a: Orderable, b: Orderable) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt);
  const alpha = (a: Orderable, b: Orderable) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const store = (a: Orderable, b: Orderable) => (a.store ?? '\uffff').localeCompare(b.store ?? '\uffff'); // no store last
  return (a: Orderable, b: Orderable): number => {
    if (sortBy === 'added') return b.createdAt.localeCompare(a.createdAt) || b.sort - a.sort;
    if (sortBy === 'due') return due(a, b) || manual(a, b);
    if (sortBy === 'alpha') return alpha(a, b) || manual(a, b);
    if (sortBy === 'aisle') return store(a, b) || compareAisles(a.store, a.aisle, b.aisle, opts.aisleOrder ?? new Map()) || alpha(a, b) || manual(a, b);
    return rank(a) - rank(b) || overdue(a) - overdue(b) || (sortBy === 'priority' ? due(a, b) : 0) || manual(a, b);
  };
}

export function todayIn(tz: string | null | undefined) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz || hostTimezone() }).format(new Date());
}

/** Today (YYYY-MM-DD) in the household's timezone: before it, an open item's due date is overdue. */
async function householdToday(db: KinwallDb) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>();
  return todayIn(row?.value);
}

/** Steps of the items matching `where` (a condition on list_items), grouped by item id, in order. */
// Open items that are due or high priority (the board and snapshots show these). Matches the WHERE of
// migration 0074's idx_list_items_flagged_open exactly, so SQLite reads only those rows.
export const FLAGGED_OPEN = "done = 0 AND (due_date IS NOT NULL OR priority IN ('high', 'urgent'))";

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
// Done by whoever made that change (`by`).
function syncItemFromSteps(db: KinwallDb, itemId: string, now: string, by: Actor) {
  return db
    .prepare(
      `UPDATE list_items SET done = 1 - done, done_at = CASE WHEN done = 0 THEN ?1 ELSE NULL END,
         done_by = CASE WHEN done = 0 THEN ?3 END, done_by_label = CASE WHEN done = 0 THEN ?4 END, updated_at = ?1
       WHERE id = ?2 AND EXISTS (SELECT 1 FROM list_item_steps WHERE item_id = ?2)
         AND done = EXISTS (SELECT 1 FROM list_item_steps WHERE item_id = ?2 AND done = 0)`,
    )
    .bind(now, itemId, by.memberId, by.label);
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

// Putting a task on an event (or taking it off one) changes that event's task list, so it follows the
// event rule (auth.ts eventWriteBlock): a kid's device can't add tasks to someone else's event.
// Ticking, editing or deleting a task that's already linked is an ordinary list edit.
async function taskLinkBlock(c: Context<{ Bindings: Env }>, ids: (string | null | undefined)[]): Promise<string | null> {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (wanted.length === 0) return null;
  const { results } = await c.env.DB.prepare(`SELECT c.member_ids, c.display_edit FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE e.id IN (${wanted.map(() => '?').join(',')})`)
    .bind(...wanted)
    .all<{ member_ids: string; display_edit: number }>();
  return eventWriteBlock(c, results);
}

// A kid's own device follows the chores rule (auth.ts deviceOwner, ownerBlock): it changes only items
// that are theirs, nobody's, or on a list that's theirs. Adding is open to everyone, and wall screens,
// parents' devices and connected apps aren't limited, so they skip the read.
/** The 403 message when an item in `itemIds` (a JSON array) on list `listId` isn't this kid's device's to change, else null. */
async function itemOwnerBlock(c: Context<{ Bindings: Env }>, listId: string, itemIds: string): Promise<string | null> {
  const owner = await deviceOwner(c);
  if (!owner) return null;
  const other = await c.env.DB.prepare(
    `SELECT li.member_id FROM list_items li JOIN lists l ON l.id = li.list_id
     WHERE li.list_id = ?1 AND li.id IN (SELECT value FROM json_each(?2)) AND li.member_id IS NOT NULL AND li.member_id != ?3
       AND NOT EXISTS (SELECT 1 FROM json_each(l.member_ids) WHERE value = ?3) LIMIT 1`,
  ).bind(listId, itemIds, owner).first<{ member_id: string }>();
  return other ? ownerBlock(c, other.member_id) : null;
}
const LIST_VIEW_FIELDS = ['sortBy', 'groupBy', 'keepChecked'];
const oneItem = (itemId: string) => JSON.stringify([itemId]);

// The catalogs learn from grown-ups' devices and wall screens: a kid's own device uses what's remembered
// (places fill in, names are suggested) but its adds, edits and checkouts teach nothing, and it can't
// edit the catalog itself. A grown-up's later edit or checkout of the same item teaches as usual.
const teaches = async (c: Context<{ Bindings: Env }>) => !(await deviceOwner(c));
const KID_CATALOG = "The catalog is changed from a grown-up's device or a wall screen.";

/** Whose items a whole-list Reset or Checkout sweeps on this device: a kid's own device only theirs and
 * nobody's (unless the list is theirs); null (everything) anywhere else. */
async function sweepFor(c: Context<{ Bindings: Env }>, listId: string): Promise<string | null> {
  const owner = await deviceOwner(c);
  if (!owner) return null;
  const list = await c.env.DB.prepare('SELECT member_ids FROM lists WHERE id = ?').bind(listId).first<{ member_ids: string }>();
  return list && parseMemberIds(list.member_ids).includes(owner) ? null : owner;
}

// Notes on list items (routes/notes.ts): no FK, so every path that deletes items deletes their notes.
const ITEM_NOTES = "target_type = 'list_item' AND target_id";

/** FROM for a trip's items from the other type's shopping lists (?1 the list, ?2 the store): planned
 * for the store, or for anywhere with a place remembered there in their own catalog (m, the place
 * at the store, if any). Archived lists stay out. */
const ALSO_AT_STORE = `lists l CROSS JOIN lists o JOIN list_items li ON li.list_id = o.id
  LEFT JOIN item_memory m ON m.catalog = coalesce(o.catalog, 'groceries') AND m.name_key = li.name_key AND m.store = ?2
  WHERE l.id = ?1 AND l.kind = 'shopping' AND o.kind = 'shopping' AND o.archived = 0 AND o.id != l.id
    AND coalesce(o.catalog, 'groceries') != coalesce(l.catalog, 'groceries')
    AND (li.store = ?2 OR (li.store IS NULL AND m.store IS NOT NULL))`;

// shopping defaults to grouping and sorting by aisle; todo/reusable to no grouping, manual.
function defaultGroupBy(kind: ListRow['kind']): ListRow['group_by'] {
  return kind === 'shopping' ? 'aisle' : 'none';
}
const defaultKeepChecked = (kind: ListRow['kind']) => (kind === 'todo' ? 0 : 1);

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
    // Single round trip: counts computed via LEFT JOIN + GROUP BY rather than a per-list query, batched
    // with the timezone and the open items' due dates (overdue = before today, in the household's zone).
    const [listsRes, tzRes, dueRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare(
        `SELECT l.*, COUNT(li.id) AS item_count, COALESCE(SUM(CASE WHEN li.done = 0 THEN 1 ELSE 0 END), 0) AS open_count
         FROM lists l LEFT JOIN list_items li ON li.list_id = l.id
         WHERE (? = 1 OR l.archived = 0)
         GROUP BY l.id
         ORDER BY l.sort, l.created_at`,
      ).bind(archived === 'true' ? 1 : 0),
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
      // FLAGGED_OPEN (implied by the due date) lets the partial index answer this without reading every
      // item; named, as SQLite would rather walk idx_list_items_list for the GROUP BY.
      c.env.DB.prepare(`SELECT list_id, due_date, COUNT(*) AS n FROM list_items INDEXED BY idx_list_items_flagged_open WHERE ${FLAGGED_OPEN} AND due_date IS NOT NULL GROUP BY list_id, due_date`),
    ]);
    const today = todayIn((tzRes.results as { value: string }[])[0]?.value);
    const overdue = new Map<string, number>();
    for (const r of dueRes.results as { list_id: string; due_date: string; n: number }[]) if (r.due_date < today) overdue.set(r.list_id, (overdue.get(r.list_id) ?? 0) + r.n);
    const results = listsRes.results as (ListRow & { item_count: number; open_count: number })[];
    return c.json(results.map((row) => toApi(row, row.item_count, row.open_count, overdue.get(row.id) ?? 0)), 200);
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
      sort_by: body.sortBy ?? (body.kind === 'shopping' ? 'aisle' : 'manual'),
      keep_checked: body.keepChecked !== undefined ? (body.keepChecked ? 1 : 0) : defaultKeepChecked(body.kind),
      catalog: await listCatalog(c.env.DB, body.kind, body.name, body.catalog),
      sort: (await c.env.DB.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM lists').first<{ n: number }>())?.n ?? 0, // new lists go last
      archived: 0,
      created_at: new Date().toISOString(),
    };
    await c.env.DB.prepare(
      'INSERT INTO lists (id, name, emoji, color, kind, member_ids, group_by, sort_by, keep_checked, catalog, sort, archived, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.name, row.emoji, row.color, row.kind, row.member_ids, row.group_by, row.sort_by, row.keep_checked, row.catalog, row.sort, row.archived, row.created_at)
      .run();
    emit(c, 'list.changed', { id: row.id });
    return c.json(toApi(row, 0, 0), 201);
  },
);

// The catalogs (one per shopping list type). Registered before /api/lists/{id}, which would otherwise
// take "remembered" for a list id. ?catalog picks one; groceries when left out (older clients).
const CatalogQuery = z.object({ catalog: ListCatalogSchema.default('groceries') });
listsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/lists/remembered',
    tags: ['Lists'],
    summary: 'A catalog (catalog=groceries, the default, or shopping): every item remembered from lists of that type, by title, with its department and the stores it is found at (aisle per store) and its categories (tags). q searches names; store keeps items found at that store; tag keeps items in that category (case ignored). They combine.',
    security: [{ Bearer: [] }],
    request: { query: CatalogQuery.extend({ q: z.string().optional(), store: z.string().optional(), tag: z.string().optional() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(RememberedItemSchema) } } } },
  }),
  async (c) => {
    const { catalog: cat, q, store, tag } = c.req.valid('query');
    return c.json(filterCatalog(await catalog(c.env.DB, cat), q, store, tag), 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/remembered',
    tags: ['Lists'],
    summary: 'Add an item to a catalog (catalog=groceries, the default, or shopping) without putting it on a list: its name, department and where it is found per store. Adds on lists of that type then use them.',
    security: [{ Bearer: [] }],
    request: { query: CatalogQuery, body: { content: { 'application/json': { schema: RememberedItemInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: RememberedItemSchema } } },
      403: { description: "a kid's own device", content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'already in the catalog', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(await teaches(c))) return c.json({ error: KID_CATALOG }, 403);
    const body = c.req.valid('json');
    const { catalog: cat } = c.req.valid('query');
    const key = itemKey(body.title);
    const [clash] = await catalog(c.env.DB, cat, key);
    if (clash) return c.json({ error: `Already in the catalog as ${clash.title}` }, 409);
    return c.json(await saveCatalogItem(c, cat, key, null, body), 201);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/lists/remembered/{key}',
    tags: ['Lists'],
    summary: 'Edit a catalog item (catalog=groceries, the default, or shopping): title (a respelling; a different name moves it, categories too), category (its department), tags (its categories) and places (replaces the stores it is found at, each with its aisle). Only given fields change. A new aisle is offered in that store\'s aisle picker.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ key: z.string() }), query: CatalogQuery, body: { content: { 'application/json': { schema: RememberedItemPatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: RememberedItemSchema } } },
      403: { description: "a kid's own device", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not in the catalog', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'the new name is another catalog item', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (!(await teaches(c))) return c.json({ error: KID_CATALOG }, 403);
    const { key } = c.req.valid('param');
    const { catalog: cat } = c.req.valid('query');
    const body = c.req.valid('json');
    const [existing] = await catalog(c.env.DB, cat, key);
    if (!existing) return c.json({ error: 'not found' }, 404);
    const to = body.title !== undefined ? itemKey(body.title) : key;
    const [clash] = to !== key ? await catalog(c.env.DB, cat, to) : [];
    if (clash) return c.json({ error: `Already in the catalog as ${clash.title}` }, 409);
    return c.json(await saveCatalogItem(c, cat, key, existing, body), 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/lists/remembered-tags',
    tags: ['Lists'],
    summary: 'Rename (to: a name) or remove (to: null) a catalog category (tag) on every item in that catalog (catalog=groceries, the default, or shopping) that has it; from matches ignoring case. Renaming onto a category an item already has merges them.',
    security: [{ Bearer: [] }],
    request: { query: CatalogQuery, body: { content: { 'application/json': { schema: RememberedTagRenameSchema } } } },
    responses: { 200: { description: 'items changed', content: { 'application/json': { schema: z.object({ updated: z.number() }) } } } },
  }),
  async (c) => {
    const { from, to } = c.req.valid('json');
    const { catalog: cat } = c.req.valid('query');
    const db = c.env.DB;
    const clean = to?.replace(/\s+/g, ' ');
    // The count runs first, in the same batch. OR REPLACE: an item that already has `to` keeps one.
    const [counted] = await db.batch<{ n: number }>([
      db.prepare('SELECT COUNT(*) AS n FROM item_tags WHERE catalog = ? AND tag = ?').bind(cat, from),
      clean
        ? db.prepare('UPDATE OR REPLACE item_tags SET tag = ? WHERE catalog = ? AND tag = ?').bind(clean, cat, from)
        : db.prepare('DELETE FROM item_tags WHERE catalog = ? AND tag = ?').bind(cat, from),
    ]);
    emit(c, 'list.changed', { tag: from });
    return c.json({ updated: counted.results[0]?.n ?? 0 }, 200);
  },
);

async function saveCatalogItem(c: Context<{ Bindings: Env }>, cat: Catalog, from: string, existing: CatalogItem | null, edit: CatalogEdit): Promise<CatalogItem> {
  if (edit.tags) {
    const { results } = await c.env.DB.prepare('SELECT DISTINCT tag FROM item_tags WHERE catalog = ? AND name_key != ?').bind(cat, from).all<{ tag: string }>();
    edit = { ...edit, tags: tagsInput(edit.tags, results.map((r) => r.tag)) };
  }
  const { key, writes } = catalogWrites(c.env.DB, cat, from, existing, edit, new Date().toISOString());
  await c.env.DB.batch(writes);
  emit(c, 'list.changed', { remembered: key });
  return (await catalog(c.env.DB, cat, key))[0]!;
}

type ValueRow = { store: string | null; category: string | null; aisle: string | null };
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/** The detail's store/category/aisle suggestions from one pass each over items, remembered places
 * and stores' aisle orders (memory's store is '' for none, an item's null). */
export function suggestedValues(items: ValueRow[], memory: ValueRow[], storeAisles: { store: string; aisle: string }[]) {
  const stores = sorted([
    ...items.filter((r) => r.store !== null).map((r) => r.store as string),
    ...[...memory, ...storeAisles].filter((r) => r.store).map((r) => r.store as string),
  ]);
  const categories = sorted([...items, ...memory].filter((r) => r.category !== null).map((r) => r.category as string));
  const pairs = [...items, ...memory].filter((r) => r.aisle !== null).map((r) => [r.store ?? '', r.aisle as string]).concat(storeAisles.map((r) => [r.store, r.aisle]));
  const aisles = [...new Map(pairs.map((p) => [JSON.stringify(p), p])).values()]
    .sort(([s1, a1], [s2, a2]) => (s1 === s2 ? (a1 < a2 ? -1 : a1 > a2 ? 1 : 0) : s1 < s2 ? -1 : 1))
    .map(([store, aisle]) => ({ store: store || null, aisle }));
  return { stores, categories, aisles };
}

/** Remembered places of the names suggested (the top SUGGESTION_CAP), newest first. */
const memoryOf = (names: { name_key: string }[], memory: { name_key: string; updated_at: string }[]) => {
  const keys = new Set(names.map((n) => n.name_key));
  return memory.filter((m) => keys.has(m.name_key)).sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
};

listsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/lists/{id}',
    tags: ['Lists'],
    summary: 'List detail: the list, its items (each with the planned meals it was added for), its group ordering, store/category/aisle suggestions and autocomplete from the catalog of its type (shopping lists), and stores\' custom aisle orders',
    description:
      'Changed: `suggestions` is filled only for shopping lists; to-do and reusable lists get empty `stores`, `categories` and `aisles`. `suggestions=false` leaves suggestions (empty) and each item\'s `places` out of a shopping list too: a cheaper read for clients that only show the items.',
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({
        store: z.string().min(1).optional().openapi({ description: 'Also return `trip`: the list as shopped at this store, and `alsoAtStore`: the other type\'s shopping lists\' items for this store (Groceries and Shopping lists share a trip), which `trip` walks too.' }),
        suggestions: z.enum(['true', 'false']).optional().openapi({ description: '`false`: skip suggestions and item places (sync clients).' }),
      }),
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ListDetailSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { store: tripStore, suggestions } = c.req.valid('query');
    const want = suggestions === 'false' && !tripStore ? 0 : 1; // a trip needs the aisles
    // One round trip: list + items + groups + suggestions, all independent reads. The shopping-only
    // reads start from the list's row (`shop`, CROSS JOIN keeps it the outer loop), so on any other list
    // (or with suggestions=false) SQLite finds no row there and never reads the household-wide tables:
    // hosted is billed per row read.
    // Everything remembered comes from the list's own catalog (groceries or shopping).
    const shop = "l.id = ?1 AND l.kind = 'shopping' AND ?2";
    const batch = await c.env.DB.batch<unknown>([
      c.env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(id),
      c.env.DB.prepare('SELECT * FROM list_items WHERE list_id = ?').bind(id), // ordered below, by the list's sortBy
      c.env.DB.prepare('SELECT * FROM list_groups WHERE list_id = ? ORDER BY kind, sort').bind(id),
      stepsQuery(c.env.DB, 'list_id = ?', id),
      // Every store/category/aisle used on any item, in one pass (with memoryRes: stores, categories and aisles below).
      c.env.DB.prepare(
        `SELECT DISTINCT li.store, li.category, li.aisle FROM lists l CROSS JOIN lists o JOIN list_items li ON li.list_id = o.id
         WHERE ${shop} AND o.kind = 'shopping' AND coalesce(o.catalog, 'groceries') = coalesce(l.catalog, 'groceries')`,
      ).bind(id, want),
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
      c.env.DB.prepare(`SELECT target_id, COUNT(*) AS n FROM notes WHERE ${ITEM_NOTES} IN (SELECT id FROM list_items WHERE list_id = ?) GROUP BY target_id`).bind(id),
      c.env.DB.prepare('SELECT store, aisle FROM store_aisles ORDER BY store, sort'),
      // Which planned meals an item came from: meal_shopping_sources refs are "meal-plan:<mealId>:ingredient:<id>".
      c.env.DB.prepare(
        `SELECT DISTINCT s.item_id, m.title, m.date FROM meal_shopping_sources s
         JOIN meals m ON m.id = substr(s.source_ref, 11, instr(substr(s.source_ref, 11), ':') - 1)
         WHERE s.list_id = ? AND s.source_ref LIKE 'meal-plan:%' ORDER BY m.date, m.title`,
      ).bind(id),
      // Where each item has been kept, per store, newest first: any store's trip renders from this.
      c.env.DB.prepare(
        `SELECT li.id AS item_id, m.store, m.aisle FROM lists l CROSS JOIN list_items li ON li.list_id = l.id
         JOIN item_memory m ON m.catalog = coalesce(l.catalog, 'groceries') AND m.name_key = li.name_key
         WHERE ${shop} ORDER BY m.updated_at DESC`,
      ).bind(id, want),
      // Autocomplete (shopping lists): remembered names, where they go, and recipe ingredients.
      c.env.DB.prepare(`SELECT n.name_key, n.title, n.uses FROM lists l CROSS JOIN item_names n WHERE ${shop} AND n.catalog = coalesce(l.catalog, 'groceries') ORDER BY n.uses DESC, n.last_used DESC LIMIT ${SUGGESTION_CAP}`).bind(id, want),
      // Everything remembered: the values above, and where the top names go (memoryOf; sorted there, as a
      // SQL ORDER BY would read every row twice).
      c.env.DB.prepare(`SELECT m.name_key, m.store, m.category, m.aisle, m.updated_at FROM lists l CROSS JOIN item_memory m WHERE ${shop} AND m.catalog = coalesce(l.catalog, 'groceries')`).bind(id, want),
      // Recipe ingredients: groceries only.
      c.env.DB.prepare(`SELECT DISTINCT ri.name, ri.category FROM lists l CROSS JOIN recipes r JOIN recipe_ingredients ri ON ri.recipe_id = r.id WHERE ${shop} AND coalesce(l.catalog, 'groceries') = 'groceries' AND r.archived = 0 ORDER BY ri.name`).bind(id, want),
      // A trip at a store also walks the other type's lists' items for that store: planned for it, or
      // for anywhere and found there before (their own catalog's places) - with their aisle there.
      ...(tripStore
        ? [
            c.env.DB.prepare(`SELECT li.*, o.name AS list_name, m.store AS place_store, m.aisle AS place_aisle FROM ${ALSO_AT_STORE} ORDER BY li.title COLLATE NOCASE, li.id`).bind(id, tripStore),
          ]
        : []),
    ]);
    const [alsoRes] = batch.slice(13);
    const [listRes, itemsRes, groupsRes, stepsRes, valuesRes, tzRes, notesRes, orderRes, mealsRes, placesRes, namesRes, memoryRes, ingredientsRes] = batch;
    const noteCounts = new Map((notesRes.results as { target_id: string; n: number }[]).map((r) => [r.target_id, r.n]));
    const list = (listRes.results as ListRow[])[0];
    if (!list) return c.json({ error: 'not found' }, 404);
    const items = itemsRes.results as unknown as ListItemRow[];
    const placesByItem = new Map<string, { store: string | null; aisle: string | null }[]>();
    for (const r of placesRes.results as { item_id: string; store: string; aisle: string | null }[]) {
      placesByItem.set(r.item_id, [...(placesByItem.get(r.item_id) ?? []), { store: r.store || null, aisle: r.aisle }]);
    }
    const groups = groupsRes.results as unknown as ListGroupRow[];
    const steps = groupSteps(stepsRes.results as ListItemStepRow[]);
    const orderRows = orderRes.results as { store: string; aisle: string }[];
    const suggest = list.kind === 'shopping' && want === 1;
    const { stores, categories, aisles } = suggest ? suggestedValues(valuesRes.results as ValueRow[], memoryRes.results as ValueRow[], orderRows) : { stores: [], categories: [], aisles: [] };
    const aisleOrder: AisleOrder = new Map();
    for (const r of orderRows) aisleOrder.set(r.store, [...(aisleOrder.get(r.store) ?? []), r.aisle]);
    const meals = new Map<string, string[]>();
    for (const r of mealsRes.results as { item_id: string; title: string }[]) {
      const titles = meals.get(r.item_id) ?? [];
      if (!titles.includes(r.title)) meals.set(r.item_id, [...titles, r.title]);
    }
    const openCount = items.filter((i) => !i.done).length;
    const today = todayIn((tzRes.results as { value: string }[])[0]?.value);
    const overdueCount = items.filter((i) => !i.done && i.due_date && i.due_date < today).length;
    const order = compareItems(list.sort_by, today, { keepChecked: !!list.keep_checked, aisleOrder });
    const apiItems = items
      .map((i) => ({ ...toItemApi(i, steps.get(i.id)), noteCount: noteCounts.get(i.id) ?? 0, ...(meals.has(i.id) ? { meals: meals.get(i.id) } : {}), ...(suggest ? { places: placesByItem.get(i.id) ?? [] } : {}) }))
      .sort(order);
    const also = ((alsoRes?.results ?? []) as (ListItemRow & { list_name: string; place_store: string | null; place_aisle: string | null })[]).map((r) => ({
      ...toItemApi(r),
      listName: r.list_name,
      places: r.place_store ? [{ store: r.place_store, aisle: r.place_aisle }] : [],
    }));
    return c.json(
      {
        list: toApi(list, items.length, openCount, overdueCount),
        items: apiItems,
        ...(tripStore ? { alsoAtStore: also } : {}),
        groups: groups.map(toGroupApi),
        suggestions: {
          stores,
          categories,
          aisles,
          ...(suggest
            ? { items: nameSuggestions(namesRes.results as never, memoryOf(namesRes.results as { name_key: string }[], memoryRes.results as { name_key: string; updated_at: string }[]) as never, ingredientsRes.results as never, tripStore) }
            : {}),
        },
        aisleOrder: [...aisleOrder].map(([store, names]) => ({ store: store || null, aisles: names })),
        ...(tripStore ? { trip: tripView([...apiItems, ...also], tripStore, aisleOrder, aisles.filter((a) => a.store === tripStore).map((a) => a.aisle)) } : {}),
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
    description: "A wall screen or kid's device (display key) may change only sortBy, groupBy and keepChecked.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ListPatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ListSchema } } },
      403: { description: 'a display key changing more than the view', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    // Wall screens and kids' devices change only how a list is viewed; its settings are for parent devices.
    if ((await requestKey(c))?.scope === 'display' && Object.keys(body).some((k) => !LIST_VIEW_FIELDS.includes(k))) return c.json({ error: 'Ask a grown-up to change this list.' }, 403);
    const existing = await c.env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(id).first<ListRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const memberIds = body.memberIds !== undefined ? await resolveMemberIds(c.env.DB, body.memberIds) : parseMemberIds(existing.member_ids);
    const kind = body.kind ?? existing.kind;
    const updated: ListRow = {
      ...existing,
      name: body.name ?? existing.name,
      emoji: body.emoji !== undefined ? body.emoji : existing.emoji,
      color: body.color !== undefined ? body.color : existing.color,
      kind: body.kind ?? existing.kind,
      member_ids: JSON.stringify(memberIds),
      group_by: body.groupBy ?? existing.group_by,
      sort_by: body.sortBy ?? existing.sort_by,
      // A kind change takes that kind's default unless the caller says otherwise.
      keep_checked: body.keepChecked !== undefined ? (body.keepChecked ? 1 : 0) : body.kind && body.kind !== existing.kind ? defaultKeepChecked(body.kind) : existing.keep_checked,
      // A shopping list keeps its type unless told otherwise; one that becomes a shopping list takes the name rule.
      catalog: await listCatalog(c.env.DB, kind, body.name ?? existing.name, body.catalog ?? (existing.kind === 'shopping' ? existing.catalog : null)),
      sort: body.sort ?? existing.sort,
      archived: body.archived !== undefined ? (body.archived ? 1 : 0) : existing.archived,
    };
    await c.env.DB.prepare('UPDATE lists SET name=?, emoji=?, color=?, kind=?, member_ids=?, group_by=?, sort_by=?, keep_checked=?, catalog=?, sort=?, archived=? WHERE id=?')
      .bind(updated.name, updated.emoji, updated.color, updated.kind, updated.member_ids, updated.group_by, updated.sort_by, updated.keep_checked, updated.catalog, updated.sort, updated.archived, id)
      .run();
    emit(c, 'list.changed', { id });
    const counts = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END), 0) AS open,
         COALESCE(SUM(CASE WHEN done = 0 AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END), 0) AS overdue
       FROM list_items WHERE list_id = ?`,
    )
      .bind(await householdToday(c.env.DB), id)
      .first<{ n: number; open: number; overdue: number }>();
    return c.json(toApi(updated, counts?.n ?? 0, counts?.open ?? 0, counts?.overdue ?? 0), 200);
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
    summary: 'Add one or more items to a list (always returns an array). An optional client-made UUID `id` makes a retried add idempotent: an id already on this list returns that item unchanged. On a shopping list, an omitted store/category/aisle is filled from what the household remembers for that item name (case, spacing and simple plurals ignored; aisle per store); explicit values, including null, win - and are remembered. With `?skipExisting=1` (Siri\'s adds) a name already on the list, matched the same way, isn\'t added again: an open one comes back as it is with `existing: "open"`, a ticked one is unticked and comes back with `existing: "reopened"`.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), query: z.object({ skipExisting: z.enum(['1', 'true']).optional() }), body: { content: { 'application/json': { schema: ListItemInputBodySchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: z.array(ListItemSchema.extend({ existing: z.enum(['open', 'reopened']).optional() })) } } },
      400: { description: 'event not found, or the same item id twice', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: "this device may not change that event's tasks", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'an item id is already used on another list', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const inputs = Array.isArray(body) ? body : [body];

    const list = await c.env.DB.prepare("SELECT id, name, kind, coalesce(catalog, 'groceries') AS catalog FROM lists WHERE id = ?").bind(id).first<{ id: string; name: string; kind: ListRow['kind']; catalog: Catalog }>();
    if (!list) return c.json({ error: 'not found' }, 404);
    if (await missingEventIds(c.env.DB, inputs.map((i) => i.eventId))) return c.json({ error: 'event not found' }, 400);
    const block = await taskLinkBlock(c, inputs.map((i) => i.eventId));
    if (block) return c.json({ error: block }, 403);

    // memberId validated against members up front, like calendars' resolveMemberIds - unknown ids drop to null.
    const requestedMemberIds = [...new Set(inputs.map((i) => i.memberId).filter((v): v is string => !!v))];
    const validMemberIds = new Set(await resolveMemberIds(c.env.DB, requestedMemberIds));

    // Client ids make a replayed add idempotent: an id already in this list answers with that item
    // instead of inserting again; an id used anywhere else is a conflict.
    const clientIds = inputs.map((i) => i.id).filter((v): v is string => !!v);
    if (new Set(clientIds).size !== clientIds.length) return c.json({ error: 'duplicate item id' }, 400);
    const already = new Map<string, string>();
    if (clientIds.length) {
      const found = await c.env.DB.prepare(`SELECT id, list_id FROM list_items WHERE id IN (${clientIds.map(() => '?').join(',')})`)
        .bind(...clientIds)
        .all<{ id: string; list_id: string }>();
      for (const r of found.results) already.set(r.id, r.list_id);
      if ([...already.values()].some((l) => l !== id)) return c.json({ error: 'item id already used' }, 409);
    }
    const fresh = inputs.filter((i) => !i.id || !already.has(i.id));
    // ?skipExisting: the item on the list with the same name (an open one first, else the latest ticked).
    const matched = new Map<(typeof inputs)[number], { id: string; done: number }>();
    if (c.req.valid('query').skipExisting && fresh.length) {
      const keys = fresh.map((i) => itemKey(i.title));
      const { results } = await c.env.DB.prepare(`SELECT id, name_key, done FROM list_items WHERE list_id = ? AND name_key IN (${keys.map(() => '?').join(',')}) ORDER BY done ASC, updated_at DESC`)
        .bind(id, ...keys)
        .all<{ id: string; name_key: string; done: number }>();
      for (const input of fresh) {
        const hit = results.find((r) => r.name_key === itemKey(input.title));
        if (hit) matched.set(input, hit);
      }
    }
    const adding = fresh.filter((i) => !matched.has(i));
    const reopened = [...matched.values()].filter((m) => m.done).map((m) => m.id);
    // Reopening is a change: a kid's device only to items it may change (like unticking one).
    const blocked = reopened.length ? await itemOwnerBlock(c, id, JSON.stringify(reopened)) : null;
    if (blocked) return c.json({ error: blocked }, 403);

    const maxSort = await c.env.DB.prepare('SELECT COALESCE(MAX(sort), -1) AS m FROM list_items WHERE list_id = ?').bind(id).first<{ m: number }>();
    let nextSort = (maxSort?.m ?? -1) + 1;

    const now = new Date().toISOString();
    const by = await actorOf(c);
    const rows: ListItemRow[] = [];
    // "Remembers where things go" (shopping lists): only OMITTED fields fill from memory -
    // explicit null means "none" and must not be overwritten.
    const shopping = list.kind === 'shopping';
    const teach = shopping && (await teaches(c));
    const memory = shopping ? await recall(c.env.DB, list.catalog, adding.map((i) => i.title)) : new Map();
    for (const input of adding) {
      const { store, category, aisle } = shopping
        ? fillPlace(memory, input.title, input)
        : { store: input.store ?? null, category: input.category ?? null, aisle: input.aisle ?? null };
      rows.push({
        id: input.id ?? crypto.randomUUID(),
        list_id: id,
        title: input.title.trim(),
        notes: input.notes ?? null,
        quantity: input.quantity ?? null,
        store,
        category,
        aisle,
        member_id: input.memberId && validMemberIds.has(input.memberId) ? input.memberId : null,
        due_date: input.dueDate ?? null,
        event_id: input.eventId ?? null,
        priority: input.priority ?? 'normal',
        done: 0,
        done_at: null,
        done_by: null,
        added_by: by.memberId,
        added_by_label: by.label,
        sort: nextSort++,
        created_at: now,
        updated_at: now,
      });
    }

    const steps: ListItemStepRow[] = rows.flatMap((r, i) =>
      (adding[i].steps ?? []).map((title, sort) => ({ id: crypto.randomUUID(), item_id: r.id, title: title.trim(), done: 0, done_at: null, sort, created_at: now, added_by: by.memberId, added_by_label: by.label })),
    );
    if (rows.length || reopened.length) {
      await c.env.DB.batch([
        ...reopened.map((rid) => c.env.DB.prepare('UPDATE list_items SET done = 0, done_at = NULL, done_by = NULL, done_by_label = NULL, updated_at = ? WHERE id = ?').bind(now, rid)),
        // Its steps too, keeping "done = all steps done" (else the next step change closes it again).
        ...reopened.map((rid) => c.env.DB.prepare('UPDATE list_item_steps SET done = 0, done_at = NULL, done_by = NULL, done_by_label = NULL WHERE item_id = ? AND done = 1').bind(rid)),
        ...rows.map((r) =>
          c.env.DB.prepare(
            'INSERT INTO list_items (id, list_id, title, name_key, notes, quantity, store, category, aisle, member_id, due_date, event_id, priority, done, done_at, done_by, added_by, added_by_label, sort, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ).bind(
            r.id,
            r.list_id,
            r.title,
            itemKey(r.title),
            r.notes,
            r.quantity,
            r.store,
            r.category,
            r.aisle,
            r.member_id,
            r.due_date,
            r.event_id,
            r.priority,
            r.done,
            r.done_at,
            r.done_by,
            r.added_by,
            r.added_by_label,
            r.sort,
            r.created_at,
            r.updated_at,
          ),
        ),
        ...steps.map((st) =>
          c.env.DB.prepare('INSERT INTO list_item_steps (id, item_id, title, done, done_at, sort, created_at, added_by, added_by_label) VALUES (?,?,?,?,?,?,?,?,?)').bind(
            st.id, st.item_id, st.title, st.done, st.done_at, st.sort, st.created_at, st.added_by, st.added_by_label,
          ),
        ),
        ...(teach ? rows.map((r) => rememberPlace(c.env.DB, list.catalog, r.title, r, now)).filter((st) => st !== null) : []),
        ...(teach ? rows.map((r) => rememberName(c.env.DB, list.catalog, r.title, now)) : []),
      ]);
      emit(c, 'list.item.changed', { listId: id, ids: [...rows.map((r) => r.id), ...reopened] });
      let execCtx: Parameters<typeof notifyListUpdate>[1];
      try {
        execCtx = c.executionCtx;
      } catch {
        execCtx = undefined; // Node: no ExecutionContext
      }
      notifyListUpdate(c.env, execCtx, id, list.name);
    }
    const stepsByItem = groupSteps(steps);
    const out = await Promise.all(inputs.map(async (input) => {
      if (input.id && already.has(input.id)) return (await loadItem(c.env.DB, id, input.id))!;
      const hit = matched.get(input);
      if (hit) return { ...(await loadItem(c.env.DB, id, hit.id))!, existing: hit.done ? ('reopened' as const) : ('open' as const) };
      const r = rows[adding.indexOf(input)]!;
      return toItemApi(r, stepsByItem.get(r.id));
    }));
    return c.json(out, 201);
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
      403: { description: "this device may not change that event's tasks", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    const blocked = await itemOwnerBlock(c, id, oneItem(itemId));
    if (blocked) return c.json({ error: blocked }, 403);
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare("SELECT li.*, l.kind = 'shopping' AS shopping, coalesce(l.catalog, 'groceries') AS catalog FROM list_items li JOIN lists l ON l.id = li.list_id WHERE li.id = ? AND li.list_id = ?")
      .bind(itemId, id)
      .first<ListItemRow & { shopping: number; catalog: Catalog }>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    if (await missingEventIds(c.env.DB, [body.eventId])) return c.json({ error: 'event not found' }, 400);
    if (body.eventId !== undefined && body.eventId !== existing.event_id) {
      const block = await taskLinkBlock(c, [existing.event_id, body.eventId]);
      if (block) return c.json({ error: block }, 403);
    }

    let memberId = body.memberId !== undefined ? body.memberId : existing.member_id;
    if (body.memberId) {
      const resolved = await resolveMemberIds(c.env.DB, [body.memberId]);
      memberId = resolved[0] ?? null;
    }

    const now = new Date().toISOString();
    const done = body.done !== undefined ? body.done : !!existing.done;
    // Ticked now (not already done): by whoever ticked it - or the member a caller names in doneBy.
    const ticked = body.done === true && (!existing.done || body.doneBy !== undefined);
    const by = ticked ? (body.doneBy ? { memberId: (await resolveMemberIds(c.env.DB, [body.doneBy]))[0] ?? null, label: null } : await actorOf(c)) : null;
    const updated: ListItemRow = {
      ...existing,
      title: body.title !== undefined ? body.title.trim() : existing.title,
      notes: body.notes !== undefined ? body.notes : existing.notes,
      quantity: body.quantity !== undefined ? body.quantity : existing.quantity,
      store: body.store !== undefined ? body.store : existing.store,
      category: body.category !== undefined ? body.category : existing.category,
      aisle: body.aisle === undefined ? existing.aisle : body.aisleStore === undefined ? body.aisle : null, // trip: set below
      member_id: memberId,
      due_date: body.dueDate !== undefined ? body.dueDate : existing.due_date,
      event_id: body.eventId !== undefined ? body.eventId : existing.event_id,
      priority: body.priority ?? existing.priority,
      done: done ? 1 : 0,
      done_at: body.done === undefined || (done && existing.done) ? existing.done_at : done ? now : null,
      done_by: by ? by.memberId : done ? existing.done_by ?? null : null,
      done_by_label: by ? by.label : done ? existing.done_by_label ?? null : null,
      updated_at: now,
    };
    // A shopping trip sets the aisle at the trip's store: the item takes it only if it's planned for
    // that store or for anywhere (and stays "anywhere"); either way it's remembered for that store.
    const trip = body.aisleStore !== undefined && body.aisle !== undefined ? { store: body.aisleStore, aisle: body.aisle } : null;
    if (trip) updated.aisle = !updated.store || updated.store === trip.store ? trip.aisle : existing.aisle;
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE list_items SET title=?, name_key=?, notes=?, quantity=?, store=?, category=?, aisle=?, member_id=?, due_date=?, event_id=?, priority=?, done=?, done_at=?, done_by=?, done_by_label=?, updated_at=? WHERE id=?',
      ).bind(
        updated.title,
        itemKey(updated.title),
        updated.notes,
        updated.quantity,
        updated.store,
        updated.category,
        updated.aisle,
        updated.member_id,
        updated.due_date,
        updated.event_id,
        updated.priority,
        updated.done,
        updated.done_at,
        updated.done_by,
        updated.done_by_label,
        updated.updated_at,
        itemId,
      ),
      // Ticking the item ticks every step (and unticking unticks them), keeping "done = all steps done".
      ...(body.done !== undefined
        ? [c.env.DB.prepare('UPDATE list_item_steps SET done = ?1, done_at = ?2, done_by = ?3, done_by_label = ?4 WHERE item_id = ?5 AND done != ?1')
            .bind(updated.done, updated.done ? now : null, updated.done ? updated.done_by : null, updated.done ? updated.done_by_label : null, itemId)]
        : []),
      // Saving where an item goes remembers it for next time (not a plain tick). On a trip, the aisle
      // is remembered for the trip's store, and an "anywhere" item doesn't remember one for no store.
      ...(existing.shopping && [body.title, body.store, body.category, body.aisle].some((v) => v !== undefined) && (await teaches(c))
        ? [
            trip && !updated.store ? null : rememberPlace(c.env.DB, existing.catalog, updated.title, updated, now),
            trip ? rememberPlace(c.env.DB, existing.catalog, updated.title, { store: trip.store, category: updated.category, aisle: trip.aisle }, now) : null,
          ].filter((st) => st !== null)
        : []),
      // A rename is the spelling to suggest from now on (not another use).
      ...(existing.shopping && body.title !== undefined && updated.title !== existing.title && (await teaches(c)) ? [rememberName(c.env.DB, existing.catalog, updated.title, now, 0)] : []),
    ]);
    emit(c, 'list.item.changed', { listId: id, id: itemId, done: !!updated.done });
    return c.json((await loadItem(c.env.DB, id, itemId))!, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/items/move',
    tags: ['Lists'],
    summary: 'Move items to another list of the same type (to-do, reusable, Groceries or Shopping). Each keeps its id and everything on it: fields, steps, notes thread and the meals it was added for; it goes to the end of the target list. Returns the moved items.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ListItemMoveSchema } } } },
    responses: {
      200: { description: 'moved', content: { 'application/json': { schema: z.array(ListItemSchema) } } },
      400: { description: 'the target is another type of list, or the same list', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: "a kid's own device: someone else's item", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'a list or item not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { itemIds, toListId } = c.req.valid('json');
    const blocked = await itemOwnerBlock(c, id, JSON.stringify(itemIds));
    if (blocked) return c.json({ error: blocked }, 403);
    const db = c.env.DB;
    const [listsRes, itemsRes] = await db.batch<unknown>([
      db.prepare('SELECT * FROM lists WHERE id IN (?, ?)').bind(id, toListId),
      db.prepare('SELECT * FROM list_items WHERE list_id = ? AND id IN (SELECT value FROM json_each(?))').bind(id, JSON.stringify(itemIds)),
    ]);
    const lists = listsRes.results as ListRow[];
    const from = lists.find((l) => l.id === id), to = lists.find((l) => l.id === toListId);
    if (!from || !to) return c.json({ error: 'list not found' }, 404);
    const typeOf = (l: ListRow) => (l.kind === 'shopping' ? `shopping:${l.catalog ?? 'groceries'}` : l.kind);
    if (from.id === to.id || typeOf(from) !== typeOf(to)) return c.json({ error: 'items move only to another list of the same type' }, 400);
    const rows = itemsRes.results as ListItemRow[];
    if (rows.length !== new Set(itemIds).size) return c.json({ error: 'item not found' }, 404);
    const ids = JSON.stringify(rows.map((r) => r.id));
    const now = new Date().toISOString();
    // Same type, so the same catalog: remember where they go, like a save.
    const cat = (to.catalog ?? 'groceries') as Catalog;
    await db.batch([
      // To the end of the target, in their order here. (Triggers bump both lists' itemsRev.)
      db.prepare(
        `UPDATE list_items SET list_id = ?1, updated_at = ?2,
           sort = (SELECT coalesce(max(sort), -1) FROM list_items WHERE list_id = ?1) + 1 + (SELECT count(*) FROM list_items o WHERE o.list_id = ?3 AND o.id IN (SELECT value FROM json_each(?4)) AND (o.sort < list_items.sort OR (o.sort = list_items.sort AND o.id < list_items.id)))
         WHERE list_id = ?3 AND id IN (SELECT value FROM json_each(?4))`,
      ).bind(toListId, now, id, ids),
      // Meal links follow (a claim the target already has for the same meal ingredient stays; the moved one's goes).
      db.prepare('UPDATE OR IGNORE meal_shopping_sources SET list_id = ? WHERE list_id = ? AND item_id IN (SELECT value FROM json_each(?))').bind(toListId, id, ids),
      db.prepare('DELETE FROM meal_shopping_sources WHERE list_id = ? AND item_id IN (SELECT value FROM json_each(?))').bind(id, ids),
      ...(to.kind === 'shopping' && (await teaches(c)) ? rows.map((r) => rememberPlace(db, cat, r.title, r, now)).filter((st) => st !== null) : []),
    ]);
    emit(c, 'list.item.changed', { listId: id, ids: rows.map((r) => r.id) });
    emit(c, 'list.item.changed', { listId: toListId, ids: rows.map((r) => r.id) });
    emit(c, 'list.changed', { id });
    emit(c, 'list.changed', { id: toListId });
    const moved = await Promise.all(itemIds.filter((v, i) => itemIds.indexOf(v) === i).map((itemId) => loadItem(db, toListId, itemId)));
    return c.json(moved.filter((m) => m !== null), 200);
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
      403: { description: "a kid's own device: someone else's item", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, itemId } = c.req.valid('param');
    const blocked = await itemOwnerBlock(c, id, oneItem(itemId));
    if (blocked) return c.json({ error: blocked }, 403);
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
    summary: 'Checkout: delete the checked items in a list - only those in itemIds (still checked) when given, else every checked item. Optional JSON body { itemIds, store }: store (the end of a shopping trip) is remembered as where they were last bought.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) }, // optional JSON body { itemIds } (ListChecked), read by checkedIds
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ deleted: z.number() }) } } }, 403: { description: "a kid's own device: someone else's item", content: { 'application/json': { schema: ErrorSchema } } }, },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { ids, store } = await checkedBody(c);
    const blocked = ids ? await itemOwnerBlock(c, id, ids) : null;
    if (blocked) return c.json({ error: blocked }, 403);
    const mine = ids ? null : await sweepFor(c, id);
    const where = `list_id = ? AND done = 1 AND (? IS NULL OR id IN (SELECT value FROM json_each(?))) AND (? IS NULL OR member_id IS NULL OR member_id = ?)`;
    // Checkout at the end of a trip: these were bought at `store` - the newest place for each, so the
    // item editor can suggest it next time. The aisle known there is kept.
    if (store && (await teaches(c))) {
      const [bought, list] = await c.env.DB.batch<unknown>([
        c.env.DB.prepare(`SELECT title, category FROM list_items WHERE ${where}`).bind(id, ids, ids, mine, mine),
        c.env.DB.prepare("SELECT coalesce(catalog, 'groceries') AS catalog FROM lists WHERE id = ?").bind(id),
      ]);
      const cat = (list.results as { catalog: Catalog }[])[0]?.catalog ?? 'groceries';
      const now = new Date().toISOString();
      if (bought.results.length) {
        await c.env.DB.batch((bought.results as { title: string; category: string | null }[]).map((b) => c.env.DB.prepare(
          `INSERT INTO item_memory (catalog, name_key, store, category, aisle, updated_at) VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT(catalog, name_key, store) DO UPDATE SET category = coalesce(excluded.category, item_memory.category), updated_at = excluded.updated_at`,
        ).bind(cat, itemKey(b.title), store, b.category, now)));
      }
    }
    await c.env.DB.prepare(`DELETE FROM notes WHERE ${ITEM_NOTES} IN (SELECT id FROM list_items WHERE ${where})`).bind(id, ids, ids, mine, mine).run();
    const result = await c.env.DB.prepare(`DELETE FROM list_items WHERE ${where}`).bind(id, ids, ids, mine, mine).run();
    emit(c, 'list.changed', { id });
    return c.json({ deleted: result.meta.changes }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/{id}/reset',
    tags: ['Lists'],
    summary: 'Uncheck every item (and every step) in a list (for reusable lists) - only those in itemIds when given',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) }, // optional JSON body { itemIds } (ListChecked), read by checkedIds
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ reset: z.number() }) } } }, 403: { description: "a kid's own device: someone else's item", content: { 'application/json': { schema: ErrorSchema } } }, },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const ids = (await checkedBody(c)).ids;
    const blocked = ids ? await itemOwnerBlock(c, id, ids) : null;
    if (blocked) return c.json({ error: blocked }, 403);
    const reset = await resetListItems(c.env.DB, id, ids ? null : await sweepFor(c, id), ids, ids ? null : await actorOf(c)); // all of it: the list was done
    emit(c, 'list.changed', { id });
    return c.json({ reset }, 200);
  },
);

/** The optional { itemIds, store } body of Checkout / Reset: ids as a JSON array param (null = every
 * item). Read by hand, not declared on the route: callers post these with no body (or an empty one). */
async function checkedBody(c: Context<{ Bindings: Env }>): Promise<{ ids: string | null; store: string | null }> {
  const parsed = ListCheckedSchema.safeParse(await c.req.json().catch(() => ({})));
  return { ids: parsed.success && parsed.data.itemIds ? JSON.stringify(parsed.data.itemIds) : null, store: parsed.success ? parsed.data.store ?? null : null };
}

/** Uncheck items (and their steps) in a list; returns how many items were ticked. With `forMember`,
 * only that member's items and unassigned ones - what a chore's checklist covers (routes/chores.ts).
 * With `ids` (a JSON array), only those items. With `doneBy` (a reset that means the list was done),
 * a reusable list with something ticked remembers when and by whom (lastDoneAt / lastDoneBy): its
 * one extra row write. */
export async function resetListItems(db: KinwallDb, id: string, forMember: string | null = null, ids: string | null = null, doneBy: Actor | null = null): Promise<number> {
  const scope = 'list_id = ? AND (? IS NULL OR member_id IS NULL OR member_id = ?) AND (? IS NULL OR id IN (SELECT value FROM json_each(?)))';
  const binds = [id, forMember, forMember, ids, ids];
  const now = new Date().toISOString();
  // First, while the ticks are still there to see.
  if (doneBy) {
    await db.prepare(`UPDATE lists SET last_done_at = ?, last_done_by = ?, last_done_by_label = ? WHERE id = ? AND kind = 'reusable' AND EXISTS (SELECT 1 FROM list_items WHERE ${scope} AND done = 1)`)
      .bind(now, doneBy.memberId, doneBy.label, id, ...binds)
      .run();
  }
  const result = await db.prepare(`UPDATE list_items SET done = 0, done_at = NULL, done_by = NULL, done_by_label = NULL, updated_at = ? WHERE ${scope} AND done = 1`)
    .bind(now, ...binds)
    .run();
  await db.prepare(`UPDATE list_item_steps SET done = 0, done_at = NULL, done_by = NULL, done_by_label = NULL WHERE done = 1 AND item_id IN (SELECT id FROM list_items WHERE ${scope})`).bind(...binds).run();
  return result.meta.changes;
}

listsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/lists/values',
    tags: ['Lists'],
    summary: 'Rename (to: a name) or remove (to: null) a store, category or aisle everywhere: items on every list, remembered places, group and aisle orders. An aisle belongs to a store (store: null = items with no store). A category with catalog changes only lists of that type and that catalog.',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: ListValueRenameSchema } } } },
    responses: { 200: { description: 'items changed', content: { 'application/json': { schema: z.object({ updated: z.number() }) } } } },
  }),
  async (c) => {
    const { field, from, to, catalog: cat } = c.req.valid('json');
    const store = c.req.valid('json').store ?? null;
    const db = c.env.DB;
    // A department is per catalog when one is given: only items on lists of that type (and their groups).
    const inCatalog = field === 'category' && cat ? " AND list_id IN (SELECT id FROM lists WHERE kind = 'shopping' AND coalesce(catalog, 'groceries') = ?)" : '';
    const catalogBind = inCatalog ? [cat] : [];
    const writes =
      field === 'store'
        ? [
            db.prepare('UPDATE list_items SET store = ? WHERE store = ?').bind(to, from),
            // OR REPLACE: renaming onto a store that already has a remembered row keeps the renamed one.
            db.prepare("UPDATE OR REPLACE item_memory SET store = coalesce(?, '') WHERE store = ?").bind(to, from),
            to
              ? db.prepare("UPDATE OR REPLACE list_groups SET name = ? WHERE kind = 'store' AND name = ?").bind(to, from)
              : db.prepare("DELETE FROM list_groups WHERE kind = 'store' AND name = ?").bind(from),
            to ? db.prepare('UPDATE OR REPLACE store_aisles SET store = ? WHERE store = ?').bind(to, from) : db.prepare('DELETE FROM store_aisles WHERE store = ?').bind(from),
          ]
        : field === 'category'
          ? [
              db.prepare(`UPDATE list_items SET category = ? WHERE category = ?${inCatalog}`).bind(to, from, ...catalogBind),
              db.prepare(`UPDATE item_memory SET category = ? WHERE category = ?${cat ? ' AND catalog = ?' : ''}`).bind(to, from, ...(cat ? [cat] : [])),
              to
                ? db.prepare(`UPDATE OR REPLACE list_groups SET name = ? WHERE kind = 'category' AND name = ?${inCatalog}`).bind(to, from, ...catalogBind)
                : db.prepare(`DELETE FROM list_groups WHERE kind = 'category' AND name = ?${inCatalog}`).bind(from, ...catalogBind),
            ]
          : [
              db.prepare("UPDATE list_items SET aisle = ? WHERE aisle = ? AND coalesce(store, '') = coalesce(?, '')").bind(to, from, store),
              db.prepare("UPDATE item_memory SET aisle = ? WHERE aisle = ? AND store = coalesce(?, '')").bind(to, from, store),
              to
                ? db.prepare("UPDATE OR REPLACE store_aisles SET aisle = ? WHERE aisle = ? AND store = coalesce(?, '')").bind(to, from, store)
                : db.prepare("DELETE FROM store_aisles WHERE aisle = ? AND store = coalesce(?, '')").bind(from, store),
            ];
    // The count runs first, in the same batch, so it's the items this rename touches.
    const count = db.prepare(`SELECT COUNT(*) AS n FROM list_items WHERE ${field} = ?${field === 'aisle' ? " AND coalesce(store, '') = coalesce(?, '')" : inCatalog}`).bind(...(field === 'aisle' ? [from, store] : [from, ...catalogBind]));
    const [counted] = await db.batch<{ n: number }>([count, ...writes]);
    emit(c, 'list.changed', { value: field });
    return c.json({ updated: counted.results[0]?.n ?? 0 }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/lists/aisles',
    tags: ['Lists'],
    summary: "Set a store's aisle walking order (store: null = items with no store), e.g. [\"Produce\", \"Bakery\", \"Aisle 4\", \"Frozen\", \"Aisle 5\", \"Dairy\"]. Aisle sort and grouping follow it; aisles not in it come after, in natural order. An empty array clears it. Every aisle in it is offered in that store's aisle picker.",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: StoreAislesSchema } } } },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: StoreAislesSchema } } } },
  }),
  async (c) => {
    const { store, aisles } = c.req.valid('json');
    const unique = [...new Set(aisles.map((a) => a.trim()).filter(Boolean))];
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM store_aisles WHERE store = ?').bind(store ?? ''),
      c.env.DB.prepare('INSERT INTO store_aisles (store, aisle, sort) SELECT ?, value, key FROM json_each(?)').bind(store ?? '', JSON.stringify(unique)),
    ]);
    emit(c, 'list.changed', { aisles: store });
    return c.json({ store, aisles: unique }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/lists/order',
    tags: ['Lists'],
    summary: 'Set the family-wide order of lists (sort = position). Lists not in ids (archived ones, other kinds) keep their relative order after the given ones. Unknown or repeated ids are rejected.',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: ListOrderSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: 'unknown or repeated id', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { ids } = c.req.valid('json');
    const { results } = await c.env.DB.prepare('SELECT id FROM lists ORDER BY sort, created_at').all<{ id: string }>();
    const known = results.map((r) => r.id);
    if (new Set(ids).size !== ids.length || ids.some((id) => !known.includes(id))) return c.json({ error: 'unknown or repeated list id' }, 400);
    const order = [...ids, ...known.filter((id) => !ids.includes(id))];
    await c.env.DB.batch(order.map((id, index) => c.env.DB.prepare('UPDATE lists SET sort = ? WHERE id = ?').bind(index, id)));
    emit(c, 'list.changed', { order: true });
    return c.json({ ok: true }, 200);
  },
);

listsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/lists/remembered/{key}',
    tags: ['Lists'],
    summary: 'Forget a remembered item name in a catalog (catalog=groceries, the default, or shopping; key: its matching key from suggestions.items): it stops being suggested there, and where it goes and its categories are forgotten. Items on lists keep it.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ key: z.string() }), query: CatalogQuery },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
  }),
  async (c) => {
    const { key } = c.req.valid('param');
    const { catalog: cat } = c.req.valid('query');
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM item_names WHERE catalog = ? AND name_key = ?').bind(cat, key),
      c.env.DB.prepare('DELETE FROM item_memory WHERE catalog = ? AND name_key = ?').bind(cat, key),
      c.env.DB.prepare('DELETE FROM item_tags WHERE catalog = ? AND name_key = ?').bind(cat, key),
    ]);
    emit(c, 'list.changed', { forgot: key });
    return c.json({ ok: true }, 200);
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
  403: { description: "a kid's own device: someone else's item", content: { 'application/json': { schema: ErrorSchema } } },
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
    const blocked = await itemOwnerBlock(c, id, oneItem(itemId));
    if (blocked) return c.json({ error: blocked }, 403);
    const { title } = c.req.valid('json');
    const db = c.env.DB;
    const item = await db.prepare('SELECT id FROM list_items WHERE id = ? AND list_id = ?').bind(itemId, id).first();
    if (!item) return c.json({ error: 'not found' }, 404);
    const now = new Date().toISOString();
    const by = await actorOf(c);
    await db.batch([
      db
        .prepare('INSERT INTO list_item_steps (id, item_id, title, done, done_at, sort, created_at, added_by, added_by_label) SELECT ?, ?, ?, 0, NULL, COALESCE(MAX(sort), -1) + 1, ?, ?, ? FROM list_item_steps WHERE item_id = ?')
        .bind(crypto.randomUUID(), itemId, title.trim(), now, by.memberId, by.label, itemId),
      syncItemFromSteps(db, itemId, now, by),
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
    const blocked = await itemOwnerBlock(c, id, oneItem(itemId));
    if (blocked) return c.json({ error: blocked }, 403);
    const body = c.req.valid('json');
    const db = c.env.DB;
    const step = await db
      .prepare('SELECT s.* FROM list_item_steps s JOIN list_items li ON li.id = s.item_id WHERE s.id = ? AND s.item_id = ? AND li.list_id = ?')
      .bind(stepId, itemId, id)
      .first<ListItemStepRow>();
    if (!step) return c.json({ error: 'not found' }, 404);
    const now = new Date().toISOString();
    const done = body.done !== undefined ? (body.done ? 1 : 0) : step.done;
    const by = await actorOf(c);
    // Who ticked it changes only with the tick: unchanged, it keeps its own.
    const [doneBy, doneByLabel] = done === step.done ? [step.done_by ?? null, step.done_by_label ?? null] : done ? [by.memberId, by.label] : [null, null];
    await db.batch([
      db
        .prepare('UPDATE list_item_steps SET title = ?, done = ?, done_at = ?, sort = ?, done_by = ?, done_by_label = ? WHERE id = ?')
        .bind(body.title !== undefined ? body.title.trim() : step.title, done, done === step.done ? step.done_at : done ? now : null, body.sort ?? step.sort, doneBy, doneByLabel, stepId),
      syncItemFromSteps(db, itemId, now, by),
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
    const blocked = await itemOwnerBlock(c, id, oneItem(itemId));
    if (blocked) return c.json({ error: blocked }, 403);
    const db = c.env.DB;
    const deleted = await db
      .prepare('DELETE FROM list_item_steps WHERE id = ? AND item_id IN (SELECT id FROM list_items WHERE id = ? AND list_id = ?)')
      .bind(stepId, itemId, id)
      .run();
    if (deleted.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    await syncItemFromSteps(db, itemId, new Date().toISOString(), await actorOf(c)).run();
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
    const blocked = await itemOwnerBlock(c, id, oneItem(itemId));
    if (blocked) return c.json({ error: blocked }, 403);
    const { stepIds } = c.req.valid('json');
    const db = c.env.DB;
    const item = await db.prepare('SELECT id FROM list_items WHERE id = ? AND list_id = ?').bind(itemId, id).first();
    if (!item) return c.json({ error: 'not found' }, 404);
    if (stepIds.length) await db.batch(stepIds.map((stepId, index) => db.prepare('UPDATE list_item_steps SET sort = ? WHERE id = ? AND item_id = ?').bind(index, stepId, itemId)));
    emit(c, 'list.item.changed', { listId: id, id: itemId });
    return c.json((await loadItem(db, id, itemId))!, 200);
  },
);
