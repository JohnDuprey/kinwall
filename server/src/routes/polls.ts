// Family polls (docs/using/polls.md, migration 0102): a parent asks a question ("Where are we eating
// Friday?") with two or more choices: typed ideas, or recipes and restaurants from the binder while
// Meals is on.
// Everyone votes once, kids included, and can change it while the poll is open. Votes aren't secret:
// each choice lists who picked it (the app shows their avatars).
//
// Who does what: parents (full access) create, close, link and delete polls. Wall screens and kids'
// devices read polls and vote (auth.ts DISPLAY_ALLOWED); a member's own device votes only for that
// member (ownerBlock), a shared wall for anyone. A poll can be about a meal (date and slot): closing
// picks the winner, and the app's "Plan it" plans that meal and links it here (PATCH mealId).
//
// Its own feature switch (settings.features.polls): off, every route here answers 404 (so MCP tools
// refuse), no notifications are sent and the bell leaves poll notes out. Polls are kept.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env, WaitCtx } from '../env.ts';
import { waitUntil } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { emit } from '../bus.ts';
import { actorOf, ownerBlock } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import { MealDateSchema, MealSlotSchema } from '../meal-schemas.ts';
import { readFeatures } from './settings.ts';
import { loadSubs, recordNotification, sendToSub } from '../notify.ts';

export const pollsRoutes = createRouter();

export const PollOptionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    recipeId: z.string().nullable().openapi({ description: 'A recipe from the recipe book; null for a typed idea (or a recipe since deleted).' }),
    restaurantId: z.string().nullable().openapi({ description: 'A restaurant from the binder (Meals → Restaurants); null otherwise (or one since deleted).' }),
    sort: z.number().int(),
    votes: z.array(z.string()).openapi({ description: 'Member ids who picked this choice.' }),
  })
  .openapi('PollOption');
export const PollSchema = z
  .object({
    id: z.string(),
    question: z.string(),
    date: z.string().nullable().openapi({ description: 'YYYY-MM-DD the poll decides (a meal), if any.' }),
    slot: MealSlotSchema.nullable(),
    status: z.enum(['open', 'closed']),
    winnerOptionId: z.string().nullable(),
    mealId: z.string().nullable().openapi({ description: 'The meal planned from the winner.' }),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    closedAt: z.string().nullable(),
    options: z.array(PollOptionSchema),
  })
  .openapi('Poll');
export type Poll = z.infer<typeof PollSchema>;

export const PollInputSchema = z
  .object({
    question: z.string().trim().min(1).max(200),
    date: MealDateSchema.nullable().optional(),
    slot: MealSlotSchema.nullable().optional(),
    options: z
      .array(z.object({ label: z.string().trim().min(1).max(120).optional(), recipeId: z.string().optional(), restaurantId: z.string().optional() })
        .refine((o) => o.label || o.recipeId || o.restaurantId, 'a choice needs a label, a recipeId or a restaurantId')
        .refine((o) => !(o.recipeId && o.restaurantId), 'a choice is a recipe or a restaurant, not both'))
      .min(2)
      .max(12),
  })
  .openapi('PollInput');

const params = z.object({ id: z.string() });
const OFF = { error: 'Polls are turned off in Settings → Features' };
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: 'parents only, or this device votes only for its owner', content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found, or polls are turned off (settings.features.polls)', content: { 'application/json': { schema: ErrorSchema } } },
  409: { description: 'the poll is closed', content: { 'application/json': { schema: ErrorSchema } } },
};
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const pollResponse = { description: 'poll', content: { 'application/json': { schema: PollSchema } } };

type PollRow = { id: string; question: string; date: string | null; slot: Poll['slot']; status: Poll['status']; winner_option_id: string | null; meal_id: string | null; created_by: string | null; created_at: string; closed_at: string | null };
type OptionRow = { id: string; poll_id: string; label: string; recipe_id: string | null; restaurant_id: string | null; sort: number };

/** Polls with their choices and votes: open ones first, then newest. */
export async function readPolls(db: KinwallDb, opts: { id?: string; status?: Poll['status']; limit?: number } = {}): Promise<Poll[]> {
  const where = opts.id ? 'WHERE id = ?1' : opts.status ? 'WHERE status = ?2' : '';
  const polls = (await db.prepare(`SELECT * FROM polls ${where} ORDER BY status = 'open' DESC, created_at DESC LIMIT ?3`).bind(opts.id ?? null, opts.status ?? null, opts.limit ?? -1).all<PollRow>()).results;
  if (!polls.length) return [];
  const ids = JSON.stringify(polls.map((p) => p.id));
  const [options, votes] = await db.batch<unknown>([
    db.prepare('SELECT id, poll_id, label, recipe_id, restaurant_id, sort FROM poll_options WHERE poll_id IN (SELECT value FROM json_each(?)) ORDER BY sort, id').bind(ids),
    db.prepare('SELECT v.option_id, v.member_id FROM poll_votes v JOIN members m ON m.id = v.member_id WHERE v.poll_id IN (SELECT value FROM json_each(?)) ORDER BY m.sort, m.created_at').bind(ids),
  ]);
  const byOption = new Map<string, string[]>();
  for (const v of votes.results as { option_id: string; member_id: string }[]) byOption.set(v.option_id, [...(byOption.get(v.option_id) ?? []), v.member_id]);
  return polls.map((p) => ({
    id: p.id, question: p.question, date: p.date, slot: p.slot, status: p.status, winnerOptionId: p.winner_option_id, mealId: p.meal_id,
    createdBy: p.created_by, createdAt: p.created_at, closedAt: p.closed_at,
    options: (options.results as OptionRow[]).filter((o) => o.poll_id === p.id).map((o) => ({ id: o.id, label: o.label, recipeId: o.recipe_id, restaurantId: o.restaurant_id, sort: o.sort, votes: byOption.get(o.id) ?? [] })),
  }));
}

