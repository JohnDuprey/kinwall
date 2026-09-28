// Temp check: a person's daily questions at the end of their day (sleep, feelings, a goal), turned on
// per member (members.temp_check, Settings → Family). One temp_checks row per member per household
// day, changed in place.
//
// Health data (AGENTS.md "Health data"): sleep, feelings and the person's own feelings list
// (members.temp_check_feelings, since "Other" may name a condition) are sealed with the family's
// key (crypto.ts seal; aad '<member>:<date>:sleep', '<member>:<date>:feelings',
// '<member>:temp_check_feelings'). Writes fail closed without a key. There's no plaintext to sweep:
// every write and import seals. Bodies are never logged; the webhook says who and which day only.
//
// Who sees the answers (see `access`):
// - parents' devices (admin keys, passkey sessions, Kinwall's own app) and the person's own device: everything;
// - a shared wall screen: it can answer (today only), and it sees their feelings list so they can pick,
//   but never what they picked: `answered` flags only, so the answers don't sit on the wall;
// - another member's own device: the flags and the goal; it can't answer for them;
// - connected apps (MCP, AI connectors): the flags and the goal, unless the family turned on aiHealthAccess.
// The goal is family content: everyone sees it (and the Board, via Member.todayGoal).
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { emit } from '../bus.ts';
import { deviceOwner, ownerBlock, resolveKey } from '../auth.ts';
import { seal, unseal, type EncryptionEnv } from '../crypto.ts';
import { ErrorSchema, FEELINGS, SLEEP_ANSWERS, TempCheckSettingsSchema } from '../schemas.ts';
import { healthBlock, HEALTH_PRIVATE } from './trackers.ts';
import { parseTempCheck, todayInTz } from './members.ts';
import { readSettings } from './settings.ts';

export const tempCheckRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

const MAX_CUSTOM = 30;
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date: YYYY-MM-DD');
const FeelingSchema = z.string().trim().min(1).max(40);
const SleepSchema = z.enum(SLEEP_ANSWERS);

const TempCheckSchema = z
  .object({
    memberId: z.string(),
    date: z.string(), // household day
    settings: TempCheckSettingsSchema,
    private: z.boolean().openapi({ description: 'Sleep and feelings are withheld from this device (null here); answered says whether they were answered.' }),
    sleep: SleepSchema.nullable(),
    feelings: z.array(z.string()).nullable(),
    goal: z.string().nullable(),
    goalSkipped: z.boolean(),
    answered: z.object({ sleep: z.boolean(), feelings: z.boolean(), goal: z.boolean() }), // goal: set or skipped
    custom: z.array(z.string()).nullable().openapi({ description: 'Their own feelings, added with "Other" (the built-in ones are great, good, fine, ok, bad, awful, tired, sore). null when withheld.' }),
  })
  .openapi('TempCheck');

const TempCheckInputSchema = z
  .object({
    sleep: SleepSchema.nullable().optional(),
    feelings: z.array(FeelingSchema).max(12).nullable().optional().openapi({ description: 'Any not in the built-ins or their own list joins their own list.' }),
    goal: z.string().trim().max(140).nullable().optional().openapi({ description: 'Setting a goal clears goalSkipped; goalSkipped: true clears the goal.' }),
    goalSkipped: z.boolean().optional(),
    custom: z.array(FeelingSchema).max(MAX_CUSTOM).optional().openapi({ description: 'Replaces their own feelings list (to remove one). Not from a shared wall screen.' }),
  })
  .openapi('TempCheckInput');

export type TempCheckRow = { member_id: string; date: string; sleep: string | null; feelings: string | null; goal: string | null; goal_skipped: number; created_at: string; updated_at: string };
type Access = 'full' | 'wall' | 'none';

/** What this caller may see of `memberId`'s answers (see the top of the file). */
async function access(c: C, memberId: string): Promise<Access> {
  if ((await resolveKey(c))?.scope === 'display') {
    const owner = await deviceOwner(c);
    return owner === memberId ? 'full' : owner ? 'none' : 'wall';
  }
  return (await healthBlock(c)) ? 'none' : 'full';
}

