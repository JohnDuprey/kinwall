import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { hostTimezone } from '../env.ts';
import { AvatarSchema, ErrorSchema, MemberInputSchema, MemberSchema, TEMP_CHECK_OFF, TRANSITIONS_OFF } from '../schemas.ts';
import { parseMemberIds } from '../calendar-members.ts';
import { balanceOf, pointTotalsStmt, type PointTotals } from '../stickers.ts';
import { privacyOf, privateNow, type PrivacyRow } from '../journal-privacy.ts';
import { actorOf, deviceOwner, isConnectedApp, requestKey } from '../auth.ts';
import type { Context } from 'hono';
import type { KinwallStatement } from '../db.ts';
import { recordNotification } from '../notify.ts';
import { pushGrownUps, securityEventStmts } from './security-events.ts';

export const membersRoutes = createRouter();

type MemberRow = { id: string; name: string; color: string; avatar: string | null; birthday: string | null; sort: number; created_at: string; needs_approval?: number; grown_up?: number; transitions: string | null; reward_goal?: string | null; temp_check?: string | null; journal_private?: number | null; journal_private_allowed?: number | null };

// The stored JSON, or off. Shared with notify.ts (which only acts on `on`).
export function parseTransitions(raw: string | null): typeof TRANSITIONS_OFF {
  if (!raw) return TRANSITIONS_OFF;
  try {
    return { ...TRANSITIONS_OFF, ...JSON.parse(raw) };
  } catch {
    return TRANSITIONS_OFF;
  }
}

/** A member's Temp check settings (members.temp_check), or off. */
export function parseTempCheck(raw: string | null | undefined): typeof TEMP_CHECK_OFF {
  if (!raw) return TEMP_CHECK_OFF;
  try {
    return { ...TEMP_CHECK_OFF, ...JSON.parse(raw) };
  } catch {
    return TEMP_CHECK_OFF;
  }
}

// Goals set around now: the household's today is within a day of UTC's, so this reads before the
// timezone is known (in the same batch), and todayGoals picks today's.
const recentGoals = (db: KinwallDb) => {
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  return db.prepare('SELECT member_id, date, goal FROM temp_checks WHERE date BETWEEN ? AND ? AND goal IS NOT NULL').bind(day(-1), day(1));
};
type GoalRow = { member_id: string; date: string; goal: string };

/** Today's goals by member (household day): only while the member has Temp check and its goal question on. */
function todayGoals(goals: GoalRow[], today: string, rows: MemberRow[]): Map<string, string> {
  const on = new Set(rows.filter((r) => { const t = parseTempCheck(r.temp_check); return t.on && t.goal; }).map((r) => r.id));
  return new Map(goals.filter((r) => r.date === today && on.has(r.member_id)).map((r) => [r.member_id, r.goal]));
}

// 18 or older on `today` (YYYY-MM-DD), from a birthday with a year. Same rule as migration 0051;
// used to infer grown-ups in imports from before the flag existed.
export function isAdultBirthday(birthday: string | null | undefined, today: string): boolean {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return false;
  return `${String(Number(birthday.slice(0, 4)) + 18).padStart(4, '0')}${birthday.slice(4)}` <= today;
}

// Exported for reuse by routes/leaderboard.ts (period boundaries use the same household tz/weekStart).
// Cached per timezone (a board or snapshot asks once per event).
const dayFormats = new Map<string, Intl.DateTimeFormat>();
export function todayInTz(tz: string, at = new Date()): string {
  let f = dayFormats.get(tz);
  if (!f) dayFormats.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }))); // en-CA -> YYYY-MM-DD
  return f.format(at);
}

export function weekStartDate(tz: string, weekStart: 0 | 1, at = new Date()): string {
  const todayStr = todayInTz(tz, at);
  const [y, m, d] = todayStr.split('-').map(Number);
  const asUtcNoon = new Date(Date.UTC(y, m - 1, d, 12)); // noon avoids DST-edge date-shift
  const dow = asUtcNoon.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow - weekStart + 7) % 7;
  asUtcNoon.setUTCDate(asUtcNoon.getUTCDate() - diff);
  return asUtcNoon.toISOString().slice(0, 10);
}

