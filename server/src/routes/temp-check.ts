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
//
// Goal follow-up (settings.evening): from eveningTime until midnight on a day they set a goal,
// "Did you finish your goal?" yes / partly / no with optional notes (followup, one sealed JSON,
// aad '<member>:<date>:followup'), treated like sleep and feelings above. notify.ts sends the
// prompt. Editable until midnight (today only). settings.journal off keeps only the outcome.
// The notes are journal text: answered while their journal is private (journal-privacy.ts), the day
// is marked private (temp_checks.private, never cleared) and the notes open only on a device that
// belongs to them. Others get the outcome with null notes (followupHidden) and can't change it.
//
// "How drained do you feel?" (settings.battery, the energy battery): from eveningTime until midnight,
// full / ok / low / empty or skip, sealed on its own (drained, aad '<member>:<date>:drained'). It
// calibrates their battery (battery.ts calibrate). Only their own device and parents' devices (and
// connected apps with aiHealthAccess) see or answer it: never a shared wall or another member's device.
//
// Last night's check-in: the goal check and "How drained?" for day D stay open after midnight
// (?date=D, followupOpen / drainedOpen) until LAST_NIGHT_UNTIL on D+1, their morning Temp check
// (sleep, feelings or goal answered for D+1), or a skip (lastNightSkipped), whichever comes first.
// Opening the app doesn't close it (day-started): that's how they'd come back to answer. Answers
// stay on D, so the journal, Insights and the battery read them there. Today's response says so
// (lastNight: D, and pending while something is unanswered); notify.ts sends one generic morning
// push for a pending one. A skip is kept as a sent_notifications key (a hash: it never says who
// or which day), outliving the window.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { emit } from '../bus.ts';
import { deviceOwner, ownerBlock, resolveKey, sha256Hex } from '../auth.ts';
import { seal, unseal, type EncryptionEnv } from '../crypto.ts';
import { ErrorSchema, FEELINGS, FOLLOWUP_OUTCOMES, SLEEP_ANSWERS, TempCheckSettingsSchema } from '../schemas.ts';
import { healthBlock, HEALTH_PRIVATE } from './trackers.ts';
import { DRAINED_ANSWERS } from '../battery.ts';
import { parseTempCheck, todayInTz } from './members.ts';
import { readSettings } from './settings.ts';
import { addDays, startDayFrom } from './medications.ts';
import { journalAccess, privateLevel } from '../journal-privacy.ts';

export const tempCheckRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

const MAX_CUSTOM = 30;
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date: YYYY-MM-DD');
const FeelingSchema = z.string().trim().min(1).max(40);
const SleepSchema = z.enum(SLEEP_ANSWERS);
export const DrainedSchema = z.enum([...DRAINED_ANSWERS, 'skip']);
export type DrainedAnswer = z.infer<typeof DrainedSchema>;
const NoteSchema = z.string().trim().max(500).nullable().optional().transform((v) => v || null);
export const FollowupSchema = z
  .object({ outcome: z.enum(FOLLOWUP_OUTCOMES), helped: z.string().nullable(), hindered: z.string().nullable(), next: z.string().nullable() })
  .openapi('GoalFollowup', { description: '"Did you finish your goal?" and their notes: what helped, what got in the way, next time.' });
export type Followup = z.infer<typeof FollowupSchema>;

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
    answered: z.object({ sleep: z.boolean(), feelings: z.boolean(), goal: z.boolean(), followup: z.boolean(), drained: z.boolean() }), // goal: set or skipped
    followup: FollowupSchema.nullable().openapi({ description: 'Their evening goal check. null when not answered or withheld (private).' }),
    followupHidden: z.boolean().openapi({ description: "The goal-check notes were written in a private journal and this device isn't theirs: followup has the outcome, notes null." }),
    followupOpen: z.boolean().openapi({ description: 'The evening goal check is showing: on, a goal set today, and past their eveningTime (household time).' }),
    custom: z.array(z.string()).nullable().openapi({ description: 'Their own feelings, added with "Other" (the built-in ones are great, good, fine, ok, bad, awful, tired, sore). null when withheld.' }),
    drained: DrainedSchema.nullable().openapi({ description: '"How drained do you feel?" (energy battery on): full, ok, low, empty or skip. null when not answered or withheld (private).' }),
    drainedOpen: z.boolean().openapi({ description: 'The drained question is showing: battery on, today past their eveningTime (or last night\'s, still open), and this is their own device or a parent\'s.' }),
    lastNight: z.object({ date: z.string(), pending: z.boolean() }).nullable().openapi({ description: "Today's response only: last night's evening check (date) is still open until noon, their morning Temp check or a skip; pending while one of its questions is unanswered. null otherwise." }),
  })
  .openapi('TempCheck');