const aad = (memberId: string, date: string, col: 'sleep' | 'feelings') => `${memberId}:${date}:${col}`;
const customAad = (memberId: string) => `${memberId}:temp_check_feelings`;
const sealMaybe = (env: EncryptionEnv, v: string | null, a: string) => (v === null ? null : seal(env, v, a));
const openMaybe = (env: EncryptionEnv, v: string | null, a: string) => (v === null ? null : unseal(env, v, a));

export async function readCustom(env: EncryptionEnv, memberId: string, stored: string | null): Promise<string[]> {
  return stored ? (JSON.parse(await unseal(env, stored, customAad(memberId))) as string[]) : [];
}
export const sealCustom = async (env: EncryptionEnv, memberId: string, list: string[]) => (list.length ? seal(env, JSON.stringify(list), customAad(memberId)) : null);

/** A stored row, opened (sealed values throw without the right key: never read as empty). */
export async function openTempCheck(env: EncryptionEnv, r: TempCheckRow) {
  const feelings = await openMaybe(env, r.feelings, aad(r.member_id, r.date, 'feelings'));
  return { sleep: (await openMaybe(env, r.sleep, aad(r.member_id, r.date, 'sleep'))) as (typeof SLEEP_ANSWERS)[number] | null, feelings: feelings === null ? null : (JSON.parse(feelings) as string[]), goal: r.goal, goalSkipped: !!r.goal_skipped };
}
/** The row as stored: sleep and feelings sealed. Throws without a key, before anything is written. */
export async function sealTempCheck(env: EncryptionEnv, memberId: string, date: string, v: { sleep: string | null; feelings: string[] | null }) {
  return { sleep: await sealMaybe(env, v.sleep, aad(memberId, date, 'sleep')), feelings: await sealMaybe(env, v.feelings && JSON.stringify(v.feelings), aad(memberId, date, 'feelings')) };
}

async function load(c: C, memberId: string, date: string) {
  const member = await c.env.DB.prepare('SELECT temp_check, temp_check_feelings FROM members WHERE id = ?').bind(memberId).first<{ temp_check: string | null; temp_check_feelings: string | null }>();
  if (!member) return null;
  const row = await c.env.DB.prepare('SELECT * FROM temp_checks WHERE member_id = ? AND date = ?').bind(memberId, date).first<TempCheckRow>();
  return { member, row };
}

async function respond(c: C, memberId: string, date: string, found: NonNullable<Awaited<ReturnType<typeof load>>>, who: Access) {
  const settings = parseTempCheck(found.member.temp_check);
  const empty = { sleep: null, feelings: null, goal: null, goalSkipped: false };
  // The answers are opened only for a caller who may see them.
  const v = found.row ? (who === 'full' ? await openTempCheck(c.env, found.row) : { ...empty, goal: found.row.goal, goalSkipped: !!found.row.goal_skipped }) : empty;
  const answered = { sleep: !!found.row?.sleep, feelings: !!found.row?.feelings, goal: !!found.row?.goal || !!found.row?.goal_skipped };
  return {
    memberId, date, settings, private: who !== 'full', answered,
    sleep: v.sleep, feelings: v.feelings, goal: v.goal, goalSkipped: v.goalSkipped,
    custom: who === 'none' ? null : await readCustom(c.env, memberId, found.member.temp_check_feelings),
  };
}

const householdToday = async (c: C) => todayInTz((await readSettings(c.env.DB)).timezone ?? hostTimezone());
const params = z.object({ id: z.string() });
const query = z.object({ date: DateSchema.optional() });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

tempCheckRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members/{id}/temp-check',
    tags: ['Members'],
    summary: "A member's Temp check for a day (today by default): their questions and answers. Sleep and feelings are health data: null (private: true) for a shared wall screen, another member's device, or a connected app without aiHealthAccess.",
    security: [{ Bearer: [] }],
    request: { params, query },
    responses: {
      200: { description: 'ok', content: json(TempCheckSchema) },
      404: { description: 'member not found', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const date = c.req.valid('query').date ?? (await householdToday(c));
    const found = await load(c, id, date);
    if (!found) return c.json({ error: 'member not found' }, 404);
    return c.json(await respond(c, id, date, found, await access(c, id)), 200);
  },
);

tempCheckRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/members/{id}/temp-check',
    tags: ['Members'],
    summary: "Answer (or change) a member's Temp check for a day (today by default). Only the fields sent change. Display keys: today only, and a member's own device only for them. Connected apps may set the goal; sleep and feelings need aiHealthAccess.",
    security: [{ Bearer: [] }],
    request: { params, query, body: { content: json(TempCheckInputSchema) } },
    responses: {
      200: { description: 'saved', content: json(TempCheckSchema) },
      400: { description: 'Temp check is off for them, or a bad answer', content: json(ErrorSchema) },
      403: { description: "someone else's device, another day from a display, or health from a connected app", content: json(ErrorSchema) },
      404: { description: 'member not found', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const today = await householdToday(c);
    const date = c.req.valid('query').date ?? today;
    const blocked = await ownerBlock(c, id);
    if (blocked) return c.json({ error: blocked }, 403);
    const found = await load(c, id, date);
    if (!found) return c.json({ error: 'member not found' }, 404);
    const settings = parseTempCheck(found.member.temp_check);
    if (!settings.on) return c.json({ error: 'Temp check is off for them (Settings → Family)' }, 400);
    const display = (await resolveKey(c))?.scope === 'display';
    if (display && date !== today) return c.json({ error: 'This device can only answer for today' }, 403);
    const who = await access(c, id);
    const health = body.sleep !== undefined || body.feelings !== undefined || body.custom !== undefined;
    if (health && who === 'none') return c.json(HEALTH_PRIVATE, 403);
    if (body.custom !== undefined && who !== 'full') return c.json({ error: "Feelings can be removed from their own device or a parent's" }, 403);

    // Only the fields sent change; the rest stay as stored (still sealed), so a wall never opens them.
    const feelings = body.feelings === undefined ? undefined : body.feelings?.length ? [...new Map(body.feelings.map((f) => [f.toLowerCase(), f])).values()] : null;
    const fresh = await sealTempCheck(c.env, id, date, { sleep: body.sleep ?? null, feelings: feelings ?? null });
    const sleepStored = body.sleep !== undefined ? fresh.sleep : (found.row?.sleep ?? null);
    const feelingsStored = feelings !== undefined ? fresh.feelings : (found.row?.feelings ?? null);
    const goal = body.goalSkipped ? null : body.goal !== undefined ? body.goal || null : (found.row?.goal ?? null); // Skip clears it
    const goalSkipped = goal ? false : (body.goalSkipped ?? !!found.row?.goal_skipped);

    // Their own feelings list: "Other" answers join it; `custom` replaces it.
    const custom = body.custom ?? (await readCustom(c.env, id, found.member.temp_check_feelings));
    const known = new Set([...FEELINGS, ...custom].map((f) => f.toLowerCase()));
    const added: string[] = [];
    for (const f of feelings ?? []) {
      if (known.has(f.toLowerCase())) continue;
      known.add(f.toLowerCase());
      added.push(f);
    }
    const nextCustom = [...custom, ...added].slice(0, MAX_CUSTOM);
    const customChanged = body.custom !== undefined || added.length > 0;

    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO temp_checks (member_id, date, sleep, feelings, goal, goal_skipped, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(member_id, date) DO UPDATE SET sleep = excluded.sleep, feelings = excluded.feelings, goal = excluded.goal, goal_skipped = excluded.goal_skipped, updated_at = excluded.updated_at`,
      ).bind(id, date, sleepStored, feelingsStored, goal, goalSkipped ? 1 : 0, now, now),
      ...(customChanged ? [c.env.DB.prepare('UPDATE members SET temp_check_feelings = ? WHERE id = ?').bind(await sealCustom(c.env, id, nextCustom), id)] : []),
    ]);
    emit(c, 'tempcheck.changed', { memberId: id, date }); // who and which day, never the answers
    return c.json(await respond(c, id, date, (await load(c, id, date))!, who), 200);
  },
);