export async function household(db: KinwallDb): Promise<{ tz: string; weekStart: 0 | 1 }> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('timezone','weekStart')")
    .all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return { tz: map.get('timezone') ?? hostTimezone(), weekStart: (Number(map.get('weekStart') ?? 0) as 0 | 1) };
}

async function pointsFor(db: KinwallDb, memberId: string, tz: string, weekStart: 0 | 1) {
  const today = todayInTz(tz);
  const weekFrom = weekStartDate(tz, weekStart);
  const todayRow = await db
    .prepare(
      `SELECT COALESCE(SUM(cc.points_awarded), 0) AS total FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id WHERE cc.member_id = ? AND cc.date = ?`,
    )
    .bind(memberId, today)
    .first<{ total: number }>();
  const weekRow = await db
    .prepare(
      `SELECT COALESCE(SUM(cc.points_awarded), 0) AS total FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id WHERE cc.member_id = ? AND cc.date >= ? AND cc.date <= ?`,
    )
    .bind(memberId, weekFrom, today)
    .first<{ total: number }>();
  return { pointsToday: todayRow?.total ?? 0, pointsWeek: weekRow?.total ?? 0 };
}

// All members' today/week points in one query (grouped + conditional SUM) instead of two
// queries per member - what GET /api/members uses instead of pointsFor() in a loop. Balances ride
// the same batch, so it stays one round trip. Binds today, week start, today, week start, today:
// only this week's rows are read (through the date index); older ones add nothing to either sum.
export const PERIOD_POINTS_SQL = `SELECT cc.member_id AS member_id,
                COALESCE(SUM(CASE WHEN cc.date = ? THEN cc.points_awarded ELSE 0 END), 0) AS today,
                COALESCE(SUM(CASE WHEN cc.date >= ? AND cc.date <= ? THEN cc.points_awarded ELSE 0 END), 0) AS week
         FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id
         WHERE cc.member_id IS NOT NULL AND cc.date >= ? AND cc.date <= ?
         GROUP BY cc.member_id`;

async function pointsByMember(db: KinwallDb, tz: string, weekStart: 0 | 1): Promise<Map<string, Points>> {
  const today = todayInTz(tz);
  const weekFrom = weekStartDate(tz, weekStart);
  const [periodRes, totalsRes] = await db.batch<unknown>([
    db
      .prepare(PERIOD_POINTS_SQL)
      .bind(today, weekFrom, today, weekFrom, today),
    pointTotalsStmt(db),
  ]);
  const period = new Map((periodRes.results as { member_id: string; today: number; week: number }[]).map((r) => [r.member_id, r]));
  return new Map(
    (totalsRes.results as PointTotals[]).map((t) => {
      const p = period.get(t.member_id);
      return [t.member_id, { pointsToday: p?.today ?? 0, pointsWeek: p?.week ?? 0, balance: t.earned - t.spent }];
    }),
  );
}

type Points = { pointsToday: number; pointsWeek: number; balance: number };
const NO_POINTS: Points = { pointsToday: 0, pointsWeek: 0, balance: 0 };

type Goal = { rewardId: string; title: string; emoji: string | null; cost: number };

// Active rewards by id, for members' goals (an archived or deleted goal reads as none).
const GOALS_SQL = 'SELECT id, title, emoji, cost FROM rewards WHERE active = 1';
const toGoals = (rows: { id: string; title: string; emoji: string | null; cost: number }[]): Map<string, Goal> =>
  new Map(rows.map((r) => [r.id, { rewardId: r.id, title: r.title, emoji: r.emoji, cost: r.cost }]));
const goalRewards = async (db: KinwallDb) => toGoals((await db.prepare(GOALS_SQL).all<{ id: string; title: string; emoji: string | null; cost: number }>()).results);

