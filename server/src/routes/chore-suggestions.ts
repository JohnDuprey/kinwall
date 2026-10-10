// Kids suggest chores (migration 0113): "🎵 Flute practice, Mon–Fri at 4 PM for 20 min, I think it's
// worth 5 points". It waits for a parent, who approves it (as asked, or with other points or schedule)
// or says "Not this time", with a note either way. Approving makes a normal chore for that kid; "I
// already did it" also records it as done that day, so the points count once, on approval.
// Wall screens and kids' devices (display keys, see auth.ts) suggest, list and dismiss an answer, a
// member's own device only for them; deciding is for parent devices (not in the display allow-list).
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { deviceOwner, ownDevice, ownerBlock, requestKey } from '../auth.ts';
import { notifyChoreApproval } from '../notify.ts';
import { isValidRrule } from '../recurrence.ts';
import { household, todayInTz } from './members.ts';
import { readSettings } from './settings.ts';
import { choreRepeatError, insertChore } from './chores.ts';
import { EmojiSchema, ErrorSchema } from '../schemas.ts';
import { MealDateSchema } from '../meal-schemas.ts';

export const choreSuggestionsRoutes = createRouter();

/** How many ideas one person can have waiting at once (a kid tapping Send over and over). */
export const MAX_WAITING = 10;

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 16:00.');
const Schedule = {
  rrule: z.string().max(200).nullable().optional().openapi({ description: 'Repeat, e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR; null or left out: once.' }),
  dueTime: Time.nullable().optional().openapi({ description: 'Start time, "HH:MM" (household time).' }),
  timerMinutes: z.number().int().min(1).max(240).nullable().optional().openapi({ description: 'Timer length in minutes ("practice for 20 min").' }),
};

export const ChoreSuggestionSchema = z
  .object({
    id: z.string(),
    memberId: z.string(),
    title: z.string(),
    emoji: z.string().nullable(),
    points: z.number().openapi({ description: 'What the kid thinks it is worth.' }),
    rrule: z.string().nullable(),
    dueDate: z.string().openapi({ description: 'The day it is for (a one-time chore), or the day a repeat starts.' }),
    dueTime: z.string().nullable(),
    timerMinutes: z.number().nullable(),
    done: z.boolean().openapi({ description: '"I already did it": approving records it as done on dueDate.' }),
    status: z.enum(['pending', 'approved', 'declined']),
    suggestedAt: z.string(),
    decidedAt: z.string().nullable(),
    decidedBy: z.string().nullable().openapi({ description: 'The grown-up who answered, when their device is theirs.' }),
    decidedByName: z.string().nullable(),
    pointsGiven: z.number().nullable().openapi({ description: 'The points the chore got (approved).' }),
    note: z.string().nullable().openapi({ description: "The parent's note to the kid." }),
    choreId: z.string().nullable(),
  })
  .openapi('ChoreSuggestion');

type Row = {
  id: string; member_id: string; title: string; emoji: string | null; points: number; rrule: string | null; due_date: string; due_time: string | null;
  timer_minutes: number | null; done: number; status: 'pending' | 'approved' | 'declined'; suggested_at: string; decided_at: string | null;
  decided_by: string | null; decided_by_name?: string | null; points_given: number | null; note: string | null; chore_id: string | null; seen: number;
};

const toApi = (r: Row) => ({
  id: r.id, memberId: r.member_id, title: r.title, emoji: r.emoji, points: r.points, rrule: r.rrule, dueDate: r.due_date, dueTime: r.due_time,
  timerMinutes: r.timer_minutes, done: !!r.done, status: r.status, suggestedAt: r.suggested_at, decidedAt: r.decided_at, decidedBy: r.decided_by,
  decidedByName: r.decided_by_name ?? null, pointsGiven: r.points_given, note: r.note, choreId: r.chore_id,
});

const SELECT = 'SELECT s.*, m.name AS decided_by_name FROM chore_suggestions s LEFT JOIN members m ON m.id = s.decided_by';
const json = <T extends z.ZodTypeAny>(schema: T, description = 'ok') => ({ description, content: { 'application/json': { schema } } });
const err = (description: string) => json(ErrorSchema, description);

