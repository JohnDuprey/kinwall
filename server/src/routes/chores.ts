import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { todayInTz } from './members.ts';
import { emit } from '../bus.ts';
import { expand, isValidRrule } from '../recurrence.ts';
import { ChoreDaySchema, ChoreInputSchema, ChoreSchema, ErrorSchema } from '../schemas.ts';
import { resetListItems } from './lists.ts';
import { actorOf, deviceOwner, ownDevice, ownerBlock, requestKey } from '../auth.ts';
import { notifyChoreApproval } from '../notify.ts';
import { MealDateSchema } from '../meal-schemas.ts';

export const choresRoutes = createRouter();

export type ChoreRow = {
  id: string;
  title: string;
  emoji: string | null;
  member_id: string | null;
  points: number;
  rrule: string | null;
  due_date: string | null;
  due_time: string | null;
  active: number;
  sort: number;
  created_at: string;
  list_id?: string | null; // checklist; optional so older row literals (tests) still type-check
  plugin_id?: string | null; // activity; likewise optional
  plugin_minutes?: number | null;
  needs_approval?: number | null; // null = follow the member's default
  approve_timed_play?: number;
  archived?: number; // deleted after it was done: kept for its history (migration 0050)
  library_id?: string | null; // made from a chore library item (migration 0082)
};

export function toApi(row: ChoreRow) {
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    memberId: row.member_id,
    points: row.points,
    rrule: row.rrule,
    dueDate: row.due_date,
    dueTime: row.due_time,
    active: !!row.active,
    sort: row.sort,
    listId: row.list_id ?? null,
    pluginId: row.plugin_id ?? null,
    pluginMinutes: row.plugin_id ? row.plugin_minutes ?? DEFAULT_ACTIVITY_MINUTES : null,
    needsApproval: row.needs_approval == null ? null : !!row.needs_approval,
    approveTimedPlay: !!row.approve_timed_play,
    libraryId: row.library_id ?? null,
  };
}

export const DEFAULT_ACTIVITY_MINUTES = 5;

// An activity must be an installed plugin (on or off: turning it off only pauses the link).
async function checkPlugin(c: { env: Env }, pluginId: string | null | undefined): Promise<string | null> {
  if (!pluginId) return null;
  const row = await c.env.DB.prepare('SELECT id FROM plugins WHERE id = ?').bind(pluginId).first();
  return row ? null : 'unknown plugin';
}

// A checklist must be a real, unarchived list. Returns an error message or null.
async function checkList(c: { env: Env }, listId: string | null | undefined): Promise<string | null> {
  if (!listId) return null;
  const row = await c.env.DB.prepare('SELECT id FROM lists WHERE id = ? AND archived = 0').bind(listId).first();
  return row ? null : 'unknown list';
}

async function checkLibrary(c: { env: Env }, libraryId: string | null | undefined): Promise<string | null> {
  if (!libraryId) return null;
  const row = await c.env.DB.prepare('SELECT id FROM chore_library WHERE id = ?').bind(libraryId).first();
  return row ? null : 'unknown library chore';
}