const TempCheckInputSchema = z
  .object({
    sleep: SleepSchema.nullable().optional(),
    feelings: z.array(FeelingSchema).max(12).nullable().optional().openapi({ description: 'Any not in the built-ins or their own list joins their own list.' }),
    goal: z.string().trim().max(140).nullable().optional().openapi({ description: 'Setting a goal clears goalSkipped; goalSkipped: true clears the goal.' }),
    goalSkipped: z.boolean().optional(),
    custom: z.array(FeelingSchema).max(MAX_CUSTOM).optional().openapi({ description: 'Replaces their own feelings list (to remove one). Not from a shared wall screen.' }),
    followup: z
      .object({ outcome: z.enum(FOLLOWUP_OUTCOMES), helped: NoteSchema, hindered: NoteSchema, next: NoteSchema })
      .optional()
      .openapi({ description: 'The evening goal check (today, or last night while open, with the evening check on and a goal set). Notes up to 500 characters each; dropped when their journal setting is off.' }),
    drained: DrainedSchema.optional().openapi({ description: '"How drained do you feel?" (today, or last night while open, with their energy battery on). Their own device or a parent\'s.' }),
    lastNightSkipped: z.literal(true).optional().openapi({ description: "With ?date= last night: skip last night's check-in. Closes it for good (no more answers, no morning reminder). Sent on its own." }),
  })
  .openapi('TempCheckInput');

export type TempCheckRow = { member_id: string; date: string; sleep: string | null; feelings: string | null; goal: string | null; goal_skipped: number; followup: string | null; drained?: string | null; private?: number; created_at: string; updated_at: string };
type Access = 'full' | 'wall' | 'none';

/** What this caller may see of `memberId`'s answers (see the top of the file). */
async function access(c: C, memberId: string): Promise<Access> {
  if ((await resolveKey(c))?.scope === 'display') {
    const owner = await deviceOwner(c);
    return owner === memberId ? 'full' : owner ? 'none' : 'wall';
  }
  return (await healthBlock(c)) ? 'none' : 'full';
}

const aad = (memberId: string, date: string, col: 'sleep' | 'feelings' | 'followup' | 'drained') => `${memberId}:${date}:${col}`;
const customAad = (memberId: string) => `${memberId}:temp_check_feelings`;
const sealMaybe = (env: EncryptionEnv, v: string | null, a: string) => (v === null ? null : seal(env, v, a));
const openMaybe = (env: EncryptionEnv, v: string | null, a: string) => (v === null ? null : unseal(env, v, a));

export async function readCustom(env: EncryptionEnv, memberId: string, stored: string | null): Promise<string[]> {
  return stored ? (JSON.parse(await unseal(env, stored, customAad(memberId))) as string[]) : [];
}
export const sealCustom = async (env: EncryptionEnv, memberId: string, list: string[]) => (list.length ? seal(env, JSON.stringify(list), customAad(memberId)) : null);

/** A stored row, opened (sealed values throw without the right key: never read as empty). On a
 * private day the goal-check notes stay out (followupHidden) unless `readPrivate` (the caller is theirs). */