function execCtx(c: Context<{ Bindings: Env }>) {
  try {
    return c.executionCtx;
  } catch {
    return undefined; // Node: no ExecutionContext
  }
}

async function repeatError(c: { env: Env }, rrule: string | null | undefined, anchor: string): Promise<string | null> {
  if (!rrule) return null;
  if (!isValidRrule(rrule)) return 'invalid rrule';
  return choreRepeatError(c.env.DB, rrule, anchor);
}

choreSuggestionsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/chore-suggestions',
    tags: ['Chores'],
    summary:
      "Open chore suggestions, oldest first: ones waiting for a parent, and answers the kid hasn't put away yet. ?memberId= one person. A member's own device gets only theirs (403 for someone else's); a shared wall screen never gets a \"Not this time\" (that note is for the kid's own device and parents).",
    security: [{ Bearer: [] }],
    request: { query: z.object({ memberId: z.string().optional() }) },
    responses: { 200: json(z.array(ChoreSuggestionSchema)), 403: err("a member's own device asked for someone else's") },
  }),
  async (c) => {
    const { memberId: asked } = c.req.valid('query');
    const blocked = await ownerBlock(c, asked);
    if (blocked) return c.json({ error: blocked }, 403);
    const memberId = asked ?? (await deviceOwner(c));
    const where = ["(s.status = 'pending' OR s.seen = 0)"];
    const binds: string[] = [];
    if (memberId) { where.push('s.member_id = ?'); binds.push(memberId); }
    if ((await requestKey(c))?.scope === 'display' && !(await deviceOwner(c))) where.push("s.status <> 'declined'");
    const { results } = await c.env.DB.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY s.suggested_at`).bind(...binds).all<Row>();
    return c.json(results.map(toApi), 200);
  },
);

choreSuggestionsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chore-suggestions',
    tags: ['Chores'],
    summary:
      "Suggest a chore for a parent to approve, with the points the kid thinks it's worth. A kid's own device suggests only for them; a wall screen names who. Parents are told. Nothing counts until a parent approves it.",
    security: [{ Bearer: [] }],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              memberId: z.string().optional().openapi({ description: "Who it's for; a member's own device may leave it out." }),
              title: z.string().trim().min(1).max(80),
              emoji: EmojiSchema.nullable().optional(),
              points: z.number().int().min(0).max(100),
              dueDate: MealDateSchema.optional().openapi({ description: 'Default: today. Ignored with done (it was today).' }),
              done: z.boolean().optional().openapi({ description: '"I already did it" (today).' }),
              ...Schedule,
            }),
          },
        },
      },
    },
    responses: {
      201: json(ChoreSuggestionSchema, 'created'),
      400: err('no one named, an unknown person or a repeat that never happens'),
      403: err("suggesting is turned off, or this device is someone else's"),
      409: err(`already ${MAX_WAITING} waiting`),
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const settings = await readSettings(c.env.DB);
    if (!settings.features.chores || !settings.kidChoreSuggestions) return c.json({ error: 'Suggesting chores is turned off.' }, 403);
    const blocked = await ownerBlock(c, body.memberId);
    if (blocked) return c.json({ error: blocked }, 403);
    const memberId = body.memberId ?? (await deviceOwner(c));
    if (!memberId) return c.json({ error: 'Say who the chore is for.' }, 400);
    const member = await c.env.DB.prepare("SELECT name, (SELECT COUNT(*) FROM chore_suggestions WHERE member_id = members.id AND status = 'pending') AS waiting FROM members WHERE id = ?")
      .bind(memberId)
      .first<{ name: string; waiting: number }>();
    if (!member) return c.json({ error: 'unknown member' }, 400);
    if (Number(member.waiting) >= MAX_WAITING) return c.json({ error: `${member.name} already has ${MAX_WAITING} ideas waiting for a grown-up.` }, 409);
    const today = todayInTz((await household(c.env.DB)).tz);
    const dueDate = body.done ? today : body.dueDate ?? today;
    const rrError = await repeatError(c, body.rrule, dueDate);
    if (rrError) return c.json({ error: rrError }, 400);
    const row: Row = {
      id: crypto.randomUUID(), member_id: memberId, title: body.title, emoji: body.emoji ?? null, points: body.points, rrule: body.rrule ?? null, due_date: dueDate,
      due_time: body.dueTime ?? null, timer_minutes: body.timerMinutes ?? null, done: body.done ? 1 : 0, status: 'pending', suggested_at: new Date().toISOString(),
      decided_at: null, decided_by: null, points_given: null, note: null, chore_id: null, seen: 0,
    };
    await c.env.DB.prepare(
      'INSERT INTO chore_suggestions (id, member_id, title, emoji, points, rrule, due_date, due_time, timer_minutes, done, status, suggested_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.member_id, row.title, row.emoji, row.points, row.rrule, row.due_date, row.due_time, row.timer_minutes, row.done, row.status, row.suggested_at)
      .run();
    emit(c, 'chore.suggestion.changed', { id: row.id, memberId, status: 'pending' });
    notifyChoreApproval(c.env, execCtx(c), 'parents', `suggest:${row.id}`, {
      title: body.done ? `${member.name} did ${row.title} and suggests it as a chore` : `${member.name} suggests a chore: ${row.title}`,
      body: `They think it's worth ${row.points} point${row.points === 1 ? '' : 's'}. Open Chores to say yes or not this time.`,
      url: '/#/chores',
      memberIds: [memberId],
    });
    return c.json(toApi(row), 201);
  },
);