/** Writes a new chore row (POST /api/chores, and assigning from the chore library). */
export async function insertChore(db: Env['DB'], row: ChoreRow): Promise<void> {
  await db
    .prepare(
      'INSERT INTO chores (id, title, emoji, member_id, points, rrule, due_date, due_time, active, sort, created_at, list_id, plugin_id, plugin_minutes, needs_approval, approve_timed_play, library_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
    .bind(row.id, row.title, row.emoji, row.member_id, row.points, row.rrule, row.due_date, row.due_time, row.active, row.sort, row.created_at, row.list_id ?? null, row.plugin_id ?? null, row.plugin_minutes ?? null, row.needs_approval ?? null, row.approve_timed_play ?? 0, row.library_id ?? null)
    .run();
}

choresRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/chores',
    tags: ['Chores'],
    summary: 'List chores',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ChoreSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM chores WHERE archived = 0 ORDER BY sort, created_at').all<ChoreRow>();
    return c.json(results.map(toApi), 200);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chores',
    tags: ['Chores'],
    summary: 'Create a chore',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: ChoreInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: ChoreSchema } } },
      400: { description: 'invalid rrule, unknown list, plugin or library chore', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if (body.rrule && !isValidRrule(body.rrule)) return c.json({ error: 'invalid rrule' }, 400);
    const listError = (await checkList(c, body.listId)) ?? (await checkPlugin(c, body.pluginId)) ?? (await checkLibrary(c, body.libraryId));
    if (listError) return c.json({ error: listError }, 400);
    const row: ChoreRow = {
      id: crypto.randomUUID(),
      title: body.title,
      emoji: body.emoji ?? null,
      member_id: body.memberId ?? null,
      points: body.points ?? 0,
      rrule: body.rrule ?? null,
      due_date: body.dueDate ?? null,
      due_time: body.dueTime ?? null,
      active: body.active === false ? 0 : 1,
      sort: body.sort ?? 0,
      created_at: new Date().toISOString(),
      list_id: body.listId ?? null,
      plugin_id: body.pluginId ?? null,
      plugin_minutes: body.pluginId ? body.pluginMinutes ?? DEFAULT_ACTIVITY_MINUTES : null,
      needs_approval: body.needsApproval == null ? null : body.needsApproval ? 1 : 0,
      approve_timed_play: body.approveTimedPlay ? 1 : 0,
      library_id: body.libraryId ?? null,
    };
    await insertChore(c.env.DB, row);
    emit(c, 'chore.changed', { id: row.id });
    return c.json(toApi(row), 201);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/chores/{id}',
    tags: ['Chores'],
    summary: 'Update a chore',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: ChoreInputSchema.omit({ libraryId: true }).partial() } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ChoreSchema } } },
      400: { description: 'invalid rrule, unknown list or unknown plugin', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    if (body.rrule && !isValidRrule(body.rrule)) return c.json({ error: 'invalid rrule' }, 400);
    const listError = (await checkList(c, body.listId)) ?? (await checkPlugin(c, body.pluginId));
    if (listError) return c.json({ error: listError }, 400);
    const existing = await c.env.DB.prepare('SELECT * FROM chores WHERE id = ? AND archived = 0').bind(id).first<ChoreRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const updated: ChoreRow = {
      ...existing,
      title: body.title ?? existing.title,
      emoji: body.emoji !== undefined ? body.emoji : existing.emoji,
      member_id: body.memberId !== undefined ? body.memberId : existing.member_id,
      points: body.points ?? existing.points,
      rrule: body.rrule !== undefined ? body.rrule : existing.rrule,
      due_date: body.dueDate !== undefined ? body.dueDate : existing.due_date,
      due_time: body.dueTime !== undefined ? body.dueTime : existing.due_time,
      active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
      sort: body.sort ?? existing.sort,
      list_id: body.listId !== undefined ? body.listId : existing.list_id ?? null,
      plugin_id: body.pluginId !== undefined ? body.pluginId : existing.plugin_id ?? null,
      needs_approval: body.needsApproval !== undefined ? (body.needsApproval === null ? null : body.needsApproval ? 1 : 0) : existing.needs_approval ?? null,
      approve_timed_play: body.approveTimedPlay !== undefined ? (body.approveTimedPlay ? 1 : 0) : existing.approve_timed_play ?? 0,
    };
    updated.plugin_minutes = updated.plugin_id ? body.pluginMinutes ?? existing.plugin_minutes ?? DEFAULT_ACTIVITY_MINUTES : null;
    await c.env.DB.prepare(
      'UPDATE chores SET title=?, emoji=?, member_id=?, points=?, rrule=?, due_date=?, due_time=?, active=?, sort=?, list_id=?, plugin_id=?, plugin_minutes=?, needs_approval=?, approve_timed_play=? WHERE id=?',
    )
      .bind(updated.title, updated.emoji, updated.member_id, updated.points, updated.rrule, updated.due_date, updated.due_time, updated.active, updated.sort, updated.list_id, updated.plugin_id, updated.plugin_minutes, updated.needs_approval, updated.approve_timed_play, id)
      .run();
    emit(c, 'chore.changed', { id });
    return c.json(toApi(updated), 200);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/chores/{id}',
    tags: ['Chores'],
    summary: 'Delete a chore. One that was ever done is archived instead: it leaves every list, but its completions and the points earned from them stay.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    // A tick still waiting for a parent's OK goes (nothing was earned); approved ones are history,
    // so a chore that has any is archived rather than deleted, and all-time counts don't drop.
    await c.env.DB.prepare("DELETE FROM chore_completions WHERE chore_id = ? AND status = 'pending' AND EXISTS (SELECT 1 FROM chores WHERE id = ? AND archived = 0)").bind(id, id).run();
    const archived = await c.env.DB.prepare('UPDATE chores SET archived = 1, active = 0 WHERE id = ? AND archived = 0 AND EXISTS (SELECT 1 FROM chore_completions WHERE chore_id = chores.id)').bind(id).run();
    const result = archived.meta.changes ? archived : await c.env.DB.prepare('DELETE FROM chores WHERE id = ? AND archived = 0').bind(id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'chore.changed', { id });
    return c.json({ ok: true }, 200);
  },
);