export async function openTempCheck(env: EncryptionEnv, r: TempCheckRow, readPrivate = true) {
  const feelings = await openMaybe(env, r.feelings, aad(r.member_id, r.date, 'feelings'));
  const opened = await openMaybe(env, r.followup ?? null, aad(r.member_id, r.date, 'followup'));
  const followupHidden = !!r.private && !readPrivate && opened !== null;
  const followup = opened === null ? null : (JSON.parse(opened) as Followup);
  return {
    sleep: (await openMaybe(env, r.sleep, aad(r.member_id, r.date, 'sleep'))) as (typeof SLEEP_ANSWERS)[number] | null, feelings: feelings === null ? null : (JSON.parse(feelings) as string[]),
    goal: r.goal, goalSkipped: !!r.goal_skipped, followup: followup && followupHidden ? { outcome: followup.outcome, helped: null, hindered: null, next: null } : followup, followupHidden,
  };
}
/** "How drained do you feel?", opened: kept apart from openTempCheck so only the battery, this route and the export read it. */
export const openDrained = async (env: EncryptionEnv, r: TempCheckRow) => (await openMaybe(env, r.drained ?? null, aad(r.member_id, r.date, 'drained'))) as DrainedAnswer | null;
/** The row as stored: sleep, feelings, the follow-up and drained sealed. Throws without a key, before anything is written. */
export async function sealTempCheck(env: EncryptionEnv, memberId: string, date: string, v: { sleep: string | null; feelings: string[] | null; followup?: Followup | null; drained?: string | null }) {
  return {
    sleep: await sealMaybe(env, v.sleep, aad(memberId, date, 'sleep')), feelings: await sealMaybe(env, v.feelings && JSON.stringify(v.feelings), aad(memberId, date, 'feelings')),
    followup: await sealMaybe(env, v.followup ? JSON.stringify(v.followup) : null, aad(memberId, date, 'followup')),
    drained: await sealMaybe(env, v.drained ?? null, aad(memberId, date, 'drained')),
  };
}