function toApi(row: MemberRow, points: Points, goals: Map<string, Goal> = new Map(), todays: Map<string, string> = new Map()) {
  return { id: row.id, name: row.name, color: row.color, avatar: row.avatar, birthday: row.birthday ?? null, sort: row.sort, grownUp: !!row.grown_up, needsApproval: !!row.needs_approval, ...points, transitionReminders: parseTransitions(row.transitions), rewardGoal: (row.reward_goal && goals.get(row.reward_goal)) || null, tempCheck: parseTempCheck(row.temp_check), todayGoal: todays.get(row.id) ?? null, privateJournal: privacyOf({ grown_up: row.grown_up ?? 0, journal_private: row.journal_private ?? null, journal_private_allowed: row.journal_private_allowed ?? 0 }) };
}

membersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members',
    tags: ['Members'],
    summary: 'List family members',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(MemberSchema) } } } },
  }),
  async (c) => {
    // household settings + the member list are independent reads - one batch, one round trip.
    const [settingsRes, membersRes, goalsRes, recentRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('timezone','weekStart')"),
      c.env.DB.prepare('SELECT * FROM members ORDER BY sort, created_at'),
      c.env.DB.prepare(GOALS_SQL),
      recentGoals(c.env.DB),
    ]);
    const settingsMap = new Map((settingsRes.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const tz = settingsMap.get('timezone') ?? hostTimezone();
    const weekStart = (Number(settingsMap.get('weekStart') ?? 0) as 0 | 1);
    const results = membersRes.results as unknown as MemberRow[];

    const points = await pointsByMember(c.env.DB, tz, weekStart);
    const goals = toGoals(goalsRes.results as { id: string; title: string; emoji: string | null; cost: number }[]);
    const todays = todayGoals(recentRes.results as GoalRow[], todayInTz(tz), results);
    return c.json(results.map((row) => toApi(row, points.get(row.id) ?? NO_POINTS, goals, todays)), 200);
  },
);

membersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/members',
    tags: ['Members'],
    summary: 'Create a family member',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: MemberInputSchema } } } },
    responses: { 201: { description: 'created', content: { 'application/json': { schema: MemberSchema } } } },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const row: MemberRow = {
      id: crypto.randomUUID(),
      name: body.name,
      color: body.color,
      avatar: body.avatar ?? null,
      birthday: body.birthday ?? null,
      // New ones go last; a flat 0 made every row tie, so the saved order couldn't hold.
      sort: body.sort ?? ((await c.env.DB.prepare('SELECT MAX(sort) AS m FROM members').first<{ m: number | null }>())?.m ?? -1) + 1,
      created_at: new Date().toISOString(),
      // A grown-up's chores never wait for an OK: needsApproval is ignored for them.
      grown_up: body.grownUp ? 1 : 0,
      needs_approval: body.needsApproval && !body.grownUp ? 1 : 0,
      transitions: body.transitionReminders ? JSON.stringify(body.transitionReminders) : null,
      temp_check: body.tempCheck ? JSON.stringify(body.tempCheck) : null,
    };
    await c.env.DB.prepare('INSERT INTO members (id, name, color, avatar, birthday, sort, created_at, grown_up, needs_approval, transitions, temp_check) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(row.id, row.name, row.color, row.avatar, row.birthday, row.sort, row.created_at, row.grown_up, row.needs_approval, row.transitions, row.temp_check)
      .run();
    emit(c, 'member.changed', { id: row.id });
    return c.json(toApi(row, NO_POINTS), 201);
  },
);