type PluginInfo = { id: string; name: string; manifest: string; enabled: number };
type PlayRow = { member_id: string; plugin_id: string; seconds: number };

/** A linked chore's activity and the day's play (`play` = that day's playtime rows). */
export function activityProgress(row: ChoreRow, plugins: Map<string, PluginInfo>, play: PlayRow[]) {
  if (!row.plugin_id) return null;
  const p = plugins.get(row.plugin_id);
  const done = play.filter((r) => r.plugin_id === row.plugin_id && (!row.member_id || r.member_id === row.member_id)).map((r) => Number(r.seconds));
  return {
    pluginId: row.plugin_id,
    name: p?.name ?? null,
    emoji: p ? ((JSON.parse(p.manifest) as { emoji?: string }).emoji ?? null) : null,
    available: !!p?.enabled,
    needSeconds: (row.plugin_minutes ?? DEFAULT_ACTIVITY_MINUTES) * 60,
    doneSeconds: Math.max(0, ...done),
  };
}

// A chore is due on `date` (household tz) if: one-off matching due_date, or its rrule
// occurs that day (anchored at due_date if set, else its creation date).
// Exported for reuse by routes/leaderboard.ts (streak calculation) - single source of truth
// for "which chores are due on date X".
export function dueOnDate(row: ChoreRow, date: string, tz: string): boolean {
  return dueDates(row, date, date, tz).has(date);
}

/** The days from `from` to `to` (inclusive, YYYY-MM-DD) a chore is due, in one expansion - what
 * a scan over many days (the streak) uses instead of dueOnDate per day. */