/** The choice with the most votes; a tie goes to the one listed first. */
export const leader = (poll: Pick<Poll, 'options'>) => poll.options.reduce<Poll['options'][number] | null>((best, o) => (!best || o.votes.length > best.votes.length ? o : best), null);

async function pollsOff(c: Context<{ Bindings: Env }>) {
  return !(await readFeatures(c.env.DB)).polls;
}
async function onePoll(db: KinwallDb, id: string) {
  return (await readPolls(db, { id }))[0];
}
function execCtx(c: Context<{ Bindings: Env }>): WaitCtx | undefined {
  try { return c.executionCtx; } catch { return undefined; } // Node: no ExecutionContext
}

/** "New poll: Which movie tonight?" in the bell, and pushed to every device that has notifications on. */
function notifyPoll(c: Context<{ Bindings: Env }>, poll: Poll): void {
  waitUntil(execCtx(c), (async () => {
    const n = { title: `🗳 New poll: ${poll.question}`, body: poll.options.map((o) => o.label).join(' · '), url: `/#/calendar?poll=${encodeURIComponent(poll.id)}` };
    await recordNotification(c.env.DB, { kind: 'poll', ...n, source: 'system' });
    for (const sub of await loadSubs(c.env.DB)) await sendToSub(c.env, c.env.DB, sub, { ...n, tag: `poll:${poll.id}` });
  })());
}

pollsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/polls', tags: ['Polls'], summary: 'Family polls with their choices and who voted for what: open ones first, then newest', security: [{ Bearer: [] }],
    request: { query: z.object({ status: z.enum(['open', 'closed']).optional(), limit: z.coerce.number().int().min(1).max(200).optional().openapi({ description: 'Default 50.' }) }) },
    responses: { 200: { description: 'polls', content: { 'application/json': { schema: z.array(PollSchema) } } }, 404: errors[404] },
  }),
  async (c) => {
    if (await pollsOff(c)) return c.json(OFF, 404);
    const { status, limit = 50 } = c.req.valid('query');
    return c.json(await readPolls(c.env.DB, { status, limit }), 200);
  },
);

pollsRoutes.openapi(
  createRoute({ method: 'get', path: '/api/polls/{id}', tags: ['Polls'], summary: 'One poll', security: [{ Bearer: [] }], request: { params }, responses: { 200: pollResponse, 404: errors[404] } }),
  async (c) => {
    if (await pollsOff(c)) return c.json(OFF, 404);
    const poll = await onePoll(c.env.DB, c.req.valid('param').id);
    return poll ? c.json(poll, 200) : c.json({ error: 'poll not found' }, 404);
  },
);

pollsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/polls', tags: ['Polls'], summary: 'Start a poll (parents); everyone gets a notification. Recipe and restaurant choices need Meals on; one without a label takes the recipe\'s or restaurant\'s name', security: [{ Bearer: [] }],
    request: { body: body(PollInputSchema) }, responses: { 201: pollResponse, ...errors },
  }),
  async (c) => {
    const db = c.env.DB;
    const features = await readFeatures(db);
    if (!features.polls) return c.json(OFF, 404);
    const input = c.req.valid('json');
    const recipeIds = input.options.flatMap((o) => (o.recipeId ? [o.recipeId] : []));
    const restaurantIds = input.options.flatMap((o) => (o.restaurantId ? [o.restaurantId] : []));
    if ((recipeIds.length || restaurantIds.length) && !features.meals) return c.json({ error: 'Recipe and restaurant choices need Meals on in Settings → Features' }, 400);
    const [recipes, places] = await db.batch<{ id: string; name: string }>([
      db.prepare('SELECT id, name FROM recipes WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(recipeIds)),
      db.prepare('SELECT id, name FROM restaurants WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(restaurantIds)),
    ]);
    const names = new Map([...recipes.results, ...places.results].map((r) => [r.id, r.name]));
    const missing = [...recipeIds, ...restaurantIds].find((id) => !names.has(id));
    if (missing) return c.json({ error: `${recipeIds.includes(missing) ? 'recipe' : 'restaurant'} not found: ${missing}` }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const by = (await actorOf(c)).memberId;
    await db.batch([
      db.prepare('INSERT INTO polls (id, question, date, slot, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, input.question, input.date ?? null, input.date ? input.slot ?? null : null, 'open', by, now),
      ...input.options.map((o, sort) => db.prepare('INSERT INTO poll_options (id, poll_id, label, recipe_id, restaurant_id, sort) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, o.label ?? names.get((o.recipeId ?? o.restaurantId)!)!, o.recipeId ?? null, o.restaurantId ?? null, sort)),
    ]);
    const poll = (await onePoll(db, id))!;
    emit(c, 'poll.changed', { id, status: 'open' });
    notifyPoll(c, poll);
    return c.json(poll, 201);
  },
);

pollsRoutes.openapi(
  createRoute({
    method: 'put', path: '/api/polls/{id}/vote', tags: ['Polls'], summary: "Set or change a family member's vote while the poll is open (optionId null takes it back). A member's own device votes only for them; a shared wall for anyone", security: [{ Bearer: [] }],
    request: { params, body: body(z.object({ memberId: z.string(), optionId: z.string().nullable() })) }, responses: { 200: pollResponse, ...errors },
  }),
  async (c) => {
    if (await pollsOff(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { memberId, optionId } = c.req.valid('json');
    const blocked = await ownerBlock(c, memberId);
    if (blocked) return c.json({ error: blocked }, 403);
    const poll = await onePoll(c.env.DB, id);
    if (!poll) return c.json({ error: 'poll not found' }, 404);
    if (poll.status !== 'open') return c.json({ error: 'This poll is closed.' }, 409);
    if (optionId && !poll.options.some((o) => o.id === optionId)) return c.json({ error: 'choice not found in this poll' }, 400);
    if (!(await c.env.DB.prepare('SELECT id FROM members WHERE id = ?').bind(memberId).first())) return c.json({ error: 'member not found' }, 404);
    await (optionId
      ? c.env.DB.prepare('INSERT INTO poll_votes (poll_id, member_id, option_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(poll_id, member_id) DO UPDATE SET option_id = excluded.option_id, updated_at = excluded.updated_at').bind(id, memberId, optionId, new Date().toISOString())
      : c.env.DB.prepare('DELETE FROM poll_votes WHERE poll_id = ? AND member_id = ?').bind(id, memberId)).run();
    emit(c, 'poll.changed', { id, status: 'open' });
    return c.json((await onePoll(c.env.DB, id))!, 200);
  },
);

pollsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/polls/{id}/close', tags: ['Polls'], summary: 'Close a poll and pick the winner (parents): optionId, else the choice with the most votes (a tie goes to the one listed first). On a closed poll, changes the winner', security: [{ Bearer: [] }],
    request: { params, body: body(z.object({ optionId: z.string().optional() })) }, responses: { 200: pollResponse, ...errors },
  }),
  async (c) => {
    if (await pollsOff(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { optionId } = c.req.valid('json');
    const poll = await onePoll(c.env.DB, id);
    if (!poll) return c.json({ error: 'poll not found' }, 404);
    if (optionId && !poll.options.some((o) => o.id === optionId)) return c.json({ error: 'choice not found in this poll' }, 400);
    const winner = optionId ?? leader(poll)?.id ?? null;
    await c.env.DB.prepare("UPDATE polls SET status = 'closed', winner_option_id = ?, closed_at = coalesce(closed_at, ?) WHERE id = ?").bind(winner, new Date().toISOString(), id).run();
    emit(c, 'poll.changed', { id, status: 'closed', winnerOptionId: winner });
    return c.json((await onePoll(c.env.DB, id))!, 200);
  },
);

pollsRoutes.openapi(
  createRoute({
    method: 'patch', path: '/api/polls/{id}', tags: ['Polls'], summary: 'Link the meal planned from a poll, or fix its question (parents)', security: [{ Bearer: [] }],
    request: { params, body: body(z.object({ question: z.string().trim().min(1).max(200).optional(), mealId: z.string().nullable().optional() })) }, responses: { 200: pollResponse, ...errors },
  }),
  async (c) => {
    if (await pollsOff(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { question, mealId } = c.req.valid('json');
    if (mealId && !(await c.env.DB.prepare('SELECT id FROM meals WHERE id = ?').bind(mealId).first())) return c.json({ error: 'meal not found' }, 400);
    const res = await c.env.DB.prepare('UPDATE polls SET question = coalesce(?, question), meal_id = CASE WHEN ? THEN ? ELSE meal_id END WHERE id = ?').bind(question ?? null, mealId !== undefined ? 1 : 0, mealId ?? null, id).run();
    if (!res.meta.changes) return c.json({ error: 'poll not found' }, 404);
    const poll = (await onePoll(c.env.DB, id))!;
    emit(c, 'poll.changed', { id, status: poll.status });
    return c.json(poll, 200);
  },
);

pollsRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/polls/{id}', tags: ['Polls'], summary: 'Delete a poll and its votes (parents)', security: [{ Bearer: [] }], request: { params }, responses: { 200: { description: 'deleted', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } }, ...errors } }),
  async (c) => {
    if (await pollsOff(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM polls WHERE id = ?').bind(id).run();
    if (!res.meta.changes) return c.json({ error: 'poll not found' }, 404);
    emit(c, 'poll.changed', { id, status: 'deleted' });
    return c.json({ ok: true }, 200);
  },
);