// Who is a grown-up decides who reads their journal (journal-privacy.ts) and which devices can be
// theirs (auth.ts validOwner), so changing it is never silent and never a connected app's to do
// (PATCH below and POST /api/import, routes/data.ts). It leaves a line in Security activity, a
// privacy note for that person and a push to parent devices (while they're marked a kid, their own
// phone isn't "theirs", so the note alone would wait). A private journal stays private when a
// grown-up is marked a kid: new entries don't open on parents' devices until a parent turns that off
// (PUT .../journal/privacy, which says so too), and what they wrote before stays theirs alone
// (journal-privacy.ts privateLevel).
export const APP_GROWN_UP = { error: "Connected apps can't change who is a grown-up. Do this from a parent's own device." };
const grownUpTitle = (name: string, grownUp: boolean) => (grownUp ? `${name} is now marked as a grown-up` : `${name} is no longer marked as a grown-up`);
/** For the batch that changes `m` (as it was) to `grownUp`. */
export async function grownUpChangeStmts(c: Context<{ Bindings: Env }>, m: PrivacyRow & { id: string }, grownUp: boolean, name = m.name): Promise<KinwallStatement[]> {
  const db = c.env.DB;
  return [
    ...(!grownUp && privateNow(m) ? [db.prepare('UPDATE members SET journal_private = 1, journal_private_allowed = 1 WHERE id = ?').bind(m.id)] : []),
    ...securityEventStmts(db, { kind: 'member.grown_up', summary: grownUpTitle(name, grownUp), by: await actorOf(c), about: m.id }),
  ];
}
/** After that batch: tell them, and parent devices. */
export async function noteGrownUpChange(c: Context<{ Bindings: Env }>, id: string, name: string, grownUp: boolean): Promise<void> {
  const note = {
    title: grownUpTitle(name, grownUp),
    body: grownUp
      ? `Changed on a parent's device. ${name}'s private journal entries open only on ${name}'s own phone or computer.`
      : `Changed on a parent's device. What ${name} wrote in private stays private. A kid's device can now be ${name}'s, and parents decide whether new entries can be private.`,
  };
  await recordNotification(c.env.DB, { kind: 'privacy', ...note, url: `/#/journal/${id}`, memberIds: [id], source: 'system' });
  pushGrownUps(c, note);
}

membersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/members/{id}',
    tags: ['Members'],
    summary: "Update a family member. Changing grownUp is for the family's own devices (not connected apps); it's logged in Security activity and that person gets a privacy note.",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { 'application/json': { schema: MemberInputSchema.partial() } } },
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: MemberSchema } } },
      403: { description: 'a connected app changing grownUp', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<MemberRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const flipped = body.grownUp !== undefined && body.grownUp !== !!existing.grown_up;
    if (flipped && (await isConnectedApp(c))) return c.json(APP_GROWN_UP, 403);
    const updated: MemberRow = {
      ...existing,
      name: body.name ?? existing.name,
      color: body.color ?? existing.color,
      avatar: body.avatar !== undefined ? body.avatar : existing.avatar,
      birthday: body.birthday !== undefined ? body.birthday : existing.birthday,
      sort: body.sort ?? existing.sort,
      grown_up: body.grownUp !== undefined ? (body.grownUp ? 1 : 0) : existing.grown_up,
      needs_approval: body.needsApproval !== undefined ? (body.needsApproval ? 1 : 0) : existing.needs_approval,
      transitions: body.transitionReminders ? JSON.stringify(body.transitionReminders) : existing.transitions,
      temp_check: body.tempCheck ? JSON.stringify(body.tempCheck) : existing.temp_check,
    };
    if (updated.grown_up) updated.needs_approval = 0; // a grown-up's chores never wait for an OK
    const privacy = { name: existing.name, grown_up: existing.grown_up ?? 0, journal_private: existing.journal_private ?? null, journal_private_allowed: existing.journal_private_allowed ?? 0 };
    const trail = flipped ? await grownUpChangeStmts(c, { id, ...privacy }, !!updated.grown_up, updated.name) : [];
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE members SET name = ?, color = ?, avatar = ?, birthday = ?, sort = ?, grown_up = ?, needs_approval = ?, transitions = ?, temp_check = ? WHERE id = ?')
        .bind(updated.name, updated.color, updated.avatar, updated.birthday, updated.sort, updated.grown_up ?? 0, updated.needs_approval ?? 0, updated.transitions, updated.temp_check ?? null, id),
      ...trail,
    ]);
    if (flipped) {
      if (!updated.grown_up && privateNow(privacy)) Object.assign(updated, { journal_private: 1, journal_private_allowed: 1 });
      await noteGrownUpChange(c, id, updated.name, !!updated.grown_up);
    }
    emit(c, 'member.changed', { id });
    const { tz, weekStart } = await household(c.env.DB);
    return c.json(toApi(updated, { ...(await pointsFor(c.env.DB, id, tz, weekStart)), balance: await balanceOf(c.env.DB, id) }, await goalRewards(c.env.DB), todayGoals((await recentGoals(c.env.DB).all<GoalRow>()).results, todayInTz(tz), [updated])), 200);
  },
);