export function dueDates(row: ChoreRow, from: string, to: string, tz: string): Set<string> {
  if (!row.rrule) return new Set(row.due_date && row.due_date >= from && row.due_date <= to ? [row.due_date] : []);
  // The creation *day* in the household tz: created_at is UTC, so an evening chore west of UTC
  // would otherwise anchor on tomorrow and not show up until then.
  const anchor = row.due_date ?? todayInTz(tz, new Date(row.created_at));
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(new Date(`${to}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000);
  try {
    return new Set(expand(row.rrule, anchor, anchor, true, tz, start, end).map((i) => i.start));
  } catch {
    return new Set(); // a bad stored rrule (pre-validation rows) hides that chore, not the whole day
  }
}

choresRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/chores/day',
    tags: ['Chores'],
    summary: 'Chores due on a date (household timezone), with completion state',
    security: [{ Bearer: [] }],
    request: { query: z.object({ date: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ChoreDaySchema) } } } },
  }),
  async (c) => {
    const { date } = c.req.valid('query');

    // tz, chores and completions are all independent reads - one batch, one round trip.
    const [tzRes, choresRes, completionsRes, checklistRes, pluginsRes, playRes, rejectionsRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
      c.env.DB.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY sort, created_at'),
      c.env.DB.prepare('SELECT * FROM chore_completions WHERE date = ?').bind(date),
      // Checklist progress per chore: the linked list's items owned by the chore's member plus
      // unassigned ones (an "anyone" chore sees the whole list), so one list can back a routine
      // for several members.
      c.env.DB.prepare(
        'SELECT ch.id AS chore_id, l.id AS list_id, l.name, COUNT(i.id) AS total, COALESCE(SUM(i.done), 0) AS done FROM chores ch JOIN lists l ON l.id = ch.list_id LEFT JOIN list_items i ON i.list_id = l.id AND (ch.member_id IS NULL OR i.member_id IS NULL OR i.member_id = ch.member_id) WHERE ch.active = 1 GROUP BY ch.id',
      ),
      c.env.DB.prepare('SELECT id, name, manifest, enabled FROM plugins'),
      c.env.DB.prepare('SELECT member_id, plugin_id, seconds FROM plugin_playtime WHERE date = ?').bind(date),
      c.env.DB.prepare('SELECT chore_id, note, rejected_at FROM chore_rejections WHERE date = ?').bind(date),
    ]);
    const rejections = new Map((rejectionsRes.results as { chore_id: string; note: string | null; rejected_at: string }[]).map((r) => [r.chore_id, r]));
    const plugins = new Map((pluginsRes.results as PluginInfo[]).map((p) => [p.id, p]));
    const play = playRes.results as PlayRow[];
    const checklists = new Map((checklistRes.results as { chore_id: string; list_id: string; name: string; total: number; done: number }[]).map((r) => [r.chore_id, r]));
    const tz = (tzRes.results[0] as { value: string } | undefined)?.value ?? hostTimezone();
    const chores = choresRes.results as unknown as ChoreRow[];
    const completions = completionsRes.results as unknown as { chore_id: string; member_id: string | null; completed_at: string; status: string }[];

    const due = chores.filter((row) => dueOnDate(row, date, tz));
    const byChore = new Map(completions.map((row) => [row.chore_id, row]));

    return c.json(
      due.map((row) => {
        const completion = byChore.get(row.id);
        const cl = row.list_id ? checklists.get(row.id) : undefined;
        const rejection = rejections.get(row.id);
        return {
          ...toApi(row),
          // A completion waiting for a parent's OK isn't done yet (no points, not counted).
          completed: completion?.status === 'approved',
          pending: completion?.status === 'pending',
          rejection: rejection && !completion ? { note: rejection.note, at: rejection.rejected_at } : null,
          completedAt: completion?.completed_at ?? null,
          completedBy: completion?.member_id ?? null,
          checklist: cl ? { listId: cl.list_id, name: cl.name, total: Number(cl.total), done: Number(cl.done) } : null,
          activity: activityProgress(row, plugins, play),
        };
      }),
      200,
    );
  },
);

/** How far back a wall screen or a kid's device can tick a chore (it may also be a day ahead of the household's today). */
const DISPLAY_DAYS_BACK = 7;
const shiftDay = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Points a completion earns: full on the day (or ahead of it), `creditPercent` of them when it's
// ticked off for a past day (never below 0).
export function lateCompletionPoints(points: number, late: boolean, creditPercent: number): number {
  return late ? Math.max(0, Math.round((points * creditPercent) / 100)) : points;
}

/**
 * Completes a chore for `date`: the checklist gate, parent approval, points (late credit), the
 * chore.completed event (webhooks, notifications) and a reusable checklist's reset. Shared by the
 * tick and by activity playtime (routes/plugins.ts), which passes `timedPlay` so a chore already
 * done that day is left alone. A wall screen or kid's device (display key) ticking a chore that
 * needs a parent's OK writes a 'pending' completion instead: no points and no chore.completed until
 * POST /api/chores/{id}/approve. Returns true when an approved completion was written, 'pending'
 * for a pending one, false when timedPlay found one already, the number of open checklist items
 * when that gates it, 'not found', or { blocked } when a member's own device tries it for
 * someone else (their chore, crediting them, or taking over their completion).
 */
export async function completeChore(c: Context<{ Bindings: Env }>, id: string, date: string, memberId: string | undefined, timedPlay = false): Promise<boolean | 'pending' | number | 'not found' | { blocked: string } | { notDue: string }> {
  // A member's own device credits them when no one is named (an Anyone chore, like the app does).
  memberId ??= (await deviceOwner(c)) ?? undefined;
  const [choreRes, settingsRes] = await c.env.DB.batch<unknown>([
    c.env.DB.prepare(
      'SELECT c.*, (SELECT needs_approval FROM members WHERE id = COALESCE(?, c.member_id)) AS member_needs_approval, (SELECT member_id FROM chore_completions WHERE chore_id = c.id AND date = ?) AS done_by, (SELECT COUNT(*) FROM chore_completions WHERE chore_id = c.id AND date != ?) AS other_days FROM chores c WHERE c.id = ? AND c.archived = 0',
    ).bind(memberId ?? null, date, date, id),
    c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('timezone', 'lateCompletionCredit')"),
  ]);
  const chore = choreRes.results[0] as (ChoreRow & { approve_timed_play: number; member_needs_approval: number | null; done_by: string | null; other_days: number }) | undefined;
  if (!chore) return 'not found';
  const blocked = await ownerBlock(c, memberId, chore.member_id, chore.done_by);
  if (blocked) return { blocked };
  const settings = new Map((settingsRes.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const tz = settings.get('timezone') ?? hostTimezone();
  const today = todayInTz(tz);
  const display = (await requestKey(c))?.scope === 'display';
  // Points are counted per day ticked, so a day has to be one the chore is really due on; and a
  // wall screen or kid's device only ticks around today (a parent's device can fix up older days).
  // A one-off with no day set (made through the API) is done once, on whichever day.
  const due = chore.rrule || chore.due_date ? dueOnDate(chore, date, tz) : !Number(chore.other_days);
  if (!chore.active || !due) return { notDue: "This chore isn't due on that day." };
  if (display && (date < shiftDay(today, -DISPLAY_DAYS_BACK) || date > shiftDay(today, 1))) return { notDue: `From this device a chore can be ticked for the last ${DISPLAY_DAYS_BACK} days. Older days are for a parent's device.` };
  // So does a grown-up's own full-access device (their phone), which otherwise acts for anyone.
  if (!memberId && !chore.member_id) memberId = (await ownDevice(c)) ?? undefined;
  // The checklist gates completion: the list's items for this chore's member (or whoever is
  // completing an "anyone" chore) plus unassigned ones. An empty set doesn't gate.
  const forMember = chore.member_id ?? memberId ?? null;
  let checklistKind: string | null = null;
  if (chore.list_id) {
    const list = await c.env.DB.prepare(
      'SELECT kind, (SELECT COUNT(*) FROM list_items WHERE list_id = lists.id AND done = 0 AND (? IS NULL OR member_id IS NULL OR member_id = ?)) AS remaining FROM lists WHERE id = ?',
    )
      .bind(forMember, forMember, chore.list_id)
      .first<{ kind: string; remaining: number }>();
    if (list && Number(list.remaining) > 0) return Number(list.remaining);
    checklistKind = list?.kind ?? null;
  }
  // Parent devices (admin keys) are approved straight away. Timed play follows the chore's own
  // "even for timed play" switch; a tick follows the chore, else the person's default.
  const needsOk = timedPlay ? !!chore.approve_timed_play : !!(chore.needs_approval ?? chore.member_needs_approval);
  const pending = needsOk && display;
  const pointsAwarded = pending ? 0 : lateCompletionPoints(chore.points, date < today, Number(settings.get('lateCompletionCredit') ?? 50));
  const who = memberId ?? chore.member_id;
  // Re-ticking an existing completion (e.g. to change who did it) keeps the points and status it
  // already has, unless it now names someone else whose tick needs a parent's OK: that one waits.
  const waits = "excluded.status = 'pending' AND chore_completions.member_id IS NOT excluded.member_id";
  const [writtenRes] = await c.env.DB.batch<unknown>([
    c.env.DB.prepare(
      `INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, points_awarded, status) VALUES (?,?,?,?,?,?,?) ON CONFLICT(chore_id, date) DO ${timedPlay ? 'NOTHING' : `UPDATE SET status = CASE WHEN ${waits} THEN 'pending' ELSE status END, points_awarded = CASE WHEN ${waits} THEN 0 ELSE points_awarded END, member_id = excluded.member_id, completed_at = excluded.completed_at`} RETURNING status, points_awarded`,
    ).bind(crypto.randomUUID(), id, date, who, new Date().toISOString(), pointsAwarded, pending ? 'pending' : 'approved'),
    c.env.DB.prepare('DELETE FROM chore_rejections WHERE chore_id = ? AND date = ?').bind(id, date), // ticked again: the "Not yet" note goes
  ]);
  const written = writtenRes.results[0] as { status: string; points_awarded: number } | undefined;
  if (!written) return false;
  // A reusable checklist starts fresh for the next time the chore comes round - just this
  // member's items and the shared ones, so a sibling's ticks on the same list survive.
  if (chore.list_id && checklistKind === 'reusable') {
    await resetListItems(c.env.DB, chore.list_id, forMember, null, who ? { memberId: who, label: null } : await actorOf(c));
    emit(c, 'list.changed', { id: chore.list_id });
  }
  if (written.status === 'pending') {
    emit(c, 'chore.pending', { id, date, title: chore.title, memberId: who });
    const name = who ? (await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(who).first<{ name: string }>())?.name : null;
    notifyChoreApproval(c.env, execCtx(c), 'parents', `approve:${id}:${date}`, {
      title: `${name ?? 'Someone'} finished ${chore.title}. Approve?`,
      body: 'Open Chores to approve it or say not yet.',
      url: '/#/chores',
      memberIds: who ? [who] : [],
    });
    return 'pending';
  }
  // Title and member ride along so a receiver (Home Assistant, n8n) can act without a lookup.
  emit(c, 'chore.completed', { id, date, title: chore.title, memberId: who, points: written.points_awarded });
  return true;
}

function execCtx(c: Context<{ Bindings: Env }>) {
  try {
    return c.executionCtx;
  } catch {
    return undefined; // Node: no ExecutionContext
  }
}

choresRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chores/{id}/complete',
    tags: ['Chores'],
    summary: 'Mark a chore complete for a date',
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: z.object({ date: MealDateSchema, memberId: z.string().optional() }) } } },
    },
    responses: {
      200: { description: 'ok; pending: true when it waits for a parent\'s OK', content: { 'application/json': { schema: z.object({ ok: z.boolean(), pending: z.boolean() }) } } },
      400: { description: "not a date, a day the chore isn't due on (or it's paused), or from a wall screen or kid's device a day more than a week back or more than a day ahead", content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: "this device belongs to someone else", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'checklist not finished', content: { 'application/json': { schema: ErrorSchema.extend({ remaining: z.number() }) } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { date, memberId } = c.req.valid('json');
    const r = await completeChore(c, id, date, memberId);
    if (r === 'not found') return c.json({ error: 'not found' }, 404);
    if (typeof r === 'object') return 'blocked' in r ? c.json({ error: r.blocked }, 403) : c.json({ error: r.notDue }, 400);
    if (typeof r === 'number') return c.json({ error: `Checklist not finished (${r} left)`, remaining: r }, 409);
    return c.json({ ok: true, pending: r === 'pending' }, 200);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/chores/{id}/complete',
    tags: ['Chores'],
    summary: 'Undo a chore completion for a date',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), query: z.object({ date: MealDateSchema }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      403: { description: 'this device belongs to someone else', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { date } = c.req.valid('query');
    const chore = await c.env.DB.prepare('SELECT title, member_id, (SELECT member_id FROM chore_completions WHERE chore_id = chores.id AND date = ?) AS done_by FROM chores WHERE id = ?')
      .bind(date, id)
      .first<{ title: string; member_id: string | null; done_by: string | null }>();
    const blocked = await ownerBlock(c, chore?.member_id, chore?.done_by);
    if (blocked) return c.json({ error: blocked }, 403);
    await c.env.DB.prepare('DELETE FROM chore_completions WHERE chore_id = ? AND date = ?').bind(id, date).run();
    emit(c, 'chore.uncompleted', { id, date, title: chore?.title ?? null, memberId: chore?.member_id ?? null });
    return c.json({ ok: true }, 200);
  },
);

// ---- Parent approval. Not in auth.ts's display allow-list, so only parent devices (admin keys)
// reach these; wall screens and kids' devices can tick and untick but never approve.

const PendingApprovalSchema = z
  .object({
    choreId: z.string(),
    title: z.string(),
    emoji: z.string().nullable(),
    date: z.string(),
    memberId: z.string().nullable(),
    completedAt: z.string(),
    points: z.number().openapi({ description: 'What approving awards (late credit from the day it was ticked, not today).' }),
  })
  .openapi('PendingApproval');

type PendingRow = { chore_id: string; title: string; emoji: string | null; date: string; member_id: string | null; completed_at: string; points: number };

async function creditSettings(c: { env: Env }) {
  const { results } = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('timezone', 'lateCompletionCredit')").all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return { tz: map.get('timezone') ?? hostTimezone(), credit: Number(map.get('lateCompletionCredit') ?? 50) };
}

// Late credit is judged by when it was ticked: done on the day earns in full even if approved tomorrow.
function approvalPoints(row: PendingRow, s: { tz: string; credit: number }): number {
  return lateCompletionPoints(row.points, row.date < todayInTz(s.tz, new Date(row.completed_at)), s.credit);
}

export const PENDING_SQL =
  "SELECT cc.chore_id, c.title, c.emoji, cc.date, cc.member_id, cc.completed_at, c.points FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id WHERE cc.status = 'pending'";

choresRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/chores/pending',
    tags: ['Chores'],
    summary: "Chores waiting for a parent's OK, oldest first (parent devices only)",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(PendingApprovalSchema) } } } },
  }),
  async (c) => {
    const s = await creditSettings(c);
    const { results } = await c.env.DB.prepare(`${PENDING_SQL} ORDER BY cc.completed_at`).all<PendingRow>();
    return c.json(results.map((r) => ({ choreId: r.chore_id, title: r.title, emoji: r.emoji, date: r.date, memberId: r.member_id, completedAt: r.completed_at, points: approvalPoints(r, s) })), 200);
  },
);