const decideParams = z.object({ id: z.string() });
const NoteSchema = z.string().trim().max(200).optional().openapi({ description: 'A note to the kid, e.g. "Love the initiative!"' });

async function pending(c: { env: Env }, id: string) {
  return c.env.DB.prepare(`${SELECT} WHERE s.id = ? AND s.status = 'pending'`).bind(id).first<Row>();
}

choreSuggestionsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chore-suggestions/{id}/approve',
    tags: ['Chores'],
    summary:
      "Say yes to a suggested chore, as asked or changed (points, name, schedule, timer), with an optional note. Makes a normal chore for that kid; \"I already did it\" is also recorded as done that day and earns the points now. The kid's devices are told (parent devices only).",
    security: [{ Bearer: [] }],
    request: {
      params: decideParams,
      body: {
        content: {
          'application/json': {
            schema: z.object({
              points: z.number().int().min(0).max(1000).optional().openapi({ description: 'Default: what the kid asked for.' }),
              title: z.string().trim().min(1).max(80).optional(),
              emoji: EmojiSchema.nullable().optional(),
              note: NoteSchema,
              ...Schedule,
            }),
          },
        },
      },
    },
    responses: {
      200: json(ChoreSuggestionSchema),
      400: err('a repeat that never happens'),
      404: err('nothing waiting with that id'),
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const s = await pending(c, id);
    if (!s) return c.json({ error: 'nothing waiting with that id' }, 404);
    const rrule = body.rrule !== undefined ? body.rrule : s.rrule;
    const rrError = await repeatError(c, rrule, s.due_date);
    if (rrError) return c.json({ error: rrError }, 400);
    const now = new Date().toISOString();
    const by = await ownDevice(c);
    const points = body.points ?? s.points;
    const choreId = crypto.randomUUID();
    const note = body.note || null;
    // Claimed on status first, so two parents tapping at once make one chore.
    const claimed = await c.env.DB.prepare("UPDATE chore_suggestions SET status = 'approved', decided_at = ?, decided_by = ?, points_given = ?, note = ? WHERE id = ? AND status = 'pending'")
      .bind(now, by, points, note, id)
      .run();
    if (!claimed.meta.changes) return c.json({ error: 'nothing waiting with that id' }, 404);
    const title = body.title ?? s.title;
    await insertChore(c.env.DB, {
      id: choreId, title, emoji: body.emoji !== undefined ? body.emoji : s.emoji, member_id: s.member_id, points, rrule: rrule ?? null,
      // The day it's for, which is also where a repeat starts counting from.
      due_date: s.due_date, due_time: body.dueTime !== undefined ? body.dueTime : s.due_time, active: 1, sort: 0, created_at: now,
      timer_minutes: body.timerMinutes !== undefined ? body.timerMinutes : s.timer_minutes,
    });
    await c.env.DB.prepare('UPDATE chore_suggestions SET chore_id = ? WHERE id = ?').bind(choreId, id).run();
    if (s.done) {
      // Done on the day they said, so it earns the full points (no late credit), once.
      await c.env.DB.prepare("INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, points_awarded, status) VALUES (?,?,?,?,?,?, 'approved') ON CONFLICT(chore_id, date) DO NOTHING")
        .bind(crypto.randomUUID(), choreId, s.due_date, s.member_id, s.suggested_at, points)
        .run();
      emit(c, 'chore.completed', { id: choreId, date: s.due_date, title, memberId: s.member_id, points });
    }
    emit(c, 'chore.changed', { id: choreId });
    emit(c, 'chore.suggestion.changed', { id, memberId: s.member_id, status: 'approved', choreId });
    const who = s.decided_by_name ?? (by ? (await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(by).first<{ name: string }>())?.name : null);
    const worth = `${points} point${points === 1 ? '' : 's'}`;
    notifyChoreApproval(c.env, execCtx(c), { owner: s.member_id }, `suggest-yes:${id}`, {
      title: `${who ?? 'A grown-up'} said yes: ${title}`,
      body: note ? `${worth}. "${note}"` : `It's on your chores now, worth ${worth}.`,
      url: '/#/chores',
      memberIds: [s.member_id],
    });
    const row = await c.env.DB.prepare(`${SELECT} WHERE s.id = ?`).bind(id).first<Row>();
    return c.json(toApi(row!), 200);
  },
);

choreSuggestionsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chore-suggestions/{id}/decline',
    tags: ['Chores'],
    summary: "\"Not this time\" to a suggested chore, with an optional note the kid sees on their own device (parent devices only).",
    security: [{ Bearer: [] }],
    request: { params: decideParams, body: { content: { 'application/json': { schema: z.object({ note: NoteSchema }) } } } },
    responses: { 200: json(ChoreSuggestionSchema), 404: err('nothing waiting with that id') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const note = c.req.valid('json').note || null;
    const s = await pending(c, id);
    if (!s) return c.json({ error: 'nothing waiting with that id' }, 404);
    const by = await ownDevice(c);
    const res = await c.env.DB.prepare("UPDATE chore_suggestions SET status = 'declined', decided_at = ?, decided_by = ?, note = ? WHERE id = ? AND status = 'pending'")
      .bind(new Date().toISOString(), by, note, id)
      .run();
    if (!res.meta.changes) return c.json({ error: 'nothing waiting with that id' }, 404);
    emit(c, 'chore.suggestion.changed', { id, memberId: s.member_id, status: 'declined' });
    notifyChoreApproval(c.env, execCtx(c), { owner: s.member_id }, `suggest-no:${id}`, {
      title: `Not this time: ${s.title}`,
      body: note ?? 'Thanks for the idea!',
      url: '/#/chores',
      memberIds: [s.member_id],
    });
    const row = await c.env.DB.prepare(`${SELECT} WHERE s.id = ?`).bind(id).first<Row>();
    return c.json(toApi(row!), 200);
  },
);

choreSuggestionsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/chore-suggestions/{id}/seen',
    tags: ['Chores'],
    summary: "Put away an answered suggestion's card (the kid read it). Their own device, a wall screen or a parent's.",
    security: [{ Bearer: [] }],
    request: { params: decideParams },
    responses: { 200: json(z.object({ ok: z.boolean() })), 403: err("this device is someone else's"), 404: err('no answered suggestion with that id') },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const s = await c.env.DB.prepare("SELECT member_id FROM chore_suggestions WHERE id = ? AND status <> 'pending'").bind(id).first<{ member_id: string }>();
    if (!s) return c.json({ error: 'no answered suggestion with that id' }, 404);
    const blocked = await ownerBlock(c, s.member_id);
    if (blocked) return c.json({ error: blocked }, 403);
    await c.env.DB.prepare('UPDATE chore_suggestions SET seen = 1 WHERE id = ?').bind(id).run();
    emit(c, 'chore.suggestion.changed', { id, memberId: s.member_id, status: 'seen' });
    return c.json({ ok: true }, 200);
  },
);