// A kid's own device picks its own avatar (the one thing about a member it may change); parents
// change it, and the rest, with PATCH above. Wall screens and the app's widget keys can't.
membersRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/members/{id}/avatar',
    tags: ['Members'],
    summary: "Set a member's avatar (an emoji or 1-2 letter initial, or null). Parents for anyone; a member's own device (not its widgets) only for them.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ avatar: AvatarSchema.nullable() }) } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ avatar: z.string().nullable() }) } } },
      403: { description: "not this member's own device", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { avatar } = c.req.valid('json');
    const key = await requestKey(c);
    if (key?.scope === 'display' && (key.deviceKind === 'widgets' || (await deviceOwner(c)) !== id)) {
      return c.json({ error: "Only a parent's device or their own device can change this avatar." }, 403);
    }
    const res = await c.env.DB.prepare('UPDATE members SET avatar = ? WHERE id = ?').bind(avatar, id).run();
    if (res.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'member.changed', { id });
    return c.json({ avatar }, 200);
  },
);

membersRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/members/{id}',
    tags: ['Members'],
    summary: 'Delete a family member',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const exists = await c.env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(id).first<{ id: string }>();
    if (!exists) return c.json({ error: 'not found' }, 404);
    // Which calendars have this member assigned - needs its own read since member_ids is JSON,
    // not something a DELETE/UPDATE WHERE clause can filter on. Batched together with the member
    // delete itself so the member row and its calendar assignments disappear atomically (the
    // adapter's batch() doesn't report per-statement changes, hence the exists check above).
    const { results: cals } = await c.env.DB.prepare('SELECT id, member_ids FROM calendars WHERE member_ids LIKE ?')
      .bind(`%${id}%`)
      .all<{ id: string; member_ids: string }>();
    const updates = cals
      .map((cal) => {
        const before = parseMemberIds(cal.member_ids);
        const after = before.filter((m) => m !== id);
        return { id: cal.id, before, after };
      })
      .filter((cal) => cal.after.length !== cal.before.length) // the LIKE above can false-positive on a substring match
      .map((cal) => c.env.DB.prepare('UPDATE calendars SET member_ids = ? WHERE id = ?').bind(JSON.stringify(cal.after), cal.id));
    // A device owned by this member becomes a shared one (still locked; an admin can re-assign it).
    // Their tracker entries stay, under their name ("Leo (removed)"); the FK then clears member_id.
    await c.env.DB.batch<unknown>([
      c.env.DB.prepare('UPDATE tracker_entries SET former_member = (SELECT name FROM members WHERE id = ?) WHERE member_id = ?').bind(id, id),
      c.env.DB.prepare('DELETE FROM members WHERE id = ?').bind(id), ...updates,
      c.env.DB.prepare('UPDATE meals SET eater_ids = (SELECT json_group_array(value) FROM json_each(meals.eater_ids) WHERE value != ?) WHERE eater_ids LIKE ?').bind(id, `%${id}%`), c.env.DB.prepare("UPDATE api_keys SET owner = 'shared' WHERE owner = ?").bind(id),
      c.env.DB.prepare("UPDATE oauth_grants SET owner = 'shared' WHERE owner = ?").bind(id), c.env.DB.prepare('UPDATE passkeys SET owner = NULL WHERE owner = ?').bind(id),
      // Who checked off an item (0078's added_by and the rest have an FK; done_by predates it).
      c.env.DB.prepare('UPDATE list_items SET done_by = NULL WHERE done_by = ?').bind(id)]);
    emit(c, 'member.changed', { id });
    return c.json({ ok: true }, 200);
  },
);