/** HH:MM now in the household's timezone. */
const nowHm = (tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/** Last night's check-in closes at this household time on the next day at the latest. */
export const LAST_NIGHT_UNTIL = '12:00';
type DayAnswers = Pick<TempCheckRow, 'sleep' | 'feelings' | 'goal' | 'goal_skipped'> | null | undefined;
type EveningAnswers = Pick<TempCheckRow, 'goal' | 'goal_skipped' | 'followup' | 'drained'> | null | undefined;
/** Their morning Temp check was answered: their day started, last night closes. */
export const morningAnswered = (r: DayAnswers) => !!(r && (r.sleep || r.feelings || r.goal || r.goal_skipped));
/** An evening question on that day is still unanswered (the drained one only for a caller who may answer it). */
export const eveningPending = (s: ReturnType<typeof parseTempCheck>, r: EveningAnswers, full = true) =>
  s.on && ((s.goal && s.evening && !!r?.goal && !r.goal_skipped && !r.followup) || (s.battery && full && !r?.drained));
export const lastNightSkipKey = async (memberId: string, date: string) => `lastnight-skip:${await sha256Hex(`${memberId}:${date}`)}`;

/** Is `date` last night, still open: before noon, their morning Temp check not answered, not skipped. */
async function lastNightOpen(c: C, memberId: string, date: string, tz: string): Promise<boolean> {
  const today = todayInTz(tz);
  if (date !== addDays(today, -1) || nowHm(tz) >= LAST_NIGHT_UNTIL) return false;
  const morning = await c.env.DB.prepare('SELECT sleep, feelings, goal, goal_skipped FROM temp_checks WHERE member_id = ? AND date = ?').bind(memberId, today).first<DayAnswers>();
  if (morningAnswered(morning)) return false;
  return !(await c.env.DB.prepare('SELECT 1 FROM sent_notifications WHERE key = ?').bind(await lastNightSkipKey(memberId, date)).first());
}

async function load(c: C, memberId: string, date: string) {
  const member = await c.env.DB.prepare('SELECT temp_check, temp_check_feelings, grown_up, journal_private, journal_private_allowed FROM members WHERE id = ?').bind(memberId)
    .first<{ temp_check: string | null; temp_check_feelings: string | null; grown_up: number; journal_private: number | null; journal_private_allowed: number }>();
  if (!member) return null;
  const row = await c.env.DB.prepare('SELECT * FROM temp_checks WHERE member_id = ? AND date = ?').bind(memberId, date).first<TempCheckRow>();
  return { member, row };
}

async function respond(c: C, memberId: string, date: string, found: NonNullable<Awaited<ReturnType<typeof load>>>, who: Access) {
  const settings = parseTempCheck(found.member.temp_check);
  const empty = { sleep: null, feelings: null, goal: null, goalSkipped: false, followup: null, followupHidden: false };
  // The answers are opened only for a caller who may see them (private notes only for their own device).
  const v = found.row ? (who === 'full' ? await openTempCheck(c.env, found.row, (await journalAccess(c, memberId)) >= (found.row.private ?? 0)) : { ...empty, goal: found.row.goal, goalSkipped: !!found.row.goal_skipped }) : empty;
  const answered = { sleep: !!found.row?.sleep, feelings: !!found.row?.feelings, goal: !!found.row?.goal || !!found.row?.goal_skipped, followup: !!found.row?.followup, drained: !!found.row?.drained };
  const tz = await householdTz(c);
  const today = todayInTz(tz);
  const evening = (date === today && nowHm(tz) >= settings.eveningTime) || (await lastNightOpen(c, memberId, date, tz));
  const followupOpen = settings.on && settings.goal && settings.evening && !!found.row?.goal && evening;
  // Never on a wall or another member's device: only a caller who may see the answer is asked.
  const drainedOpen = settings.on && settings.battery && who === 'full' && evening;
  let lastNight: { date: string; pending: boolean } | null = null;
  const yesterday = addDays(today, -1);
  if (date === today && settings.on && (settings.battery || (settings.goal && settings.evening)) && (await lastNightOpen(c, memberId, yesterday, tz))) {
    const y = await c.env.DB.prepare('SELECT goal, goal_skipped, followup, drained FROM temp_checks WHERE member_id = ? AND date = ?').bind(memberId, yesterday).first<EveningAnswers>();
    const asks = (settings.battery && who === 'full') || (settings.goal && settings.evening && !!y?.goal && !y.goal_skipped);
    if (asks) lastNight = { date: yesterday, pending: eveningPending(settings, y, who === 'full') };
  }
  return {
    memberId, date, settings, private: who !== 'full', answered, followup: v.followup, followupHidden: v.followupHidden, followupOpen,
    drained: who === 'full' && found.row ? await openDrained(c.env, found.row) : null, drainedOpen, lastNight,
    sleep: v.sleep, feelings: v.feelings, goal: v.goal, goalSkipped: v.goalSkipped,
    custom: who === 'none' ? null : await readCustom(c.env, memberId, found.member.temp_check_feelings),
  };
}

const householdTz = async (c: C) => (await readSettings(c.env.DB)).timezone ?? hostTimezone();
const householdToday = async (c: C) => todayInTz(await householdTz(c));
const params = z.object({ id: z.string() });
const query = z.object({ date: DateSchema.optional() });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

tempCheckRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members/{id}/temp-check',
    tags: ['Members'],
    summary: "A member's Temp check for a day (today by default): their questions and answers. Sleep, feelings, the evening goal check (followup) and drained are sensitive: null (private: true) for a shared wall screen, another member's device, or a connected app without aiHealthAccess.",
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
    summary: "Answer (or change) a member's Temp check for a day (today by default). Only the fields sent change. Display keys: today only (and last night's followup and drained while open), and a member's own device only for them. Connected apps may set the goal; sleep, feelings, followup and drained need aiHealthAccess. followup and drained: today, or last night until noon, their morning Temp check or lastNightSkipped; drained never from a shared wall.",
    security: [{ Bearer: [] }],
    request: { params, query, body: { content: json(TempCheckInputSchema) } },
    responses: {
      200: { description: 'saved', content: json(TempCheckSchema) },
      400: { description: 'Temp check is off for them, or a bad answer', content: json(ErrorSchema) },
      403: { description: "someone else's device, another day from a display, the evening check outside its window, or health from a connected app", content: json(ErrorSchema) },
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
    // The evening check is open today, or last night until noon, their morning Temp check or a skip.
    const lastNight = date !== today && (await lastNightOpen(c, id, date, await householdTz(c)));
    const closed = { error: "The evening check can be changed that evening, or the next morning until they've checked in" };
    const eveningOnly = Object.keys(body).every((k) => k === 'followup' || k === 'drained' || k === 'lastNightSkipped');
    const display = (await resolveKey(c))?.scope === 'display';
    if (display && date !== today && !(lastNight && eveningOnly)) return c.json({ error: 'This device can only answer for today' }, 403);
    const who = await access(c, id);
    const health = body.sleep !== undefined || body.feelings !== undefined || body.custom !== undefined || body.followup !== undefined || body.drained !== undefined;
    if (health && who === 'none') return c.json(HEALTH_PRIVATE, 403);
    if (body.lastNightSkipped) {
      if (!lastNight) return c.json(closed, 403);
      if (who === 'none') return c.json(HEALTH_PRIVATE, 403);
      await c.env.DB.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(await lastNightSkipKey(id, date), new Date().toISOString()).run();
      emit(c, 'tempcheck.changed', { memberId: id, date });
      return c.json(await respond(c, id, date, found, who), 200);
    }
    if (body.drained !== undefined) {
      if (who !== 'full') return c.json({ error: "This can be answered from their own device or a parent's" }, 403);
      if (!settings.battery) return c.json({ error: 'The energy battery is off for them (Settings → Family)' }, 400);
      if (date !== today && !lastNight) return c.json(closed, 403);
    }
    if (body.custom !== undefined && who !== 'full') return c.json({ error: "Feelings can be removed from their own device or a parent's" }, 403);
    // Private goal-check notes: only their own device changes them (anyone else can't see what they'd overwrite).
    const own = (await journalAccess(c, id)) >= (found.row?.private ?? 0);
    if (body.followup !== undefined && found.row?.private && found.row.followup && !own) return c.json({ error: 'Their goal check is private: only their own devices can change it.' }, 403);

    // Only the fields sent change; the rest stay as stored (still sealed), so a wall never opens them.
    const feelings = body.feelings === undefined ? undefined : body.feelings?.length ? [...new Map(body.feelings.map((f) => [f.toLowerCase(), f])).values()] : null;
    const goal = body.goalSkipped ? null : body.goal !== undefined ? body.goal || null : (found.row?.goal ?? null); // Skip clears it
    const goalSkipped = goal ? false : (body.goalSkipped ?? !!found.row?.goal_skipped);
    if (body.followup) {
      if (!settings.evening || !settings.goal) return c.json({ error: 'The evening goal check is off for them (Settings → Family)' }, 400);
      if (date !== today && !lastNight) return c.json(closed, 403);
      if (!goal) return c.json({ error: 'There is no goal that day to check on' }, 400);
    }
    // Journal off: only yes / partly / no is kept, never the notes.
    const followup = body.followup && (settings.journal ? body.followup : { outcome: body.followup.outcome, helped: null, hindered: null, next: null });

    const fresh = await sealTempCheck(c.env, id, date, { sleep: body.sleep ?? null, feelings: feelings ?? null, followup: followup ?? null, drained: body.drained ?? null });
    const sleepStored = body.sleep !== undefined ? fresh.sleep : (found.row?.sleep ?? null);
    const feelingsStored = feelings !== undefined ? fresh.feelings : (found.row?.feelings ?? null);
    const followupStored = followup ? fresh.followup : (found.row?.followup ?? null);
    const drainedStored = body.drained ? fresh.drained : (found.row?.drained ?? null);
    const priv = Math.max(found.row?.private ?? 0, followup ? privateLevel(found.member) : 0); // never cleared or lowered (the level: journal-privacy.ts)

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
        `INSERT INTO temp_checks (member_id, date, sleep, feelings, goal, goal_skipped, followup, drained, private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(member_id, date) DO UPDATE SET sleep = excluded.sleep, feelings = excluded.feelings, goal = excluded.goal, goal_skipped = excluded.goal_skipped, followup = excluded.followup, drained = excluded.drained, private = excluded.private, updated_at = excluded.updated_at`,
      ).bind(id, date, sleepStored, feelingsStored, goal, goalSkipped ? 1 : 0, followupStored, drainedStored, priv, now, now),
      ...(customChanged ? [c.env.DB.prepare('UPDATE members SET temp_check_feelings = ? WHERE id = ?').bind(await sealCustom(c.env, id, nextCustom), id)] : []),
    ]);
    emit(c, 'tempcheck.changed', { memberId: id, date }); // who and which day, never the answers
    if (date === today) await startDayFrom(c, id); // answering starts the day ("When I start my day" medicines)
    return c.json(await respond(c, id, date, (await load(c, id, date))!, who), 200);
  },
);