const DateBody = z.object({ date: z.string() });

choresRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chores/{id}/approve',
    tags: ['Chores'],
    summary: "Approve a completion waiting for a parent's OK: awards its points and emits chore.completed (parent devices only)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: DateBody } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean(), points: z.number() }) } } },
      404: { description: 'nothing waiting for approval', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { date } = c.req.valid('json');
    const row = await c.env.DB.prepare(`${PENDING_SQL} AND cc.chore_id = ? AND cc.date = ?`).bind(id, date).first<PendingRow>();
    if (!row) return c.json({ error: 'nothing waiting for approval' }, 404);
    const points = approvalPoints(row, await creditSettings(c));
    // Guarded on status so a double tap (two parents at once) awards once.
    const res = await c.env.DB.prepare("UPDATE chore_completions SET status = 'approved', points_awarded = ? WHERE chore_id = ? AND date = ? AND status = 'pending'").bind(points, id, date).run();
    if (res.meta.changes === 0) return c.json({ error: 'nothing waiting for approval' }, 404);
    emit(c, 'chore.completed', { id, date, title: row.title, memberId: row.member_id, points });
    return c.json({ ok: true, points }, 200);
  },
);

choresRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chores/{id}/reject',
    tags: ['Chores'],
    summary: "\"Not yet\": remove a completion waiting for a parent's OK and leave an optional note on the chore until it's ticked again; tells the kid's devices (parent devices only)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: DateBody.extend({ note: z.string().max(200).optional() }) } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'nothing waiting for approval', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { date, note: raw } = c.req.valid('json');
    const note = raw?.trim() || null;
    const row = await c.env.DB.prepare(`${PENDING_SQL} AND cc.chore_id = ? AND cc.date = ?`).bind(id, date).first<PendingRow>();
    if (!row) return c.json({ error: 'nothing waiting for approval' }, 404);
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM chore_completions WHERE chore_id = ? AND date = ? AND status = 'pending'").bind(id, date),
      c.env.DB.prepare(
        'INSERT INTO chore_rejections (chore_id, date, member_id, note, rejected_at) VALUES (?,?,?,?,?) ON CONFLICT(chore_id, date) DO UPDATE SET member_id = excluded.member_id, note = excluded.note, rejected_at = excluded.rejected_at',
      ).bind(id, date, row.member_id, note, now),
    ]);
    emit(c, 'chore.rejected', { id, date, title: row.title, memberId: row.member_id, note });
    if (row.member_id) {
      notifyChoreApproval(c.env, execCtx(c), { owner: row.member_id }, `notyet:${id}:${date}:${now}`, {
        title: `Not yet: ${row.title}`,
        body: note ?? 'Give it another go, then tick it again.',
        url: '/#/chores',
        memberIds: [row.member_id],
      });
    }
    return c.json({ ok: true }, 200);
  },
);
